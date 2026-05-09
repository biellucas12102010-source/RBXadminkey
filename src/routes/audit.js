// src/routes/audit.js
const router = require('express').Router();
const { Audit } = require('../db');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

router.get('/', async (req, res) => {
  const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });

  try {
    const { action, key, result: r, from, to, limit = '50' } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (key)    filter.key    = { $regex: key, $options: 'i' };
    if (r)      filter.result = r;
    if (from || to) {
      filter.ts = {};
      if (from) filter.ts.$gte = new Date(from);
      if (to)   filter.ts.$lte = new Date(to);
    }

    const logs = await Audit.find(filter)
      .sort({ ts: -1 })
      .limit(Math.min(parseInt(limit, 10) || 50, 500))
      .lean();

    return res.json({ success: true, count: logs.length, logs });
  } catch (e) {
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

router.delete('/', async (req, res) => {
  const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });

  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await Audit.deleteMany({ ts: { $lt: cutoff } });
    return res.json({ success: true, removed: result.deletedCount });
  } catch (e) {
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

// Função exportada para uso interno nos outros routes
async function logAudit(data) {
  try { await Audit.create(data); } catch {}
}

module.exports = router;
