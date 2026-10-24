/*
 * bot.js — El "cerebro" de Verde
 * --------------------------------------------------------------
 * Toma la configuración que editás en el dashboard (data/state.json),
 * arma el prompt, le pregunta a la IA (Anthropic) y devuelve la respuesta.
 * Guarda el historial de cada conversación en disco (data/conversations.json)
 * para que NO se pierda al reiniciar, y las pausas de cada cliente
 * (data/pausas.json) cuando una persona del equipo toma la conversación.
 *
 * No hace falta tocar este archivo.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');
const PAUSAS_FILE = path.join(DATA_DIR, 'pausas.json');

/* ---------- modelo de IA ---------- */
const MODELO_PREDETERMINADO = 'claude-sonnet-5-5';
// Modelos retirados o por retirarse → reemplazo recomendado por Anthropic.
// Así Verde no deja de responder si el panel todavía tiene un modelo viejo.
const MODELOS_REEMPLAZO = {
  'claude-sonnet-4-5': 'claude-sonnet-5-5',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-5-5',
  'claude-sonnet-4-0': 'claude-sonnet-5-5',
  'claude-sonnet-4-20250514': 'claude-sonnet-5-5'
};
const ESFUERZOS_VALIDOS = ['low', 'medium', 'high'];
// IA que se pueden elegir en el panel, con los ajustes que indica la documentación oficial
// para responder rápido en un chat:
//  - Sonnet 5.5: sin razonamiento previo (between_tools) y esfuerzo medio.
//  - Opus 5.5 y Fable 5.1: su razonamiento no se puede apagar; se usa el esfuerzo más bajo
//    y un margen de tokens para que el razonamiento no corte la respuesta.
const MODELOS = [
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', thinking: { type: 'between_tools' }, esfuerzo: 'medium', tokensMinimos: 0 },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', thinking: null, esfuerzo: 'low', tokensMinimos: 4000 },
  { id: 'claude-fable-5-1', nombre: 'Claude Fable 5.1', thinking: null, esfuerzo: 'low', tokensMinimos: 4000 }
];
function listarModelos() { return MODELOS.map(m => ({ id: m.id, nombre: m.nombre })); }
function modeloPermitido(id) { return MODELOS.some(m => m.id === id); }

/* ---------- leer configuración guardada por el dashboard ---------- */
function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('No se pudo leer state.json:', e.message);
    return {};
  }
}
function getVerde() {
  const s = readState();
  return (s && s.verde) ? s.verde : {};
}

/* ---------- armar el system prompt desde la configuración ---------- */
function buildSystemPrompt(v) {
  v = v || {};
  const trato = { vos: 'Tratá al cliente de "vos" (rioplatense)', 'tú': 'Tratá al cliente de "tú"', usted: 'Tratá al cliente de "usted" (formal)' }[v.trato || 'vos'];
  const emojis = { nada: 'No uses emojis.', moderado: 'Usá emojis con moderación.', abundante: 'Usá emojis de forma abundante.' }[v.emojis || 'moderado'];
  const lineas = v.lineas || 3;
  const rasgos = (v.rasgos || []).join(', ') || '—';
  const ventajas = (v.ventajas || []).filter(x => (x.texto || '').trim())
    .map(x => `• ${x.emoji ? x.emoji + ' ' : ''}${x.texto}`).join('\n') || '—';
  const pasos = (v.pasos || []).filter(s => s.activo !== false && (s.titulo || '').trim())
    .map((s, i) => `${i + 1}. ${s.titulo}${s.desc ? ': ' + s.desc : ''}${s.ejemplo ? `\n   Ej: "${s.ejemplo}"` : ''}`).join('\n') || '—';
  const objeciones = (v.objeciones || []).filter(o => (o.obj || '').trim())
    .map(o => `- Si dice "${o.obj}" → ${o.resp}`).join('\n') || '—';
  const reglas = (v.reglas || []).filter(r => (r || '').trim())
    .map((r, i) => `${i + 1}. ${r}`).join('\n') || '—';
  const fr = v.frases || {};

  return `Sos ${v.nombre || 'el asesor'}, ${v.rol || 'asesor de ventas'} de ${v.empresa || 'la empresa'}. Rubro: ${v.rubro || ''}.
Hablás en ${v.idioma || 'Español rioplatense'}.

== PERSONALIDAD ==
Rasgos: ${rasgos}.
${trato}. Mensajes cortos, máximo ${lineas} líneas por mensaje. ${emojis}

== VENTAJAS / DIFERENCIALES ==
${ventajas}

== PROCESO DE VENTA ==
${pasos}

== MANEJO DE OBJECIONES ==
${objeciones}

== REGLAS DE ORO ==
${reglas}

== FRASES CLAVE ==
Bienvenida: "${fr.bienvenida || ''}"
Al derivar a un humano: "${fr.derivacion || ''}"
Si hay un error técnico: "${fr.error || ''}"`;
}

