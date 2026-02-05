'use strict';

import { WebSocketServer } from 'ws';
import { verifyToken } from '../auth.mjs';
import { subscribeToUpdates, abortCommand, getRunningCommands } from './operations/executor.mjs';
import { answerQuestion, cancelQuestion } from './assertions/pending-questions.mjs';

// Connected clients (userId -> Set of WebSocket connections)
const clients = new Map();

/**
 * Initialize WebSocket server.
 *
 * @param {http.Server} server - HTTP server to attach to
 */
export function initWebSocket(server) {
  let wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Extract token from query string
    let url   = new URL(req.url, 'http://localhost');
    let token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    // Verify token
    let decoded = verifyToken(token);

    if (!decoded) {
      ws.close(4001, 'Invalid or expired token');
      return;
    }

    let userId = decoded.sub;

    // Add to clients map
    if (!clients.has(userId))
      clients.set(userId, new Set());

    clients.get(userId).add(ws);

    console.log(`WebSocket client connected for user ${userId}`);

    // Subscribe to command updates for this user
    let unsubscribe = subscribeToUpdates(userId, (commandState) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type:    'command_update',
          command: commandState,
        }));
      }
    });

    // Send current running commands on connect
    let running = getRunningCommands(userId);

    if (running.length > 0) {
      ws.send(JSON.stringify({
        type:     'running_commands',
        commands: running,
      }));
    }

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        let message = JSON.parse(data.toString());

        switch (message.type) {
          case 'abort':
            if (message.commandId) {
              let aborted = abortCommand(message.commandId);

              ws.send(JSON.stringify({
                type:      'abort_result',
                commandId: message.commandId,
                success:   aborted,
              }));
            }
            break;

          case 'question_answer':
            if (message.assertionId && message.answer !== undefined) {
              let answered = answerQuestion(message.assertionId, message.answer);

              ws.send(JSON.stringify({
                type:        'question_answer_result',
                assertionId: message.assertionId,
                success:     answered,
              }));
            }
            break;

          case 'question_cancel':
            if (message.assertionId) {
              cancelQuestion(message.assertionId);

              ws.send(JSON.stringify({
                type:        'question_cancel_result',
                assertionId: message.assertionId,
                success:     true,
              }));
            }
            break;
        }
      } catch (e) {
        console.error('WebSocket message parse error:', e);
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      clients.get(userId)?.delete(ws);

      if (clients.get(userId)?.size === 0)
        clients.delete(userId);

      unsubscribe();
      console.log(`WebSocket client disconnected for user ${userId}`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  console.log('WebSocket server initialized on /ws');

  return wss;
}

/**
 * Broadcast a message to all connected clients for a user.
 *
 * @param {number} userId - User ID
 * @param {object} message - Message to send
 */
export function broadcastToUser(userId, message) {
  let userClients = clients.get(userId);

  if (!userClients)
    return;

  let payload = JSON.stringify(message);

  for (let ws of userClients) {
    if (ws.readyState === ws.OPEN)
      ws.send(payload);
  }
}

/**
 * Get the number of connected clients for a user.
 *
 * @param {number} userId - User ID
 * @returns {number} Number of connected clients
 */
export function getClientCount(userId) {
  return clients.get(userId)?.size || 0;
}

export default {
  initWebSocket,
  broadcastToUser,
  getClientCount,
};
