// src/routes/renew.js
const router = require('express').Router();
const { Key } = require('../db');
const { getIP, logAudit } = require('../helpers');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

router.all('/', async (req, res) => {
  const p     = { ...req.query, ...req.body };
  const token = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');

  if (token !== ADMIN_TOKEN()) {
    await logAudit({ action: 'renew', ip: getIP(req), result: 'unauthorized', detail: 'Token inválido' });
    return res.json({ error: 'UNAUTHORIZED' });
  }

  const key  = (p.key || '').trim();
  const days = parseInt(p.days ?? '30', 10);

  if (!key)             return res.json({ error: 'KEY_REQUIRED' });
  if (isNaN(days) || days < 0) return res.json({ error: 'DAYS_INVALID' });

  try {
    const entry = await Key.findOne({ key });
    if (!entry)        return res.json({ error: 'KEY_NOT_FOUND' });
    if (!entry.active) return res.json({ error: 'KEY_REVOKED' });

    const oldExpiry = entry.expiry;

    if (days === 0) {
      entry.expiry = null;
      entry.daysOnFirstUse = 0;
    } else {
      const base = entry.expiry && entry.expiry > new Date() ? entry.expiry : new Date();
      entry.expiry = new Date(base.getTime() + days * 86400000);
      entry.daysOnFirstUse = days;
    }
    entry.active = true;
    await entry.save();

    const expiryLabel = entry.expiry
      ? entry.expiry.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : 'Ilimitado';

    await logAudit({
      action: 'renew', key, user: entry.user, ip: getIP(req), result: 'success',
      detail: `days=${days === 0 ? 'ilimitado' : days}, old=${oldExpiry || 'null'}, new=${entry.expiry || 'null'}`
    });

    return res.json({ success: true, key, expiry: expiryLabel, days });
  } catch (e) {
    await logAudit({ action: 'renew', key, ip: getIP(req), result: 'error', detail: e.message });
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
