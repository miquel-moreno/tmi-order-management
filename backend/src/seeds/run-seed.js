// backend/src/seeds/run-seed.js
// Ejecuta el generador de datos de demostracion sin arrancar el servidor.
//   npm run seed
require('dotenv').config();
const { generateDemo } = require('./demo-generator');

const result = generateDemo();
console.log(`Seed OK: ${result.created_count} pedidos, ${result.clients} clientes, ${result.users} usuarios.`);
