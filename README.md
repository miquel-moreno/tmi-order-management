# Taller de Pedidos (demo) — gestión de pedidos de plegado de chapa

Sistema para una SL de plegado de chapa de aluminio con 1 cizalla + 1 plegadora.
Recibe pedidos por **WhatsApp** y **email**, los clasifica, prioriza y los muestra
en un **panel de taller** pensado para tablet junto a la plegadora.

---

## 1. Resumen de la solución

- **Backend**: Node.js + Express + SQLite (better-sqlite3). Base de datos en un
  solo archivo, cero admin, migrable a Postgres sin tocar lógica.
- **Frontend**: un único `index.html` con CSS/JS vanilla servido por el mismo
  backend. Sin build step, sin `npm install` en la tablet — abres una URL y
  funciona. Botones grandes, código de color por prioridad, auto-refresh.
- **Parser**: regex + heurísticas en español para extraer `nº pedido`,
  `fecha de entrega`, `urgencia`, `medidas`, `radio de plegado` y detectar si
  requiere cizalla. Aislado en `services/parser.js` para poder sustituirlo
  por otra implementación en el futuro sin tocar nada más.
- **Webhooks**: endpoints `POST /api/webhooks/whatsapp` y `/email` que aceptan
  un payload normalizado simple. Cuando conectes WhatsApp Cloud API o un
  proveedor de email (Mailgun, SES, Postmark) solo traduces su payload al
  formato normalizado dentro del mismo archivo.
- **Modo demo**: `POST /api/demo/seed` crea 6 pedidos ficticios con dibujos
  SVG generados al vuelo — útil para probar el panel sin datos reales.

---

## 2. Arquitectura técnica

```
  ┌────────────────┐        ┌────────────────┐
  │  WhatsApp API  │        │  Email proveedor│
  └────────┬───────┘        └────────┬────────┘
           │ webhook                 │ webhook
           └──────────┬──────────────┘
                      ▼
         ┌────────────────────────┐
         │  Backend (Express)     │
         │  - Webhooks            │
         │  - Parser              │
         │  - Servicio de órdenes │
         │  - API REST            │
         │  - Static /uploads     │
         └────────┬───────────────┘
                  │
       ┌──────────┼──────────────┐
       ▼          ▼              ▼
   SQLite    Filesystem     Frontend
   (pedidos) (dibujos)      (panel taller)
```

**Por qué este stack**

- **SQLite** para un MVP que corre en una máquina del taller o VPS pequeño:
  cero administración, transaccional, rápido y más que suficiente para miles
  de pedidos al mes. Cambiar a Postgres es cuestión de reescribir `db.js`.
- **Express** es boring tech — bien documentado, cualquier dev lo mantiene.
- **HTML/JS vanilla** en el panel evita la complicación de builds, CI, Node en
  la tablet, versiones de React, etc. El taller no debería depender de un
  pipeline de frontend para funcionar.
- **better-sqlite3** es síncrono y rápido; simplifica mucho el código
  comparado con drivers asíncronos.

---

## 3. Modelo de datos

Tablas principales (ver `backend/src/models/db.js`):

| Tabla             | Propósito |
|-------------------|-----------|
| `orders`          | Pedido interno. Guarda `external_number`, `channel`, `sender`, **`raw_text` (siempre)**, `measurements`, `bend_radius`, `requires_shear`, `requires_press_brake`, `priority`, `status`, `due_at`, timestamps de cada fase, `is_demo`. |
| `attachments`     | Imágenes/dibujos ligados al pedido. Nunca se pierden — están en disco + registro en DB. |
| `inbound_messages`| Copia del mensaje original (WhatsApp/email). Sirve para auditar y reparsear si cambia el parser. |
| `order_events`    | Log de trazabilidad: creación, cambios de estado, subida de adjunto, marca de incidencia, etc. Actor + timestamp + metadata JSON. |
| `clients`         | Catálogo de clientes (para el MVP casi no se usa, pero queda preparado). |
| `users`           | Operarios / admins. El MVP usa actor como string; en fase 2 se convierte en auth real. |
| `machines`        | Cizalla y plegadora. Preparado para cuando haya más de una. |

Todo pedido guarda el **texto original completo** (`raw_text`) por si el parser
se equivoca — se puede reprocesar.

---

