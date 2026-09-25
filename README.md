# TMI Order Management · Panel de pedidos del taller

Panel en producción en TMI System para gestionar los pedidos de un taller de plegado de chapa. Reúne en un solo sitio los pedidos que entran desde la oficina, por correo y desde el móvil de los montadores del cliente.

> Demo disponible bajo petición.

![Panel de taller](./docs/images/prod-panel-taller.png)

## Qué hace

- **Entrada de pedidos** desde tres canales: oficina, correo y montadores.
- **Ficha de pedido en PDF** generada automáticamente con los datos del correo y los planos ([flujo de n8n](https://github.com/miquel-moreno/tmi-n8n-automations)).
- **Etiqueta** para identificar cada pieza en el taller.
- **Estados** del pedido, de *Pendiente* a *Entregado*, con el panel actualizado en tiempo real.
- **Roles** separados para montadores, administración y almacén.

![Detalle de un pedido](./docs/images/prod-detalle-pedido.png)

<table><tr>
<td width="68%"><img src="./docs/images/prod-ficha-pedido.png" alt="Ficha de pedido generada desde el correo"></td>
<td width="32%"><img src="./docs/images/prod-etiqueta.png" alt="Etiqueta de pedido"></td>
</tr></table>

<sub>Los correos y los planos del cliente aparecen difuminados.</sub>

## Cómo está hecho

| | |
|---|---|
| **Aplicación en producción** | HTML · CSS · JavaScript sin build · PostgreSQL gestionado con almacenamiento y tiempo real |
| **Motor de este repositorio** | Node.js · Express · SQLite |
| **Documentos** | Ficha y etiqueta en PDF generadas con n8n y Gotenberg |

## El código de este repositorio

Contiene el **motor de entrada de pedidos**: lee un mensaje en texto libre, extrae los datos y lo coloca en su cola con una prioridad.

> «Pedido 90234, lo necesito hoy. 400x200 e=2mm, 2 pliegues r=3mm. RAL 9016.»
> → nº de pedido, fecha de entrega, prioridad crítica, medidas, pliegues, color y si requiere corte.

```
backend/
  src/services/parser.js    extracción de datos del texto (regex y reglas en español)
  src/services/orders.js    alta de pedidos, estados y trazabilidad
  src/routes/               API REST (pedidos, webhooks de entrada)
  src/models/db.js          esquema SQLite
  test/                     tests del parser
frontend/index.html         panel sin frameworks
docs/API.md                 referencia de la API
```

```bash
cd backend
npm install
npm run seed   # datos ficticios
npm start      # http://localhost:4000
npm test
```

## Mi papel

Desarrollado en TMI junto a mi socio: diseño del flujo de pedidos, panel, generación de documentos y puesta en producción. Desarrollo asistido por IA bajo mi especificación y revisión.

---

[Perfil](https://github.com/miquel-moreno) · [LinkedIn](https://www.linkedin.com/in/miquel-moreno-martinez)
