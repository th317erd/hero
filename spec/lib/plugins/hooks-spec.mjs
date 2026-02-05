'use strict';

import {
  HOOK_TYPES,
  executeHook,
  beforeUserMessage,
  afterAgentResponse,
  beforeCommand,
  afterCommand,
  beforeTool,
  afterTool,
} from '../../../server/lib/plugins/hooks.mjs';

describe('Hooks module', () => {
  describe('HOOK_TYPES', () => {
    it('should define BEFORE_USER_MESSAGE', () => {
      expect(HOOK_TYPES.BEFORE_USER_MESSAGE).toBe('beforeUserMessage');
    });

    it('should define AFTER_AGENT_RESPONSE', () => {
      expect(HOOK_TYPES.AFTER_AGENT_RESPONSE).toBe('afterAgentResponse');
    });

    it('should define BEFORE_COMMAND', () => {
      expect(HOOK_TYPES.BEFORE_COMMAND).toBe('beforeCommand');
    });

    it('should define AFTER_COMMAND', () => {
      expect(HOOK_TYPES.AFTER_COMMAND).toBe('afterCommand');
    });

    it('should define BEFORE_TOOL', () => {
      expect(HOOK_TYPES.BEFORE_TOOL).toBe('beforeTool');
    });

    it('should define AFTER_TOOL', () => {
      expect(HOOK_TYPES.AFTER_TOOL).toBe('afterTool');
    });
  });

  describe('executeHook', () => {
    it('should be a function', () => {
      expect(typeof executeHook).toBe('function');
    });

    it('should return original data when no plugins loaded', async () => {
      // With no plugins installed, the hook should pass through unchanged
      let data   = { test: 'value' };
      let result = await executeHook('beforeUserMessage', data);

      expect(result).toBe(data);
    });

    it('should respect AbortSignal', async () => {
      let controller = new AbortController();
      controller.abort();

      await expectAsync(executeHook('beforeUserMessage', 'test', {}, controller.signal))
        .toBeRejectedWithError(/aborted/);
    });
  });

  describe('hook helper functions', () => {
    it('beforeUserMessage should be a function', () => {
      expect(typeof beforeUserMessage).toBe('function');
    });

    it('afterAgentResponse should be a function', () => {
      expect(typeof afterAgentResponse).toBe('function');
    });

    it('beforeCommand should be a function', () => {
      expect(typeof beforeCommand).toBe('function');
    });

    it('afterCommand should be a function', () => {
      expect(typeof afterCommand).toBe('function');
    });

    it('beforeTool should be a function', () => {
      expect(typeof beforeTool).toBe('function');
    });

    it('afterTool should be a function', () => {
      expect(typeof afterTool).toBe('function');
    });

    it('beforeUserMessage should pass through data when no plugins', async () => {
      let result = await beforeUserMessage('hello', {});
      expect(result).toBe('hello');
    });

    it('afterAgentResponse should pass through data when no plugins', async () => {
      let response = { content: [{ type: 'text', text: 'Hi' }] };
      let result   = await afterAgentResponse(response, {});
      expect(result).toBe(response);
    });

    it('beforeCommand should pass through data when no plugins', async () => {
      let data   = { command: 'test', args: 'arg1' };
      let result = await beforeCommand(data, {});
      expect(result).toBe(data);
    });
  });
});
