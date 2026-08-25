// backend/src/routes/webhooks.js
// Endpoints para recibir mensajes de WhatsApp (Cloud API) y Email (Mailgun, SES, etc.).
// En el MVP aceptamos un payload "normalizado" simple. Cuando conectes el
// proveedor real, solo hay que traducir su payload a este formato aqui dentro.

const express = require('express');
const axiosLike = require('http');  // no usamos axios para no anadir dep
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');
const orders = require('../services/orders');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../storage/uploads');
const genId = customAlphabet('0123456789abcdef', 12);

// Helper: descarga una URL a disco local. En produccion reemplazar por fetch nativo.
// Aqui lo hacemos de forma muy simple; si la URL falla, guardamos metadata igualmente.
async function downloadToUploads(url, originalName) {
  return new Promise((resolve) => {
    const ext = path.extname(new URL(url).pathname) || '.bin';
    const filename = `${Date.now()}_${genId()}${ext}`;
    const fullPath = path.join(UPLOADS_DIR, filename);
    const client = url.startsWith('https') ? require('https') : require('http');
    client.get(url, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const file = fs.createWriteStream(fullPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({
        filename,
        original_name: originalName || path.basename(url),
        mime_type: res.headers['content-type'],
        size_bytes: parseInt(res.headers['content-length'] || '0', 10),
        kind: 'drawing'
      })));
      file.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Webhook WhatsApp (formato normalizado MVP)
// Payload esperado: { from, text, media: [{url, filename, mime_type}] }
router.post('/whatsapp', express.json({ limit: '5mb' }), async (req, res, next) => {
  try {
    const { from, text, media = [] } = req.body || {};
    const attachments = [];
    for (const m of media) {
      if (!m.url) continue;
      const att = await downloadToUploads(m.url, m.filename);
      if (att) attachments.push(att);
    }
    const order = orders.createOrderFromInbound({
      channel: 'whatsapp',
      sender: from,
      text,
      attachments
    });
    res.status(201).json({ order_id: order.id, status: order.status });
  } catch (e) { next(e); }
});

// Webhook Email (formato normalizado MVP)
// Payload esperado: { from, subject, text, attachments: [{url, filename, mime_type}] }
router.post('/email', express.json({ limit: '10mb' }), async (req, res, next) => {
  try {
    const { from, subject, text, attachments: emailAtts = [] } = req.body || {};
    const atts = [];
    for (const m of emailAtts) {
      if (!m.url) continue;
      const att = await downloadToUploads(m.url, m.filename);
      if (att) atts.push(att);
    }
    const order = orders.createOrderFromInbound({
      channel: 'email',
      sender: from,
      text: subject ? `${subject}\n\n${text || ''}` : text,
      attachments: atts
    });
    res.status(201).json({ order_id: order.id, status: order.status });
  } catch (e) { next(e); }
});

module.exports = router;
