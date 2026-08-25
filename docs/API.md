# API Reference — Taller de Pedidos (demo)

Base URL: `http://localhost:4000`

Todas las respuestas son JSON. Los errores devuelven `{ "error": "..." }` con
status HTTP correspondiente (400, 404, 500).

## Health
```
GET /api/health
→ { "ok": true, "ts": "2026-04-16T14:30:00.000Z" }
```

## Orders

### Crear
```
POST /api/orders   (multipart/form-data)

Campos:
  channel        "whatsapp" | "email" | "manual" (default manual)
  sender         string (opcional)
  text           string con el texto completo del mensaje
  client_id      string (opcional)
  is_demo        "true" | "false"
  attachments    archivos (hasta 10, máx 20MB cada uno)

→ 201 { order completo }
```

### Listar
```
GET /api/orders?status=&priority=&machine=&limit=

machine: "shear" (pedidos que requieren cizalla) o "press_brake"
→ 200 [ orders ]  (orden: prioridad asc, due_at asc, received_at asc)
```

### Detalle
```
GET /api/orders/:id
→ 200 { order, attachments: [], events: [] }
→ 404 si no existe
```

### Cambiar estado
```
POST /api/orders/:id/status
Body: { "status": "in_shear", "actor": "operario-juan" }
→ 200 { order actualizado }
→ 400 si la transición no es válida
```

Transiciones permitidas:

```
received            → pending_validation | pending_shear | pending_press_brake | incident
pending_validation  → pending_shear | pending_press_brake | incident
pending_shear       → in_shear | incident
in_shear            → sheared | incident
sheared             → pending_press_brake | incident
pending_press_brake → in_press_brake | incident
in_press_brake      → done | incident
done                → ready_for_pickup | delivered
ready_for_pickup    → delivered
delivered           → (final)
incident            → pending_validation | pending_shear | pending_press_brake
```

### Cambiar prioridad
```
POST /api/orders/:id/priority
Body: { "priority": "critical", "actor": "admin" }
Valores: critical | very_high | high | medium | low | pending_validation
```

### Editar campos
```
PATCH /api/orders/:id
Body: { external_number?, notes?, measurements?, bend_radius?, due_at?,
        requires_shear?, requires_press_brake?, actor? }
```

### Subir adjunto
```
POST /api/orders/:id/attachments   (multipart)
Campo: file (requerido), kind ("drawing"|"photo"|"document"|"other")
```

### Evento manual
```
POST /api/orders/:id/events
Body: { "type": "note_added", "actor": "operario-juan", "meta": {...} }
```

### Alertas urgentes
```
GET /api/orders/alerts/stale-urgent
→ 200 [ orders ]  (urgentes no iniciados con <2h al vencimiento)
```

## Webhooks

### WhatsApp (payload normalizado)
```
POST /api/webhooks/whatsapp
Content-Type: application/json
Body:
{
  "from": "+34600000000",
  "text": "Pedido 45830, lo necesito hoy",
  "media": [
    { "url": "https://...", "filename": "dibujo.jpg", "mime_type": "image/jpeg" }
  ]
}
→ 201 { "order_id": "...", "status": "pending_shear" }
```

### Email (payload normalizado)
```
POST /api/webhooks/email
Body:
{
  "from": "pedidos@example.com",
  "subject": "Pedido 45831",
  "text": "Para mañana primera hora. 300x150 e=2mm",
  "attachments": [ { "url": "...", "filename": "plano.pdf" } ]
}
```

## Demo

```
POST   /api/demo/seed     → crea 6 pedidos ficticios con dibujos SVG
DELETE /api/demo/seed     → borra todos los pedidos con is_demo=1
```

## Archivos estáticos

```
GET /uploads/:filename    → sirve los adjuntos
```
