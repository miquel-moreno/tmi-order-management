// Tests del parser de pedidos. Ejecutar con: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/services/parser');

const now = new Date('2026-04-16T10:00:00.000Z'); // fecha de referencia fija

test('extractExternalNumber', () => {
  assert.deepStrictEqual(p.extractExternalNumber('Pedido 45821, urgente'), '45821', 'pedido NNNN');
  assert.deepStrictEqual(p.extractExternalNumber('Ped. 45822 urgente'),     '45822', 'ped. NNNN');
  assert.deepStrictEqual(p.extractExternalNumber('#45823 para hoy'),        '45823', '#NNNN');
  assert.deepStrictEqual(p.extractExternalNumber('num 12345-A'),            '12345-A', 'num NNNN-X');
  assert.deepStrictEqual(p.extractExternalNumber('nº 98765'),               '98765', 'nº NNNN');
  assert.deepStrictEqual(p.extractExternalNumber('foto adjunta'),           null,    'sin numero');
  // Regresion: un candidato sin tirada de 5-8 digitos NO es un numero valido.
  // "PEDIDO" sin numero detras no debe producir "IDO" (la regex comiendose "ped").
  assert.deepStrictEqual(p.extractExternalNumber('Pedido.'),                null,    'PEDIDO sin numero -> null (no "IDO")');
  assert.deepStrictEqual(p.extractExternalNumber('pedido nº'),              null,    'pedido nº sin numero -> null');
  assert.deepStrictEqual(p.extractExternalNumber('Asunto: consulta pedido'), null,   'asunto sin numero -> null');
  assert.deepStrictEqual(p.extractExternalNumber('Para manana. 400x200'),   null,    'medidas no son numero de pedido');
  assert.deepStrictEqual(p.extractExternalNumber('Pedido 900123456'),       '900123456', 'tirada de digitos larga sigue valida');

});

test('extractDueDateAndUrgency', () => {
  assert.deepStrictEqual(p.extractDueDateAndUrgency('lo necesito hoy', now).urgency,              'today',              'hoy');
  assert.deepStrictEqual(p.extractDueDateAndUrgency('para manana primera hora', now).urgency,     'tomorrow_morning',   'manana primera hora');
  assert.deepStrictEqual(p.extractDueDateAndUrgency('para manana ultima hora', now).urgency,      'tomorrow_evening',   'manana ultima hora');
  assert.deepStrictEqual(p.extractDueDateAndUrgency('lo quiero para manana', now).urgency,        'tomorrow',           'manana');
  assert.deepStrictEqual(p.extractDueDateAndUrgency('pasado manana', now).urgency,                'day_after_tomorrow', 'pasado manana');
  assert.deepStrictEqual(p.extractDueDateAndUrgency('texto sin fecha', now).urgency,              null,                 'sin fecha');
  assert.ok(p.extractDueDateAndUrgency('lo quiero 18/04', now).due_at,                                 'fecha explicita');

});

test('priorityFromUrgency', () => {
  assert.deepStrictEqual(p.priorityFromUrgency('today'),              'critical',            'today -> critical');
  assert.deepStrictEqual(p.priorityFromUrgency('tomorrow_morning'),   'very_high',           'tomorrow_morning -> very_high');
  assert.deepStrictEqual(p.priorityFromUrgency('tomorrow'),           'high',                'tomorrow -> high');
  assert.deepStrictEqual(p.priorityFromUrgency('day_after_tomorrow'), 'medium',              'pasado manana -> medium');
  assert.deepStrictEqual(p.priorityFromUrgency(null),                 'pending_validation',  'null -> pending_validation');

});

test('extractMeasurements', () => {
  assert.deepStrictEqual(p.extractMeasurements('200x100 mm e=2mm'),   '200x100 mm | e=2mm',  'dim + espesor');
  assert.deepStrictEqual(p.extractMeasurements('350 x 120 x 3'),      '350 x 120 x 3',       'dim 3D');
  assert.deepStrictEqual(p.extractMeasurements('sin medidas'),        null,                   'sin medidas');

});

test('extractBendRadius', () => {
  assert.ok(p.extractBendRadius('radio 3mm'),        'radio 3mm');
  assert.ok(p.extractBendRadius('2 pliegues'),       '2 pliegues');
  assert.deepStrictEqual(p.extractBendRadius('texto limpio'),         null,                   'sin radio');

});

test('detectRequiresShear', () => {
  assert.deepStrictEqual(p.detectRequiresShear('cortar y plegar'),   true,   'cortar');
  assert.deepStrictEqual(p.detectRequiresShear('cizalla + plegadora'), true, 'cizalla');
  assert.deepStrictEqual(p.detectRequiresShear('solo plegar'),       false,  'solo plegar');
  // Regresion: la NEGACION del corte debe resolver a NO requiere cizalla.
  // Es el fallo mas caro: mandar a cortar una pieza que dice "sin corte".
  assert.deepStrictEqual(p.detectRequiresShear('600x300 e=3mm sin corte'),        false, 'sin corte');
  assert.deepStrictEqual(p.detectRequiresShear('no cortar, solo plegar'),          false, 'no cortar');
  assert.deepStrictEqual(p.detectRequiresShear('sin cortar'),                      false, 'sin cortar');
  assert.deepStrictEqual(p.detectRequiresShear('ya cortado, solo plegar'),         false, 'ya cortado');
  assert.deepStrictEqual(p.detectRequiresShear('sin cizalla'),                     false, 'sin cizalla');
  assert.deepStrictEqual(p.detectRequiresShear('no requiere corte'),               false, 'no requiere corte');
  assert.deepStrictEqual(p.detectRequiresShear('sin necesidad de corte'),          false, 'sin necesidad de corte');
  assert.deepStrictEqual(p.detectRequiresShear('Pedido 90001. 400x200. Cortar y plegar. Sin prisa'), true, 'positivo entre otras frases');
  assert.deepStrictEqual(p.detectRequiresShear('600x300 sin corte pero cortar los angulos'), true, 'negacion parcial: hay corte positivo aparte');

});

test('parseInboundMessage (integración)', () => {
  const r = p.parseInboundMessage({
    text: 'Pedido 45821, lo necesito hoy. 200x100 e=2mm, 2 pliegues r=3mm. Cortar y plegar.',
    attachmentsCount: 1,
    now,
  });
  assert.deepStrictEqual(r.external_number, '45821', 'pedido extraído');
  assert.deepStrictEqual(r.priority, 'critical', 'prioridad crítica');
  assert.deepStrictEqual(r.requires_shear, true, 'requiere cizalla');
  assert.deepStrictEqual(r.is_complete, true, 'completo');
  assert.ok(r.measurements, 'medidas extraídas');
  assert.ok(r.due_at, 'fecha de entrega calculada');

  const incomp = p.parseInboundMessage({ text: 'foto adjunta, urgente', attachmentsCount: 1, now });
  assert.deepStrictEqual(incomp.is_complete, false, 'incompleto cuando falta nº y fecha');
  assert.ok(incomp.missing_fields.includes('numero_pedido'), 'marca numero_pedido faltante');
  assert.ok(incomp.missing_fields.includes('fecha_entrega'), 'marca fecha_entrega faltante');
});
