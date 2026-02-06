'use strict';

// ============================================================================
// Interaction System Tests
// ============================================================================
// Comprehensive tests for the interaction framework.
// Tests simulate both "agent" and "user/system" sides of interactions.

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { InteractionFunction, PERMISSION } from '../../../server/lib/interactions/function.mjs';
import {
  InteractionBus,
  getInteractionBus,
  TARGETS,
  getAgentMessages,
  queueAgentMessage,
  clearAgentMessages,
} from '../../../server/lib/interactions/bus.mjs';
import {
  detectInteractions,
  executeInteractions,
  formatInteractionFeedback,
} from '../../../server/lib/interactions/detector.mjs';
import {
  SystemFunction,
  registerFunctionClass,
  unregisterFunctionClass,
  getRegisteredFunctionClass,
  getRegisteredFunctionNames,
  getAllRegisteredFunctions,
  clearRegisteredFunctions,
  getSystemFunction,
  initializeSystemFunction,
  checkSystemFunctionAllowed,
  buildAgentInstructions,
} from '../../../server/lib/interactions/functions/system.mjs';
import { WebSearchFunction } from '../../../server/lib/interactions/functions/websearch.mjs';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * A simple test function for testing the registration system.
 */
class EchoFunction extends InteractionFunction {
  static register() {
    return {
      name:        'echo',
      description: 'Echoes back the input payload',
      target:      '@system',
      permission:  PERMISSION.ALWAYS,
      schema: {
        type:       'object',
        properties: {
          message: {
            type:        'string',
            description: 'Message to echo',
          },
        },
        required: ['message'],
      },
      examples: [
        {
          description: 'Echo a message',
          payload:     { message: 'Hello, World!' },
        },
      ],
    };
  }

  constructor(context = {}) {
    super('echo', context);
  }

  async execute(params) {
    return {
      echoed:    params.message,
      timestamp: Date.now(),
    };
  }
}

/**
 * A function that requires permission check.
 */
class RestrictedFunction extends InteractionFunction {
  static register() {
    return {
      name:        'restricted',
      description: 'A function with permission checks',
      target:      '@system',
      permission:  PERMISSION.ALWAYS,
      schema: {
        type:       'object',
        properties: {
          action: {
            type:        'string',
            description: 'Action to perform',
          },
        },
      },
    };
  }

  constructor(context = {}) {
    super('restricted', context);
    this.blockedActions = ['delete', 'destroy', 'drop'];
  }

  async allowed(payload, context = {}) {
    if (!payload || !payload.action) {
      return { allowed: false, reason: 'Action is required' };
    }

    if (this.blockedActions.includes(payload.action.toLowerCase())) {
      return { allowed: false, reason: `Action '${payload.action}' is not allowed` };
    }

    return { allowed: true };
  }

  async execute(params) {
    return { performed: params.action };
  }
}

/**
 * A disabled function.
 */
class DisabledFunction extends InteractionFunction {
  static register() {
    return {
      name:        'disabled',
      description: 'A disabled function',
      target:      '@system',
      permission:  PERMISSION.NEVER,
    };
  }

  constructor(context = {}) {
    super('disabled', context);
  }

