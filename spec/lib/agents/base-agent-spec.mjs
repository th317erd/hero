'use strict';

import { BaseAgent } from '../../../server/lib/agents/base-agent.mjs';

describe('BaseAgent', () => {
  describe('constructor', () => {
    it('should initialize with default values', () => {
      let agent = new BaseAgent();

      expect(agent.apiKey).toBeUndefined();
      expect(agent.apiUrl).toBeUndefined();
      expect(agent.system).toBe('');
      expect(agent.tools).toEqual([]);
    });

    it('should accept configuration options', () => {
      let tools = [{ name: 'test_tool' }];
      let agent = new BaseAgent({
        apiKey: 'test-key',
        apiUrl: 'https://test.api',
        system: 'You are a test agent',
        tools:  tools,
      });

      expect(agent.apiKey).toBe('test-key');
      expect(agent.apiUrl).toBe('https://test.api');
      expect(agent.system).toBe('You are a test agent');
      expect(agent.tools).toBe(tools);
    });
  });

  describe('sendMessage', () => {
    it('should throw "not implemented" error', async () => {
      let agent = new BaseAgent();

      await expectAsync(agent.sendMessage([]))
        .toBeRejectedWithError(/must be implemented/);
    });
  });

  describe('sendMessageStream', () => {
    it('should throw "not implemented" error', async () => {
      let agent    = new BaseAgent();
      let iterator = agent.sendMessageStream([]);

      await expectAsync(iterator.next())
        .toBeRejectedWithError(/must be implemented/);
    });
  });

  describe('executeTool', () => {
    it('should throw error for unknown tool', async () => {
      let agent = new BaseAgent();

      await expectAsync(agent.executeTool('unknown_tool', {}))
        .toBeRejectedWithError(/not found/);
    });

    it('should throw error for tool without execute function', async () => {
      let agent = new BaseAgent({
        tools: [{ name: 'no_execute_tool' }],
      });

      await expectAsync(agent.executeTool('no_execute_tool', {}))
        .toBeRejectedWithError(/no execute function/);
    });

    it('should execute tool with execute function', async () => {
      let agent = new BaseAgent({
        tools: [{
          name:    'test_tool',
          execute: async (input) => `Result: ${input.value}`,
        }],
      });

      let result = await agent.executeTool('test_tool', { value: 42 });

      expect(result).toBe('Result: 42');
    });

    it('should pass abort signal to tool', async () => {
      let receivedSignal = null;
      let agent = new BaseAgent({
        tools: [{
          name:    'signal_tool',
          execute: async (input, signal) => {
            receivedSignal = signal;
            return 'done';
          },
        }],
      });

      let controller = new AbortController();
      await agent.executeTool('signal_tool', {}, controller.signal);

      expect(receivedSignal).toBe(controller.signal);
    });
  });

  describe('getToolDefinitions', () => {
    it('should return empty array when no tools', () => {
      let agent = new BaseAgent();

      expect(agent.getToolDefinitions()).toEqual([]);
    });

    it('should return tool definitions in API format', () => {
      let agent = new BaseAgent({
        tools: [{
          name:         'my_tool',
          description:  'A test tool',
          input_schema: { type: 'object', properties: {} },
          execute:      async () => 'result',
        }],
      });

      let defs = agent.getToolDefinitions();

      expect(defs).toEqual([{
        name:         'my_tool',
        description:  'A test tool',
        input_schema: { type: 'object', properties: {} },
      }]);
    });

    it('should handle inputSchema alias', () => {
      let agent = new BaseAgent({
        tools: [{
          name:        'alias_tool',
          description: 'Uses inputSchema instead',
          inputSchema: { type: 'object' },
        }],
      });

      let defs = agent.getToolDefinitions();

      expect(defs[0].input_schema).toEqual({ type: 'object' });
    });
  });

  describe('setTools', () => {
    it('should replace tools array', () => {
      let agent = new BaseAgent({ tools: [{ name: 'old' }] });
      let newTools = [{ name: 'new' }];

      agent.setTools(newTools);

      expect(agent.tools).toBe(newTools);
    });
  });

  describe('addTool', () => {
    it('should add a tool', () => {
      let agent = new BaseAgent();
      let tool  = { name: 'added_tool' };

      agent.addTool(tool);

      expect(agent.tools).toContain(tool);
    });

    it('should replace tool with same name', () => {
      let agent    = new BaseAgent({ tools: [{ name: 'tool', version: 1 }] });
      let newTool  = { name: 'tool', version: 2 };

      agent.addTool(newTool);

      expect(agent.tools.length).toBe(1);
      expect(agent.tools[0].version).toBe(2);
    });
  });
});
