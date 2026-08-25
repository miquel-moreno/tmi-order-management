// backend/src/seeds/run-seed.js
// Ejecuta el seed sin necesidad de arrancar el servidor.
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');
const orders = require('../services/orders');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../../storage/uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const genId = customAlphabet('0123456789abcdef', 12);

function makeDrawing(label) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#f5f0e6"/>
  <g stroke="#111" stroke-width="2" fill="none">
    <rect x="80" y="80" width="440" height="240"/>
    <line x1="80" y1="160" x2="520" y2="160" stroke-dasharray="8 6"/>
    <line x1="80" y1="240" x2="520" y2="240" stroke-dasharray="8 6"/>
  </g>
  <text x="300" y="50" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold">${label}</text>
</svg>`;
  const filename = `seed_${Date.now()}_${genId()}.svg`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), svg);
  return {
    filename, original_name: `${label}.svg`,
    mime_type: 'image/svg+xml', size_bytes: Buffer.byteLength(svg), kind: 'drawing'
  };
}

const MSGS = [
  { channel: 'whatsapp', sender: 'Juan', text: 'Pedido 45821, lo necesito hoy. 200x100 e=2mm, 2 pliegues r=3mm.' },
  { channel: 'whatsapp', sender: 'Pedro', text: 'Pedido #45822, manana primera hora. Cortar y plegar 350x120x2.' },
  { channel: 'email',    sender: 'pedidos@cliente.com', text: 'Pedido 45823, pasado manana. 500x200 r=2mm.' },
  { channel: 'whatsapp', sender: 'Juan', text: 'Pedido 45824, manana ultima hora.' },
  { channel: 'whatsapp', sender: 'Luis', text: 'Foto adjunta, urgente' }, // incompleto
  { channel: 'email',    sender: 'compras@cliente.com', text: 'Pedido 45826 - 600x300 e=3mm. Sin corte.' }
];

for (const m of MSGS) {
  const att = makeDrawing(`PED-${Math.floor(Math.random()*90000)+10000}`);
  const o = orders.createOrderFromInbound({ ...m, attachments: [att], is_demo: true });
  console.log(`creado ${o.id}  status=${o.status}  prio=${o.priority}`);
}
console.log('Seed OK');
