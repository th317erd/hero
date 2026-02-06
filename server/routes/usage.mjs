'use strict';

import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { requireAuth } from '../middleware/auth.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Token rates for cost calculation (same as frontend)
const INPUT_TOKEN_RATE  = 0.003 / 1000;   // $3 per 1M input tokens
const OUTPUT_TOKEN_RATE = 0.015 / 1000;   // $15 per 1M output tokens

/**
 * GET /api/usage
 * Get total token usage across all sessions for the current user,
 * including any corrections.
 */
router.get('/', (req, res) => {
  let db = getDatabase();

  // Get session usage
  let sessionUsage = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM sessions
    WHERE user_id = ?
  `).get(req.user.id);

  // Get corrections
  let corrections = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM usage_corrections
    WHERE user_id = ?
  `).get(req.user.id);

  return res.json({
    inputTokens:  sessionUsage.input_tokens + (corrections?.input_tokens || 0),
    outputTokens: sessionUsage.output_tokens + (corrections?.output_tokens || 0),
    sessionInputTokens:  sessionUsage.input_tokens,
    sessionOutputTokens: sessionUsage.output_tokens,
    correctionInputTokens:  corrections?.input_tokens || 0,
    correctionOutputTokens: corrections?.output_tokens || 0,
  });
});

/**
 * POST /api/usage/correction
 * Add a usage correction. User provides their actual current cost/tokens,
 * and we calculate the difference from what we're tracking.
 *
 * Body: { actualCost: number } or { actualInputTokens: number, actualOutputTokens: number }
 */
router.post('/correction', (req, res) => {
  let { actualCost, actualInputTokens, actualOutputTokens, reason } = req.body;
  let db = getDatabase();

  // Get current tracked usage
  let sessionUsage = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM sessions
    WHERE user_id = ?
  `).get(req.user.id);

  let corrections = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens
    FROM usage_corrections
    WHERE user_id = ?
  `).get(req.user.id);

  let currentInputTokens  = sessionUsage.input_tokens + (corrections?.input_tokens || 0);
  let currentOutputTokens = sessionUsage.output_tokens + (corrections?.output_tokens || 0);
  let currentCost = (currentInputTokens * INPUT_TOKEN_RATE) + (currentOutputTokens * OUTPUT_TOKEN_RATE);

  let correctionInputTokens  = 0;
  let correctionOutputTokens = 0;

  if (actualCost !== undefined) {
    // User provided a cost, calculate the difference
    let costDiff = actualCost - currentCost;

    // Distribute the cost difference proportionally
    // Assume 80% output tokens, 20% input tokens for correction distribution
    if (costDiff !== 0) {
      let outputPortion = costDiff * 0.8;
      let inputPortion  = costDiff * 0.2;

      correctionOutputTokens = Math.round(outputPortion / OUTPUT_TOKEN_RATE);
      correctionInputTokens  = Math.round(inputPortion / INPUT_TOKEN_RATE);
    }
  } else if (actualInputTokens !== undefined || actualOutputTokens !== undefined) {
    // User provided token counts
    correctionInputTokens  = (actualInputTokens || currentInputTokens) - currentInputTokens;
    correctionOutputTokens = (actualOutputTokens || currentOutputTokens) - currentOutputTokens;
  } else {
    return res.status(400).json({
      error: 'Must provide either actualCost or actualInputTokens/actualOutputTokens',
    });
  }

  // Only insert if there's actually a correction needed
  if (correctionInputTokens !== 0 || correctionOutputTokens !== 0) {
    db.prepare(`
      INSERT INTO usage_corrections (user_id, input_tokens, output_tokens, reason)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, correctionInputTokens, correctionOutputTokens, reason || 'Manual correction');
  }

  // Return the new totals
  let newInputTokens  = currentInputTokens + correctionInputTokens;
  let newOutputTokens = currentOutputTokens + correctionOutputTokens;
  let newCost = (newInputTokens * INPUT_TOKEN_RATE) + (newOutputTokens * OUTPUT_TOKEN_RATE);

  return res.json({
    success:              true,
    correctionApplied:    { inputTokens: correctionInputTokens, outputTokens: correctionOutputTokens },
    newTotals:            { inputTokens: newInputTokens, outputTokens: newOutputTokens, cost: newCost },
    previousTotals:       { inputTokens: currentInputTokens, outputTokens: currentOutputTokens, cost: currentCost },
  });
});

/**
 * GET /api/usage/corrections
 * List all usage corrections for the current user.
 */
router.get('/corrections', (req, res) => {
  let db = getDatabase();

  let corrections = db.prepare(`
    SELECT id, input_tokens, output_tokens, reason, created_at
    FROM usage_corrections
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.user.id);

  return res.json({
    corrections: corrections.map((c) => ({
      id:           c.id,
      inputTokens:  c.input_tokens,
      outputTokens: c.output_tokens,
      reason:       c.reason,
      createdAt:    c.created_at,
    })),
  });
});

export default router;
