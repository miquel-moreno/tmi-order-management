// backend/src/routes/orders.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');
const orders = require('../services/orders');

const router = express.Router();
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../storage/uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const id = customAlphabet('0123456789abcdef', 12)();
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}_${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB por adjunto
});

// Crear pedido (canal manual o desde un webhook normalizado)
router.post('/', upload.array('attachments', 10), (req, res, next) => {
  try {
    const { channel = 'manual', sender, text, client_id, is_demo, category, ral_type } = req.body;
    const attachments = (req.files || []).map(f => ({
      filename: f.filename,
      original_name: f.originalname,
      mime_type: f.mimetype,
      size_bytes: f.size,
      kind: 'drawing'
    }));
    const order = orders.createOrderFromInbound({
      channel, sender, text, attachments,
      client_id: client_id || null,
      is_demo: is_demo === 'true' || is_demo === true,
      category: category || null,
      ral_type: ral_type || null,
    });
    res.status(201).json(order);
  } catch (e) { next(e); }
});

// Listar con filtros
router.get('/', (req, res, next) => {
  try {
    const { status, priority, machine, limit } = req.query;
    const list = orders.listOrders({
      status, priority, machine,
      limit: limit ? parseInt(limit, 10) : undefined
    });
    res.json(list);
  } catch (e) { next(e); }
});

// Alertas: urgentes sin iniciar
router.get('/alerts/stale-urgent', (req, res, next) => {
  try { res.json(orders.getStaleUrgentOrders()); }
  catch (e) { next(e); }
});

// Detalle
router.get('/:id', (req, res, next) => {
  try {
    const order = orders.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (e) { next(e); }
});

// Cambiar estado
router.post('/:id/status', (req, res, next) => {
  try {
    const { status, actor } = req.body;
    const order = orders.updateStatus(req.params.id, status, actor || 'operario');
    res.json(order);
  } catch (e) { next(e); }
});

// Cambiar prioridad manualmente
router.post('/:id/priority', (req, res, next) => {
  try {
    const { priority, actor } = req.body;
    const order = orders.updatePriority(req.params.id, priority, actor || 'admin');
    res.json(order);
  } catch (e) { next(e); }
});

// Editar campos (completar datos tras validacion)
router.patch('/:id', (req, res, next) => {
  try {
    const order = orders.updateFields(req.params.id, req.body, req.body.actor || 'admin');
    res.json(order);
  } catch (e) { next(e); }
});

// Subir adjunto adicional
router.post('/:id/attachments', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    const att = orders.addAttachment(req.params.id, req.file, req.body.kind || 'drawing');
    res.status(201).json(att);
  } catch (e) { next(e); }
});

// Registrar evento manual (incidencia, nota de trazabilidad)
router.post('/:id/events', (req, res, next) => {
  try {
    const { type, actor, meta } = req.body;
    orders.logEvent(req.params.id, { type, actor: actor || 'operario', meta });
    res.status(201).json(orders.getOrderById(req.params.id));
  } catch (e) { next(e); }
});

module.exports = router;
