'use strict';

import Anthropic from '@anthropic-ai/sdk';
import { BaseAgent } from './base-agent.mjs';

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

      response = await this.client.messages.create(requestParams);

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
    let { signal } = options;

    // Clone messages to avoid mutating original
    let conversationMessages = [...messages];
    let currentToolUse       = null;

    // Agentic loop with streaming
    while (true) {
      if (signal?.aborted)
        throw new Error('Request aborted');

      let requestParams = {
        model:      this.model,
        max_tokens: this.maxTokens,
        messages:   conversationMessages,
        stream:     true,
      };

      if (this.system)
        requestParams.system = this.system;

      let toolDefs = this.getToolDefinitions();

      if (toolDefs.length > 0)
        requestParams.tools = toolDefs;

      let stream       = await this.client.messages.stream(requestParams);
      let contentBlocks = [];
      let stopReason   = null;

      for await (let event of stream) {
        if (signal?.aborted)
          throw new Error('Request aborted');

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            contentBlocks.push({ type: 'text', text: '' });
          } else if (event.content_block.type === 'tool_use') {
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

              yield { type: 'text', text: event.delta.text };
            }
          } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
            yield { type: 'tool_use_input', partial: event.delta.partial_json };
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolUse) {
            // Parse accumulated input
            try {
              // The full input will be in the final message
            } catch (e) {
              // Ignore parse errors during streaming
            }

            currentToolUse = null;
          }
        } else if (event.type === 'message_stop') {
          // Get the final message for complete content
          let finalMessage = await stream.finalMessage();
          contentBlocks    = finalMessage.content;
          stopReason       = finalMessage.stop_reason;
        }
      }

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
