'use strict';

import { verifyToken } from '../auth.mjs';
import config from '../config.mjs';

/**
 * Middleware to require authentication.
 * Extracts JWT from cookie and attaches user to request.
 *
 * For API routes: returns 401 JSON response if not authenticated.
 * For page routes: redirects to login page.
 */
export function requireAuth(req, res, next) {
  let token = req.cookies?.token;

  if (!token) {
    if (req.path.startsWith('/api/'))
      return res.status(401).json({ error: 'Authentication required' });

    return res.redirect('/login');
  }

  let decoded = verifyToken(token);

  if (!decoded) {
    // Clear invalid token
    res.clearCookie('token', { path: config.basePath });

    if (req.path.startsWith('/api/'))
      return res.status(401).json({ error: 'Invalid or expired token' });

    return res.redirect('/login');
  }

  // Attach user info to request
  req.user = {
    id:       decoded.sub,
    username: decoded.username,
    secret:   decoded.secret,
  };

  next();
}

/**
 * Middleware to optionally extract auth info without requiring it.
 * If authenticated, attaches user to request. Otherwise, continues.
 */
export function optionalAuth(req, res, next) {
  let token = req.cookies?.token;

  if (token) {
    let decoded = verifyToken(token);

    if (decoded) {
      req.user = {
        id:       decoded.sub,
        username: decoded.username,
        secret:   decoded.secret,
      };
    }
  }

  next();
}

/**
 * Get the current user's data key for decryption.
 *
 * @param {object} req - Express request with user attached
 * @returns {string} Hex-encoded data key
 * @throws {Error} If user not authenticated or secret not available
 */
export function getDataKey(req) {
  if (!req.user || !req.user.secret || !req.user.secret.dataKey)
    throw new Error('User not authenticated or secret not available');

  return req.user.secret.dataKey;
}

export default {
  requireAuth,
  optionalAuth,
  getDataKey,
};
