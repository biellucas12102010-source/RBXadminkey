// src/helpers.js — funções utilitárias compartilhadas
const crypto = require('crypto');
const fetch  = require('node-fetch');
const { Audit } = require('./db');

// ── IP ────────────────────────────────────────────────────────────────────────
function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || null;
}

// ── Hash de senha ─────────────────────────────────────────────────────────────
function hashPass(password) {
  return crypto
    .createHash('sha256')
    .update(password + 'rbx-acc-salt-2025')
    .digest('hex');
}

// ── Audit log ─────────────────────────────────────────────────────────────────
async function logAudit({ action, key = null, user = null, ip = null, result = 'success', detail = null }) {
  try {
    await Audit.create({ action, key, user, ip, result, detail });
  } catch (e) {
    console.error('[audit] falha ao registrar:', e.message);
  }
}

// ── Mascara email (abc@gmail.com → a**@g***l.com) ─────────────────────────────
function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1);
  const maskedLocal  = local[0] + '*'.repeat(Math.max(local.length - 1, 1));
  const dot = domain.lastIndexOf('.');
  const maskedDomain = dot > 0
    ? domain[0] + '*'.repeat(dot - 1) + domain.slice(dot)
    : domain[0] + '*'.repeat(domain.length - 1);
  return maskedLocal + '@' + maskedDomain;
}

// ── Envio de e-mail de redefinição ────────────────────────────────────────────
async function sendResetEmail(name, toEmail, code) {
  const appName   = process.env.APP_NAME          || 'RBXexploit';
  const fromEmail = process.env.RESET_FROM_EMAIL  || process.env.GMAIL_USER || 'noreply@rbxexploit.com';

  const subject = `${appName} — Código de redefinição de senha`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0E0E22;color:#CCCCEE;border-radius:16px;padding:32px">
      <h2 style="color:white;margin-bottom:4px">${appName}</h2>
      <p style="color:#6C3FC4;font-size:11px;margin-bottom:24px">REDEFINIÇÃO DE SENHA</p>
      <p>Olá <b style="color:white">${name}</b>,</p>
      <p>Use o código abaixo para redefinir sua senha. Ele expira em <b>15 minutos</b>.</p>
      <div style="background:#1A1A3A;border:1px solid #6C3FC4;border-radius:12px;padding:20px;text-align:center;margin:24px 0">
        <span style="font-family:monospace;font-size:32px;letter-spacing:10px;color:white;font-weight:bold">${code}</span>
      </div>
      <p style="color:#555577;font-size:12px">Se você não solicitou isso, ignore este e-mail. Sua senha não será alterada.</p>
    </div>`;
  const text = `${appName} — Código de redefinição: ${code}\n\nExpira em 15 minutos.\nSe não solicitou, ignore.`;

  // ── Gmail via Nodemailer (principal) ─────────────────────────────────────
  const gmailUser = process.env.GMAIL_USER || '';
  const gmailPass = process.env.GMAIL_APP_PASSWORD || '';
  if (gmailUser && gmailPass) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      });
      await transporter.sendMail({
        from: `"${appName}" <${gmailUser}>`,
        to: toEmail,
        subject,
        html,
        text,
      });
      console.log(`[sendResetEmail] Gmail OK → ${toEmail}`);
      return true;
    } catch (e) { console.error('[sendResetEmail] Gmail erro:', e.message); }
  }

  // ── Resend (fallback) ─────────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY || '';
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: [toEmail], subject, html, text })
      });
      if (r.ok) return true;
      console.error('[sendResetEmail] Resend error:', await r.text());
    } catch (e) { console.error('[sendResetEmail] Resend exception:', e.message); }
  }

  // ── Mailgun (fallback) ────────────────────────────────────────────────────
  const mailgunKey = process.env.MAILGUN_API_KEY || '';
  const mailgunDom = process.env.MAILGUN_DOMAIN  || '';
  if (mailgunKey && mailgunDom) {
    try {
      const form = new URLSearchParams({ from: fromEmail, to: toEmail, subject, html, text });
      const r = await fetch(`https://api.mailgun.net/v3/${mailgunDom}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from('api:' + mailgunKey).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: form.toString()
      });
      if (r.ok) return true;
      console.error('[sendResetEmail] Mailgun error:', await r.text());
    } catch (e) { console.error('[sendResetEmail] Mailgun exception:', e.message); }
  }

  // Dev mode — loga o código no console
  console.log(`[sendResetEmail] DEV MODE — código para ${toEmail}: ${code}`);
  return false;
}

module.exports = { getIP, hashPass, logAudit, maskEmail, sendResetEmail };