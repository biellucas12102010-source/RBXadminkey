// src/routes/validate.js
const router = require('express').Router();
const { Key } = require('../db');

router.all('/', async (req, res) => {
  const p    = { ...req.query, ...req.body };
  const key  = (p.key  || '').trim();
  const hwid = (p.hwid || '').trim();

  if (!key) return res.json({ valid: false, error: 'KEY_INVALID' });

  // Dev key — sempre válida
  if (key === 'DEVK_REDUXSTUDIOS1#')
    return res.json({ valid: true, type: 'dev', hwid_ok: true, expiry: null });

  try {
    const entry = await Key.findOne({ key });
    if (!entry)          return res.json({ valid: false, error: 'KEY_INVALID' });
    if (!entry.active)   return res.json({ valid: false, error: 'KEY_REVOKED' });
    if (entry.suspended) return res.json({ valid: false, error: 'KEY_SUSPENDED' });

    if (entry.expiry && Date.now() > entry.expiry.getTime()) {
      entry.active = false;
      await entry.save();
      return res.json({ valid: false, error: 'KEY_EXPIRED' });
    }

    // Primeiro uso: vincula HWID e calcula expiração
    if (!entry.hwid) {
      if (hwid) {
        entry.hwid = hwid;
        const days = entry.daysOnFirstUse;
        if (days === 0) {
          entry.expiry = null;
        } else {
          entry.expiry = new Date(Date.now() + days * 86400000);
        }
        await entry.save();
      }
      return res.json({ valid: true, type: entry.type, hwid_ok: true, expiry: entry.expiry || null });
    }

    if (entry.hwid !== hwid) return res.json({ valid: false, error: 'HWID_MISMATCH' });

    return res.json({ valid: true, type: entry.type, hwid_ok: true, expiry: entry.expiry || null });
  } catch (e) {
    return res.json({ valid: false, error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
