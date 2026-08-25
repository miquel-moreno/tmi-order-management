// Tests del parser sin dependencias externas. Ejecutar con:  node test-parser.js
const p = require('./backend/src/services/parser');

let passed = 0, failed = 0;
function eq(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { passed++; console.log(`  OK  ${label}`); }
  else    { failed++; console.log(`  FAIL ${label}\n       expected: ${JSON.stringify(b)}\n       got:      ${JSON.stringify(a)}`); }
}
function truthy(v, label) {
  if (v) { passed++; console.log(`  OK  ${label}`); }
  else   { failed++; console.log(`  FAIL ${label}`); }
}

console.log('\n=== extractExternalNumber ===');
eq(p.extractExternalNumber('Pedido 45821, urgente'), '45821', 'pedido NNNN');
eq(p.extractExternalNumber('Ped. 45822 urgente'),     '45822', 'ped. NNNN');
eq(p.extractExternalNumber('#45823 para hoy'),        '45823', '#NNNN');
eq(p.extractExternalNumber('num 12345-A'),            '12345-A', 'num NNNN-X');
eq(p.extractExternalNumber('nº 98765'),               '98765', 'nº NNNN');
eq(p.extractExternalNumber('foto adjunta'),           null,    'sin numero');

console.log('\n=== extractDueDateAndUrgency ===');
const now = new Date('2026-04-16T10:00:00.000Z'); // referencia fija
eq(p.extractDueDateAndUrgency('lo necesito hoy', now).urgency,              'today',              'hoy');
eq(p.extractDueDateAndUrgency('para manana primera hora', now).urgency,     'tomorrow_morning',   'manana primera hora');
eq(p.extractDueDateAndUrgency('para manana ultima hora', now).urgency,      'tomorrow_evening',   'manana ultima hora');
eq(p.extractDueDateAndUrgency('lo quiero para manana', now).urgency,        'tomorrow',           'manana');
eq(p.extractDueDateAndUrgency('pasado manana', now).urgency,                'day_after_tomorrow', 'pasado manana');
eq(p.extractDueDateAndUrgency('texto sin fecha', now).urgency,              null,                 'sin fecha');
truthy(p.extractDueDateAndUrgency('lo quiero 18/04', now).due_at,                                 'fecha explicita');

console.log('\n=== priorityFromUrgency ===');
eq(p.priorityFromUrgency('today'),              'critical',            'today -> critical');
eq(p.priorityFromUrgency('tomorrow_morning'),   'very_high',           'tomorrow_morning -> very_high');
eq(p.priorityFromUrgency('tomorrow'),           'high',                'tomorrow -> high');
eq(p.priorityFromUrgency('day_after_tomorrow'), 'medium',              'pasado manana -> medium');
eq(p.priorityFromUrgency(null),                 'pending_validation',  'null -> pending_validation');

console.log('\n=== extractMeasurements ===');
eq(p.extractMeasurements('200x100 mm e=2mm'),   '200x100 mm | e=2mm',  'dim + espesor');
eq(p.extractMeasurements('350 x 120 x 3'),      '350 x 120 x 3',       'dim 3D');
eq(p.extractMeasurements('sin medidas'),        null,                   'sin medidas');

console.log('\n=== extractBendRadius ===');
truthy(p.extractBendRadius('radio 3mm'),        'radio 3mm');
truthy(p.extractBendRadius('2 pliegues'),       '2 pliegues');
eq(p.extractBendRadius('texto limpio'),         null,                   'sin radio');

console.log('\n=== detectRequiresShear ===');
eq(p.detectRequiresShear('cortar y plegar'),   true,   'cortar');
eq(p.detectRequiresShear('cizalla + plegadora'), true, 'cizalla');
eq(p.detectRequiresShear('solo plegar'),       false,  'solo plegar');

console.log('\n=== parseInboundMessage (integracion) ===');
const r = p.parseInboundMessage({
  text: 'Pedido 45821, lo necesito hoy. 200x100 e=2mm, 2 pliegues r=3mm. Cortar y plegar.',
  attachmentsCount: 1,
  now
});
eq(r.external_number, '45821',       'pedido extraido');
eq(r.priority,        'critical',    'prioridad critica');
eq(r.requires_shear,  true,          'requiere cizalla');
eq(r.is_complete,     true,          'completo');
truthy(r.measurements,               'medidas extraidas');
truthy(r.due_at,                     'due_at set');

const incomp = p.parseInboundMessage({ text: 'foto adjunta, urgente', attachmentsCount: 1, now });
eq(incomp.is_complete, false, 'incompleto cuando falta nº y fecha');
truthy(incomp.missing_fields.includes('numero_pedido'), 'marca numero_pedido faltante');
truthy(incomp.missing_fields.includes('fecha_entrega'), 'marca fecha_entrega faltante');

console.log(`\n=== Resultado: ${passed} OK, ${failed} FAIL ===`);
process.exit(failed > 0 ? 1 : 0);