## 4. Estados del pedido

```
received
   │
   ▼
pending_validation ◄── (si falta info)
   │
   ▼
pending_shear → in_shear → sheared ─┐
                                     ▼
                               pending_press_brake → in_press_brake → done
                                                                        │
                                                                        ▼
                                                             ready_for_pickup → delivered

               ─────► incident  (desde cualquier estado operativo)
```

Un pedido puede:
- **Solo plegadora**: `received → pending_press_brake → in_press_brake → done → …`
- **Cizalla + plegadora**: `received → pending_shear → in_shear → sheared → pending_press_brake → in_press_brake → done → …`

Las transiciones permitidas están centralizadas en `services/orders.js::STATUS_TRANSITIONS`.

### Prioridades

| Urgencia detectada        | Prioridad         |
|---------------------------|-------------------|
| "hoy"                     | `critical`        |
| "mañana primera hora"     | `very_high`       |
| "mañana última hora" / "mañana" | `high`      |
| "pasado mañana" / fecha explícita | `medium`  |
| sin fecha clara           | `pending_validation` |

Cambiar reglas = editar `parser.js::priorityFromUrgency`. Sin redespliegue del frontend.

---

## 5. Estructura del proyecto

```
taller-pedidos-demo/
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── data/                      # SQLite DB (se crea al arrancar)
│   ├── storage/uploads/           # dibujos/imágenes
│   └── src/
│       ├── server.js              # entrypoint Express
│       ├── models/
│       │   └── db.js              # schema + conexión SQLite
│       ├── services/
│       │   ├── parser.js          # extracción de info desde mensajes
│       │   └── orders.js          # lógica de negocio (crear, transicionar, priorizar)
│       ├── routes/
│       │   ├── orders.js          # CRUD + cambio de estado + adjuntos
│       │   ├── webhooks.js        # WhatsApp + Email
│       │   └── demo.js            # modo simulación
│       ├── middleware/            # (reservado para auth en fase 2)
│       ├── utils/                 # (reservado)
│       └── seeds/
│           └── run-seed.js        # script standalone de datos demo
├── frontend/
│   └── index.html                 # panel de taller (autocontenido)
└── docs/
    ├── API.md
    └── ROADMAP.md
```

---

## 6. API

Documentación detallada en `docs/API.md`. Resumen:

| Método | Ruta                                | Qué hace |
|--------|-------------------------------------|----------|
| GET    | `/api/health`                       | Healthcheck |
| POST   | `/api/orders`                       | Crear pedido (multipart, acepta adjuntos) |
| GET    | `/api/orders?status=&priority=&machine=` | Listar con filtros |
| GET    | `/api/orders/:id`                   | Detalle con attachments y eventos |
| POST   | `/api/orders/:id/status`            | Cambiar estado |
| POST   | `/api/orders/:id/priority`          | Cambiar prioridad manual |
| PATCH  | `/api/orders/:id`                   | Editar campos (notes, medidas, due_at, etc.) |
| POST   | `/api/orders/:id/attachments`       | Subir adjunto adicional |
| POST   | `/api/orders/:id/events`            | Registrar evento manual (incidencia) |
| GET    | `/api/orders/alerts/stale-urgent`   | Pedidos urgentes no iniciados (<2h al vencimiento) |
| POST   | `/api/webhooks/whatsapp`            | Webhook WhatsApp |
| POST   | `/api/webhooks/email`               | Webhook email |
| POST   | `/api/demo/seed`                    | Generar pedidos ficticios |
| DELETE | `/api/demo/seed`                    | Borrar pedidos demo |

---

## 7. Diseño de pantallas

**Panel de taller** (`frontend/index.html`):

1. **Vista Activos** — todos los pedidos en curso, ordenados por prioridad y
   fecha. Cards grandes, borde izquierdo con color de prioridad, botón gigante
   con la siguiente acción contextual (INICIAR CORTE / INICIAR PLEGADO / TERMINAR / …).
2. **Vista Pendientes de validar** — pedidos a los que les falta información.
3. **Vista Terminados** — pedidos `done`, `ready_for_pickup`, `delivered`.
4. **Modal de detalle** — dibujo a gran tamaño, datos, texto original, timeline
   completo, botón de incidencia.
