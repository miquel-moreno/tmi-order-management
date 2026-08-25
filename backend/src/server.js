// backend/src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('./models/db'); // inicializa schema

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../storage/uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// CORS cerrado: la demo se sirve desde el MISMO origen que la API (el panel es
// estatico servido por este mismo proceso), asi que no se permite ningun origen
// cruzado. Same-origin no necesita CORS; cross-origin queda bloqueado.
app.use(cors({ origin: false }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Servimos los adjuntos estaticamente. En produccion ponlos detras de auth.
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

// Servimos el frontend estatico (single HTML) desde /frontend
const FRONTEND_DIR = path.join(__dirname, '../../frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use('/', express.static(FRONTEND_DIR));
}

app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/orders',   require('./routes/orders'));
app.use('/api/demo',     require('./routes/demo'));

// Webhooks de ingesta: implementados en routes/webhooks.js (demuestran el diseño
// de payload normalizado), pero DESACTIVADOS en la demo pública. La entrada de
// mensajes se hace desde el panel con el endpoint interno /api/demo/simulate, de
// modo que no queda ninguna escritura pública sin autenticar — ni la descarga de
// URLs arbitrarias del webhook (SSRF). Se activan con WEBHOOKS_ENABLED=1.
if (process.env.WEBHOOKS_ENABLED === '1') {
  app.use('/api/webhooks', require('./routes/webhooks'));
} else {
  app.use('/api/webhooks', (req, res) =>
    res.status(404).json({ error: 'Webhooks desactivados en la demo. Usa el simulador del panel.' }));
}

// Manejador de errores centralizado
app.use((err, req, res, next) => {
  console.error('[err]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`Taller de Pedidos (demo) corriendo en http://localhost:${PORT}`);
  console.log(`  - Panel:      http://localhost:${PORT}/`);
  console.log(`  - API health: http://localhost:${PORT}/api/health`);
});