/* ---------- lectura y escritura segura de archivos JSON ---------- */
function leerJson(archivo) {
  try {
    if (!fs.existsSync(archivo)) return {};
    const raw = fs.readFileSync(archivo, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('No se pudo leer ' + path.basename(archivo) + ':', e.message);
    return {};
  }
}
function guardarJson(archivo, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = archivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, archivo);
  } catch (e) {
    console.error('No se pudo guardar ' + path.basename(archivo) + ':', e.message);
  }
}

/* ---------- historial de conversaciones (persistente) ---------- */
function loadConversations() { return leerJson(CONV_FILE); }
function saveConversations(obj) { guardarJson(CONV_FILE, obj); }
function resetConversation(from) {
  const convs = loadConversations();
  if (convs[from]) { delete convs[from]; saveConversations(convs); }
  return true;
}
function memoriaDe(v) {
  const n = parseInt(v && v.tecnico && v.tecnico.memoria, 10);
  return n >= 2 ? n : 20;
}
// Une mensajes seguidos del mismo rol (por ejemplo, dos mensajes del cliente sin respuesta).
function unirSeguidos(hist) {
  const out = [];
  for (const m of (Array.isArray(hist) ? hist : [])) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const ult = out[out.length - 1];
    if (ult && ult.role === m.role) ult.content += '\n\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}
// Lo que se le envía a la IA: los últimos mensajes, empezando siempre por un mensaje del cliente.
function paraLaIA(hist, n) {
  const t = unirSeguidos(hist).slice(-Math.max(2, n || 20));
  while (t.length && t[0].role !== 'user') t.shift();
  return t;
}
// Agrega un mensaje al historial de un cliente sin consultar a la IA.
function registrarMensaje(clave, rol, texto) {
  const v = getVerde();
  const convs = loadConversations();
  const hist = Array.isArray(convs[clave]) ? convs[clave] : [];
  hist.push({ role: rol, content: String(texto == null ? '' : texto) });
  convs[clave] = unirSeguidos(hist).slice(-memoriaDe(v));
  saveConversations(convs);
}

/* ---------- pausas: cuando una persona del equipo toma la conversación ---------- */
function pausar(clave, horas) {
  const h = Number(horas) > 0 ? Number(horas) : 12;
  const ahora = Date.now();
  const p = leerJson(PAUSAS_FILE);
  for (const k of Object.keys(p)) if (!(p[k] > ahora)) delete p[k]; // limpia pausas vencidas
  p[clave] = ahora + h * 3600 * 1000;
  guardarJson(PAUSAS_FILE, p);
  return p[clave];
}
function estaPausado(clave) {
  const p = leerJson(PAUSAS_FILE);
  return !!(p[clave] && p[clave] > Date.now());
}
// «Reanudar ahora» desde el panel: termina la pausa automática de ese chat.
function quitarPausa(clave) {
  const p = leerJson(PAUSAS_FILE);
  if (!Object.prototype.hasOwnProperty.call(p, clave)) return false;
  delete p[clave];
  guardarJson(PAUSAS_FILE, p);
  return true;
}
// Pausas vigentes { clave: hasta } (para la pantalla «Conversaciones»).
function pausasVigentes() {
  const ahora = Date.now();
  const p = leerJson(PAUSAS_FILE);
  const r = {};
  for (const k of Object.keys(p)) if (p[k] > ahora) r[k] = p[k];
  return r;
}
// Antes de enviar se vuelve a revisar: mientras la IA preparaba la respuesta, una persona del
// equipo pudo tomar la conversación o alguien pudo apagar a Verde en este chat.
function noDebeResponder(from, opciones) {
  if (estaPausado(from)) return true;
  return !!(opciones && typeof opciones.puedeResponder === 'function' && !opciones.puedeResponder());
}

/* ---------- una conversación a la vez por cliente ---------- */
// Si un cliente manda varios mensajes seguidos, se responden en orden y sin pisar el historial.
const colas = new Map();
function enCola(clave, tarea) {
  const previa = colas.get(clave) || Promise.resolve();
  const actual = previa.then(tarea, tarea);
  const fin = actual.catch(() => {});
  colas.set(clave, fin);
  fin.then(() => { if (colas.get(clave) === fin) colas.delete(clave); });
  return actual;
}

/* ---------- llamada a la IA (Anthropic) ---------- */
const modelosAvisados = new Set();
function resolverModelo(v) {
  const elegido = String((v && v.tecnico && v.tecnico.modelo) || '').trim() || MODELO_PREDETERMINADO;
  const reemplazo = MODELOS_REEMPLAZO[elegido];
  if (reemplazo) {
    if (!modelosAvisados.has(elegido)) {
      modelosAvisados.add(elegido);
      console.warn('Aviso: el modelo "' + elegido + '" está retirado o por retirarse; se usa "' + reemplazo + '". Actualizalo en el panel (Parámetros técnicos).');
    }
    return reemplazo;
  }
  return elegido;
}
// Arma el pedido a la IA. En Claude Sonnet 5.5 se desactiva el razonamiento previo
// (thinking "between_tools") y se fija el esfuerzo, como indica la documentación oficial
// para conversaciones que deben responder rápido.
function armarPedido(model, system, messages, max_tokens) {
  const pedido = { model, max_tokens, system, messages };
  const conf = MODELOS.find(m => m.id === model);
  if (!conf) return pedido;   // otro modelo: pedido básico de siempre
  if (conf.thinking) pedido.thinking = conf.thinking;
  let esfuerzo = conf.esfuerzo;
  if (model === 'claude-sonnet-5-5') {
    const e = String(process.env.VERDE_ESFUERZO || '').trim().toLowerCase();
    if (ESFUERZOS_VALIDOS.includes(e)) esfuerzo = e;
  }
  pedido.output_config = { effort: esfuerzo };
  pedido.max_tokens = Math.max(max_tokens, conf.tokensMinimos);
  return pedido;
}
async function callClaude(system, messages, v, modeloPuntual) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Falta la clave ANTHROPIC_API_KEY (configurala en el archivo .env).');
  const model = modeloPuntual && modeloPermitido(modeloPuntual) ? modeloPuntual : resolverModelo(v);
  const max_tokens = (v.tecnico && v.tecnico.maxTokens) || 1000;
  const pedido = armarPedido(model, system, messages, max_tokens);

  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01'
      },
      body: JSON.stringify(pedido),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(limite);
  }

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error('La IA respondió con error ' + resp.status + ': ' + detail.slice(0, 300));
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('La IA no devolvió texto (motivo: ' + (data.stop_reason || 'desconocido') + ').');
  return text;
}

