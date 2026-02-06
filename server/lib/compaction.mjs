'use strict';

// ============================================================================
// Conversation Compaction System
// ============================================================================
// Automatically compacts conversation history into snapshots to manage context
// size. Uses debouncing to avoid compacting during active conversation.
//
// Thresholds:
// - MIN_THRESHOLD: Start attempting to compact (debounced)
// - MAX_THRESHOLD: Force immediate compaction
//
// Snapshots are stored as hidden messages with type='snapshot'. When loading
// history, we get the most recent snapshot + any messages after it.

import { getDatabase } from '../database.mjs';
import { broadcastToUser } from './websocket.mjs';

// Default settings (can be overridden per-agent)
const DEFAULT_MIN_THRESHOLD = 15;  // Start debounced compaction
const DEFAULT_MAX_THRESHOLD = 25;  // Force immediate compaction
const DEFAULT_DEBOUNCE_MS   = 5000; // 5 seconds debounce

// Active debounce timers per session
const debounceTimers = new Map();

// Debug logging
function debug(...args) {
  if (process.env.DEBUG)
    console.log('[Compaction]', ...args);
}

/**
 * Get compaction settings for an agent.
 */
function getCompactionSettings(agent) {
  return {
    minThreshold: agent?.config?.compactionMinThreshold || DEFAULT_MIN_THRESHOLD,
    maxThreshold: agent?.config?.compactionMaxThreshold || DEFAULT_MAX_THRESHOLD,
    debounceMs:   agent?.config?.compactionDebounceMs || DEFAULT_DEBOUNCE_MS,
    enabled:      agent?.config?.compactionEnabled !== false, // Default enabled
  };
}

/**
 * Count non-snapshot messages after the most recent snapshot.
 */
function countMessagesAfterSnapshot(sessionId) {
  let db = getDatabase();

  // Find most recent snapshot
  let snapshot = db.prepare(`
    SELECT id, created_at FROM messages
    WHERE session_id = ? AND type = 'snapshot'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);

  if (snapshot) {
    // Count messages after snapshot
    let result = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE session_id = ? AND created_at > ? AND type != 'snapshot'
    `).get(sessionId, snapshot.created_at);
    return result.count;
  } else {
    // No snapshot - count all messages
    let result = db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE session_id = ? AND type != 'snapshot'
    `).get(sessionId);
    return result.count;
  }
}

/**
 * Get messages for compaction (all messages since last snapshot).
 */
function getMessagesForCompaction(sessionId) {
  let db = getDatabase();

  // Find most recent snapshot
  let snapshot = db.prepare(`
    SELECT id, created_at FROM messages
    WHERE session_id = ? AND type = 'snapshot'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);

  let messages;
  if (snapshot) {
    messages = db.prepare(`
      SELECT role, content, type FROM messages
      WHERE session_id = ? AND created_at > ? AND type != 'snapshot' AND hidden = 0
      ORDER BY created_at ASC
    `).all(sessionId, snapshot.created_at);
  } else {
    messages = db.prepare(`
      SELECT role, content, type FROM messages
      WHERE session_id = ? AND type != 'snapshot' AND hidden = 0
      ORDER BY created_at ASC
    `).all(sessionId);
  }

  return messages;
}

/**
 * Build the compaction prompt for the agent.
 */
function buildCompactionPrompt(messages) {
  let conversation = messages.map((m) => {
    let content = (typeof m.content === 'string') ? m.content : JSON.parse(m.content);
    let role    = (m.role === 'user') ? 'User' : 'Assistant';
    return `${role}: ${content}`;
  }).join('\n\n');

  return `Please provide a concise summary of this conversation so far. Focus on:
- Key topics discussed
- Important decisions or conclusions reached
- Any ongoing tasks or context that should be remembered

Keep the summary brief but comprehensive enough to continue the conversation naturally.

CONVERSATION:
${conversation}

SUMMARY:`;
}

/**
 * Store a snapshot message.
 */
function storeSnapshot(sessionId, userId, content) {
  let db = getDatabase();

  let stmt = db.prepare(`
    INSERT INTO messages (session_id, user_id, role, content, hidden, type, created_at)
    VALUES (?, ?, 'assistant', ?, 1, 'snapshot', datetime('now'))
  `);

  let result = stmt.run(sessionId, userId, JSON.stringify(content));
  debug('Snapshot stored', { sessionId, messageId: result.lastInsertRowid, contentLength: content.length });

  return result.lastInsertRowid;
}

/**
 * Perform the actual compaction.
 */