  async execute(params) {
    return { should: 'never reach here' };
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simulate an agent sending an interaction request as an <interaction> tag.
 * Keeps single objects as single (not wrapped in array).
 */
function agentResponse(interactions) {
  return '<interaction>' + JSON.stringify(interactions, null, 2) + '</interaction>';
}

/**
 * Create a mock context for testing.
 */
function createContext(overrides = {}) {
  return {
    sessionId: 'test-session-123',
    userId:    1,
    dataKey:   'test-key',
    ...overrides,
  };
}

// ============================================================================
// InteractionFunction Base Class Tests
// ============================================================================

describe('InteractionFunction', () => {
  describe('static registration', () => {
    it('should throw if register() is not implemented', () => {
      class BadFunction extends InteractionFunction {}
      assert.throws(() => BadFunction.register(), /must be implemented/);
    });

    it('should return registration info when implemented', () => {
      let reg = EchoFunction.register();
      assert.equal(reg.name, 'echo');
      assert.equal(reg.description, 'Echoes back the input payload');
      assert.ok(reg.schema);
    });

    it('should have static functionName getter', () => {
      assert.equal(EchoFunction.functionName, 'echo');
    });

    it('should have static isRegisterable getter', () => {
      assert.equal(EchoFunction.isRegisterable, true);

      class BadFunction extends InteractionFunction {}
      assert.equal(BadFunction.isRegisterable, false);
    });
  });

  describe('instance lifecycle', () => {
    it('should start in pending state', () => {
      let func = new EchoFunction();
      assert.equal(func.state, 'pending');
      assert.ok(func.id);
      assert.equal(func.name, 'echo');
    });

    it('should transition to running then completed on success', async () => {
      let func = new EchoFunction();
      let states = [];

      func.on('start', () => states.push('start'));
      func.on('complete', () => states.push('complete'));

      let result = await func.start({ message: 'test' });

      assert.equal(func.state, 'completed');
      assert.deepEqual(states, ['start', 'complete']);
      assert.equal(result.echoed, 'test');
    });

    it('should transition to failed on error', async () => {
      class FailingFunction extends InteractionFunction {
        static register() {
          return { name: 'failing', description: 'Fails' };
        }
        async execute() {
          throw new Error('Intentional failure');
        }
      }

      let func = new FailingFunction();
      let errorEmitted = false;
      func.on('error', () => errorEmitted = true);

      // Catch the execution promise rejection to prevent unhandled rejection
      func.execution.catch(() => {});

      await assert.rejects(
        () => func.start({}),
        { message: 'Intentional failure' }
      );

      assert.equal(func.state, 'failed');
      assert.ok(errorEmitted);
    });

    it('should not start twice', async () => {
      let func = new EchoFunction();
      await func.start({ message: 'test' });

      await assert.rejects(
        () => func.start({ message: 'again' }),
        /Cannot start function in state/
      );
    });

    it('should cancel pending function', () => {
      class SlowFunction extends InteractionFunction {
        static register() {
          return { name: 'slow', description: 'Slow' };
        }
        async execute() {
          await new Promise((r) => setTimeout(r, 1000));
          return 'done';
        }
      }

      let func = new SlowFunction();
      assert.equal(func.state, 'pending');

      // Catch the execution promise rejection to prevent unhandled rejection
      func.execution.catch(() => {});

      // Cancel before starting
      let cancelled = func.cancel('Test cancellation');
      assert.equal(cancelled, true);
      assert.equal(func.state, 'cancelled');
    });
  });

  describe('permission checking', () => {
    it('should allow by default', async () => {
      let func = new EchoFunction();
      let result = await func.allowed({ message: 'test' }, {});
      assert.equal(result.allowed, true);
    });

    it('should deny when custom allowed() returns false', async () => {
      let func = new RestrictedFunction();
      let result = await func.allowed({ action: 'delete' }, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('not allowed'));
    });

    it('should allow when custom allowed() returns true', async () => {
      let func = new RestrictedFunction();
      let result = await func.allowed({ action: 'read' }, {});
      assert.equal(result.allowed, true);
    });

    it('should deny for PERMISSION.NEVER functions', async () => {
      let func = new DisabledFunction();
      let result = await func.allowed({}, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('disabled'));
    });
  });
});

// ============================================================================
// InteractionBus Tests
// ============================================================================

describe('InteractionBus', () => {
  let bus;

  beforeEach(() => {
    bus = new InteractionBus();
  });

  describe('interaction creation', () => {
    it('should create interaction with all fields', () => {
      let interaction = bus.create('@system', 'echo', { message: 'test' }, {
        sourceId:  'agent-1',
        sessionId: 123,
        userId:    1,
      });

      assert.ok(interaction.interaction_id);
      assert.equal(interaction.target_id, '@system');
      assert.equal(interaction.target_property, 'echo');
      assert.deepEqual(interaction.payload, { message: 'test' });
      assert.equal(interaction.source_id, 'agent-1');
      assert.equal(interaction.session_id, 123);
      assert.equal(interaction.user_id, 1);
      assert.ok(interaction.ts);
    });
  });

  describe('handler registration', () => {
    it('should register and invoke handlers for @ targets', async () => {
      let called = false;
      bus.registerHandler('@test', async (interaction) => {
        called = true;
        return { received: interaction.payload };
      });

      let interaction = bus.create('@test', 'method', { data: 'hello' });
      let result = await bus.send(interaction);

      assert.ok(called);
      assert.deepEqual(result, { received: { data: 'hello' } });
    });

    it('should unregister handlers', async () => {
      bus.registerHandler('@removable', async () => 'result');
      assert.ok(bus.unregisterHandler('@removable'));

      let interaction = bus.create('@removable', 'method', {});
      await assert.rejects(
        () => bus.send(interaction),
        /No handler for target/
      );
    });
  });

  describe('@agent message queue', () => {
    it('should queue messages for agent', () => {
      queueAgentMessage('session-1', 'int-123', 'update', { status: 'pending' });
      queueAgentMessage('session-1', 'int-456', 'update', { status: 'completed' });

      let messages = getAgentMessages('session-1');
      assert.equal(messages.length, 2);
      assert.equal(messages[0].interaction_id, 'int-123');
      assert.equal(messages[1].interaction_id, 'int-456');
    });

    it('should clear queue after retrieval by default', () => {
      queueAgentMessage('session-1', 'int-123', 'update', { status: 'pending' });
      getAgentMessages('session-1');
      let messages = getAgentMessages('session-1');
      assert.equal(messages.length, 0);
    });

    it('should preserve queue with clear=false', () => {
      queueAgentMessage('session-1', 'int-123', 'update', { status: 'pending' });
      getAgentMessages('session-1', false);
      let messages = getAgentMessages('session-1');
      assert.equal(messages.length, 1);
    });

    it('should separate messages by session', () => {
      queueAgentMessage('session-1', 'int-1', 'update', { for: 'session-1' });
      queueAgentMessage('session-2', 'int-2', 'update', { for: 'session-2' });

      assert.equal(getAgentMessages('session-1').length, 1);
      assert.equal(getAgentMessages('session-2').length, 1);
    });

    it('should clear agent messages', () => {
      queueAgentMessage('session-1', 'int-1', 'update', {});
      clearAgentMessages('session-1');
      assert.equal(getAgentMessages('session-1').length, 0);
    });
  });

  describe('pending interactions', () => {
    it('should resolve pending interaction', async () => {
      let interaction = bus.create('@user', 'prompt', { text: 'yes or no?' });

      // Simulate async resolution
      setTimeout(() => {
        bus.respond(interaction.interaction_id, { answer: 'yes' });
      }, 10);

      let result = await bus.request(interaction);
      assert.deepEqual(result, { answer: 'yes' });
    });

    it('should reject pending interaction', async () => {
      let interaction = bus.create('@user', 'prompt', { text: 'yes or no?' });

      setTimeout(() => {
        bus.respond(interaction.interaction_id, 'User cancelled', false);
      }, 10);

      await assert.rejects(
        () => bus.request(interaction),
        /User cancelled/
      );
    });

    it('should timeout pending interaction', async () => {
      let interaction = bus.create('@user', 'prompt', {});
      await assert.rejects(
        () => bus.request(interaction, 50),
        /timed out/
      );
    });
  });

  describe('history', () => {
    it('should track interaction history', () => {
      bus.create('@system', 'echo', { m: 1 });
      bus.create('@system', 'echo', { m: 2 });

      let int1 = bus.create('@system', 'echo', { m: 1 }, { sessionId: 1 });
      let int2 = bus.create('@system', 'echo', { m: 2 }, { sessionId: 2 });

      bus.fire(int1);
      bus.fire(int2);

      let history = bus.getHistory();
      assert.equal(history.length, 2);

      let filtered = bus.getHistory({ sessionId: 1 });
      assert.equal(filtered.length, 1);
    });
  });
});

// ============================================================================
// Interaction Detector Tests
// ============================================================================

describe('Interaction Detector', () => {
  describe('detectInteractions', () => {
    it('should detect single interaction in JSON code block', () => {
      let content = agentResponse({
        interaction_id:  'test-id-1',
        target_id:       '@system',
        target_property: 'websearch',
        payload:         { query: 'test query' },
      });

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.mode, 'single');
      assert.equal(result.interactions.length, 1);
      assert.equal(result.interactions[0].interaction_id, 'test-id-1');
    });

    it('should detect array of interactions', () => {
      let content = agentResponse([
        { interaction_id: 'id-1', target_id: '@system', target_property: 'echo', payload: { m: 1 } },
        { interaction_id: 'id-2', target_id: '@system', target_property: 'echo', payload: { m: 2 } },
      ]);

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.mode, 'sequential');
      assert.equal(result.interactions.length, 2);
    });

    it('should return null for non-interaction content', () => {
      let result = detectInteractions('Just some regular text');
      assert.equal(result, null);
    });

    it('should return null for json blocks (must use interaction tag)', () => {
      let content = '```json\n{"interaction_id": "x", "target_id": "@system", "target_property": "echo"}\n```';
      let result = detectInteractions(content);
      assert.equal(result, null);
    });

    it('should return null for interaction code blocks (must use tag)', () => {
      let content = '```interaction\n{"interaction_id": "x", "target_id": "@system", "target_property": "echo"}\n```';
      let result = detectInteractions(content);
      assert.equal(result, null);
    });

    it('should return null for interaction tag without required fields', () => {
      let content = '<interaction>{"foo": "bar"}</interaction>';
      let result = detectInteractions(content);
      assert.equal(result, null);
    });

    it('should return null for interaction tag without interaction_id', () => {
      let content = '<interaction>{"target_id": "@system", "target_property": "echo"}</interaction>';
      let result = detectInteractions(content);
      assert.equal(result, null);
    });

    it('should handle array content format', () => {
      let content = [
        { type: 'text', text: agentResponse({ interaction_id: 'id-1', target_id: '@system', target_property: 'echo', payload: {} }) },
      ];

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.interactions[0].interaction_id, 'id-1');
    });

    it('should detect interaction tags interlaced with text', () => {
      let content = `Hello! I'll help you with that.

Let me search for some information:

<interaction>
{
  "interaction_id": "search-1",
  "target_id": "@system",
  "target_property": "websearch",
  "payload": { "query": "test" }
}
</interaction>

I'll wait for the results.`;

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.mode, 'single');
      assert.equal(result.interactions[0].interaction_id, 'search-1');
    });

    it('should detect multiple interaction tags in same response', () => {
      let content = `First search:

<interaction>{ "interaction_id": "s1", "target_id": "@system", "target_property": "echo", "payload": {} }</interaction>

Second search:

<interaction>{ "interaction_id": "s2", "target_id": "@system", "target_property": "echo", "payload": {} }</interaction>`;

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.mode, 'sequential');
      assert.equal(result.interactions.length, 2);
      assert.equal(result.interactions[0].interaction_id, 's1');
      assert.equal(result.interactions[1].interaction_id, 's2');
    });