/* ---------- obtener la respuesta del bot para un mensaje ---------- */
/* ---------- buscador de productos en el Excel cargado ---------- */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function cleanNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  if (isNaN(n)) return String(v);
  if (n <= 0) return null; // precio en 0 = sin cargar; lo confirma un asesor
  return Math.round(n);
}
function getSource() {
  const s = readState();
  return (s.sources || []).find(x => x.preview && x.preview.length > 1) || null;
}
// Columnas confirmadas (base 0): Nombre=2, Stock=5, Precio venta=6, Precio con descuento=8
const COL = { NAME: 2, STOCK: 5, PV: 6, PD: 8 };
const STOP = new Set(['el','la','los','las','un','una','unos','unas','de','del','para','por','con','y','o','a','en','me','te','le','lo','al','su','mi','se','es','que','cuanto','cuanta','cuantos','cuantas','cuesta','cuestan','sale','salen','precio','precios','vale','valen','tiene','tienen','tenes','hay','quiero','dame','decime','busco','necesito','tienes','cual','sobre','este','esta','ese','esa','hola','buenas','dia','dias','tardes','noches',
  // preguntas generales que NO son de productos: no deben disparar el catálogo
  'direccion','direcciones','ubicados','ubicado','ubicacion','ubicado','queda','quedan','quedas','estan','estas','donde','local','locales','sucursal','sucursales','horario','horarios','hora','horas','abren','abre','cierran','cierra','abierto','abiertos','cerrado','atienden','atencion',
  'pago','pagos','pagar','tarjeta','tarjetas','efectivo','transferencia','debito','credito','cuotas','financiacion',
  'envio','envios','envian','envia','delivery','mandan','manda','reparto','llega','llegan',
  'telefono','telefonos','celular','contacto','contactar','llamar','whatsapp','correo','mail','email','web','pagina','instagram','facebook',
  'garantia','garantias','factura','iva','cambio','devolucion','reparan','reparacion','arreglan','arreglo','service','tecnico','demoran','demora','tarda','tardan']);
