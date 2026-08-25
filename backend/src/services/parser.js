// backend/src/services/parser.js
// Extrae estructura de un mensaje de WhatsApp/email.
// Usamos regex + heuristicas en espanol. La funcion esta aislada tras un
// contrato estable para poder sustituir la implementacion internamente sin
// tocar el resto del sistema.

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Numero de pedido ---
// Acepta: "pedido 12345", "ped. 12345", "#12345", "nº 12345", "num 12345".
// Un numero de pedido valido DEBE contener una tirada de 5-8 digitos (admite
// sufijo tipo "12345-A"). Si el candidato extraido no la tiene, se descarta y se
// trata como "sin numero" -> evita artefactos como "IDO" (la regex comiendose el
// final de "PEDIDO" via la alternativa "ped").
function isValidExternalNumber(candidate) {
  return typeof candidate === 'string' && /\d{5,8}/.test(candidate);
}

function extractExternalNumber(text) {
  if (!text) return null;
  const keyword = text.match(/(?:pedido|ped\.?|orden|nº|n°|num(?:ero)?|#)\s*[:\-]?\s*([a-z0-9][a-z0-9\-\/]{2,})/i);
  if (keyword && isValidExternalNumber(keyword[1])) return keyword[1].toUpperCase();
  const loose = text.match(/\b([0-9]{5,8})\b/); // fallback: un numero largo suelto
  if (loose) return loose[1];
  return null;
}

// --- Fecha de entrega y urgencia ---
// Devuelve { due_at: ISO, urgency: 'today'|'tomorrow_morning'|... } o nulls.
function extractDueDateAndUrgency(text, now = new Date()) {
  const t = normalize(text);
  const result = { due_at: null, urgency: null };

  const atEndOfDay   = (d) => { const x = new Date(d); x.setHours(18, 0, 0, 0); return x; };
  const atMorning    = (d) => { const x = new Date(d); x.setHours(8,  0, 0, 0); return x; };
  const tomorrow     = () => { const x = new Date(now); x.setDate(x.getDate() + 1); return x; };
  const dayAfter     = () => { const x = new Date(now); x.setDate(x.getDate() + 2); return x; };

  // Reglas por palabras clave (orden importa: la mas especifica primero).
  // "pasado manana" va ANTES de "manana" para no comerselo.
  if (/\b(para hoy|lo necesito hoy|urgente hoy|hoy mismo)\b/.test(t)) {
    result.urgency = 'today';
    result.due_at = atEndOfDay(now).toISOString();
  } else if (/\bpasado\s*manana\b/.test(t)) {
    result.urgency = 'day_after_tomorrow';
    result.due_at = atEndOfDay(dayAfter()).toISOString();
  } else if (/\bmanana\s+(a\s+)?(primera hora|primera)\b/.test(t)) {
    result.urgency = 'tomorrow_morning';
    result.due_at = atMorning(tomorrow()).toISOString();
  } else if (/\bmanana\s+(a\s+)?(ultima hora|tarde|ultima)\b/.test(t)) {
    result.urgency = 'tomorrow_evening';
    result.due_at = atEndOfDay(tomorrow()).toISOString();
  } else if (/\bpara\s+manana\b|\bmanana\b/.test(t)) {
    result.urgency = 'tomorrow';
    result.due_at = atEndOfDay(tomorrow()).toISOString();
  }

  // Fecha explicita tipo 18/04 o 18-04-2026
  const dateMatch = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dateMatch && !result.due_at) {
    const day = parseInt(dateMatch[1], 10);
    const mon = parseInt(dateMatch[2], 10) - 1;
    let year  = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, mon, day, 18, 0, 0, 0);
    if (!isNaN(d.getTime())) {
      result.due_at = d.toISOString();
      result.urgency = result.urgency || 'scheduled';
    }
  }

  return result;
}

// --- Prioridad derivada de urgencia ---
function priorityFromUrgency(urgency) {
  switch (urgency) {
    case 'today':              return 'critical';
    case 'tomorrow_morning':   return 'very_high';
    case 'tomorrow_evening':
    case 'tomorrow':           return 'high';
    case 'day_after_tomorrow': return 'medium';
    case 'scheduled':          return 'medium';
    default:                   return 'pending_validation';
  }
}

// --- Medidas ---
// Captura patrones tipo "200x100", "200 x 100 x 3", "e=2mm", "espesor 2"
function extractMeasurements(text) {
  if (!text) return null;
  const found = [];
  const dims = text.match(/\b\d{2,4}\s*[xX]\s*\d{1,4}(?:\s*[xX]\s*\d{1,3})?\s*(?:mm|cm)?/g);
  if (dims) found.push(...dims);
  const thick = text.match(/(?:e\s*=|espesor\s*:?|grosor\s*:?)\s*\d+(?:[\.,]\d+)?\s*mm?/gi);
  if (thick) found.push(...thick);
  return found.length ? found.join(' | ') : null;
}

