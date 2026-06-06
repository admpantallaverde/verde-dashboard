/*
 * bot.js — El "cerebro" de Verde
 * --------------------------------------------------------------
 * Toma la configuración que editás en el dashboard (data/state.json),
 * arma el prompt, le pregunta a la IA (Anthropic) y devuelve la respuesta.
 * Guarda el historial de cada conversación en disco (data/conversations.json)
 * para que NO se pierda al reiniciar.
 *
 * No hace falta tocar este archivo.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');

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

/* ---------- historial de conversaciones (persistente) ---------- */
function loadConversations() {
  try {
    if (!fs.existsSync(CONV_FILE)) return {};
    const raw = fs.readFileSync(CONV_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('No se pudo leer conversations.json:', e.message);
    return {};
  }
}
function saveConversations(obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = CONV_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, CONV_FILE);
  } catch (e) {
    console.error('No se pudo guardar conversations.json:', e.message);
  }
}

/* ---------- llamada a la IA (Anthropic) ---------- */
async function callClaude(system, messages, v) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Falta la clave ANTHROPIC_API_KEY (configurala en el archivo .env).');
  const model = (v.tecnico && v.tecnico.modelo) || 'claude-sonnet-4-5';
  const max_tokens = (v.tecnico && v.tecnico.maxTokens) || 1000;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens, system, messages })
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error('La IA respondió con error ' + resp.status + ': ' + detail.slice(0, 300));
  }
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return text || '…';
}

/* ---------- obtener la respuesta del bot para un mensaje ---------- */
/* ---------- buscador de productos en el Excel cargado ---------- */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function cleanNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? String(v) : Math.round(n);
}
function getSource() {
  const s = readState();
  return (s.sources || []).find(x => x.preview && x.preview.length > 1) || null;
}
// Columnas confirmadas (base 0): Nombre=2, Stock=5, Precio venta=6, Precio con descuento=8
const COL = { NAME: 2, STOCK: 5, PV: 6, PD: 8 };
const STOP = new Set(['el','la','los','las','un','una','unos','unas','de','del','para','por','con','y','o','a','en','me','te','le','lo','al','su','mi','se','es','que','cuanto','cuanta','cuantos','cuantas','cuesta','cuestan','sale','salen','precio','precios','vale','valen','tiene','tienen','tenes','hay','quiero','dame','decime','busco','necesito','tienes','cual','sobre','este','esta','ese','esa','del','hola','buenas','dia','dias','tardes','noches']);
function findProducts(query, limit) {
  limit = limit || 8;
  const src = getSource();
  if (!src) return { hasSource: false, found: [], tokens: [] };
  const body = src.preview.slice(1);
  const tokens = norm(query).split(/\s+/).filter(w => w && !STOP.has(w));
  if (!tokens.length) return { hasSource: true, found: [], tokens: [] };
  const found = [];
  for (const r of body) {
    const name = norm(r[COL.NAME]);
    if (!name) continue;
    if (tokens.every(t => name.includes(t))) {
      found.push({
        nombre: String(r[COL.NAME] == null ? '' : r[COL.NAME]).trim(),
        precio: cleanNum(r[COL.PV]),
        precioDesc: cleanNum(r[COL.PD]),
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
  if (!found.length) {
    return '\n\n== BÚSQUEDA EN EL CATÁLOGO ==\nNo se encontraron productos que coincidan con lo que pidió el cliente. NO inventes precios ni stock: ofrecé cotizar o derivá a un asesor.';
  }
  let b = '\n\n== PRODUCTOS DEL CATÁLOGO (datos REALES — usá EXCLUSIVAMENTE estos precios y stock; no inventes) ==';
  found.forEach(p => {
    let line = '\n• ' + p.nombre;
    if (p.precio != null) line += ' | Precio: $' + p.precio;
    if (p.precioDesc != null && p.precioDesc !== p.precio) line += ' | Con descuento: $' + p.precioDesc;
    if (p.stock != null) line += ' | Stock: ' + p.stock;
    b += line;
  });
  b += '\nSi ninguno coincide exactamente con lo que pide el cliente, no inventes: ofrecé cotizar o derivá.';
  return b;
}

async function getReply(from, body) {
  const v = getVerde();
  const fr = v.frases || {};

  // Si el bot está apagado, no responde: deriva a un humano.
  if (v.encendido === false) {
    return fr.derivacion || 'En este momento no estamos atendiendo por este medio. Te conecto con un asesor.';
  }

  const memN = (v.tecnico && v.tecnico.memoria) || 20;
  const convs = loadConversations();
  const hist = Array.isArray(convs[from]) ? convs[from] : [];
  hist.push({ role: 'user', content: String(body || '') });
  const trimmed = hist.slice(-memN);

  const system = buildSystemPrompt(v) + productBlock(String(body || ''));
  let reply;
  try {
    reply = await callClaude(system, trimmed, v);
  } catch (e) {
    console.error('Error al consultar la IA:', e.message);
    return fr.error || 'Disculpá, tuve un problema técnico. Ahora mismo te conecto con uno de nuestros asesores 🙌';
  }

  trimmed.push({ role: 'assistant', content: reply });
  convs[from] = trimmed.slice(-memN);
  saveConversations(convs);
  return reply;
}

module.exports = { buildSystemPrompt, getReply, getVerde, callClaude, findProducts, productBlock };