5. **Modal de creación manual** — para dar de alta un pedido sin pasar por
   WhatsApp/email (útil para pedidos que llegan por teléfono).

Diseño pensado para industrial: botones >14px, alto contraste, poco texto,
código de color inmediato.

---

## 8. Automatizaciones implementadas

- **Creación automática** de pedido al entrar mensaje por webhook.
- **Clasificación de prioridad** automática según urgencia detectada.
- **Marcado como incompleto** si faltan nº pedido, fecha de entrega o dibujo.
- **Trazabilidad total** en `order_events`: creación, incompleto_flag,
  status_changed, priority_changed, fields_updated, attachment_added.
- **Estado inicial inteligente**: si el pedido requiere cizalla → `pending_shear`;
  si no → `pending_press_brake` directo.
- **Alerta de urgentes no iniciados** vía `GET /alerts/stale-urgent`
  (cualquier sistema externo — cron, Telegram, etc. — puede consumirlo).
- **Auto-refresh** del panel cada 20s.

Pendiente de Fase 2: envío proactivo de notificaciones (webhook de salida).

---

## 9. Roadmap

Ver `docs/ROADMAP.md`. Resumen:

- **Fase 1 (esto)**: MVP funcional. Entrada manual + webhooks normalizados +
  panel + seed demo. **Ya usable desde el primer día.**
- **Fase 2**: Integración real con WhatsApp Cloud API y email IMAP/Mailgun.
  Notificaciones de salida (aviso "pedido listo" al montador). Autenticación
  básica de operarios.
- **Fase 3**: Mejoras del parser para casos ambiguos y extraccion de medidas
  desde el propio dibujo. Deteccion de pedidos duplicados.
- **Fase 4**: Métricas de taller (pedidos/día, tiempo medio por fase, alertas
  SLA), integración con ERP, escalado a más máquinas, app nativa.

---

## 10. Instrucciones para ejecutar el proyecto

### Requisitos
- Node.js 20+ (el servidor usa `node --watch` para dev)
- Ningún otro servicio externo

### Arranque

```bash
cd taller-pedidos-demo/backend
cp .env.example .env
npm install
npm run start
```

Abrir en el navegador: **http://localhost:4000/**

### Probar con datos demo

Opción A — desde el panel: botón **"Seed demo"** arriba a la derecha.

Opción B — desde terminal:
```bash
curl -X POST http://localhost:4000/api/demo/seed
```

Opción C — standalone sin arrancar el server:
```bash
npm run seed
```

### Crear un pedido manualmente desde terminal

```bash
curl -X POST http://localhost:4000/api/orders \
  -F channel=whatsapp \
  -F sender="Juan" \
  -F text="Pedido 45830, lo necesito hoy. 400x200 e=2mm" \
  -F attachments=@/ruta/a/dibujo.jpg
```

### Simular webhook WhatsApp

```bash
curl -X POST http://localhost:4000/api/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+34600000000",
    "text": "Pedido 45831 para manana primera hora. 300x150, 2 pliegues.",
    "media": []
  }'
```

### Borrar los pedidos demo

```bash
curl -X DELETE http://localhost:4000/api/demo/seed
```

---

## 11. Decisiones de diseño

- **SQLite sobre Postgres para MVP**: elimina una pieza móvil. Cuando el
  volumen o la necesidad de analítica lo justifique, migración mecánica.
- **Vanilla JS en el panel**: el taller no debe depender de Node/npm en la
  tablet. `index.html` es un único archivo desplegable en cualquier servidor
  estático o incluso en un pendrive.
- **Parser como servicio aislado**: cuando cambie la estrategia de parsing, se
  sustituye `parseInboundMessage` y nada más cambia.
- **Webhook normalizado en vez de acoplarse a WhatsApp Cloud API directamente**:
  permite cambiar de proveedor sin refactorizar. Solo hay que traducir el
  payload del proveedor al formato esperado (`{ from, text, media: [] }`).
- **`raw_text` siempre guardado**: si el parser falla, nunca se pierde
  información — se puede reprocesar.
- **`is_demo` flag**: permite tener datos de prueba y reales mezclados,
  borrando solo los demo. Evita tener dos bases de datos.
- **Transiciones centralizadas**: toda la lógica de qué estado va después de
  qué está en un solo mapa. Cambiar el flujo = editar un objeto.

---
