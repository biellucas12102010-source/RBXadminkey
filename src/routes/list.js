// src/routes/list.js
const router = require('express').Router();
const { Key, Account } = require('../db');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

router.all('/', async (req, res) => {
  const p     = { ...req.query, ...req.body };
  const token = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });

  try {
    // Mapeia key → conta para enriquecer
    const accounts = await Account.find({}, { key: 1, email: 1, name: 1 }).lean();
    const accByKey = {};
    for (const a of accounts) {
      if (a.key) accByKey[a.key] = { email: a.email, name: a.name };
    }

    const keys = await Key.find({}).lean();
    const result = keys.map(entry => {
      const acc = accByKey[entry.key] || null;
      return {
        key:            entry.key,
        type:           entry.type,
        active:         entry.active,
        suspended:      entry.suspended || false,
        hwid:           entry.hwid || null,
        user:           acc ? (acc.name || acc.email) : (entry.user || 'Anonymous'),
        email:          acc ? acc.email : null,
        accountName:    acc ? (acc.name || null) : null,
        created:        entry.created,
        expiry:         entry.expiry,
        daysOnFirstUse: entry.daysOnFirstUse ?? null,
        hasAccount:     !!acc,
        deletedVia:     entry.deletedVia || null,
        revokedAt:      entry.revokedAt  || null,
        deletedAt:      entry.deletedAt  || null,
      };
    });

    return res.json({ success: true, count: result.length, keys: result });
  } catch (e) {
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