    it('should handle JSON payloads containing closing tag in string', () => {
      // The JSON contains </interaction> inside a string value - parser should find correct closing tag
      let content = '<interaction>{\n  "interaction_id": "edge-case",\n  "target_id": "@system",\n  "target_property": "echo",\n  "payload": {\n    "message": "This contains </interaction> inside the string"\n  }\n}</interaction>';

      let result = detectInteractions(content);
      assert.ok(result);
      assert.equal(result.interactions[0].interaction_id, 'edge-case');
      assert.ok(result.interactions[0].payload.message.includes('</interaction>'));
    });
  });

  describe('executeInteractions', () => {
    beforeEach(() => {
      clearRegisteredFunctions();
      registerFunctionClass(EchoFunction);
      registerFunctionClass(RestrictedFunction);
      initializeSystemFunction();
    });

    afterEach(() => {
      clearRegisteredFunctions();
    });

    it('should execute allowed interactions', async () => {
      let block = {
        mode:         'single',
        interactions: [{
          interaction_id:  'test-int-1',
          target_id:       '@system',
          target_property: 'echo',
          payload:         { message: 'Hello!' },
        }],
      };

      let context = createContext();
      let results = await executeInteractions(block, context);

      assert.equal(results.results.length, 1);
      assert.equal(results.results[0].status, 'completed');
      assert.equal(results.results[0].result.result.echoed, 'Hello!');
    });

    it('should queue status updates for agent', async () => {
      clearAgentMessages('test-session-123');

      let block = {
        mode:         'single',
        interactions: [{
          interaction_id:  'test-int-2',
          target_id:       '@system',
          target_property: 'echo',
          payload:         { message: 'Test' },
        }],
      };

      let context = createContext();
      await executeInteractions(block, context);

      let messages = getAgentMessages('test-session-123');
      assert.ok(messages.length >= 2); // pending + completed
      assert.equal(messages[0].payload.status, 'pending');
      assert.equal(messages[messages.length - 1].payload.status, 'completed');
    });

    it('should deny interactions that fail permission check', async () => {
      clearAgentMessages('test-session-123');

      let block = {
        mode:         'single',
        interactions: [{
          interaction_id:  'test-int-3',
          target_id:       '@system',
          target_property: 'restricted',
          payload:         { action: 'delete' },
        }],
      };

      let context = createContext();
      let results = await executeInteractions(block, context);

      assert.equal(results.results[0].status, 'denied');
      assert.ok(results.results[0].reason.includes('not allowed'));
    });

    it('should handle unknown functions', async () => {
      let block = {
        mode:         'single',
        interactions: [{
          interaction_id:  'test-int-4',
          target_id:       '@system',
          target_property: 'nonexistent',
          payload:         {},
        }],
      };

      let context = createContext();
      let results = await executeInteractions(block, context);

      assert.equal(results.results[0].status, 'denied');
      assert.ok(results.results[0].reason.includes('Unknown function'));
    });
  });

  describe('formatInteractionFeedback', () => {
    it('should format completed results', () => {
      let result = {
        results: [{
          interaction_id:  'id-1',
          target_id:       '@system',
          target_property: 'echo',
          status:          'completed',
          result:          { echoed: 'Hello' },
        }],
      };

      let feedback = formatInteractionFeedback(result);
      assert.ok(feedback.includes('completed'));
      assert.ok(feedback.includes('echoed'));
    });

    it('should format denied results', () => {
      let result = {
        results: [{
          interaction_id:  'id-1',
          target_id:       '@system',
          target_property: 'restricted',
          status:          'denied',
          reason:          'Action not allowed',
        }],
      };

      let feedback = formatInteractionFeedback(result);
      assert.ok(feedback.includes('denied'));
      assert.ok(feedback.includes('Action not allowed'));
    });

    it('should format failed results', () => {
      let result = {
        results: [{
          interaction_id:  'id-1',
          target_id:       '@system',
          target_property: 'broken',
          status:          'failed',
          error:           'Something went wrong',
        }],
      };

      let feedback = formatInteractionFeedback(result);
      assert.ok(feedback.includes('failed'));
      assert.ok(feedback.includes('Something went wrong'));
    });
  });
});

