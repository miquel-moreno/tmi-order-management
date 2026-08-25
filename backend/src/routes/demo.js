// backend/src/routes/demo.js
// Modo demostracion: generar y borrar los datos ficticios del panel.
// Toda la logica de generacion (determinista) vive en seeds/demo-generator.js.
const express = require('express');
const { generateDemo, clearDemo } = require('../seeds/demo-generator');

const router = express.Router();

// Generar el conjunto de demostracion (borra el anterior y lo regenera).
router.post('/seed', (req, res, next) => {
  try {
    const result = generateDemo();
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// Borrar solo los datos marcados como demo.
router.delete('/seed', (req, res, next) => {
  try {
    const result = clearDemo();
    res.json(result);
  } catch (e) { next(e); }
});

module.exports = router;
