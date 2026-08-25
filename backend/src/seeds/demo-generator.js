// backend/src/seeds/demo-generator.js
//
// Generador DETERMINISTA de datos de demostracion para la demo publica.
//
// Crea 3 clientes ficticios, 6 usuarios (5 montadores + 1 operario) y ~72
// pedidos repartidos por estado, prioridad, canal y a lo largo de los ultimos
// 30 dias. Todo queda marcado is_demo = 1 (los pedidos) o con id 'demo-*'
// (clientes y usuarios) para poder borrarlo con clearDemo() sin tocar nada mas.
//
// Determinismo: con la misma SEED, la ESTRUCTURA generada (que plantilla, que
// estado, que desfases en dias/horas) es identica en cada ejecucion. Las marcas
// de tiempo son relativas al instante de ejecucion, para que la demo siempre
// muestre "los ultimos 30 dias" por muy tarde que se despliegue.
//
// Los pedidos se crean pasando por el parser y la maquina de estados reales
// (createOrderFromInbound + updateStatus): la demo demuestra el sistema de
// verdad. Solo las marcas de tiempo se reescriben despues, para que el historico
// sea coherente y escalonado en vez de "todo en el mismo segundo".

const fs = require('fs');
const path = require('path');
const { customAlphabet } = require('nanoid');
const db = require('../models/db');
const orders = require('../services/orders');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../storage/uploads');
const genHex = customAlphabet('0123456789abcdef', 12);

const SEED = 20260825;
const NUMBER_START = 90000; // rango claramente ficticio

const iso = (d) => d.toISOString();

// ── PRNG determinista (mulberry32) ──────────────────────────────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Datos fijos ─────────────────────────────────────────────────────────────
const MONTADORES = ['Montador A', 'Montador B', 'Montador C', 'Montador D', 'Montador E'];

const CLIENTS = [
  { id: 'demo-cli-1', name: 'Cerrajería Ejemplo S.L.', email: 'pedidos@example.com' },
  { id: 'demo-cli-2', name: 'Construcciones Ficticias', email: 'compras@example.com' },
  { id: 'demo-cli-3', name: 'Taller Demo',              email: 'taller@example.com' },
];

const CATEGORIES = ['ventana', 'puerta', 'fachada', 'perfil', 'bandeja',
                    'cubierta', 'marco', 'reja', 'canaleta', 'vierteaguas', 'dintel'];
const RAL_CODES  = ['9016', '9005', '7016', '7035', '9010', '3004'];
const SHEAR_PHRASES = ['Cortar y plegar.', 'Requiere corte.', 'Cizalla + plegado.', 'Cortado y plegado.'];

// Bateria de mensajes para "Simular mensaje entrante" (interaccion en vivo del
// panel). Cubre variantes de escritura y algun mensaje incompleto a proposito,
// para que se vea al parser clasificar y, a veces, mandar a validar. {n} = numero.
const SIM_TEMPLATES = [
  'Pedido {n}, lo necesito hoy. 400x200 e=2mm, 2 pliegues r=3mm. RAL 9016.',
  'ped. {n} para mañana primera hora. Cortar y plegar 350x120x2.',
  '#{n} pasado mañana. 500x200, radio 2mm. Para fachada.',
  'nº {n}, para mañana. 300x150 e=3mm. Vierteaguas.',
  'Pedido {n}. 600x300 e=3mm sin corte. Marco de ventana. RAL 7016.',
  'ORDEN {n} urgente hoy. Reja 800x400. Cizalla + plegado.',
  'pedido nº {n} para manana ultima hora. 450x180 e=2mm.',
  'Foto adjunta, es urgente.',            // incompleto: sin numero ni fecha -> a validar
  'Pedido {n}. 250x100 e=2mm.',           // incompleto: sin fecha -> a validar
  'Para mañana. 400x200 e=2mm. Dintel.',  // incompleto: sin numero -> a validar
];

// Formas de escribir el numero de pedido — cubre las variantes que el parser sabe leer.
const NUM_FORMS = [
  (n) => `Pedido ${n}`,
  (n) => `ped. ${n}`,
  (n) => `#${n}`,
  (n) => `nº ${n}`,
  (n) => `pedido nº ${n}`,
  (n) => `ORDEN ${n}`,
];

// Frases de urgencia por prioridad. Se mezclan variantes con y sin tildes a
// proposito: el parser normaliza tildes, asi que ambas deben funcionar.
const URGENCY = {
  critical:  ['lo necesito hoy', 'para hoy', 'urgente hoy', 'hoy mismo'],
  very_high: ['para mañana primera hora', 'manana a primera hora', 'mañana a primera hora'],
  high:      ['para mañana', 'para manana', 'mañana última hora', 'manana por la tarde'],
  medium:    ['pasado mañana', 'pasado manana'],
};

