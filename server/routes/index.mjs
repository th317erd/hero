'use strict';

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.mjs';

import authRoutes from './auth.mjs';
import agentsRoutes from './agents.mjs';
import sessionsRoutes from './sessions.mjs';
import messagesRoutes from './messages.mjs';
import commandsRoutes from './commands.mjs';
import toolsRoutes from './tools.mjs';
import processesRoutes from './processes.mjs';

const router = Router();

// Auth routes (login/logout don't require auth)
router.use('/', authRoutes);

// Protected routes
router.use('/agents', agentsRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/sessions', messagesRoutes);  // Mounted under /sessions for /sessions/:id/messages
router.use('/commands', commandsRoutes);
router.use('/tools', toolsRoutes);
router.use('/processes', processesRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default router;