// ============================================================================
// SystemFunction Tests
// ============================================================================

describe('SystemFunction', () => {
  beforeEach(() => {
    clearRegisteredFunctions();
  });

  afterEach(() => {
    clearRegisteredFunctions();
  });

  describe('function registration', () => {
    it('should register function classes', () => {
      registerFunctionClass(EchoFunction);
      assert.ok(getRegisteredFunctionClass('echo'));
      assert.ok(getRegisteredFunctionNames().includes('echo'));
    });

    it('should throw for non-class registration', () => {
      assert.throws(
        () => registerFunctionClass('not a class'),
        /must be a class/
      );
    });

    it('should throw for class without register()', () => {
      class BadClass {}
      assert.throws(
        () => registerFunctionClass(BadClass),
        /must implement/
      );
    });

    it('should unregister function classes', () => {
      registerFunctionClass(EchoFunction);
      assert.ok(unregisterFunctionClass('echo'));
      assert.equal(getRegisteredFunctionClass('echo'), null);
    });

    it('should get all registered functions', () => {
      registerFunctionClass(EchoFunction);
      registerFunctionClass(RestrictedFunction);

      let all = getAllRegisteredFunctions();
      assert.equal(all.length, 2);
      assert.ok(all.find((f) => f.name === 'echo'));
      assert.ok(all.find((f) => f.name === 'restricted'));
    });
  });

  describe('handle()', () => {
    beforeEach(() => {
      registerFunctionClass(EchoFunction);
      registerFunctionClass(RestrictedFunction);
      initializeSystemFunction();
    });

    it('should dispatch to registered function', async () => {
      let system = getSystemFunction();
      let result = await system.handle({
        interaction_id:  'test-1',
        target_id:       '@system',
        target_property: 'echo',
        payload:         { message: 'Hello' },
        session_id:      1,
        user_id:         1,
      });

      assert.equal(result.status, 'completed');
      assert.equal(result.result.echoed, 'Hello');
    });

    it('should return error for unknown function', async () => {
      let system = getSystemFunction();
      let result = await system.handle({
        interaction_id:  'test-2',
        target_id:       '@system',
        target_property: 'unknown',
        payload:         {},
      });

      assert.equal(result.status, 'error');
      assert.ok(result.error.includes('Unknown function'));
    });

    it('should return denied for failed permission check', async () => {
      let system = getSystemFunction();
      let result = await system.handle({
        interaction_id:  'test-3',
        target_id:       '@system',
        target_property: 'restricted',
        payload:         { action: 'destroy' },
        session_id:      1,
        user_id:         1,
      });

      assert.equal(result.status, 'denied');
      assert.ok(result.reason.includes('not allowed'));
    });
  });

  describe('buildAgentInstructions()', () => {
    it('should build markdown instructions', () => {
      registerFunctionClass(EchoFunction);
      registerFunctionClass(RestrictedFunction);

      let instructions = buildAgentInstructions();

      assert.ok(instructions.includes('## Available System Functions'));
      assert.ok(instructions.includes('### `echo`'));
      assert.ok(instructions.includes('### `restricted`'));
      assert.ok(instructions.includes('Echoes back the input payload'));
    });

    it('should include schema in instructions', () => {
      registerFunctionClass(EchoFunction);

      let instructions = buildAgentInstructions();

      assert.ok(instructions.includes('| Property | Type | Description |'));
      assert.ok(instructions.includes('`message`'));
    });

    it('should include examples in instructions', () => {
      registerFunctionClass(EchoFunction);

      let instructions = buildAgentInstructions();

      assert.ok(instructions.includes('**Examples:**'));
      assert.ok(instructions.includes('Hello, World!'));
    });
  });
});