async function performCompaction(sessionId, userId, agent) {
  debug('Performing compaction', { sessionId });

  try {
    // Get messages to compact
    let messages = getMessagesForCompaction(sessionId);

    if (messages.length < 3) {
      debug('Not enough messages to compact', { count: messages.length });
      return { success: false, reason: 'Not enough messages' };
    }

    // Build compaction prompt
    let prompt = buildCompactionPrompt(messages);

    // Ask agent to summarize
    debug('Requesting summary from agent');
    let response = await agent.sendMessage([
      { role: 'user', content: prompt },
    ], { maxTokens: 1000 });

    // Extract summary content
    let summary;
    if (typeof response.content === 'string') {
      summary = response.content;
    } else if (Array.isArray(response.content)) {
      summary = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
    }

    if (!summary) {
      debug('No summary returned from agent');
      return { success: false, reason: 'No summary returned' };
    }

    // Store snapshot
    let snapshotId = storeSnapshot(sessionId, userId, summary);

    // Broadcast to user that compaction happened (optional)
    broadcastToUser(userId, {
      type:      'compaction_complete',
      sessionId: sessionId,
      messageCount: messages.length,
    });

    debug('Compaction complete', { sessionId, snapshotId, originalMessages: messages.length });

    return {
      success:          true,
      snapshotId:       snapshotId,
      compactedCount:   messages.length,
      summaryLength:    summary.length,
    };

  } catch (error) {
    console.error('[Compaction] Error:', error);
    return { success: false, reason: error.message };
  }
}

/**
 * Check if compaction is needed and trigger if so.
 * This is the main entry point called after each message.
 */
export async function checkCompaction(sessionId, userId, agent, options = {}) {
  let settings = getCompactionSettings(agent);

  if (!settings.enabled) {
    return { triggered: false, reason: 'Compaction disabled' };
  }

  let messageCount = countMessagesAfterSnapshot(sessionId);
  debug('Checking compaction', { sessionId, messageCount, min: settings.minThreshold, max: settings.maxThreshold });

  // Below minimum - no action needed
  if (messageCount < settings.minThreshold) {
    // Clear any pending debounce
    if (debounceTimers.has(sessionId)) {
      clearTimeout(debounceTimers.get(sessionId));
      debounceTimers.delete(sessionId);
    }
    return { triggered: false, reason: 'Below threshold' };
  }

  // At or above maximum - force immediate compaction
  if (messageCount >= settings.maxThreshold || options.force) {
    debug('Max threshold reached or forced, compacting immediately');
    // Clear debounce timer
    if (debounceTimers.has(sessionId)) {
      clearTimeout(debounceTimers.get(sessionId));
      debounceTimers.delete(sessionId);
    }
    return await performCompaction(sessionId, userId, agent);
  }

  // Between min and max - debounce
  debug('Between thresholds, debouncing');

  // Clear existing timer
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
  }

  // Set new debounce timer
  return new Promise((resolve) => {
    let timer = setTimeout(async () => {
      debounceTimers.delete(sessionId);
      debug('Debounce timer fired, compacting');
      let result = await performCompaction(sessionId, userId, agent);
      resolve(result);
    }, settings.debounceMs);

    debounceTimers.set(sessionId, timer);

    // Return immediately - compaction will happen later
    resolve({ triggered: true, debounced: true, reason: 'Debounce started' });
  });
}

/**
 * Force compaction for a session (used by /compact command).
 */
export async function forceCompaction(sessionId, userId, agent) {
  debug('Force compaction requested', { sessionId });

  // Clear any pending debounce
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }

  return await performCompaction(sessionId, userId, agent);
}

/**
 * Load messages for agent context, using snapshots.
 * Returns: most recent snapshot (if any) + messages after it.
 */
export function loadMessagesWithSnapshot(sessionId, maxRecentMessages = 20) {
  let db = getDatabase();

  // Find most recent snapshot
  let snapshot = db.prepare(`
    SELECT id, content, created_at FROM messages
    WHERE session_id = ? AND type = 'snapshot'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);

  let messages = [];

  // If we have a snapshot, start with it as context
  if (snapshot) {
    let snapshotContent = JSON.parse(snapshot.content);
    messages.push({
      role:    'assistant',
      content: `[Previous conversation summary]\n${snapshotContent}`,
    });

    // Get messages after snapshot
    let recentMessages = db.prepare(`
      SELECT role, content FROM messages
      WHERE session_id = ? AND created_at > ? AND type NOT IN ('snapshot', 'system')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, snapshot.created_at, maxRecentMessages);

    for (let m of recentMessages) {
      messages.push({
        role:    m.role,
        content: JSON.parse(m.content),
      });
    }

    debug('Loaded messages with snapshot', {
      sessionId,
      snapshotId:    snapshot.id,
      recentCount:   recentMessages.length,
    });
  } else {
    // No snapshot - load recent messages directly
    let recentMessages = db.prepare(`
      SELECT role, content FROM messages
      WHERE session_id = ? AND type NOT IN ('snapshot', 'system')
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, maxRecentMessages);

    // Reverse to get chronological order
    recentMessages.reverse();

    for (let m of recentMessages) {
      messages.push({
        role:    m.role,
        content: JSON.parse(m.content),
      });
    }

    debug('Loaded messages without snapshot', {
      sessionId,
      count: messages.length,
    });
  }

  return messages;
}

export default {
  checkCompaction,
  forceCompaction,
  loadMessagesWithSnapshot,
  getCompactionSettings,
};
