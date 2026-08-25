# Roadmap — Taller de Pedidos (demo)

## Fase 1 — MVP funcional interno  ✅ (este entregable)

**Objetivo**: poder reemplazar el grupo de WhatsApp desorganizado con un panel
estructurado en el taller. Todo lo crítico cubierto sin dependencias externas.

- Backend Express + SQLite
- Creación de pedidos: manual desde panel, webhook WhatsApp normalizado, webhook email normalizado
- Parser en español (regex/heurística) para nº pedido, urgencia, fecha, medidas, radio, cizalla
- Priorización automática
- Panel de taller con vistas Activos / Pendientes validar / Terminados
- Modal detalle con dibujo grande, datos, texto original, timeline
- Modo demo con `POST /api/demo/seed`
- Trazabilidad completa (`order_events`)
- Todos los adjuntos persistidos en disco + DB

**Tiempo estimado de implementación**: 2–3 días para afinar + puesta en marcha.

---

## Fase 2 — Integración real y notificaciones

**Objetivo**: eliminar el paso manual de reenviar mensajes al sistema.

- **WhatsApp Cloud API** (Meta): registrar número, configurar webhook entrante,
  traducir payload al formato normalizado en `routes/webhooks.js`. No se toca
  la lógica del parser.
- **Email**: bien con IMAP + cron, bien con servicio (Mailgun, SendGrid Inbound
  Parse, SES + Lambda). Mismo patrón: traducir a payload normalizado.
- **Notificaciones de salida**:
  - Mensaje WhatsApp automático al montador cuando el pedido está `done`.
  - Alerta interna cuando un pedido urgente no se ha iniciado a tiempo
    (cron cada 10 min consumiendo `/alerts/stale-urgent`).
- **Autenticación básica** de operarios (PIN de 4 dígitos). El `actor` en los
  eventos deja de ser un string y pasa a ser el usuario real.
- **Multi-tablet**: el panel ya es apto, solo añadir polling inteligente o SSE.

---

## Fase 3 — Parsing más robusto

**Objetivo**: que los pedidos incompletos se autocompleten mejor.

- **Mejorar las heurísticas del parser** para casos ambiguos que hoy caen en
  `pending_validation`. El parser está aislado tras un contrato estable, así que
  su implementación se puede cambiar sin tocar rutas ni modelo de datos.
- **Extracción de medidas desde el propio dibujo** cuando el texto del mensaje
  no las lleva.
- **Detección automática de piezas duplicadas** (mismo número de pedido).
- **Sugerencias de prioridad** ajustadas por contexto histórico
  (ej: este montador suele pedir con margen de 4h).

---

## Fase 4 — Integración completa y métricas

**Objetivo**: el sistema deja de ser interno y se convierte en plataforma.

- **Conexión con ERP del cliente**: cuando se crea un pedido, sincronizar con
  su sistema vía API (número de pedido real, cliente final, etc.).
- **Métricas de taller**:
  - pedidos / día / semana
  - tiempo medio en corte
  - tiempo medio en plegado
  - % pedidos con retraso
  - carga por operario
- **Portal cliente**: el cliente ve el estado de sus pedidos en tiempo real.
- **App móvil nativa** (React Native o PWA instalable) para el montador —
  crear pedido desde el móvil directamente, no desde WhatsApp.
- **Soporte multi-máquina**: 2 plegadoras, 2 cizallas, asignación automática
  por carga.
- **Logística**: tracking de recogidas/entregas, firma digital.

---

## Principios transversales

- **No romper lo que funciona**: cada fase mantiene compatibilidad con la
  anterior. El panel sigue funcionando si una API externa está caída.
- **Datos primero**: la DB y la trazabilidad son el núcleo. Todo lo demás
  (UI, integraciones) se construye encima.
- **Boring tech**: elegir lo más aburrido que resuelva el problema. Cada pieza
  nueva añade mantenimiento.