// ── clearDemo ───────────────────────────────────────────────────────────────
function clearDemo() {
  const orderIds = db.prepare(`SELECT id FROM orders WHERE is_demo = 1`).all().map(r => r.id);
  const files = db.prepare(`
    SELECT a.filename FROM attachments a
    JOIN orders o ON o.id = a.order_id
    WHERE o.is_demo = 1
  `).all().map(r => r.filename);

  const tx = db.transaction(() => {
    const delMsg   = db.prepare(`DELETE FROM inbound_messages WHERE order_id = ?`);
    const delOrder = db.prepare(`DELETE FROM orders WHERE id = ?`); // cascada: attachments + order_events
    for (const id of orderIds) { delMsg.run(id); delOrder.run(id); }
    db.prepare(`DELETE FROM clients WHERE id LIKE 'demo-%'`).run();
    db.prepare(`DELETE FROM users   WHERE id LIKE 'demo-%'`).run();
  });
  tx();

  // Ficheros SVG fuera de la transaccion (no son transaccionales).
  let removed = 0;
  for (const f of files) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); removed++; } catch (_) { /* ya no esta */ }
  }
  return { deleted_orders: orderIds.length, deleted_files: removed };
}

// ── Dibujo SVG de relleno (placeholder, sin datos reales) ───────────────────
function makeDrawing(label, idx) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f5f0e6"/>
  <g stroke="#111" stroke-width="2" fill="none">
    <rect x="80" y="80" width="440" height="240"/>
    <line x1="80" y1="160" x2="520" y2="160" stroke-dasharray="8 6"/>
    <line x1="80" y1="240" x2="520" y2="240" stroke-dasharray="8 6"/>
    <circle cx="140" cy="120" r="8"/><circle cx="460" cy="120" r="8"/>
    <circle cx="140" cy="280" r="8"/><circle cx="460" cy="280" r="8"/>
  </g>
  <g font-family="monospace" font-size="14" fill="#111">
    <text x="300" y="50" text-anchor="middle" font-size="18" font-weight="bold">${label}</text>
    <text x="300" y="360" text-anchor="middle">Dibujo de ejemplo (DEMO)</text>
    <text x="300" y="380" text-anchor="middle">chapa de aluminio</text>
  </g>
</svg>`;
  const filename = `demo_${String(idx).padStart(3, '0')}_${genHex()}.svg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), svg);
  return {
    filename,
    original_name: `${label}.svg`,
    mime_type: 'image/svg+xml',
    size_bytes: Buffer.byteLength(svg),
    kind: 'drawing',
  };
}

// ── Cadena de estados valida segun si el pedido pasa por cizalla ────────────
function chainFor(withShear) {
  return withShear
    ? ['pending_shear', 'in_shear', 'sheared', 'pending_press_brake', 'in_press_brake', 'done', 'ready_for_pickup', 'delivered']
    : ['pending_press_brake', 'in_press_brake', 'done', 'ready_for_pickup', 'delivered'];
}
function stepsTo(withShear, finalStatus) {
  const chain = chainFor(withShear);
  const idx = chain.indexOf(finalStatus);
  return idx <= 0 ? [] : chain.slice(1, idx + 1);
}

// due_at coherente con la fecha de recepcion, segun la urgencia.
function dueFrom(recv, kind) {
  if (!kind) return null;
  const d = new Date(recv);
  if (kind === 'today')            { d.setHours(18, 0, 0, 0); return d; }
  if (kind === 'tomorrow_morning') { d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; }
  if (kind === 'tomorrow')         { d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d; }
  if (kind === 'day_after')        { d.setDate(d.getDate() + 2); d.setHours(18, 0, 0, 0); return d; }
  return null;
}
const DUE_KIND = { critical: 'today', very_high: 'tomorrow_morning', high: 'tomorrow', medium: 'day_after' };