function findProducts(query, limit) {
  limit = limit || 8;
  const src = getSource();
  if (!src) return { hasSource: false, found: [], tokens: [] };
  const body = src.preview.slice(1);
  const tokens = norm(query).split(/\s+/).filter(w => w && !STOP.has(w));
  if (!tokens.length) return { hasSource: true, found: [], tokens: [] };
  // números: palabra exacta ("16" no matchea "2016" ni "1630"). Texto/modelos: prefijo ("a21" matchea "a21s")
  const rxs = tokens.map(t => {
    const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /^\d+$/.test(t) ? new RegExp('\\b' + e + '\\b') : new RegExp('\\b' + e);
  });
  const found = [];
  for (const r of body) {
    const name = norm(r[COL.NAME]);
    if (!name) continue;
    if (rxs.every(rx => rx.test(name))) {
      let precio = cleanNum(r[COL.PV]);
      let precioDesc = cleanNum(r[COL.PD]);
      if (precio === 0) precio = null;        // $0 = sin precio cargado
      if (precioDesc === 0) precioDesc = null;
      found.push({
        nombre: String(r[COL.NAME] == null ? '' : r[COL.NAME]).trim(),
        precio: precio,
        precioDesc: precioDesc,
        stock: (r[COL.STOCK] == null || r[COL.STOCK] === '') ? null : r[COL.STOCK]
      });
      if (found.length >= limit) break;
    }
  }
  return { hasSource: true, found, tokens };
}
function productBlock(query) {
  const { hasSource, found, tokens } = findProducts(query);
  if (!hasSource || !tokens.length) return '';
  if (!found.length) return ''; // no es una consulta de producto reconocible: Verde responde normal
  let b = '\n\n=== CATÁLOGO (INSTRUCCIÓN OBLIGATORIA) ===\n' +
    'Estos productos SÍ existen en el catálogo (es info real). REGLAS:\n' +
    '1) Confirmá con naturalidad y tu propio tono que sí tenés el/los producto(s).\n' +
    '2) PROHIBIDO decir un precio, estimar, dar rangos o "precios de mercado". El precio SIEMPRE lo confirma un asesor humano.\n' +
    '3) Para el precio, derivá al asesor con tu estilo (sin inventar números).\n' +
    '4) Usá esta info solo para reconocer el producto; no menciones stock ni códigos salvo que el cliente pregunte.\n' +
    'Productos que coinciden:';
  found.forEach(p => { b += '\n• ' + p.nombre; });
  return b;
}

