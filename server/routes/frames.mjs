'use strict';

// ============================================================================
// Frames API Routes
// ============================================================================
// Provides access to interaction frames for sessions.
// Frames are the event-sourced units that make up conversation history.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.mjs';
import { getDatabase } from '../database.mjs';
import {
  getFrames,
  getFrame,
  getLatestCompact,
  countFrames,
  compileFrames,
} from '../lib/frames/index.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/sessions/:sessionId/frames
 * Get frames for a session.
 *
 * Query parameters:
 * - fromCompact: If 'true', start from most recent compact frame
 * - fromTimestamp: Get frames after this timestamp
 * - types: Comma-separated list of frame types to filter
 * - limit: Maximum number of frames to return
 * - compiled: If 'true', return compiled state instead of raw frames
 */
router.get('/:sessionId/frames', (req, res) => {
  const db = getDatabase();
  const sessionId = parseInt(req.params.sessionId, 10);

  // Verify session exists and belongs to user
  const session = db.prepare(`
    SELECT id FROM sessions WHERE id = ? AND user_id = ?
  `).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Build options from query params
  const options = {};

  if (req.query.fromCompact) {
    options.fromCompact = true;
  }

  if (req.query.fromTimestamp) {
    options.fromTimestamp = req.query.fromTimestamp;
  }

  if (req.query.types) {
    options.types = req.query.types.split(',').map((t) => t.trim());
  }

  if (req.query.limit) {
    options.limit = parseInt(req.query.limit, 10);
  }

  const frames = getFrames(sessionId, options);

  // If compiled view requested, compile frames and return
  if (req.query.compiled === 'true') {
    const compiled = compileFrames(frames);
    // Convert Map to object for JSON serialization
    const compiledObj = {};
    for (const [id, payload] of compiled) {
      compiledObj[id] = payload;
    }
    return res.json({
      compiled: compiledObj,
      frameCount: frames.length,
    });
  }

  res.json({
    frames,
    count: frames.length,
  });
});

/**
 * GET /api/sessions/:sessionId/frames/stats
 * Get frame statistics for a session.
 * NOTE: Must be defined before :frameId route to avoid conflict.
 */
router.get('/:sessionId/frames/stats', (req, res) => {
  const db = getDatabase();
  const sessionId = parseInt(req.params.sessionId, 10);

  // Verify session exists and belongs to user
  const session = db.prepare(`
    SELECT id FROM sessions WHERE id = ? AND user_id = ?
  `).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const total = countFrames(sessionId);
  const latestCompact = getLatestCompact(sessionId);

  // Count by type
  const messageCount = countFrames(sessionId, { types: ['message'] });
  const requestCount = countFrames(sessionId, { types: ['request'] });
  const resultCount = countFrames(sessionId, { types: ['result'] });
  const updateCount = countFrames(sessionId, { types: ['update'] });
  const compactCount = countFrames(sessionId, { types: ['compact'] });

  res.json({
    stats: {
      total,
      byType: {
        message: messageCount,
        request: requestCount,
        result: resultCount,
        update: updateCount,
        compact: compactCount,
      },
      latestCompact: (latestCompact) ? {
        id: latestCompact.id,
        timestamp: latestCompact.timestamp,
      } : null,
    },
  });
});

/**
 * GET /api/sessions/:sessionId/frames/:frameId
 * Get a single frame by ID.
 */
router.get('/:sessionId/frames/:frameId', (req, res) => {
  const db = getDatabase();
  const sessionId = parseInt(req.params.sessionId, 10);

  // Verify session exists and belongs to user
  const session = db.prepare(`
    SELECT id FROM sessions WHERE id = ? AND user_id = ?
  `).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const frame = getFrame(req.params.frameId);

  if (!frame || frame.sessionId !== sessionId) {
    return res.status(404).json({ error: 'Frame not found' });
  }

  res.json({ frame });
});

export default router;
