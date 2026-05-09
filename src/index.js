// src/index.js — Servidor Express principal (substitui Netlify Functions)
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { connect } = require('./db');

const app = express();

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));  // 10mb para suportar imagens no chat
app.use(express.urlencoded({ extended: true }));

// ── Arquivos estáticos (public/) ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Rotas da API ─────────────────────────────────────────────────────────────
//  Todas as URLs antigas do Netlify (/api/acc, /api/validate, etc.) são mantidas
//  exatamente iguais — não precisa mudar nada no executor C#.
app.use('/api/validate',   require('./routes/validate'));
app.use('/api/generate',   require('./routes/generate'));
app.use('/api/revoke',     require('./routes/revoke'));
app.use('/api/reset-hwid', require('./routes/reset-hwid'));
app.use('/api/renew',      require('./routes/renew'));
app.use('/api/list',       require('./routes/list'));
app.use('/api/audit',      require('./routes/audit'));
app.use('/api/acc',        require('./routes/acc'));
app.use('/api/chat',       require('./routes/chat'));

// ── Fallback: serve index.html para qualquer rota não-API ─────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Inicialização ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] RBX Key System rodando na porta ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[server] Falha ao conectar no MongoDB:', err.message);
    process.exit(1);
  });
