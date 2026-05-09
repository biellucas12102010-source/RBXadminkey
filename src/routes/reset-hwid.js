// src/routes/reset-hwid.js
const router = require('express').Router();
const { Key, Account } = require('../db');
const { getIP, logAudit } = require('../helpers');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

async function notifyOwner(key) {
  const msg = 'Seu HWID foi resetado pelo administrador. Insira sua key novamente para continuar usando o RBX.';
  const notif = { id: Date.now().toString(36), reason: 'reset-hwid', msg, ts: new Date().toISOString(), read: false };
  try {
    const acc = await Account.findOne({ key });
    if (acc) {
      acc.notifications.push(notif);
      await acc.save();
    }
  } catch (e) { console.error('[reset-hwid notify]', e.message); }
}

router.all('/', async (req, res) => {
  const p     = { ...req.query, ...req.body };
  const token = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');

  if (token !== ADMIN_TOKEN()) {
    await logAudit({ action: 'reset-hwid', ip: getIP(req), result: 'unauthorized', detail: 'Token inválido' });
    return res.json({ error: 'UNAUTHORIZED' });
  }

  const key = (p.key || '').trim();
  if (!key) return res.json({ error: 'KEY_REQUIRED' });

  try {
    const entry = await Key.findOne({ key });
    if (!entry) {
      await logAudit({ action: 'reset-hwid', key, ip: getIP(req), result: 'error', detail: 'Key não encontrada' });
      return res.json({ error: 'KEY_NOT_FOUND' });
    }

    const oldHwid = entry.hwid;
    entry.hwid = null;
    await entry.save();

    await notifyOwner(key);

    await logAudit({
      action: 'reset-hwid', key, user: entry.user, ip: getIP(req),
      result: 'success', detail: 'hwid_anterior=' + (oldHwid || 'nenhum')
    });

    return res.json({ success: true, key, hwid_reset: true });
  } catch (e) {
    await logAudit({ action: 'reset-hwid', key, ip: getIP(req), result: 'error', detail: e.message });
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