// ── generateDemo ────────────────────────────────────────────────────────────
function generateDemo() {
  clearDemo(); // idempotente: primero limpia lo que hubiera

  const now = new Date();
  const rng = makeRng(SEED);
  const rnd = () => rng();
  const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Clientes y usuarios (para que las tablas del esquema no esten vacias).
  const insCli = db.prepare(`INSERT INTO clients (id, name, contact) VALUES (?, ?, ?)`);
  for (const c of CLIENTS) insCli.run(c.id, c.name, c.email);
  const insUsr = db.prepare(`INSERT INTO users (id, name, role) VALUES (?, ?, ?)`);
  MONTADORES.forEach((m, i) => insUsr.run(`demo-usr-${i + 1}`, m, 'montador'));
  insUsr.run('demo-usr-6', 'Operario Demo', 'operario');

  // ── Definicion de los pedidos por bucket ──────────────────────────────────
  const specs = [];

  // Activos (15): en fases de corte y plegado.
  const activePlan = [
    ['pending_shear', true], ['pending_shear', true], ['pending_shear', true],
    ['in_shear', true], ['in_shear', true], ['in_shear', true],
    ['sheared', true], ['sheared', true],
    ['pending_press_brake', false], ['pending_press_brake', false],
    ['pending_press_brake', true], ['pending_press_brake', true],
    ['in_press_brake', false], ['in_press_brake', false], ['in_press_brake', true],
  ];
  for (const [finalStatus, withShear] of activePlan) {
    specs.push({ bucket: 'active', finalStatus, withShear, incident: false, recvDaysMin: 0, recvDaysMax: 4 });
  }

  // Terminados (45): done / ready_for_pickup / delivered, repartidos en 30 dias.
  const terminalPlan = [];
  for (let i = 0; i < 12; i++) terminalPlan.push('done');
  for (let i = 0; i < 13; i++) terminalPlan.push('ready_for_pickup');
  for (let i = 0; i < 20; i++) terminalPlan.push('delivered');
  for (const finalStatus of terminalPlan) {
    specs.push({ bucket: 'terminal', finalStatus, withShear: rnd() < 0.4, incident: false, recvDaysMin: 1, recvDaysMax: 30 });
  }

  // Incidencias (4): entran, avanzan un poco y se marcan como incidencia.
  for (let i = 0; i < 4; i++) {
    specs.push({ bucket: 'incident', finalStatus: 'incident', withShear: rnd() < 0.5, incident: true, recvDaysMin: 1, recvDaysMax: 12 });
  }

  // Prioridades para los 64 pedidos NO de validacion: ~10/20/30/40.
  const nonVal = specs; // de momento solo hay no-validacion
  const prioBag = shuffle([
    ...Array(7).fill('critical'),
    ...Array(13).fill('very_high'),
    ...Array(19).fill('high'),
    ...Array(25).fill('medium'),
  ]); // 64 en total
  nonVal.forEach((s, i) => { s.priority = prioBag[i]; s.dueKind = DUE_KIND[s.priority]; });

  // Validacion (8): incompletos por motivos DISTINTOS.
  //   Motivo -> que falta. hasNumber/hasDate/hasDrawing controlan el texto y el adjunto.
  const validationPlan = [
    { reason: 'falta_numero',        hasNumber: false, hasDate: true,  hasDrawing: true,  dueKind: 'tomorrow' },
    { reason: 'falta_numero',        hasNumber: false, hasDate: true,  hasDrawing: true,  dueKind: 'day_after' },
    { reason: 'falta_fecha',         hasNumber: true,  hasDate: false, hasDrawing: true,  dueKind: null },
    { reason: 'falta_fecha',         hasNumber: true,  hasDate: false, hasDrawing: true,  dueKind: null },
    { reason: 'falta_dibujo',        hasNumber: true,  hasDate: true,  hasDrawing: false, dueKind: 'today' },
    { reason: 'falta_dibujo',        hasNumber: true,  hasDate: true,  hasDrawing: false, dueKind: 'tomorrow' },
    { reason: 'falta_numero_fecha',  hasNumber: false, hasDate: false, hasDrawing: true,  dueKind: null },
    { reason: 'falta_fecha_dibujo',  hasNumber: true,  hasDate: false, hasDrawing: false, dueKind: null },
  ];
  for (const v of validationPlan) {
    specs.push({
      bucket: 'validation', finalStatus: 'pending_validation', withShear: false, incident: false,
      recvDaysMin: 0, recvDaysMax: 3, priority: null, ...v,
    });
  }

  // Canales para los 72: ~60% whatsapp, ~25% email, ~15% manual.
  const total = specs.length;
  const nEmail  = Math.round(total * 0.25);
  const nManual = Math.round(total * 0.15);
  const nWa     = total - nEmail - nManual;
  const channelBag = shuffle([
    ...Array(nWa).fill('whatsapp'),
    ...Array(nEmail).fill('email'),
    ...Array(nManual).fill('manual'),
  ]);
  specs.forEach((s, i) => { s.channel = channelBag[i]; });

  // ── Composicion de texto + remitente + numero por pedido ──────────────────
  let nextNumber = NUMBER_START;
  const measure = () => pick([
    () => `${pick([200, 300, 350, 400, 500, 600])}x${pick([100, 120, 150, 200, 250, 300])}`,
    () => `${pick([200, 350, 400, 500])} x ${pick([100, 120, 200])} x ${pick([2, 3])}`,
    () => `${pick([300, 400, 500])}x${pick([150, 200, 250])} e=${pick([1, 2, 3])}mm`,
    () => `${pick([200, 400])}x${pick([100, 200])}, e=${pick([2, 3])}mm, ${pick([2, 3, 4])} pliegues r=${pick([2, 3])}mm`,
    () => '',
  ])();

  for (const s of specs) {
    // Numero de pedido (si aplica)
    const wantsNumber = s.bucket === 'validation' ? s.hasNumber : true;
    s.number = wantsNumber ? nextNumber++ : null;

    // Remitente y cliente segun canal
    if (s.channel === 'email') {
      const c = pick(CLIENTS);
      s.sender = `${c.name} <${c.email}>`;
      s.client_id = c.id;
    } else {
      s.sender = pick(MONTADORES);
      s.client_id = null;
    }

    // Urgencia / fecha
    let urgency = '';
    if (s.bucket === 'validation') {
      if (s.hasDate) urgency = pick(URGENCY[s.dueKind === 'today' ? 'critical' : s.dueKind === 'day_after' ? 'medium' : 'high']);
    } else {
      urgency = pick(URGENCY[s.priority]);
    }

    // Adjunto (drawing) — validacion 'falta_dibujo'/'falta_fecha_dibujo' no lo lleva
    s.hasDrawing = s.bucket === 'validation' ? s.hasDrawing : true;

    // Texto
    const parts = [];
    if (s.number != null) parts.push(pick(NUM_FORMS)(s.number));
    if (urgency) parts.push(urgency);
    const m = measure(); if (m) parts.push(m);
    if (rnd() < 0.5) parts.push(pick([`para ${pick(CATEGORIES)}`, pick(CATEGORIES)]));
    if (s.withShear) parts.push(pick(SHEAR_PHRASES));
    if (rnd() < 0.35) parts.push(`RAL ${pick(RAL_CODES)}`);
    // Para 'falta_numero_fecha' aseguramos una frase sin numero ni fecha
    if (s.bucket === 'validation' && s.reason === 'falta_numero_fecha' && parts.length === 0) {
      parts.push('Foto adjunta, es urgente');
    }
    // El canal email antepone un asunto, como en un correo real.
    let text = parts.join('. ') + '.';
    if (s.channel === 'email') {
      const subj = s.number != null ? `Asunto: Pedido ${s.number}` : 'Asunto: consulta pedido';
      text = `${subj}\n\n${text}`;
    }
    s.text = text;

    // Fecha de recepcion (dias atras) + hora de taller
    let recvMs = now.getTime() - rint(s.recvDaysMin, s.recvDaysMax) * 86400000;
    const recv = new Date(recvMs);
    recv.setHours(rint(7, 17), rint(0, 59), 0, 0);
    if (recv.getTime() > now.getTime() - 3 * 3600000) recvMs = now.getTime() - 3 * 3600000;
    else recvMs = recv.getTime();
    s.receivedAt = new Date(recvMs);

    // Transiciones (incluida la incidencia, si aplica) y sus tiempos
    s.steps = stepsTo(s.withShear, s.finalStatus);
    s.allTransitions = s.incident ? [...stepsTo(s.withShear, s.withShear ? 'pending_shear' : 'pending_press_brake'), 'incident'] : s.steps.slice();
    // (para incidencia dejamos que avance 0..2 pasos antes; simplificamos: solo la incidencia)
    if (s.incident) {
      const advance = rint(0, Math.min(2, chainFor(s.withShear).length - 2));
      s.steps = chainFor(s.withShear).slice(1, 1 + advance);
      s.allTransitions = [...s.steps, 'incident'];
    }

    let t = s.receivedAt.getTime();
    s.stepTimes = s.allTransitions.map(() => {
      t += rint(20, 240) * 60000;
      if (t > now.getTime() - 60000) t = now.getTime() - 60000;
      return new Date(t);
    });

    // started/finished/delivered derivados de las transiciones
    s.startedAt = null; s.finishedAt = null; s.deliveredAt = null;
    s.allTransitions.forEach((st, i) => {
      if ((st === 'in_shear' || st === 'in_press_brake') && !s.startedAt) s.startedAt = s.stepTimes[i];
      if (st === 'done') s.finishedAt = s.stepTimes[i];
      if (st === 'delivered') s.deliveredAt = s.stepTimes[i];
    });

    // due_at coherente con la recepcion
    s.dueAt = dueFrom(s.receivedAt, s.bucket === 'validation' ? s.dueKind : DUE_KIND[s.priority]);
  }

  // ── Instanciacion: crear, transicionar y reescribir marcas de tiempo ──────
  const upEv   = db.prepare(`UPDATE order_events SET created_at = ? WHERE id = ?`);
  const upOrd  = db.prepare(`UPDATE orders SET received_at = ?, started_at = ?, finished_at = ?, delivered_at = ?, due_at = ? WHERE id = ?`);
  const upMsg  = db.prepare(`UPDATE inbound_messages SET received_at = ? WHERE order_id = ?`);
  const upAtt  = db.prepare(`UPDATE attachments SET created_at = ? WHERE order_id = ?`);

  const created = [];
  specs.forEach((s, idx) => {
    const atts = s.hasDrawing ? [makeDrawing(s.number != null ? `PED-${s.number}` : 'SIN-Nº', idx)] : [];
    const o = orders.createOrderFromInbound({
      channel: s.channel, sender: s.sender, text: s.text,
      attachments: atts, is_demo: true, client_id: s.client_id,
    });
    for (const st of s.steps) orders.updateStatus(o.id, st, 'operario');
    if (s.incident) orders.updateStatus(o.id, 'incident', 'operario');

    // Backdating de marcas de tiempo
    const evs = db.prepare(`SELECT id, event_type FROM order_events WHERE order_id = ? ORDER BY rowid`).all(o.id);
    let si = 0;
    for (const ev of evs) {
      let when = s.receivedAt;
      if (ev.event_type === 'created') when = s.receivedAt;
      else if (ev.event_type === 'incomplete_flag') when = new Date(s.receivedAt.getTime() + 2 * 60000);
      else if (ev.event_type === 'status_changed') { when = s.stepTimes[si] || s.receivedAt; si++; }
      upEv.run(iso(when), ev.id);
    }
    upOrd.run(
      iso(s.receivedAt),
      s.startedAt ? iso(s.startedAt) : null,
      s.finishedAt ? iso(s.finishedAt) : null,
      s.deliveredAt ? iso(s.deliveredAt) : null,
      s.dueAt ? iso(s.dueAt) : null,
      o.id
    );
    upMsg.run(iso(s.receivedAt), o.id);
    upAtt.run(iso(s.receivedAt), o.id);

    created.push(o.id);
  });

  return {
    created_count: created.length,
    clients: CLIENTS.length,
    users: MONTADORES.length + 1,
  };
}

