'use strict';

import { Router } from 'express';
import { getDatabase } from '../database.mjs';
import { encryptWithKey, decryptWithKey } from '../encryption.mjs';
import { requireAuth, getDataKey } from '../middleware/auth.mjs';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/agents
 * List all agents for the current user.
 */
router.get('/', (req, res) => {
  let db     = getDatabase();
  let agents = db.prepare(`
    SELECT id, name, type, api_url, default_processes, created_at, updated_at
    FROM agents
    WHERE user_id = ?
    ORDER BY name
  `).all(req.user.id);

  return res.json({
    agents: agents.map((a) => ({
      id:               a.id,
      name:             a.name,
      type:             a.type,
      apiUrl:           a.api_url,
      defaultProcesses: JSON.parse(a.default_processes || '[]'),
      createdAt:        a.created_at,
      updatedAt:        a.updated_at,
    })),
  });
});

/**
 * POST /api/agents
 * Create a new agent.
 */
router.post('/', (req, res) => {
  let { name, type, apiUrl, apiKey, config: agentConfig, defaultProcesses } = req.body;

  if (!name || !type)
    return res.status(400).json({ error: 'Name and type are required' });

  // Validate type
  let validTypes = ['claude', 'openai'];  // Will be expanded with agent registry

  if (!validTypes.includes(type))
    return res.status(400).json({ error: `Invalid agent type. Valid types: ${validTypes.join(', ')}` });

  // Validate defaultProcesses if provided
  if (defaultProcesses !== undefined && !Array.isArray(defaultProcesses))
    return res.status(400).json({ error: 'defaultProcesses must be an array' });

  let db = getDatabase();

  // Check for duplicate name
  let existing = db.prepare('SELECT id FROM agents WHERE user_id = ? AND name = ?').get(req.user.id, name);

  if (existing)
    return res.status(409).json({ error: `Agent "${name}" already exists` });

  try {
    let dataKey = getDataKey(req);

    // Encrypt sensitive fields
    let encryptedApiKey = apiKey ? encryptWithKey(apiKey, dataKey) : null;
    let encryptedConfig = agentConfig ? encryptWithKey(JSON.stringify(agentConfig), dataKey) : null;
    let processesJson   = JSON.stringify(defaultProcesses || []);

    let result = db.prepare(`
      INSERT INTO agents (user_id, name, type, api_url, encrypted_api_key, encrypted_config, default_processes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, name, type, apiUrl || null, encryptedApiKey, encryptedConfig, processesJson);

    return res.status(201).json({
      id:               result.lastInsertRowid,
      name:             name,
      type:             type,
      apiUrl:           apiUrl || null,
      defaultProcesses: defaultProcesses || [],
      createdAt:        new Date().toISOString(),
    });
  } catch (error) {
    console.error('Create agent error:', error);
    return res.status(500).json({ error: 'Failed to create agent' });
  }
});

/**
 * GET /api/agents/:id
 * Get a specific agent.
 */
router.get('/:id', (req, res) => {
  let db    = getDatabase();
  let agent = db.prepare(`
    SELECT id, name, type, api_url, encrypted_api_key, encrypted_config, default_processes, created_at, updated_at
    FROM agents
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  try {
    let dataKey = getDataKey(req);

    // Decrypt config (but not API key - never expose it)
    let agentConfig = null;

    if (agent.encrypted_config) {
      let decrypted = decryptWithKey(agent.encrypted_config, dataKey);
      agentConfig   = JSON.parse(decrypted);
    }

    return res.json({
      id:               agent.id,
      name:             agent.name,
      type:             agent.type,
      apiUrl:           agent.api_url,
      config:           agentConfig,
      defaultProcesses: JSON.parse(agent.default_processes || '[]'),
      hasApiKey:        !!agent.encrypted_api_key,
      createdAt:        agent.created_at,
      updatedAt:        agent.updated_at,
    });
  } catch (error) {
    console.error('Get agent error:', error);
    return res.status(500).json({ error: 'Failed to get agent' });
  }
});

/**
 * PUT /api/agents/:id
 * Update an agent.
 */
router.put('/:id', (req, res) => {
  let { name, type, apiUrl, apiKey, config: agentConfig, defaultProcesses } = req.body;

  let db    = getDatabase();
  let agent = db.prepare('SELECT id FROM agents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  // Validate defaultProcesses if provided
  if (defaultProcesses !== undefined && !Array.isArray(defaultProcesses))
    return res.status(400).json({ error: 'defaultProcesses must be an array' });

  try {
    let dataKey = getDataKey(req);
    let updates = [];
    let values  = [];

    if (name !== undefined) {
      // Check for duplicate name (excluding current agent)
      let existing = db.prepare('SELECT id FROM agents WHERE user_id = ? AND name = ? AND id != ?').get(req.user.id, name, req.params.id);

      if (existing)
        return res.status(409).json({ error: `Agent "${name}" already exists` });

      updates.push('name = ?');
      values.push(name);
    }

    if (type !== undefined) {
      let validTypes = ['claude', 'openai'];

      if (!validTypes.includes(type))
        return res.status(400).json({ error: `Invalid agent type. Valid types: ${validTypes.join(', ')}` });

      updates.push('type = ?');
      values.push(type);
    }

    if (apiUrl !== undefined) {
      updates.push('api_url = ?');
      values.push(apiUrl || null);
    }

    if (apiKey !== undefined) {
      let encryptedApiKey = apiKey ? encryptWithKey(apiKey, dataKey) : null;
      updates.push('encrypted_api_key = ?');
      values.push(encryptedApiKey);
    }

    if (agentConfig !== undefined) {
      let encryptedConfig = agentConfig ? encryptWithKey(JSON.stringify(agentConfig), dataKey) : null;
      updates.push('encrypted_config = ?');
      values.push(encryptedConfig);
    }

    if (defaultProcesses !== undefined) {
      updates.push('default_processes = ?');
      values.push(JSON.stringify(defaultProcesses));
    }

    if (updates.length === 0)
      return res.status(400).json({ error: 'No fields to update' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id);
    values.push(req.user.id);

    db.prepare(`
      UPDATE agents
      SET ${updates.join(', ')}
      WHERE id = ? AND user_id = ?
    `).run(...values);

    return res.json({ success: true });
  } catch (error) {
    console.error('Update agent error:', error);
    return res.status(500).json({ error: 'Failed to update agent' });
  }
});

/**
 * DELETE /api/agents/:id
 * Delete an agent.
 */
router.delete('/:id', (req, res) => {
  let db     = getDatabase();
  let result = db.prepare('DELETE FROM agents WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  if (result.changes === 0)
    return res.status(404).json({ error: 'Agent not found' });

  return res.json({ success: true });
});

/**
 * GET /api/agents/:id/config
 * Get the decrypted config for an agent.
 */
router.get('/:id/config', (req, res) => {
  let db    = getDatabase();
  let agent = db.prepare(`
    SELECT encrypted_config
    FROM agents
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  try {
    let dataKey = getDataKey(req);
    let config  = {};

    if (agent.encrypted_config) {
      let decrypted = decryptWithKey(agent.encrypted_config, dataKey);
      config = JSON.parse(decrypted);
    }

    return res.json({ config });
  } catch (error) {
    console.error('Get agent config error:', error);
    return res.status(500).json({ error: 'Failed to get agent config' });
  }
});

/**
 * PUT /api/agents/:id/config
 * Update the config for an agent.
 */
router.put('/:id/config', (req, res) => {
  let { config } = req.body;

  if (config === undefined)
    return res.status(400).json({ error: 'Config is required' });

  // Validate config is an object
  if (typeof config !== 'object' || config === null || Array.isArray(config))
    return res.status(400).json({ error: 'Config must be a JSON object' });

  let db    = getDatabase();
  let agent = db.prepare('SELECT id FROM agents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

  if (!agent)
    return res.status(404).json({ error: 'Agent not found' });

  try {
    let dataKey         = getDataKey(req);
    let encryptedConfig = encryptWithKey(JSON.stringify(config), dataKey);

    db.prepare(`
      UPDATE agents
      SET encrypted_config = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(encryptedConfig, req.params.id, req.user.id);

    return res.json({ success: true });
  } catch (error) {
    console.error('Update agent config error:', error);
    return res.status(500).json({ error: 'Failed to update agent config' });
  }
});

export default router;
