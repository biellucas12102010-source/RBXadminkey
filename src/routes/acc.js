// src/routes/acc.js
const router  = require('express').Router();
const crypto  = require('crypto');
const { Account, Key, Reset } = require('../db');
const { getIP, hashPass, logAudit, sendResetEmail } = require('../helpers');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

// ── POST /api/acc — criar/atualizar conta ─────────────────────────────────────
router.post('/', async (req, res) => {
  const { email: rawEmail, password, key, name, hwid } = req.body || {};
  const email = (rawEmail || '').toLowerCase().trim();

  if (!email || !password || !key)
    return res.json({ error: 'FIELDS_REQUIRED: email, password, key' });
  if (password.length < 6)
    return res.json({ error: 'PASSWORD_TOO_SHORT' });

  try {
    const keyEntry = await Key.findOne({ key });
    if (!keyEntry)          return res.json({ error: 'KEY_INVALID' });
    if (!keyEntry.active)   return res.json({ error: 'KEY_REVOKED' });

    // Verifica se a key já pertence a outro email
    const keyOwner = await Account.findOne({ key });
    if (keyOwner && keyOwner.email !== email)
      return res.json({ error: 'KEY_ALREADY_REGISTERED' });

    // Verifica se o email já existe com outra key
    const existing = await Account.findOne({ email });
    if (existing && existing.key !== key)
      return res.json({ error: 'EMAIL_ALREADY_REGISTERED' });

    const passwordHash = hashPass(password);
    const accountName  = (name || '').trim() || email.split('@')[0];

    if (existing) {
      // Atualiza conta existente
      existing.name         = accountName;
      existing.passwordHash = passwordHash;
      existing.hwid         = hwid || null;
      existing.updatedAt    = new Date();
      await existing.save();
    } else {
      // Cria nova conta
      await Account.create({
        email, name: accountName, passwordHash, key,
        keyType: keyEntry.type, hwid: hwid || null,
      });
    }

    await logAudit({
      action: 'acc-register', key, user: email, ip: getIP(req),
      result: 'success', detail: `name=${accountName}, keyType=${keyEntry.type}`
    });

    return res.json({ success: true, email, name: accountName, keyType: keyEntry.type, status: 'active' });
  } catch (e) {
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

// ── GET /api/acc — todas as actions GET ──────────────────────────────────────
router.get('/', async (req, res) => {
  const p      = req.query;
  const action = (p.action || '').toLowerCase();
  const token  = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');

  // ── login ───────────────────────────────────────────────────────────────
  if (action === 'login') {
    const email    = (p.email    || '').toLowerCase().trim();
    const password = (p.password || '').trim();
    if (!email || !password) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({ email });
      if (!acc) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      if (hashPass(password) !== acc.passwordHash)
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      if (acc.status === 'suspended')
        return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });

      const keyEntry = await Key.findOne({ key: acc.key });

      const notifications = acc.notifications || [];
      acc.notifications   = [];
      acc.updatedAt       = new Date();
      await acc.save();

      return res.json({
        success:      true,
        email:        acc.email,
        name:         acc.name,
        key:          acc.key,
        keyType:      acc.keyType,
        keyActive:    keyEntry ? (keyEntry.active && !keyEntry.suspended) : false,
        keySuspended: keyEntry ? !!keyEntry.suspended : false,
        keyExpiry:    keyEntry ? keyEntry.expiry : null,
        notifications
      });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── activate ────────────────────────────────────────────────────────────
  if (action === 'activate') {
    const email    = (p.email    || '').toLowerCase().trim();
    const password = (p.password || '').trim();
    const key      = (p.key      || '').trim();
    if (!email || !password || !key) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({ email });
      if (!acc || hashPass(password) !== acc.passwordHash)
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      if (acc.key !== key) return res.status(403).json({ error: 'KEY_NOT_YOURS' });

      const keyEntry = await Key.findOne({ key });
      if (!keyEntry)         return res.json({ error: 'KEY_INVALID' });
      if (!keyEntry.active)  return res.json({ error: 'KEY_PERMANENTLY_REVOKED' });
      if (!keyEntry.suspended) return res.json({ success: true, message: 'KEY_ALREADY_ACTIVE' });

      keyEntry.suspended = false;
      await keyEntry.save();

      await logAudit({ action: 'acc-activate', key, user: email, ip: getIP(req), result: 'success' });
      return res.json({ success: true, message: 'KEY_REACTIVATED', key });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── notifications ───────────────────────────────────────────────────────
  if (action === 'notifications') {
    const email    = (p.email    || '').toLowerCase().trim();
    const password = (p.password || '').trim();
    if (!email || !password) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({ email });
      if (!acc || hashPass(password) !== acc.passwordHash)
        return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      const notifications = acc.notifications || [];
      acc.notifications   = [];
      await acc.save();
      return res.json({ success: true, notifications });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── forgot_password ─────────────────────────────────────────────────────
  if (action === 'forgot_password') {
    const email = (p.email || '').toLowerCase().trim();
    if (!email) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({ email });
      if (!acc) return res.json({ error: 'USER_NOT_FOUND' });

      // Gera código de 6 chars
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const bytes = crypto.randomBytes(6);
      let code = '';
      for (const b of bytes) code += chars[b % chars.length];

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      // Upsert do código (sobrescreve se já existia um)
      await Reset.findOneAndUpdate(
        { email },
        { code, expiresAt },
        { upsert: true, new: true }
      );

      await sendResetEmail(acc.name || email, email, code);

      await logAudit({ action: 'forgot-password-request', user: email, ip: getIP(req), result: 'success' });
      return res.json({ success: true, name: acc.name || email.split('@')[0] });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── reset_password ──────────────────────────────────────────────────────
  if (action === 'reset_password') {
    const email       = (p.email        || '').toLowerCase().trim();
    const code        = (p.code         || '').trim().toUpperCase();
    const newPassword = (p.new_password || '').trim();

    if (!email || !code || !newPassword) return res.json({ error: 'FIELDS_REQUIRED' });
    if (newPassword.length < 6) return res.json({ error: 'PASSWORD_TOO_SHORT' });

    try {
      const resetDoc = await Reset.findOne({ email });
      if (!resetDoc) return res.json({ error: 'INVALID_CODE' });
      if (Date.now() > resetDoc.expiresAt.getTime()) {
        await resetDoc.deleteOne();
        return res.json({ error: 'CODE_EXPIRED' });
      }
      if (resetDoc.code !== code) return res.json({ error: 'INVALID_CODE' });

      const acc = await Account.findOne({ email });
      if (!acc) return res.json({ error: 'USER_NOT_FOUND' });

      acc.passwordHash = hashPass(newPassword);
      acc.updatedAt    = new Date();
      await acc.save();
      await resetDoc.deleteOne();

      await logAudit({ action: 'password-reset', user: email, ip: getIP(req), result: 'success' });
      return res.json({ success: true });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── lookup_email ─────────────────────────────────────────────────────────
  if (action === 'lookup_email') {
    const username = (p.username || '').trim().toLowerCase();
    if (!username) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({
        name: { $regex: `^${username}$`, $options: 'i' }
      });
      if (!acc) return res.json({ error: 'USER_NOT_FOUND' });
      return res.json({ success: true, email: acc.email });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── search (público) ─────────────────────────────────────────────────────
  if (action === 'search') {
    const q = (p.q || '').toLowerCase().trim();
    if (!q || q.length < 2) return res.json({ error: 'QUERY_TOO_SHORT' });

    try {
      const results = await Account.find({
        $or: [
          { email: { $regex: q, $options: 'i' } },
          { name:  { $regex: q, $options: 'i' } }
        ]
      }, { email: 1, name: 1, keyType: 1 }).limit(25).lean();

      return res.json({ success: true, count: results.length, results });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── lookup (público — busca por email exato) ─────────────────────────────
  if (action === 'lookup') {
    const email = (p.email || '').toLowerCase().trim();
    if (!email) return res.json({ error: 'EMAIL_REQUIRED' });
    try {
      const acc = await Account.findOne({ email }, { email: 1, name: 1, keyType: 1 }).lean();
      if (!acc) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      return res.json({ success: true, email: acc.email, name: acc.name, keyType: acc.keyType });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── list (admin) ─────────────────────────────────────────────────────────
  if (action === 'list') {
    if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });
    try {
      const accounts = await Account.find({}, { passwordHash: 0 }).lean();
      return res.json({ success: true, count: accounts.length, accounts });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── get (admin) ──────────────────────────────────────────────────────────
  if (action === 'get') {
    if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });
    const email = (p.email || '').toLowerCase().trim();
    if (!email) return res.json({ error: 'EMAIL_REQUIRED' });
    try {
      const acc = await Account.findOne({ email }, { passwordHash: 0 }).lean();
      if (!acc) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      return res.json({ success: true, ...acc });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  // ── notify (admin) ───────────────────────────────────────────────────────
  if (action === 'notify') {
    if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });
    const email  = (p.email  || '').toLowerCase().trim();
    const msg    = (p.msg    || '').trim();
    const reason = (p.reason || 'generic').trim();
    if (!email || !msg) return res.json({ error: 'FIELDS_REQUIRED' });

    try {
      const acc = await Account.findOne({ email });
      if (!acc) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });
      acc.notifications.push({ id: Date.now().toString(36), reason, msg, ts: new Date().toISOString(), read: false });
      await acc.save();
      return res.json({ success: true, notified: email });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  return res.json({ error: 'UNKNOWN_ACTION' });
});

// ── DELETE /api/acc — remove conta (admin) ────────────────────────────────────
router.delete('/', async (req, res) => {
  const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (token !== ADMIN_TOKEN()) return res.json({ error: 'UNAUTHORIZED' });

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.json({ error: 'EMAIL_REQUIRED' });

  try {
    const acc = await Account.findOneAndDelete({ email });
    if (!acc) return res.status(404).json({ error: 'ACCOUNT_NOT_FOUND' });

    await logAudit({ action: 'acc-delete', user: email, ip: getIP(req), result: 'success' });
    return res.json({ success: true, deleted: email });
  } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
});

module.exports = router;