// ── simulateInbound ─────────────────────────────────────────────────────────
// Crea UN pedido a partir de un mensaje de ejemplo, como si acabara de entrar
// por el canal indicado. Devuelve el texto enviado y el pedido resultante, para
// que el panel enseñe la relacion "entra texto suelto -> sale pedido clasificado".
// Marca is_demo = 1. Los numeros van en un rango 95000+ para no chocar con el seed.
let simCounter = 95000;
function simulateInbound(channel = 'whatsapp') {
  const ch = ['whatsapp', 'email', 'manual'].includes(channel) ? channel : 'whatsapp';

  let sender, client_id = null;
  if (ch === 'email') {
    const c = CLIENTS[Math.floor(Math.random() * CLIENTS.length)];
    sender = `${c.name} <${c.email}>`;
    client_id = c.id;
  } else {
    sender = MONTADORES[Math.floor(Math.random() * MONTADORES.length)];
  }

  const tpl = SIM_TEMPLATES[Math.floor(Math.random() * SIM_TEMPLATES.length)];
  const n = simCounter++;
  let text = tpl.replace('{n}', n);
  if (ch === 'email') text = `Asunto: ${text.split('.')[0]}\n\n${text}`;

  const atts = Math.random() < 0.7 ? [makeDrawing(`PED-${n}`, simCounter)] : [];
  const o = orders.createOrderFromInbound({ channel: ch, sender, text, attachments: atts, is_demo: true, client_id });

  return {
    sent: { channel: ch, sender, text },
    order: {
      id: o.id,
      external_number: o.external_number,
      status: o.status,
      priority: o.priority,
      requires_shear: o.requires_shear,
      measurements: o.measurements,
      category: o.category,
      ral_type: o.ral_type,
      due_at: o.due_at,
      to_validation: o.status === 'pending_validation',
    },
  };
}

module.exports = { generateDemo, clearDemo, simulateInbound, SEED };
