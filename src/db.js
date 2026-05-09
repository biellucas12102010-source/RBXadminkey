// src/db.js — Conexão MongoDB + todos os models
const mongoose = require('mongoose');

// ── Conexão ───────────────────────────────────────────────────────────────────
let connected = false;
async function connect() {
  if (connected) return;
  await mongoose.connect(process.env.MONGODB_URI);
  connected = true;
  console.log('[db] MongoDB conectado');
}

// ── Schema: Key ───────────────────────────────────────────────────────────────
const keySchema = new mongoose.Schema({
  key:            { type: String, required: true, unique: true, index: true },
  type:           { type: String, default: 'free' },      // free | premium | dev
  active:         { type: Boolean, default: true },
  suspended:      { type: Boolean, default: false },
  hwid:           { type: String, default: null },
  user:           { type: String, default: 'Anonymous' },
  expiry:         { type: Date,   default: null },
  daysOnFirstUse: { type: Number, default: 1 },           // 0 = unlimited
  created:        { type: Date,   default: Date.now },
  revokedAt:      { type: Date,   default: null },
  deletedAt:      { type: Date,   default: null },
  deletedVia:     { type: String, default: null },
}, { collection: 'keys' });

// ── Schema: Account (redux-accounts) ─────────────────────────────────────────
const accountSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, index: true, lowercase: true },
  name:         { type: String, default: '' },
  passwordHash: { type: String, required: true },
  key:          { type: String, default: null },
  keyType:      { type: String, default: null },
  hwid:         { type: String, default: null },
  status:       { type: String, default: 'active' },      // active | suspended
  notifications:{ type: Array,  default: [] },
  registeredAt: { type: Date,   default: Date.now },
  updatedAt:    { type: Date,   default: Date.now },
}, { collection: 'accounts' });

// ── Schema: Audit Log ─────────────────────────────────────────────────────────
const auditSchema = new mongoose.Schema({
  ts:     { type: Date,   default: Date.now, index: true },
  action: { type: String },
  key:    { type: String, default: null },
  user:   { type: String, default: null },
  ip:     { type: String, default: null },
  result: { type: String, default: 'success' },
  detail: { type: String, default: null },
}, { collection: 'audit' });

// ── Schema: Chat ──────────────────────────────────────────────────────────────
// Chave de conversa: emails ordenados alfabeticamente separados por |
const chatSchema = new mongoose.Schema({
  convKey:  { type: String, required: true, unique: true, index: true },
  messages: { type: Array, default: [] },
  updatedAt:{ type: Date,  default: Date.now },
}, { collection: 'chats' });

// ── Schema: Unread count ──────────────────────────────────────────────────────
const unreadSchema = new mongoose.Schema({
  recipient: { type: String, required: true },
  sender:    { type: String, required: true },
  count:     { type: Number, default: 0 },
}, { collection: 'unread' });
unreadSchema.index({ recipient: 1, sender: 1 }, { unique: true });

// ── Schema: Reset Code ────────────────────────────────────────────────────────
const resetSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, index: true },
  code:      { type: String, required: true },
  expiresAt: { type: Date,   required: true },
}, { collection: 'reset_codes' });

// TTL index: MongoDB apaga automaticamente docs expirados
resetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = {
  connect,
  Key:     mongoose.model('Key',     keySchema),
  Account: mongoose.model('Account', accountSchema),
  Audit:   mongoose.model('Audit',   auditSchema),
  Chat:    mongoose.model('Chat',    chatSchema),
  Unread:  mongoose.model('Unread',  unreadSchema),
  Reset:   mongoose.model('Reset',   resetSchema),
};
