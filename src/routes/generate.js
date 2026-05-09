// src/routes/generate.js
const router = require('express').Router();
const { Key } = require('../db');
const { getIP, logAudit } = require('../helpers');

const ADMIN_TOKEN = () => process.env.REDUX_ADMIN_TOKEN || 'redux-admin-secret';

function genKey(keyType) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const prefix = keyType === 'premium' ? 'KEYP_' : 'KEYF_';
  const len = keyType === 'premium' ? 20 : 15;
  let k = '';
  for (let i = 0; i < len; i++) k += chars[Math.floor(Math.random() * chars.length)];
  return prefix + k;
}

router.all('/', async (req, res) => {
  const p     = { ...req.query, ...req.body };
  const token = p.token || (req.headers['authorization'] || '').replace('Bearer ', '');

  if (token !== ADMIN_TOKEN()) {
    await logAudit({ action: 'generate', ip: getIP(req), result: 'unauthorized', detail: 'Token inválido' });
    return res.json({ error: 'UNAUTHORIZED' });
  }

  const rawType = (p.type || 'free').toLowerCase();
  const user    = p.user || 'Anonymous';

  let keyType = 'free';
  let daysOnFirstUse = 1;

  if      (rawType === 'premium')                              { keyType = 'premium'; daysOnFirstUse = 0; }
  else if (rawType === 'premium7')                             { keyType = 'premium'; daysOnFirstUse = 7; }
  else if (rawType === 'premium30')                            { keyType = 'premium'; daysOnFirstUse = 30; }
  else if (rawType === 'premiumunlimited' || rawType === 'premium_unlimited') { keyType = 'premium'; daysOnFirstUse = 0; }
  else if (rawType === 'free')                                 { keyType = 'free'; daysOnFirstUse = parseInt(p.days ?? '1', 10); }
  else if (rawType === 'free7')                                { keyType = 'free'; daysOnFirstUse = 7; }
  else if (rawType === 'free30')                               { keyType = 'free'; daysOnFirstUse = 30; }
  else if (rawType === 'freeunlimited' || rawType === 'free_unlimited') { keyType = 'free'; daysOnFirstUse = 0; }
  else {
    keyType = rawType.startsWith('premium') ? 'premium' : 'free';
    daysOnFirstUse = parseInt(p.days ?? '1', 10) || 1;
  }

  const key = genKey(keyType);

  try {
    await Key.create({ key, type: keyType, active: true, hwid: null, suspended: false, user, daysOnFirstUse });

    const expiryLabel = daysOnFirstUse === 0 ? 'unlimited'
      : daysOnFirstUse === 1 ? '1d on first use'
      : `${daysOnFirstUse}d on first use`;

    await logAudit({
      action: 'generate', key, user, ip: getIP(req), result: 'success',
      detail: `type=${keyType}, rawType=${rawType}, daysOnFirstUse=${daysOnFirstUse === 0 ? 'infinito' : daysOnFirstUse}`
    });

    return res.json({ success: true, key, type: keyType, user, expiry: expiryLabel, daysOnFirstUse });
  } catch (e) {
    await logAudit({ action: 'generate', user, ip: getIP(req), result: 'error', detail: e.message });
    return res.json({ error: 'SERVER_ERROR', detail: e.message });
  }
});

module.exports = router;