/* ---------- contexto del momento: fecha y hora de Montevideo ---------- */
function bloqueContexto() {
  const ahora = new Date();
  const zona = 'America/Montevideo';
  const fecha = new Intl.DateTimeFormat('es-UY', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora);
  const hora = new Intl.DateTimeFormat('es-UY', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
  return '\n\n== CONTEXTO ACTUAL ==\n' +
    'Hoy es ' + fecha + ' y son las ' + hora + ' en Montevideo. Usá este dato si el cliente pregunta por horarios o si el local está abierto ahora.\n' +
    'Si en la conversación aparece un texto marcado con "[Asesor humano]", lo escribió una persona del equipo de la tienda: tenelo en cuenta, no lo contradigas y no repitas esa marca.\n' +
    'Cuando derives la conversación a una persona del equipo (por ejemplo, porque el cliente pide un precio, quiere hablar con una persona o consulta por una reparación en curso), escribí al final de tu mensaje, en una línea aparte, la marca [DERIVAR]. El sistema la quita antes de enviar: el cliente no la ve. No la uses en ningún otro caso.';
}

/* ---------- obtener la respuesta del bot para un mensaje ---------- */
const MARCA_DERIVAR = /\[\s*DERIVAR\s*\]/i;
const MARCA_DERIVAR_TODAS = /\[\s*DERIVAR\s*\]/gi;
// Quita la marca [DERIVAR] del texto e indica si estaba.
function separarDerivacion(texto) {
  const derivar = MARCA_DERIVAR.test(texto);
  const limpio = String(texto).replace(MARCA_DERIVAR_TODAS, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texto: limpio, derivar };
}

// Devuelve { texto, derivar, error } o null si Verde no debe responder (apagado o conversación en pausa).
// opciones.modelo: probar otra IA puntualmente (solo desde el simulador).
function responderCliente(from, body, opciones) {
  return enCola(String(from), () => responder(String(from), String(body == null ? '' : body), opciones || {}));
}
// Compatibilidad: solo el texto.
async function getReply(from, body) {
  const r = await responderCliente(from, body);
  return r ? r.texto : null;
}
async function responder(from, body, opciones) {
  const v = getVerde();
  const fr = v.frases || {};

  // Apagado: silencio total (no se envía nada al cliente).
  if (v.encendido === false) return null;

  // 1) se guarda el mensaje del cliente antes de consultar a la IA
  registrarMensaje(from, 'user', body);

  // 2) se arma el pedido con el historial guardado
  const convs = loadConversations();
  const hist = Array.isArray(convs[from]) ? convs[from] : [];
  const system = buildSystemPrompt(v) + bloqueContexto() + productBlock(body);
  let crudo;
  try {
    crudo = await callClaude(system, paraLaIA(hist, memoriaDe(v)), v, opciones.modelo);
  } catch (e) {
    console.error('Error al consultar la IA:', e.message);
    // La frase de error deriva a un asesor: el chat pasa a «Chats por responder».
    if (noDebeResponder(from, opciones)) return null;
    return { texto: fr.error || 'Disculpá, tuve un problema técnico. Ahora mismo te conecto con uno de nuestros asesores 🙌', derivar: true, error: true };
  }
  const sep = separarDerivacion(crudo);
  const reply = sep.texto || fr.derivacion || 'Te paso con un asesor para que te ayude. 🙌';

  // 3) si mientras pensaba una persona del equipo tomó la conversación, o alguien apagó a Verde
  //    en este chat, no se responde
  if (noDebeResponder(from, opciones)) return null;

  // 4) se guarda la respuesta de Verde (sin la marca)
  registrarMensaje(from, 'assistant', reply);
  return { texto: reply, derivar: sep.derivar, error: false };
}

module.exports = {
  buildSystemPrompt, getReply, getVerde, callClaude, findProducts, productBlock, resetConversation,
  registrarMensaje, pausar, estaPausado, quitarPausa, pausasVigentes, resolverModelo, armarPedido, paraLaIA, MODELO_PREDETERMINADO,
  responderCliente, separarDerivacion, listarModelos, modeloPermitido
};
