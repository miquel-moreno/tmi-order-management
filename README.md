# TMI Order Management · Panel de pedidos del taller

Panel en producción en TMI System para gestionar los pedidos de un taller de plegado de chapa. Reúne en un solo sitio los pedidos que entran desde la oficina, por correo y desde el móvil de los montadores del cliente.

> Demo disponible bajo petición.

![Panel de taller](./docs/images/prod-panel-taller.png)

## Qué hace

- **Entrada de pedidos** desde tres canales: oficina, correo y montadores.
- **Ficha de pedido en PDF** generada automáticamente con los datos del correo y los planos.
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
| **Aplicación** | HTML · CSS · JavaScript, sin build |
| **Datos** | PostgreSQL gestionado · almacenamiento de archivos · tiempo real |
| **Documentos** | Ficha y etiqueta en PDF |

Este repositorio contiene además una versión de demostración con datos ficticios (Node.js, Express y SQLite), que lee pedidos en texto libre y los clasifica por prioridad. Detalles en [docs/API.md](docs/API.md).

## Mi papel

Desarrollado en TMI junto a mi socio: diseño del flujo de pedidos, panel, generación de documentos y puesta en producción.

---

[Perfil](https://github.com/miquel-moreno) · [LinkedIn](https://www.linkedin.com/in/miquel-moreno-martinez)
