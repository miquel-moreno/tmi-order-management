// backend/src/routes/demo.js
// Modo demostracion: generar y borrar los datos ficticios del panel.
// Toda la logica de generacion (determinista) vive en seeds/demo-generator.js.
const express = require('express');
const { simulateInbound } = require('../seeds/demo-generator');

const router = express.Router();

// Simular un mensaje entrante por un canal y crear el pedido resultante.
// Endpoint INTERNO del panel (no es el webhook publico): la demo lo dispara
// desde el propio boton, y solo AÑADE un pedido.
//
// El sembrado y el borrado masivo NO se exponen por HTTP en la demo publica:
// la base se siembra al desplegar con `npm run seed` (llama a generateDemo
// directamente). Asi no hay ningun endpoint de reinicio ni de borrado masivo
// alcanzable desde fuera.
router.post('/simulate', (req, res, next) => {
  try {
    const channel = (req.query.channel || (req.body && req.body.channel) || 'whatsapp');
    res.status(201).json(simulateInbound(channel));
  } catch (e) { next(e); }
});

module.exports = router;
