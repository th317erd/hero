# MessageStore Interface Design

## Goals

1. **Single point of access** for all message/frame operations
2. **Hide implementation** - callers don't know if it's state.messages or frames
3. **Testable** - can mock the store in tests
4. **Observable** - components can subscribe to changes
5. **Future-proof** - easy to migrate to frames-only

---

## Interface Definition

```javascript
/**
 * MessageStore - Unified interface for message/frame operations
 *
 * This is the ONLY way to interact with conversation messages.
 * Do NOT access state.messages or frames directly.
 */
class MessageStore {

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Initialize store for a session
   * @param {number} sessionId
   * @param {Array} initialMessages - From API or cache
   */
  init(sessionId, initialMessages = [])

  /**
   * Clear all messages (session switch)
   */
  clear()

  // =========================================================================
  // Read Operations
  // =========================================================================

  /**
   * Get all messages (respects hidden filter)
   * @param {Object} options
   * @param {boolean} options.includeHidden - Include hidden messages
   * @returns {Array<Message>}
   */
  getAll(options = {})

  /**
   * Find message by ID (handles string/number coercion)
   * @param {string|number} id
   * @returns {Message|null}
   */
  findById(id)

  /**
   * Find message by predicate
   * @param {Function} predicate
   * @returns {Message|null}
   */
  find(predicate)

  /**
   * Check if message exists
   * @param {string|number} id
   * @returns {boolean}
   */
  has(id)

  /**
   * Get message count
   * @returns {number}
   */
  get count()

  // =========================================================================
  // Write Operations
  // =========================================================================

  /**
   * Add a new message
   * @param {Message} message
   * @returns {Message} - The added message (may have generated ID)
   */
  add(message)

  /**
   * Update an existing message
   * @param {string|number} id
   * @param {Partial<Message>} updates
   * @returns {Message|null}
   */
  update(id, updates)

  /**
   * Update message content (handles string vs array format)
   * @param {string|number} id
   * @param {Function} contentUpdater - (content) => newContent
   * @returns {boolean} - Success
   */
  updateContent(id, contentUpdater)

  /**
   * Remove a message
   * @param {string|number} id
   * @returns {boolean}
   */
  remove(id)

  /**
   * Replace a message (e.g., optimistic → real)
   * @param {string|number} oldId
   * @param {Message} newMessage
   * @returns {boolean}
   */
  replace(oldId, newMessage)

  // =========================================================================
  // Prompt-Specific Operations
  // =========================================================================

  /**
   * Mark a prompt as answered within a message
   * @param {string|number} messageId
   * @param {string} promptId
   * @param {string} answer
   * @returns {boolean}
   */
  answerPrompt(messageId, promptId, answer)

  /**
   * Find unanswered prompts across all messages
   * @returns {Array<{messageId, promptId, question}>}
   */
  findUnansweredPrompts()

  // =========================================================================
  // Optimistic UI
  // =========================================================================

  /**
   * Add an optimistic message (not yet confirmed by server)
   * @param {Message} message
   * @returns {string} - Temporary ID
   */
  addOptimistic(message)

  /**
   * Confirm an optimistic message with real ID
   * @param {string} tempId
   * @param {Message} realMessage
   */
  confirmOptimistic(tempId, realMessage)

  /**
   * Remove a failed optimistic message
   * @param {string} tempId
   */
  rejectOptimistic(tempId)

  // =========================================================================
  // Subscriptions (Observable)
  // =========================================================================

  /**
   * Subscribe to store changes
   * @param {Function} callback - (event: {type, message?, messages?}) => void
   * @returns {Function} - Unsubscribe function
   */
  subscribe(callback)

  /**
   * Notify all subscribers
   * @param {Object} event
   */
  _notify(event)
}
```

---

## Event Types

```javascript
const MessageStoreEvents = {
  INIT: 'init',           // Store initialized with messages
  CLEAR: 'clear',         // Store cleared
  ADD: 'add',             // Message added
  UPDATE: 'update',       // Message updated
  REMOVE: 'remove',       // Message removed
  REPLACE: 'replace',     // Message replaced
  BULK_UPDATE: 'bulk',    // Multiple messages changed
};
```

---

## Message Type

```javascript
/**
 * @typedef {Object} Message
 * @property {string|number} id
 * @property {'user'|'assistant'|'system'} role
 * @property {string|ContentBlock[]} content
 * @property {string} createdAt - ISO timestamp
 * @property {boolean} [hidden] - Hidden from UI but sent to AI
 * @property {boolean} [optimistic] - Not yet confirmed by server
 * @property {string} [optimisticId] - Temp ID for optimistic messages
 */
```

---

## Usage Examples

```javascript
// BEFORE (scattered, fragile)
state.messages.push({ role: 'user', content: text });
let msg = state.messages.find(m => m.id === id);
state.messages[idx].content = updated;

// AFTER (centralized, robust)
import { messageStore } from './stores/message-store.js';

messageStore.add({ role: 'user', content: text });
let msg = messageStore.findById(id);
messageStore.updateContent(id, content => content.replace(...));

// Prompt answering (BEFORE)
updatePromptInState(messageId, promptId, answer);

// Prompt answering (AFTER)
messageStore.answerPrompt(messageId, promptId, answer);

// Subscribing to changes
const unsubscribe = messageStore.subscribe(event => {
  if (event.type === 'update') {
    heroChat.render();
  }
});
```

---

## Implementation Notes

### Phase 1: Create Store with state.messages Backend

```javascript
// Initial implementation uses state.messages internally
// This allows gradual migration - callers use new API,
// but implementation still uses old storage

class MessageStore {
  #messages = [];  // This IS state.messages, just owned by store
  #subscribers = new Set();

  // ... implementation
}

// Export singleton
export const messageStore = new MessageStore();

// Expose as window.messageStore for debugging
if (typeof window !== 'undefined') {
  window.messageStore = messageStore;
}
```

### Phase 2: Migrate Callers

Replace all 31 `state.messages` references with `messageStore.*` calls.

### Phase 3: Switch to Frames Backend

```javascript
// Later, change internal implementation to use frames
class MessageStore {
  get #messages() {
    // Now reads from frames provider!
    const provider = document.getElementById('session-frames');
    return provider?.frames
      ?.filter(f => f.type === 'message')
      ?.map(frameToMessage) || [];
  }

  // Write operations go through server/WebSocket
  add(message) {
    // POST to server, server creates frame, broadcasts via WebSocket
    // Provider updates, our getter returns new data
  }
}
```

---

## File Structure

```
public/js/
├── stores/
│   ├── message-store.js      # MessageStore class
│   ├── message-store.test.js # Unit tests
│   └── index.js              # Export all stores
├── app.js                    # Uses messageStore
├── streaming.js              # Uses messageStore
├── commands.js               # Uses messageStore
└── approvals.js              # Uses messageStore
```

---

## Migration Checklist

- [ ] Create `public/js/stores/message-store.js`
- [ ] Write tests for MessageStore
- [ ] Migrate `app.js` (14 usages)
- [ ] Migrate `streaming.js` (5 usages)
- [ ] Migrate `commands.js` (5 usages)
- [ ] Migrate `approvals.js` (5 usages)
- [ ] Migrate `hero-app.js` (1 usage)
- [ ] Remove `state.messages` from state object
- [ ] Update hero-chat to subscribe to messageStore
- [ ] Integration tests pass