// ============================================================================
// WebSearchFunction Tests
// ============================================================================

describe('WebSearchFunction', () => {
  describe('registration', () => {
    it('should have correct registration info', () => {
      let reg = WebSearchFunction.register();
      assert.equal(reg.name, 'websearch');
      assert.ok(reg.description);
      assert.ok(reg.schema);
      assert.ok(reg.examples);
    });
  });

  describe('permission checking', () => {
    it('should deny missing payload', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed(null, {});
      assert.equal(result.allowed, false);
    });

    it('should deny missing url and query', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed({}, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('Either url or query is required'));
    });

    it('should deny localhost URLs', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed({ url: 'http://localhost/test' }, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('localhost'));
    });

    it('should deny private network URLs', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed({ url: 'http://192.168.1.1/admin' }, {});
      assert.equal(result.allowed, false);
      assert.ok(result.reason.includes('private network'));
    });

    it('should allow valid public URLs', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed({ url: 'https://example.com' }, {});
      assert.equal(result.allowed, true);
    });

    it('should allow search queries', async () => {
      let func = new WebSearchFunction();
      let result = await func.allowed({ query: 'test search' }, {});
      assert.equal(result.allowed, true);
    });
  });
});

// ============================================================================
// End-to-End Interaction Flow Tests
// ============================================================================

