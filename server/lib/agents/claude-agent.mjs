'use strict';

import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent.mjs';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

function debug(...args) {
  if (DEBUG)
    console.log('[ClaudeAgent]', ...args);
}

/**
 * Claude agent implementation using the Anthropic API.
 */
export class ClaudeAgent extends BaseAgent {
  /**
   * Create a new Claude agent.
   *
   * @param {object} config - Agent configuration
   * @param {string} config.apiKey - Anthropic API key
   * @param {string} [config.apiUrl] - Custom API URL
   * @param {string} [config.system] - System prompt
   * @param {string} [config.model] - Model to use
   * @param {number} [config.maxTokens] - Maximum tokens in response
   * @param {Array} [config.tools] - Available tools
   */
  constructor(config = {}) {
    super(config);

    let clientConfig = {};

    if (config.apiKey)
      clientConfig.apiKey = config.apiKey;

    if (config.apiUrl)
      clientConfig.baseURL = config.apiUrl;

    this.client    = new Anthropic(clientConfig);
    this.model     = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
  }

  static get type() {
    return 'claude';
  }

  /**
   * Send a message and get the agent's response.
   * Handles the full agentic loop.
   */
  async sendMessage(messages, options = {}) {
    let { signal } = options;
    let toolCalls    = [];
    let toolMessages = [];
    let response;

    // Clone messages to avoid mutating original
    let conversationMessages = [...messages];

    // Calculate approximate token count for diagnostics
    let totalChars = 0;
    for (let msg of conversationMessages) {
      let content = (typeof msg.content === 'string') ? msg.content : JSON.stringify(msg.content);
      totalChars += content.length;
    }
    let estimatedTokens = Math.ceil(totalChars / 4);
    debug('sendMessage called', { messageCount: conversationMessages.length, estimatedTokens });

    // Agentic loop: keep going while agent wants to use tools
    while (true) {
      if (signal?.aborted)
        throw new Error('Request aborted');

      let requestParams = {
        model:      this.model,
        max_tokens: this.maxTokens,
        messages:   conversationMessages,
      };

      if (this.system)
        requestParams.system = this.system;

      let toolDefs = this.getToolDefinitions();

      if (toolDefs.length > 0)
        requestParams.tools = toolDefs;

      let apiStartTime = Date.now();
      response = await this.client.messages.create(requestParams);
      let apiTime = Date.now() - apiStartTime;

      // Log usage info
      if (DEBUG && response.usage) {
        console.log('[ClaudeAgent] sendMessage usage:', {
          input_tokens:  response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          apiTimeMs:     apiTime,
        });
      }

      // Check if we need to execute tools
      if (response.stop_reason !== 'tool_use')
        break;

      // Add assistant response to conversation
      conversationMessages.push({
        role:    'assistant',
        content: response.content,
      });

      // Extract and execute tool calls
      let toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
      let toolResults   = [];

      for (let toolUse of toolUseBlocks) {
        if (signal?.aborted)
          throw new Error('Request aborted');

        let result;

        try {
          result = await this.executeTool(toolUse.name, toolUse.input, signal);
        } catch (error) {
          result = `Error: ${error.message}`;
        }

        toolCalls.push({
          id:     toolUse.id,
          name:   toolUse.name,
          input:  toolUse.input,
          result: result,
        });

        toolResults.push({
          type:        'tool_result',
          tool_use_id: toolUse.id,
          content:     result,
        });
      }

      // Add tool results to conversation
      let toolResultMessage = {
        role:    'user',
        content: toolResults,
      };

      conversationMessages.push(toolResultMessage);
      toolMessages.push(toolResultMessage);
    }

    return {
      content:      response.content,
      toolCalls:    toolCalls,
      toolMessages: toolMessages,
      stopReason:   response.stop_reason,
    };
  }

