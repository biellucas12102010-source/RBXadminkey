// src/routes/revoke.js
const router  = require('express').Router();
const { Key, Account } = require('../db');
const { getIP, logAudit } = require('../helpers');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

async function notifyOwner(key, reason, msg) {
  try {
    const acc = await Account.findOne({ key });
    if (!acc) return;
    acc.notifications.push({ id: Date.now().toString(36), reason, msg, ts: new Date().toISOString(), read: false });
    await acc.save();
  } catch (e) { console.error('[revoke notify]', e.message); }
}

router.all('/', async (req, res) => {
  const p     = { ...req.query, ...req.body };
  const token = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');

  if (token !== ADMIN_TOKEN()) {
    await logAudit({ action: 'revoke', ip: getIP(req), result: 'unauthorized', detail: 'Token inválido' });
    return res.json({ error: 'UNAUTHORIZED' });
  }

  const key    = (p.key    || '').trim();
  const reason = (p.reason || 'removed-key').trim();
  if (!key) return res.json({ error: 'KEY_REQUIRED' });

  try {
    const entry = await Key.findOne({ key });
    if (!entry) {
      await logAudit({ action: 'revoke', key, ip: getIP(req), result: 'error', detail: 'Key não encontrada' });
      return res.json({ error: 'KEY_NOT_FOUND' });
    }

    if (reason === 'reset-key') {
      entry.suspended = true;
      entry.hwid = null;
      await entry.save();
      await notifyOwner(key, 'reset-key', 'Sua key foi resetada pelo administrador. Insira sua key novamente para reativá-la.');
      await logAudit({ action: 'revoke', key, user: entry.user, ip: getIP(req), result: 'success', detail: 'RESET suspended=true' });
      return res.json({ success: true, key, reset: true, suspended: true });

    } else if (reason === 'bulk-delete') {
      entry.active = false;
      entry.suspended = false;
      entry.deletedAt = new Date();
      entry.deletedVia = 'bulk-delete';
      await entry.save();
      await notifyOwner(key, 'removed-key', 'Sua key foi excluída pelo administrador. Adquira uma nova key para continuar usando o RBX.');
      await logAudit({ action: 'revoke', key, user: entry.user, ip: getIP(req), result: 'success', detail: 'BULK-DELETE' });
      return res.json({ success: true, key, revoked: true, deletedVia: 'bulk-delete' });

    } else {
      entry.active = false;
      entry.suspended = false;
      entry.revokedAt = new Date();
      entry.deletedVia = 'revoke';
      await entry.save();
      await notifyOwner(key, 'removed-key', 'Sua key foi removida pelo administrador. Adquira uma nova key para continuar usando o RBX.');
      await logAudit({ action: 'revoke', key, user: entry.user, ip: getIP(req), result: 'success', detail: 'REVOGADO' });
      return res.json({ success: true, key, revoked: true, deletedVia: 'revoke' });
    }
  } catch (e) {
    await logAudit({ action: 'revoke', key, ip: getIP(req), result: 'error', detail: e.message });
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