describe('End-to-End Interaction Flow', () => {
  beforeEach(() => {
    clearRegisteredFunctions();
    registerFunctionClass(EchoFunction);
    registerFunctionClass(RestrictedFunction);
    initializeSystemFunction();
  });

  afterEach(() => {
    clearRegisteredFunctions();
  });

  it('should complete full agent -> system -> agent flow', async () => {
    // 1. Agent sends interaction request (as JSON code block)
    let agentMessage = agentResponse({
      interaction_id:  'agent-req-001',
      target_id:       '@system',
      target_property: 'echo',
      payload:         { message: 'What is the capital of France?' },
    });

    // 2. System detects interaction
    let detected = detectInteractions(agentMessage);
    assert.ok(detected);
    assert.equal(detected.interactions[0].interaction_id, 'agent-req-001');

    // 3. System executes interaction
    let context = createContext({ sessionId: 'e2e-session-1' });
    clearAgentMessages('e2e-session-1');

    let results = await executeInteractions(detected, context);

    // 4. Check results
    assert.equal(results.results.length, 1);
    assert.equal(results.results[0].status, 'completed');
    assert.equal(results.results[0].result.result.echoed, 'What is the capital of France?');

    // 5. Check agent received status updates
    let agentUpdates = getAgentMessages('e2e-session-1');
    assert.ok(agentUpdates.length >= 2);

    let pendingUpdate = agentUpdates.find((u) => u.payload.status === 'pending');
    let completedUpdate = agentUpdates.find((u) => u.payload.status === 'completed');

    assert.ok(pendingUpdate);
    assert.ok(completedUpdate);
    assert.equal(pendingUpdate.interaction_id, 'agent-req-001');

    // 6. Format feedback for agent
    let feedback = formatInteractionFeedback(results);
    assert.ok(feedback.includes('completed'));
    assert.ok(feedback.includes('echoed'));
  });

  it('should handle multiple sequential interactions', async () => {
    let agentMessage = agentResponse([
      { interaction_id: 'seq-1', target_id: '@system', target_property: 'echo', payload: { message: 'First' } },
      { interaction_id: 'seq-2', target_id: '@system', target_property: 'echo', payload: { message: 'Second' } },
      { interaction_id: 'seq-3', target_id: '@system', target_property: 'restricted', payload: { action: 'read' } },
    ]);

    let detected = detectInteractions(agentMessage);
    assert.equal(detected.mode, 'sequential');
    assert.equal(detected.interactions.length, 3);

    let context = createContext({ sessionId: 'e2e-session-2' });
    clearAgentMessages('e2e-session-2');

    let results = await executeInteractions(detected, context);

    assert.equal(results.results.length, 3);
    assert.equal(results.results[0].result.result.echoed, 'First');
    assert.equal(results.results[1].result.result.echoed, 'Second');
    assert.equal(results.results[2].result.result.performed, 'read');
  });

  it('should handle mixed success and denied interactions', async () => {
    let agentMessage = agentResponse([
      { interaction_id: 'mix-1', target_id: '@system', target_property: 'echo', payload: { message: 'OK' } },
      { interaction_id: 'mix-2', target_id: '@system', target_property: 'restricted', payload: { action: 'delete' } },
      { interaction_id: 'mix-3', target_id: '@system', target_property: 'echo', payload: { message: 'Also OK' } },
    ]);

    let detected = detectInteractions(agentMessage);
    let context = createContext({ sessionId: 'e2e-session-3' });
    let results = await executeInteractions(detected, context);

    assert.equal(results.results[0].status, 'completed');
    assert.equal(results.results[1].status, 'denied');
    assert.equal(results.results[2].status, 'completed');

    let feedback = formatInteractionFeedback(results);
    assert.ok(feedback.includes('completed'));
    assert.ok(feedback.includes('denied'));
  });

  it('should provide useful feedback to agent on error', async () => {
    let agentMessage = agentResponse({
      interaction_id:  'err-1',
      target_id:       '@system',
      target_property: 'nonexistent_function',
      payload:         {},
    });

    let detected = detectInteractions(agentMessage);
    let context = createContext({ sessionId: 'e2e-session-4' });
    let results = await executeInteractions(detected, context);

    assert.equal(results.results[0].status, 'denied');

    let feedback = formatInteractionFeedback(results);
    assert.ok(feedback.includes('Unknown function'));
    assert.ok(feedback.includes('Available'));
  });
});