  /**
   * Send a message and stream the response.
   */
  async *sendMessageStream(messages, options = {}) {
    // Calculate approximate token count for diagnostics
    let totalChars     = 0;
    let messageSizes   = [];

    for (let msg of messages) {
      let content = (typeof msg.content === 'string') ? msg.content : JSON.stringify(msg.content);
      let chars   = content.length;
      totalChars += chars;
      messageSizes.push({ role: msg.role, chars });
    }

    // Rough token estimate: ~4 chars per token for English
    let estimatedTokens = Math.ceil(totalChars / 4);

    debug('sendMessageStream called', {
      messageCount:    messages.length,
      model:           this.model,
      totalChars:      totalChars,
      estimatedTokens: estimatedTokens,
    });

    // Log message sizes in debug mode
    if (DEBUG) {
      console.log('[ClaudeAgent] Message breakdown:');
      for (let i = 0; i < messageSizes.length; i++) {
        let { role, chars } = messageSizes[i];
        console.log(`  [${i}] ${role}: ${chars} chars (~${Math.ceil(chars / 4)} tokens)`);
      }
    }

    let { signal } = options;

    // Clone messages to avoid mutating original
    let conversationMessages = [...messages];
    let currentToolUse       = null;

    // Agentic loop with streaming
    while (true) {
      if (signal?.aborted) {
        debug('Request aborted');
        throw new Error('Request aborted');
      }

      let requestParams = {
        model:      this.model,
        max_tokens: this.maxTokens,
        messages:   conversationMessages,
        stream:     true,
      };

      if (this.system) {
        requestParams.system = this.system;
        debug('Using system prompt', { length: this.system.length });
      }

      let toolDefs = this.getToolDefinitions();

      if (toolDefs.length > 0) {
        requestParams.tools = toolDefs;
        debug('Using tools', { count: toolDefs.length });
      }

      debug('Calling Anthropic API', { model: requestParams.model, maxTokens: requestParams.max_tokens });

      let apiStartTime = Date.now();
      let stream;
      try {
        stream = await this.client.messages.stream(requestParams);
        let apiConnectTime = Date.now() - apiStartTime;
        debug('Stream created successfully', { connectTimeMs: apiConnectTime });
      } catch (apiError) {
        let apiErrorTime = Date.now() - apiStartTime;
        debug('API error creating stream:', { error: apiError.message, timeMs: apiErrorTime });
        throw apiError;
      }

      let contentBlocks = [];
      let stopReason   = null;
      let eventCount   = 0;

      try {
        for await (let event of stream) {
          eventCount++;
          if (signal?.aborted) {
            debug('Signal aborted during stream');
            throw new Error('Request aborted');
          }

          debug(`Event #${eventCount}:`, event.type);

          // Handle message_start for debugging (contains model info)
          if (event.type === 'message_start') {
            debug('Message started', { id: event.message?.id, model: event.message?.model });
          } else if (event.type === 'content_block_start') {
            if (event.content_block.type === 'text') {
              debug('Text block started');
              contentBlocks.push({ type: 'text', text: '' });
            } else if (event.content_block.type === 'tool_use') {
              debug('Tool use block started', { name: event.content_block.name });
              currentToolUse = {
                type:  'tool_use',
                id:    event.content_block.id,
                name:  event.content_block.name,
                input: {},
              };

              contentBlocks.push(currentToolUse);

              yield {
                type:    'tool_use_start',
                toolUse: { id: currentToolUse.id, name: currentToolUse.name },
              };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              let lastBlock = contentBlocks[contentBlocks.length - 1];

              if (lastBlock && lastBlock.type === 'text') {
                lastBlock.text += event.delta.text;
                debug('Text delta', { length: event.delta.text.length, totalLength: lastBlock.text.length });

                yield { type: 'text', text: event.delta.text };
              }
            } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
              yield { type: 'tool_use_input', partial: event.delta.partial_json };
            }
          } else if (event.type === 'content_block_stop') {
            debug('Content block stopped');
            if (currentToolUse) {
              currentToolUse = null;
            }
          } else if (event.type === 'message_delta') {
            // Contains stop_reason and usage info
            let totalTime = Date.now() - apiStartTime;
            debug('Message delta', {
              stopReason: event.delta?.stop_reason,
              usage:      event.usage,
              totalTimeMs: totalTime,
            });

            // Log and yield token usage if available
            if (event.usage) {
              if (DEBUG) {
                console.log('[ClaudeAgent] Token usage:', {
                  input_tokens:  event.usage.input_tokens,
                  output_tokens: event.usage.output_tokens,
                  totalTimeMs:   totalTime,
                });
              }

              // Yield usage info to stream handler
              yield {
                type:         'usage',
                input_tokens:  event.usage.input_tokens,
                output_tokens: event.usage.output_tokens,
              };
            }

            if (event.delta?.stop_reason)
              stopReason = event.delta.stop_reason;
          } else if (event.type === 'message_stop') {
            debug('Message stop received, getting final message');
            // Get the final message for complete content
            let finalMessage = await stream.finalMessage();
            contentBlocks    = finalMessage.content;
            stopReason       = finalMessage.stop_reason;
            debug('Final message received', { stopReason, contentBlockCount: contentBlocks.length });
          } else if (event.type === 'error') {
            debug('Stream error event', event);
            throw new Error(event.error?.message || 'Unknown stream error');
          }
        }
      } catch (streamIterError) {
        debug('Error during stream iteration:', streamIterError.message, streamIterError.stack);
        throw streamIterError;
      }

      debug('Stream loop complete', { eventCount, stopReason });

      // Check if we need to execute tools
      if (stopReason !== 'tool_use') {
        yield { type: 'done', stopReason: stopReason };
        break;
      }

      // Add assistant response to conversation
      conversationMessages.push({
        role:    'assistant',
        content: contentBlocks,
      });

      // Execute tools
      let toolUseBlocks = contentBlocks.filter((block) => block.type === 'tool_use');
      let toolResults   = [];

      for (let toolUse of toolUseBlocks) {
        if (signal?.aborted)
          throw new Error('Request aborted');

        let result;

        try {
          result = await this.executeTool(toolUse.name, toolUse.input, signal);
        } catch (error) {
          result = `Error: ${error.message}`;
        }

        yield {
          type:       'tool_result',
          toolUseId:  toolUse.id,
          toolName:   toolUse.name,
          result:     result,
        };

        toolResults.push({
          type:        'tool_result',
          tool_use_id: toolUse.id,
          content:     result,
        });
      }

      // Add tool results to conversation
      conversationMessages.push({
        role:    'user',
        content: toolResults,
      });
    }
  }
}

export default ClaudeAgent;
