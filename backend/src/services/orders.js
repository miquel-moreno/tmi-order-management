// backend/src/services/orders.js
// Logica de negocio sobre pedidos: crear, actualizar estado, priorizar,
// y registrar trazabilidad.

const { customAlphabet } = require('nanoid');
const db = require('../models/db');
const { parseInboundMessage } = require('./parser');

const genId = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 10);

// Transiciones validas del estado. El panel las usa para mostrar botones.
// Reglas de negocio centralizadas aqui - asi luego es trivial cambiarlas.
const STATUS_TRANSITIONS = {
  received:            ['pending_validation', 'pending_shear', 'pending_press_brake', 'incident'],
  pending_validation:  ['pending_shear', 'pending_press_brake', 'incident'],
  pending_shear:       ['in_shear', 'incident'],
  in_shear:            ['sheared', 'incident'],
  sheared:             ['pending_press_brake', 'incident'],
  pending_press_brake: ['in_press_brake', 'incident'],
  in_press_brake:      ['done', 'incident'],
  done:                ['ready_for_pickup', 'delivered'],
  ready_for_pickup:    ['delivered'],
  delivered:           [],
  incident:            ['pending_validation', 'pending_shear', 'pending_press_brake']
};

function logEvent(order_id, { type, from, to, actor = 'system', meta = null }) {
  db.prepare(`
    INSERT INTO order_events (id, order_id, event_type, from_value, to_value, actor, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(genId(), order_id, type, from, to, actor, meta ? JSON.stringify(meta) : null);
}

function rowToOrder(row) {
  if (!row) return null;
  return {
    ...row,
    requires_shear:       !!row.requires_shear,
    requires_press_brake: !!row.requires_press_brake,
    is_demo:              !!row.is_demo
  };
}

// Determina el estado inicial segun lo que sabemos del pedido.
function initialStatus(parsed) {
  if (!parsed.is_complete) return 'pending_validation';
  if (parsed.requires_shear) return 'pending_shear';
  return 'pending_press_brake';
}

function createOrderFromInbound({
  channel, sender, text, attachments = [], client_id = null, is_demo = false,
  category = null, ral_type = null
}) {
  const parsed = parseInboundMessage({ text, attachmentsCount: attachments.length });
  // Los valores pasados explicitamente desde el formulario tienen prioridad sobre el parser
  if (category) parsed.category = category;
  if (ral_type) parsed.ral_type = ral_type;
  const id = genId();
  const status = initialStatus(parsed);

  const insertOrder = db.prepare(`
    INSERT INTO orders (
      id, external_number, client_id, channel, sender, raw_text,
      measurements, bend_radius,
      requires_shear, requires_press_brake,
      category, ral_type,
      priority, status, due_at, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAttachment = db.prepare(`
    INSERT INTO attachments (id, order_id, filename, original_name, mime_type, size_bytes, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMsg = db.prepare(`
    INSERT INTO inbound_messages (id, channel, sender, raw_text, order_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertOrder.run(
      id,
      parsed.external_number,
      client_id,
      channel,
      sender || null,
      text || null,
      parsed.measurements,
      parsed.bend_radius,
      parsed.requires_shear ? 1 : 0,
      parsed.requires_press_brake ? 1 : 0,
      parsed.category || null,
      parsed.ral_type || null,
      parsed.priority,
      status,
      parsed.due_at,
      is_demo ? 1 : 0
    );
    for (const a of attachments) {
      insertAttachment.run(
        genId(), id, a.filename, a.original_name || a.filename,
        a.mime_type || null, a.size_bytes || null, a.kind || 'drawing'
      );
    }
    insertMsg.run(genId(), channel, sender || null, text || null, id,
      JSON.stringify({ parsed }));

    logEvent(id, { type: 'created', to: status, meta: { parsed } });
    if (!parsed.is_complete) {
      logEvent(id, {
        type: 'incomplete_flag',
        to: 'pending_validation',
        meta: { missing_fields: parsed.missing_fields }
      });
    }
  });
  tx();

  return getOrderById(id);
}

function getOrderById(id) {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
  if (!row) return null;
  const order = rowToOrder(row);
  order.attachments = db.prepare(`SELECT * FROM attachments WHERE order_id = ? ORDER BY created_at`).all(id);
  order.events = db.prepare(`SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at`).all(id);
  return order;
}

function listOrders({ status, priority, machine, limit = 200 } = {}) {
  const clauses = [];
  const params = [];
  if (status)   { clauses.push(`status = ?`);   params.push(status); }
  if (priority) { clauses.push(`priority = ?`); params.push(priority); }
  if (machine === 'shear')      clauses.push(`requires_shear = 1`);
  if (machine === 'press_brake') clauses.push(`requires_press_brake = 1`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  // Orden: primero por prioridad (critica arriba), luego por due_at, luego por
  // fecha de recepcion. Usamos CASE para ordenar por prioridad "logica".
  const sql = `
    SELECT *,
      CASE priority
        WHEN 'critical'           THEN 1
        WHEN 'very_high'          THEN 2
        WHEN 'high'               THEN 3
        WHEN 'medium'             THEN 4
        WHEN 'low'                THEN 5
        WHEN 'pending_validation' THEN 6
        ELSE 7
      END AS _prio_rank
    FROM orders
    ${where}
    ORDER BY _prio_rank ASC,
             (due_at IS NULL) ASC,
             due_at ASC,
             received_at ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);
  return rows.map(rowToOrder).map(o => {
    const atts = db.prepare(`SELECT id, filename, mime_type, kind FROM attachments WHERE order_id = ?`).all(o.id);
    return { ...o, attachments: atts };
  });
}

function updateStatus(id, next_status, actor = 'operario') {
  const order = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });

  const allowed = STATUS_TRANSITIONS[order.status] || [];
  if (!allowed.includes(next_status)) {
    throw Object.assign(
      new Error(`Transicion no permitida: ${order.status} -> ${next_status}`),
      { status: 400 }
    );
  }

  // Marcadores temporales segun el nuevo estado.
  const now = new Date().toISOString();
  const fields = ['status = ?'];
  const params = [next_status];

  if (['in_shear', 'in_press_brake'].includes(next_status)) {
    fields.push(`started_at = COALESCE(started_at, ?)`);
    params.push(now);
  }
  if (next_status === 'done') {
    fields.push(`finished_at = ?`);
    params.push(now);
  }
  if (next_status === 'delivered') {
    fields.push(`delivered_at = ?`);
    params.push(now);
  }

  params.push(id);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  logEvent(id, {
    type: 'status_changed',
    from: order.status,
    to: next_status,
    actor
  });
  return getOrderById(id);
}

function updatePriority(id, priority, actor = 'admin') {
  const order = db.prepare(`SELECT priority FROM orders WHERE id = ?`).get(id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  db.prepare(`UPDATE orders SET priority = ? WHERE id = ?`).run(priority, id);
  logEvent(id, { type: 'priority_changed', from: order.priority, to: priority, actor });
  return getOrderById(id);
}

function updateFields(id, patch, actor = 'admin') {
  const allowed = ['external_number', 'notes', 'measurements', 'bend_radius',
                   'due_at', 'requires_shear', 'requires_press_brake',
                   'category', 'ral_type'];
  const fields = [];
  const params = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = ?`);
      let v = patch[k];
      if (k === 'requires_shear' || k === 'requires_press_brake') v = v ? 1 : 0;
      params.push(v);
    }
  }
  if (!fields.length) return getOrderById(id);
  params.push(id);
  db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  logEvent(id, { type: 'fields_updated', actor, meta: patch });
  return getOrderById(id);
}