// ============================================================================
// HelpFunction Tests
// ============================================================================

import { HelpFunction } from '../../../server/lib/interactions/functions/help.mjs';

describe('HelpFunction', () => {
  beforeEach(() => {
    clearRegisteredFunctions();
    registerFunctionClass(EchoFunction);
    registerFunctionClass(RestrictedFunction);
    registerFunctionClass(HelpFunction);
    initializeSystemFunction();
  });

  afterEach(() => {
    clearRegisteredFunctions();
  });

  describe('registration', () => {
    it('should have correct registration info', () => {
      let reg = HelpFunction.register();
      assert.equal(reg.name, 'help');
      assert.equal(reg.permission, PERMISSION.ALWAYS);
      assert.ok(reg.description);
      assert.ok(reg.schema);
      assert.ok(reg.examples);
    });

    it('should be registered as a system function', () => {
      assert.ok(getRegisteredFunctionClass('help'));
      assert.ok(getRegisteredFunctionNames().includes('help'));
    });
  });

  describe('permission checking', () => {
    it('should always allow help requests', async () => {
      let func = new HelpFunction();

      // Empty payload
      let result1 = await func.allowed({}, {});
      assert.equal(result1.allowed, true);

      // With filter
      let result2 = await func.allowed({ filter: 'echo' }, {});
      assert.equal(result2.allowed, true);

      // Null payload
      let result3 = await func.allowed(null, {});
      assert.equal(result3.allowed, true);
    });
  });

  describe('execute()', () => {
    it('should return all help categories by default', async () => {
      let func = new HelpFunction({});
      let result = await func.start({});

      assert.ok(result.success);
      assert.ok(result.commands);
      assert.ok(result.functions);
      assert.ok(result.abilities);
      assert.ok(result.assertions);
    });

    it('should return only specified category', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ category: 'functions' });

      assert.ok(result.success);
      assert.ok(result.functions);
      assert.equal(result.commands, undefined);
      assert.equal(result.abilities, undefined);
      assert.equal(result.assertions, undefined);
    });

    it('should filter results by regex pattern', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ filter: 'echo' });

      assert.ok(result.success);
      // Should find the echo function
      let echoFunc = result.functions.find((f) => f.name === 'echo');
      assert.ok(echoFunc);

      // Should not include restricted (doesn't match 'echo')
      let restrictedFunc = result.functions.find((f) => f.name === 'restricted');
      assert.equal(restrictedFunc, undefined);
    });

    it('should filter with case-insensitive regex', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ filter: 'ECHO' });

      assert.ok(result.success);
      let echoFunc = result.functions.find((f) => f.name === 'echo');
      assert.ok(echoFunc);
    });

    it('should handle complex regex patterns', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ filter: 'echo|restricted' });

      assert.ok(result.success);
      assert.ok(result.functions.find((f) => f.name === 'echo'));
      assert.ok(result.functions.find((f) => f.name === 'restricted'));
    });

    it('should return error for invalid regex', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ filter: '[invalid' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('Invalid regex'));
    });

    it('should include builtin commands', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ category: 'commands' });

      assert.ok(result.commands.builtin.length > 0);
      let helpCmd = result.commands.builtin.find((c) => c.name === 'help');
      assert.ok(helpCmd);
      assert.ok(helpCmd.description.includes('Usage'));
    });

    it('should filter commands by pattern', async () => {
      let func = new HelpFunction({});
      let result = await func.start({ category: 'commands', filter: 'session' });

      assert.ok(result.commands.builtin.find((c) => c.name === 'session'));
      assert.equal(result.commands.builtin.find((c) => c.name === 'clear'), undefined);
    });
  });

  describe('system function dispatch', () => {
    it('should be callable via SystemFunction.handle()', async () => {
      let system = getSystemFunction();
      let result = await system.handle({
        interaction_id:  'help-test-1',
        target_id:       '@system',
        target_property: 'help',
        payload:         {},
        session_id:      1,
        user_id:         1,
      });

      assert.equal(result.status, 'completed');
      assert.ok(result.result.success);
      assert.ok(result.result.functions);
    });

    it('should support filter via system dispatch', async () => {
      let system = getSystemFunction();
      let result = await system.handle({
        interaction_id:  'help-test-2',
        target_id:       '@system',
        target_property: 'help',
        payload:         { filter: 'echo' },
        session_id:      1,
        user_id:         1,
      });

      assert.equal(result.status, 'completed');
      let echoFunc = result.result.functions.find((f) => f.name === 'echo');
      assert.ok(echoFunc);
    });
  });

  describe('agent usage flow', () => {
    it('should work in full agent interaction flow', async () => {
      // Simulate agent sending help request
      let agentMessage = agentResponse({
        interaction_id:  'agent-help-1',
        target_id:       '@system',
        target_property: 'help',
        payload:         { filter: 'echo', category: 'functions' },
      });

      let detected = detectInteractions(agentMessage);
      assert.ok(detected);
      assert.equal(detected.interactions[0].target_property, 'help');

      let context = createContext({ sessionId: 'help-test-session' });
      clearAgentMessages('help-test-session');

      let results = await executeInteractions(detected, context);

      assert.equal(results.results.length, 1);
      assert.equal(results.results[0].status, 'completed');
      assert.ok(results.results[0].result.result.functions);

      // Feedback should be formatted correctly
      let feedback = formatInteractionFeedback(results);
      assert.ok(feedback.includes('completed'));
    });
  });
});

// ============================================================================
// Run Tests
// ============================================================================

console.log('Running Interaction System Tests...\n');
