'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.mjs';

import authRoutes from './auth.mjs';
import agentsRoutes from './agents.mjs';
import sessionsRoutes from './sessions.mjs';
import messagesRoutes from './messages.mjs';
import messagesStreamRoutes from './messages-stream.mjs';
import commandsRoutes from './commands.mjs';
import toolsRoutes from './tools.mjs';
import abilitiesRoutes from './abilities.mjs';
import helpRoutes from './help.mjs';

const router = Router();

// Auth routes (login/logout don't require auth)
router.use('/', authRoutes);

// Protected routes
router.use('/agents', agentsRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/sessions', messagesRoutes);        // Mounted under /sessions for /sessions/:id/messages
router.use('/sessions', messagesStreamRoutes);  // Streaming endpoint: /sessions/:id/messages/stream
router.use('/commands', commandsRoutes);
router.use('/tools', toolsRoutes);
router.use('/abilities', abilitiesRoutes);
router.use('/help', helpRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;