// --- Radio / tipo de plegado ---
function extractBendRadius(text) {
  if (!text) return null;
  const m = text.match(/\b(?:r\s*=|radio\s*:?|r\s*:?)\s*\d+(?:[\.,]\d+)?\s*mm?/i);
  if (m) return m[0];
  const bend = text.match(/(\d+)\s*(?:pliegues|plegados|dobleces)/i);
  if (bend) return bend[0];
  return null;
}

// --- Categoria ---
// Detecta el tipo de pieza a partir de palabras clave habituales en taller.
function extractCategory(text) {
  if (!text) return null;
  const cats = [
    { re: /\b(ventana|ventanas)\b/i,     label: 'Ventana' },
    { re: /\b(puerta|puertas)\b/i,       label: 'Puerta' },
    { re: /\b(fachada|fachadas)\b/i,     label: 'Fachada' },
    { re: /\b(perfil|perfiles)\b/i,      label: 'Perfil' },
    { re: /\b(bandeja|bandejas)\b/i,     label: 'Bandeja' },
    { re: /\b(cubierta|cubiertas)\b/i,   label: 'Cubierta' },
    { re: /\b(marco|marcos)\b/i,         label: 'Marco' },
    { re: /\b(reja|rejas)\b/i,           label: 'Reja' },
    { re: /\b(canaleta|canaletas)\b/i,   label: 'Canaleta' },
    { re: /\b(vierteaguas)\b/i,          label: 'Vierteaguas' },
    { re: /\b(dintel|dinteles)\b/i,      label: 'Dintel' },
  ];
  for (const c of cats) {
    if (c.re.test(text)) return c.label;
  }
  return null;
}

// --- Tipo RAL ---
// Captura codigos RAL tipo "RAL 9016", "RAL-7016", "ral9005"
function extractRalType(text) {
  if (!text) return null;
  const m = text.match(/\bRAL[\s\-]?(\d{4})\b/i);
  return m ? 'RAL ' + m[1] : null;
}

// --- Requiere cizalla? ---
// Detecta si el pedido requiere corte en cizalla. IMPORTANTE: respeta la
// negacion. "sin corte", "no cortar", "ya cortado", "sin cizalla"... significan
// que NO hay que cortar. Es el fallo mas caro posible: mandar a la cizalla una
// pieza que no se corta. Estrategia: eliminar del texto las menciones NEGADAS de
// corte y solo entonces buscar una mencion positiva.
function detectRequiresShear(text) {
  if (!text) return false;
  const t = normalize(text); // minusculas, sin tildes, espacios colapsados
  const stripped = t.replace(
    /\b(sin|no|ni|ya)\b(?:\s+\w+){0,3}?\s+(cortar|corte|cortes|cortado|cortada|cizalla|despiece)\b/g,
    ' '
  );
  return /\b(cortar|corte|cortado|cizalla|despiece)\b/.test(stripped);
}

// --- Completitud ---
// Un pedido se considera incompleto si no tenemos ni numero ni due_at.
function assessCompleteness({ external_number, due_at, has_attachments }) {
  const missing = [];
  if (!external_number)  missing.push('numero_pedido');
  if (!due_at)           missing.push('fecha_entrega');
  if (!has_attachments)  missing.push('dibujo_adjunto');
  return {
    is_complete: missing.length === 0,
    missing_fields: missing
  };
}

function parseInboundMessage({ text, attachmentsCount = 0, now = new Date() }) {
  const external_number = extractExternalNumber(text);
  const { due_at, urgency } = extractDueDateAndUrgency(text, now);
  const priority = priorityFromUrgency(urgency);
  const measurements = extractMeasurements(text);
  const bend_radius = extractBendRadius(text);
  const requires_shear = detectRequiresShear(text);
  const category = extractCategory(text);
  const ral_type = extractRalType(text);
  const completeness = assessCompleteness({
    external_number,
    due_at,
    has_attachments: attachmentsCount > 0
  });
  return {
    external_number,
    due_at,
    urgency,
    priority,
    measurements,
    bend_radius,
    requires_shear,
    requires_press_brake: true, // por defecto asumimos plegado
    category,
    ral_type,
    ...completeness
  };
}

module.exports = {
  parseInboundMessage,
  extractExternalNumber,
  extractDueDateAndUrgency,
  priorityFromUrgency,
  extractMeasurements,
  extractBendRadius,
  detectRequiresShear,
  extractCategory,
  extractRalType,
  assessCompleteness
};
