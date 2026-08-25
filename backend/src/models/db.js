// backend/src/models/db.js
// Capa de base de datos con SQLite (better-sqlite3).
// SQLite lo elegimos porque el MVP corre en una maquina en taller o en un VPS
// pequeno: cero admin, transacciones serias, y trivial de migrar a Postgres despues.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/taller.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      contact      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      role         TEXT NOT NULL CHECK(role IN ('operario','admin','montador')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS machines (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK(kind IN ('cizalla','plegadora'))
    );

    CREATE TABLE IF NOT EXISTS inbound_messages (
      id           TEXT PRIMARY KEY,
      channel      TEXT NOT NULL CHECK(channel IN ('whatsapp','email','manual')),
      sender       TEXT,
      raw_text     TEXT,
      received_at  TEXT NOT NULL DEFAULT (datetime('now')),
      payload_json TEXT,          -- JSON original del webhook para debugging
      order_id     TEXT,          -- link al pedido creado a partir de este mensaje
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                    TEXT PRIMARY KEY,
      external_number       TEXT,                      -- numero de pedido del cliente
      client_id             TEXT,
      channel               TEXT NOT NULL CHECK(channel IN ('whatsapp','email','manual')),
      sender                TEXT,
      raw_text              TEXT,                      -- texto original SIEMPRE guardado
      notes                 TEXT,                      -- observaciones del operario
      measurements          TEXT,                      -- medidas extraidas (texto libre)
      bend_radius           TEXT,                      -- radio/tipo de plegado
      requires_shear        INTEGER NOT NULL DEFAULT 0, -- pasa por cizalla
      requires_press_brake  INTEGER NOT NULL DEFAULT 1, -- pasa por plegadora
      priority              TEXT NOT NULL DEFAULT 'pending_validation'
                             CHECK(priority IN ('critical','very_high','high','medium','low','pending_validation')),
      status                TEXT NOT NULL DEFAULT 'received'
                             CHECK(status IN (
                               'received',
                               'pending_validation',
                               'pending_shear',
                               'in_shear',
                               'sheared',
                               'pending_press_brake',
                               'in_press_brake',
                               'done',
                               'ready_for_pickup',
                               'delivered',
                               'incident'
                             )),
      category              TEXT,                      -- categoria del pedido (ventana, puerta, fachada...)
      ral_type              TEXT,                      -- codigo RAL de la chapa (ej. RAL 9016)
      due_at                TEXT,                      -- ISO datetime fecha/hora comprometida
      received_at           TEXT NOT NULL DEFAULT (datetime('now')),
      started_at            TEXT,
      finished_at           TEXT,
      delivered_at          TEXT,
      is_demo               INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status   ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders(priority);
    CREATE INDEX IF NOT EXISTS idx_orders_due      ON orders(due_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id           TEXT PRIMARY KEY,
      order_id     TEXT NOT NULL,
      filename     TEXT NOT NULL,                      -- nombre en disco
      original_name TEXT,
      mime_type    TEXT,
      size_bytes   INTEGER,
      kind         TEXT NOT NULL DEFAULT 'drawing'
                    CHECK(kind IN ('drawing','photo','document','other')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_order ON attachments(order_id);
  `);

  // Migraciones: añadir columnas si la BD ya existia sin ellas
  for (const col of [
    `ALTER TABLE orders ADD COLUMN category TEXT`,
    `ALTER TABLE orders ADD COLUMN ral_type TEXT`,
  ]) {
    try { db.exec(col); } catch (_) { /* columna ya existe */ }
  }

  db.exec(`

    CREATE TABLE IF NOT EXISTS order_events (
      id           TEXT PRIMARY KEY,
      order_id     TEXT NOT NULL,
      event_type   TEXT NOT NULL,    -- created, status_changed, priority_changed, note_added, incident, etc.
      from_value   TEXT,
      to_value     TEXT,
      actor        TEXT,             -- usuario o 'system'
      meta_json    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
  `);
}

init();

module.exports = db;
