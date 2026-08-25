// backend/src/routes/demo.js
// Modo simulacion: generar pedidos ficticios para probar el panel.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');
const orders = require('../services/orders');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../storage/uploads');
const genId = customAlphabet('0123456789abcdef', 12);

// Genera un SVG "dibujo de chapa" como placeholder visual, sin deps externas.
function generatePlaceholderDrawing(label) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f5f0e6"/>
  <g stroke="#111" stroke-width="2" fill="none">
    <rect x="80" y="80" width="440" height="240"/>
    <line x1="80"  y1="160" x2="520" y2="160" stroke-dasharray="8 6"/>
    <line x1="80"  y1="240" x2="520" y2="240" stroke-dasharray="8 6"/>
    <circle cx="140" cy="120" r="8"/>
    <circle cx="460" cy="120" r="8"/>
    <circle cx="140" cy="280" r="8"/>
    <circle cx="460" cy="280" r="8"/>
  </g>
  <g font-family="monospace" font-size="14" fill="#111">
    <text x="300" y="50" text-anchor="middle" font-size="18" font-weight="bold">${label}</text>
    <text x="300" y="360" text-anchor="middle">Dibujo de ejemplo - 440 x 240 mm</text>
    <text x="300" y="380" text-anchor="middle">2 pliegues | e=2mm | Aluminio</text>
  </g>
</svg>`;
  const filename = `demo_${Date.now()}_${genId()}.svg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), svg);
  return {
    filename,
    original_name: `${label}.svg`,
    mime_type: 'image/svg+xml',
    size_bytes: Buffer.byteLength(svg),
    kind: 'drawing'
  };
}

const DEMO_MESSAGES = [
  { channel: 'whatsapp', sender: 'Juan (montador)',
    text: 'Pedido 45821, lo necesito hoy. 200x100, e=2mm, 2 pliegues r=3mm.' },
  { channel: 'whatsapp', sender: 'Pedro (montador)',
    text: 'Para manana primera hora. Pedido #45822. Cortar y plegar. 350x120x2.' },
  { channel: 'email', sender: 'pedidos@cliente.com',
    text: 'Asunto: Pedido 45823\n\nBuenos dias, para pasado manana. Medidas 500x200, radio 2mm.' },
  { channel: 'whatsapp', sender: 'Juan (montador)',
    text: 'Pedido 45824 para manana ultima hora.' },
  { channel: 'whatsapp', sender: 'Luis (montador)',
    text: 'Foto adjunta. Es urgente.' }, // incompleto a proposito
  { channel: 'email', sender: 'compras@cliente.com',
    text: 'Asunto: Pedido 45826 - 18/04\n\nPor favor preparar. 600x300 e=3mm. Sin corte.' }
];

router.post('/seed', (req, res, next) => {
  try {
    const created = [];
    for (const m of DEMO_MESSAGES) {
      const att = generatePlaceholderDrawing(`PED-${Math.floor(Math.random()*90000)+10000}`);
      const o = orders.createOrderFromInbound({
        channel: m.channel,
        sender: m.sender,
        text: m.text,
        attachments: [att],
        is_demo: true
      });
      created.push({ id: o.id, status: o.status, priority: o.priority });
    }
    res.status(201).json({ created_count: created.length, orders: created });
  } catch (e) { next(e); }
});

// Borrar solo los demo
router.delete('/seed', (req, res, next) => {
  try {
    const db = require('../models/db');
    const ids = db.prepare(`SELECT id FROM orders WHERE is_demo = 1`).all().map(r => r.id);
    const stmt = db.prepare(`DELETE FROM orders WHERE id = ?`);
    const tx = db.transaction(() => { for (const id of ids) stmt.run(id); });
    tx();
    res.json({ deleted: ids.length });
  } catch (e) { next(e); }
});

module.exports = router;
