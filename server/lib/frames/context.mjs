'use strict';

// ============================================================================
// Frame-Based Context Builder
// ============================================================================
// Builds conversation context for AI from frames instead of messages.
// Uses frame compilation to build the effective state.

import {
  getFrames,
  getLatestCompact,
  compileFrames,
  FrameType,
  AuthorType,
} from './index.mjs';

// Debug logging
function debug(...args) {
  if (process.env.DEBUG)
    console.log('[FrameContext]', ...args);
}

/**
 * Load frames for AI context, using compact frames as checkpoints.
 * Returns frames compiled into a format suitable for the AI.
 *
 * @param {number} sessionId - Session ID
 * @param {Object} [options] - Options
 * @param {number} [options.maxRecentFrames] - Max frames to load after compact
 * @param {Database} [db] - Optional database instance for testing
 * @returns {Object[]} Array of messages in AI format [{role, content}]
 */
export function loadFramesForContext(sessionId, options = {}, db = null) {
  const { maxRecentFrames = 50 } = options;

  // Get frames from the most recent compact point forward
  const frames = getFrames(sessionId, { fromCompact: true, limit: maxRecentFrames }, db);

  debug('Loading frames for context', {
    sessionId,
    frameCount: frames.length,
    fromCompact: true,
  });

  if (frames.length === 0) {
    return [];
  }

  // Compile frames to get effective state
  const compiled = compileFrames(frames);

  // Convert compiled frames to AI message format
  const messages = [];

  // Check if we have a compact frame - if so, add its snapshot as context
  const compactFrame = frames.find((f) => f.type === FrameType.COMPACT);
  if (compactFrame && compactFrame.payload.context) {
    messages.push({
      role: 'assistant',
      content: `[RESTORED CONTEXT - Continue from here]\n\n${compactFrame.payload.context}\n\n[END RESTORED CONTEXT - Resume conversation below]`,
    });
  }

  // Process message frames in order
  for (const frame of frames) {
    // Skip non-message frames
    if (frame.type !== FrameType.MESSAGE) {
      continue;
    }

    // Get compiled content (may have been updated)
    const content = compiled.get(frame.id);
    if (!content) {
      continue;
    }

    // Determine role from author type or payload
    let role;
    if (content.role) {
      role = content.role;
    } else if (frame.authorType === AuthorType.USER) {
      role = 'user';
    } else if (frame.authorType === AuthorType.AGENT) {
      role = 'assistant';
    } else if (frame.authorType === AuthorType.SYSTEM) {
      role = 'user'; // System messages sent as user for context
    } else {
      role = 'user';
    }

    // Extract content string
    let messageContent;
    if (typeof content === 'string') {
      messageContent = content;
    } else if (content.content) {
      messageContent = content.content;
    } else if (content.text) {
      messageContent = content.text;
    } else {
      // Fall back to JSON stringification for complex payloads
      messageContent = JSON.stringify(content);
    }

    messages.push({
      role,
      content: messageContent,
    });
  }

  // Also include request/result frames as context (important for multi-turn)
  for (const frame of frames) {
    if (frame.type === FrameType.REQUEST) {
      const content = compiled.get(frame.id);
      if (content && content.feedback) {
        // This request has been answered - include the feedback
        messages.push({
          role: 'user',
          content: `[Interaction Result]\n${JSON.stringify(content.feedback)}`,
        });
      }
    } else if (frame.type === FrameType.RESULT) {
      const content = compiled.get(frame.id);
      if (content) {
        messages.push({
          role: 'user',
          content: `[System Result]\n${JSON.stringify(content)}`,
        });
      }
    }
  }

  debug('Context built from frames', {
    sessionId,
    messageCount: messages.length,
    frameCount: frames.length,
  });

  return messages;
}

/**
 * Get the raw frames for a session, suitable for client display.
 * Unlike loadFramesForContext, this returns the frame objects themselves.
 *
 * @param {number} sessionId - Session ID
 * @param {Object} [options] - Options
 * @param {boolean} [options.fromCompact] - Start from most recent compact
 * @param {string[]} [options.types] - Filter by frame types
 * @param {number} [options.limit] - Max frames to return
 * @param {Database} [db] - Optional database instance for testing
 * @returns {Object} Object with frames array and compiled map
 */
export function getFramesForDisplay(sessionId, options = {}, db = null) {
  const frames = getFrames(sessionId, options, db);
  const compiled = compileFrames(frames);

  // Convert Map to plain object for JSON serialization
  const compiledObj = {};
  for (const [id, payload] of compiled) {
    compiledObj[id] = payload;
  }

  return {
    frames,
    compiled: compiledObj,
    count: frames.length,
  };
}

/**
 * Build a summary of the conversation for compaction.
 * Returns the formatted content suitable for an AI to summarize.
 *
 * @param {number} sessionId - Session ID
 * @param {Database} [db] - Optional database instance for testing
 * @returns {string} Formatted conversation for summarization
 */
export function buildConversationForCompaction(sessionId, db = null) {
  const frames = getFrames(sessionId, { fromCompact: true }, db);
  const compiled = compileFrames(frames);

  const lines = [];

  for (const frame of frames) {
    if (frame.type !== FrameType.MESSAGE) {
      continue;
    }

    const content = compiled.get(frame.id);
    if (!content) {
      continue;
    }

    let role = 'User';
    if (frame.authorType === AuthorType.AGENT) {
      role = 'Assistant';
    } else if (frame.authorType === AuthorType.SYSTEM) {
      role = 'System';
    }

    let text;
    if (typeof content === 'string') {
      text = content;
    } else if (content.content) {
      text = content.content;
    } else if (content.text) {
      text = content.text;
    } else {
      text = JSON.stringify(content);
    }

    lines.push(`${role}: ${text}`);
  }

  return lines.join('\n\n');
}

/**
 * Count the number of message frames since the last compact.
 * Used to determine when compaction is needed.
 *
 * @param {number} sessionId - Session ID
 * @param {Database} [db] - Optional database instance for testing
 * @returns {number} Number of message frames since last compact
 */
export function countMessagesSinceCompact(sessionId, db = null) {
  const latestCompact = getLatestCompact(sessionId, db);

  const options = {};
  if (latestCompact) {
    options.fromTimestamp = latestCompact.timestamp;
  }
  options.types = ['message'];

  const frames = getFrames(sessionId, options, db);
  return frames.length;
}

export default {
  loadFramesForContext,
  getFramesForDisplay,
  buildConversationForCompaction,
  countMessagesSinceCompact,
};
