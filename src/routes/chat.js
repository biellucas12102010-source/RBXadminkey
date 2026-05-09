// src/routes/chat.js
const router = require('express').Router();
const { Chat, Unread } = require('../db');

function convKey(a, b) {
  return [...[a, b].map(s => s.toLowerCase())].sort().join('|');
}

// GET ?action=history&token=<me>&with=<friend>
router.get('/', async (req, res) => {
  const { action, token, with: friendEmail } = req.query;
  const me = (token || '').toLowerCase();
  if (!me) return res.json({ error: 'TOKEN_REQUIRED' });

  if (action === 'history') {
    if (!friendEmail) return res.json({ error: 'WITH_REQUIRED' });
    try {
      const conv = await Chat.findOne({ convKey: convKey(me, friendEmail) });
      return res.json({ success: true, messages: conv ? conv.messages : [] });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  if (action === 'unread') {
    try {
      const records = await Unread.find({ recipient: me, count: { $gt: 0 } }).lean();
      const counts = {};
      for (const r of records) counts[r.sender] = r.count;
      return res.json({ success: true, counts });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  return res.json({ error: 'UNKNOWN_ACTION' });
});

// POST ?action=send|react|markread&token=<me>
router.post('/', async (req, res) => {
  const { action, token } = req.query;
  const me = (token || '').toLowerCase();
  if (!me) return res.json({ error: 'TOKEN_REQUIRED' });

  const body = req.body || {};

  if (action === 'send') {
    const to = (body.to || '').toLowerCase();
    if (!to) return res.json({ error: 'TO_REQUIRED' });
    if (!body.text && !body.mediaBase64 && !body.stickerUrl)
      return res.json({ error: 'CONTENT_REQUIRED' });

    try {
      const ck = convKey(me, to);
      const newMsg = {
        id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        from:        me,
        to,
        text:        (body.text || '').substring(0, 2000),
        type:        body.type || 'text',
        mediaBase64: body.mediaBase64 || undefined,
        mediaName:   body.mediaName   || undefined,
        stickerUrl:  body.stickerUrl  || undefined,
        stickerName: body.stickerName || undefined,
        reactions:   {},
        ts:          new Date().toISOString()
      };

      let conv = await Chat.findOne({ convKey: ck });
      if (!conv) conv = new Chat({ convKey: ck, messages: [] });
      conv.messages.push(newMsg);
      if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
      conv.updatedAt = new Date();
      await conv.save();

      // Incrementa unread
      await Unread.findOneAndUpdate(
        { recipient: to, sender: me },
        { $inc: { count: 1 } },
        { upsert: true }
      );

      return res.json({ success: true, message: newMsg });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  if (action === 'react') {
    const friendEmail = (body.with || '').toLowerCase();
    const { msgId, emoji } = body;
    if (!friendEmail || !msgId || !emoji) return res.json({ error: 'PARAMS_REQUIRED' });

    try {
      const conv = await Chat.findOne({ convKey: convKey(me, friendEmail) });
      if (!conv) return res.json({ error: 'MSG_NOT_FOUND' });

      const msg = conv.messages.find(m => m.id === msgId);
      if (!msg) return res.json({ error: 'MSG_NOT_FOUND' });

      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(me);
      if (idx >= 0) {
        msg.reactions[emoji].splice(idx, 1);
        if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
      } else {
        msg.reactions[emoji].push(me);
      }
      conv.markModified('messages');
      await conv.save();
      return res.json({ success: true, message: msg });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  if (action === 'markread') {
    const sender = (body.from || '').toLowerCase();
    if (!sender) return res.json({ error: 'FROM_REQUIRED' });
    try {
      await Unread.findOneAndUpdate({ recipient: me, sender }, { count: 0 }, { upsert: true });
      return res.json({ success: true });
    } catch (e) { return res.json({ error: 'SERVER_ERROR', detail: e.message }); }
  }

  return res.json({ error: 'UNKNOWN_ACTION' });
});

module.exports = router;