// Alertas: pedidos urgentes no iniciados. El frontend llama a esto cada X min.
function getStaleUrgentOrders() {
  const now = new Date();
  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE status IN ('received','pending_validation','pending_shear','pending_press_brake')
      AND priority IN ('critical','very_high','high')
      AND due_at IS NOT NULL
  `).all();
  return rows
    .map(rowToOrder)
    .filter(o => {
      const due = new Date(o.due_at).getTime();
      // Si faltan menos de 2h y no empezo, es alerta.
      return (due - now.getTime()) < 2 * 3600 * 1000;
    });
}

function addAttachment(order_id, file, kind = 'drawing') {
  const row = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(order_id);
  if (!row) throw Object.assign(new Error('Order not found'), { status: 404 });
  const id = genId();
  db.prepare(`
    INSERT INTO attachments (id, order_id, filename, original_name, mime_type, size_bytes, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, order_id, file.filename, file.originalname, file.mimetype, file.size, kind);
  logEvent(order_id, { type: 'attachment_added', actor: 'operario', meta: { filename: file.filename } });
  return db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id);
}

module.exports = {
  STATUS_TRANSITIONS,
  createOrderFromInbound,
  getOrderById,
  listOrders,
  updateStatus,
  updatePriority,
  updateFields,
  getStaleUrgentOrders,
  addAttachment,
  logEvent
};
