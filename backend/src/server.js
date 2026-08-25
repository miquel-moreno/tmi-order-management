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

app.use(cors());
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
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/demo',     require('./routes/demo'));

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
