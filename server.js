/*
 * Servidor del Dashboard + Bot Verde
 * --------------------------------------------------------------
 * Qué hace:
 *   1. Muestra el dashboard (la pantalla web).
 *   2. Guarda toda tu configuración en disco (data/state.json).
 *   3. Recibe los mensajes de WhatsApp:
 *        - vía 360dialog (coexistencia) en /webhook/360/<clave secreta>
 *        - vía Twilio (pruebas actuales) en /webhook
 *      arma el prompt desde tu config, le pregunta a la IA y responde.
 *   4. Permite PROBAR el bot desde el dashboard sin WhatsApp (/api/simulate).
 *   5. Si una persona del equipo responde desde el celular, Verde se pausa
 *      con ese cliente (12 horas por defecto).
 *
 * Las claves (IA y WhatsApp) viven en el archivo .env, NUNCA en la pantalla.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const bot = require('./bot.js');

const VERSION = '1.2.0';
const app = express();
const PORT = process.env.PORT || 3003;
// Solo atiende dentro del servidor: el acceso público pasa siempre por Nginx (con contraseña).
const HOST = process.env.HOST || '127.0.0.1';
const PAUSA_HORAS = Number(process.env.VERDE_PAUSA_HORAS) > 0 ? Number(process.env.VERDE_PAUSA_HORAS) : 12;

/* ============================================================
   NÚMEROS INTERNOS DE LA EMPRESA
   Si uno de estos números le escribe al bot por WhatsApp,
   Verde NO responde nada (no lo trata como cliente).
   Cargá acá los números con código de país, entre comillas.
   Ejemplo: '+59899123456'
   ============================================================ */
const NUMEROS_INTERNOS = [
  // '+59899123456',   // ej: encargado
  // '+59891234567',   // ej: otro local
];
// normaliza un número: deja solo dígitos (ignora 'whatsapp:', '+', espacios, guiones)
function soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }
function esNumeroInterno(from) {
  const f = soloDigitos(from);
  if (!f) return false;
  return NUMEROS_INTERNOS.some(n => {
    const d = soloDigitos(n);
    return d && (f === d || f.endsWith(d) || d.endsWith(f));
  });
}

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: false })); // Twilio manda formularios
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // el dashboard (index.html) no se guarda en caché: siempre la última versión
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

/* ---------- API de configuración (Paso 1) ---------- */
app.get('/api/state', (req, res) => {
  try {
    if (!fs.existsSync(STATE_FILE)) return res.json({ state: null });
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    res.json({ state: raw ? JSON.parse(raw) : null });
  } catch (err) {
    console.error('Error al leer el estado:', err);
    res.status(500).json({ error: 'No se pudo leer la configuración guardada.' });
  }
});

app.put('/api/state', (req, res) => {
  try {
    const state = req.body && req.body.state;
    if (typeof state === 'undefined') return res.status(400).json({ error: 'Falta el campo "state".' });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error al guardar el estado:', err);
    res.status(500).json({ error: 'No se pudo guardar la configuración.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    ia: !!process.env.ANTHROPIC_API_KEY,          // ¿hay clave de IA cargada?
    bot: (bot.getVerde().encendido !== false),    // ¿el bot está encendido?
    wa360: d360Configurado()                      // ¿están los datos de 360dialog en .env?
  });
});

/* ---------- Probar el bot desde el dashboard (sin WhatsApp) ---------- */
app.post('/api/simulate', async (req, res) => {
  try {
    const message = (req.body && req.body.message || '').toString();
    const from = (req.body && req.body.from || 'simulador').toString();
    if (!message.trim()) return res.status(400).json({ error: 'Escribí un mensaje.' });
    const reply = await bot.getReply('sim:' + from, message);
    res.json({ reply: reply || '(Verde está apagado y no enviaría ninguna respuesta.)' });
  } catch (err) {
    console.error('Error en /api/simulate:', err);
    res.status(500).json({ error: 'No se pudo generar la respuesta.' });
  }
});

/* ---------- Reiniciar la charla del simulador (borra su memoria) ---------- */
app.post('/api/simulate/reset', (req, res) => {
  try {
    const from = (req.body && req.body.from || 'simulador').toString();
    bot.resetConversation('sim:' + from);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /api/simulate/reset:', err);
    res.status(500).json({ ok: false });
  }
});

/* ---------- Webhook de WhatsApp (Twilio) ---------- */
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
app.post('/webhook', async (req, res) => {
  const from = req.body.From || 'desconocido';
  const body = req.body.Body || '';
  // Si escribe un número INTERNO de la empresa: silencio total (no lo tratamos como cliente).
  if (esNumeroInterno(from)) {
    console.log('WhatsApp << (número interno) de', from, '→ sin respuesta');
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    return;
  }
  // Si el cliente manda una imagen, captura o PDF (ej: un comprobante de pago),
  // Verde NO intenta interpretarlo: agradece y deriva a un asesor humano.
  const numMedia = parseInt((req.body && req.body.NumMedia) || '0', 10) || 0;
  if (numMedia > 0) {
    const fr = (bot.getVerde().frases) || {};
    const reply = fr.adjunto || '¡Gracias! 🙌 Recibí tu archivo. En un momento un asesor lo revisa y te confirma todo. Si querés, dejame por acá cualquier dato que quieras sumar.';
    console.log('WhatsApp << (adjunto x' + numMedia + ') de', from, '→ derivado a humano');
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + escapeXml(reply) + '</Message></Response>');
    return;
  }
  console.log('WhatsApp <<', from, ':', body);
  let reply;
  try {
    reply = await bot.getReply(from, body);
  } catch (err) {
    console.error('Error en /webhook:', err);
    const fr = (bot.getVerde().frases) || {};
    reply = fr.error || 'Disculpá, tuve un problema técnico.';
  }
  res.set('Content-Type', 'text/xml');
  if (!reply) {
    console.log('WhatsApp >> (sin respuesta: Verde apagado)');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    return;
  }
  console.log('WhatsApp >>', reply);
  res.send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>' + escapeXml(reply) + '</Message></Response>');
});

/* ============================================================
   WHATSAPP POR 360DIALOG (coexistencia con la app del celular)
   Datos en .env:
     D360_API_KEY         clave del número (prueba o real)
     D360_MESSAGES_URL    dirección de envío de 360dialog
     D360_WEBHOOK_SECRET  clave secreta que va en la dirección del webhook
   ============================================================ */
function d360Configurado() {
  return !!(process.env.D360_API_KEY && process.env.D360_MESSAGES_URL && process.env.D360_WEBHOOK_SECRET);
}
function claveWebhookValida(recibida) {
  const esperada = process.env.D360_WEBHOOK_SECRET || '';
  if (!esperada || !recibida) return false;
  const a = Buffer.from(String(recibida));
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Registro corto de mensajes ya procesados (360dialog puede reenviar un mismo aviso)
// y de mensajes enviados por Verde (para no confundirlos con respuestas del equipo).
function crearRegistro(maximo) {
  const mapa = new Map();
  return {
    tiene: id => !!id && mapa.has(id),
    agregar: id => {
      if (!id) return;
      mapa.set(id, Date.now());
      while (mapa.size > maximo) mapa.delete(mapa.keys().next().value);
    }
  };
}
const yaProcesados = crearRegistro(5000);
const enviadosPorVerde = crearRegistro(5000);

const DESCRIPCION_ADJUNTO = {
  image: 'una imagen', document: 'un documento', audio: 'un audio',
  video: 'un video', location: 'una ubicación', contacts: 'un contacto'
};
// Traduce un mensaje de WhatsApp a: texto, adjunto o algo que se ignora (stickers, reacciones, etc.).
function interpretar(msg) {
  const tipo = msg && msg.type;
  if (tipo === 'text') return { clase: 'texto', texto: (msg.text && msg.text.body) || '' };
  if (tipo === 'button') return { clase: 'texto', texto: (msg.button && (msg.button.text || msg.button.payload)) || '' };
  if (tipo === 'interactive') {
    const i = msg.interactive || {};
    const r = i.button_reply || i.list_reply || {};
    return { clase: 'texto', texto: r.title || r.id || '' };
  }
  if (DESCRIPCION_ADJUNTO[tipo]) {
    const leyenda = msg[tipo] && msg[tipo].caption ? ': ' + msg[tipo].caption : '';
    return { clase: 'adjunto', desc: DESCRIPCION_ADJUNTO[tipo], leyenda };
  }
  return { clase: 'ignorar', tipo: tipo || 'desconocido' };
}

async function enviarWhatsApp(destino, texto) {
  const cuerpo = destino.to
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino.to }
    : { messaging_product: 'whatsapp', recipient: destino.recipient };
  cuerpo.type = 'text';
  cuerpo.text = { body: String(texto).slice(0, 4096) };
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(process.env.D360_MESSAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'D360-API-KEY': process.env.D360_API_KEY },
      body: JSON.stringify(cuerpo),
      signal: ctrl.signal
    });
    const txt = await r.text();
    if (!r.ok) {
      console.error('360dialog rechazó el envío (' + r.status + '):', txt.slice(0, 300));
      return false;
    }
    try {
      const j = JSON.parse(txt);
      const id = j && j.messages && j.messages[0] && j.messages[0].id;
      enviadosPorVerde.agregar(id);
    } catch (e) { /* respuesta sin JSON: el envío igual fue aceptado */ }
    return true;
  } catch (e) {
    console.error('No se pudo enviar por 360dialog:', e.message);
    return false;
  } finally {
    clearTimeout(limite);
  }
}

// Mensaje de un cliente
async function manejarEntrante(msg) {
  if (!msg || yaProcesados.tiene(msg.id)) return;
  yaProcesados.agregar(msg.id);
  const numero = msg.from ? String(msg.from) : '';
  const usuario = msg.from_user_id ? String(msg.from_user_id) : '';
  if (!numero && !usuario) return;
  const clave = 'wa:' + (numero || usuario);
  const destino = numero ? { to: numero } : { recipient: usuario };
  const quien = numero ? '+' + numero : 'cliente sin número visible';

  if (numero && esNumeroInterno(numero)) { console.log('360 << número interno', quien, '→ sin respuesta'); return; }

  const info = interpretar(msg);
  if (info.clase === 'ignorar') { console.log('360 <<', info.tipo, 'de', quien, '→ se ignora'); return; }
  const textoCliente = info.clase === 'adjunto' ? '[El cliente envió ' + info.desc + info.leyenda + ']' : info.texto;

  const v = bot.getVerde();
  if (v.encendido === false) { console.log('360 << de', quien, '→ Verde apagado, sin respuesta'); return; }

  if (bot.estaPausado(clave)) {
    bot.registrarMensaje(clave, 'user', textoCliente);
    console.log('360 << de', quien, '→ conversación en pausa (la atiende una persona del equipo)');
    return;
  }

  if (info.clase === 'adjunto') {
    // Igual que con Twilio: Verde no interpreta archivos; agradece y deriva a una persona.
    const fr = v.frases || {};
    const resp = fr.adjunto || '¡Gracias! 🙌 Recibí tu archivo. En un momento un asesor lo revisa y te confirma todo. Si querés, dejame por acá cualquier dato que quieras sumar.';
    bot.registrarMensaje(clave, 'user', textoCliente);
    const ok = await enviarWhatsApp(destino, resp);
    if (ok) bot.registrarMensaje(clave, 'assistant', resp);
    console.log('360 << adjunto de', quien, '→', ok ? 'derivado a una persona' : 'NO se pudo responder');
    return;
  }

  if (!textoCliente.trim()) return;
  console.log('360 << de', quien, ':', textoCliente.slice(0, 200));
  const respuesta = await bot.getReply(clave, textoCliente);
  if (!respuesta) { console.log('360 >> sin respuesta (Verde apagado o conversación en pausa)'); return; }
  const ok = await enviarWhatsApp(destino, respuesta);
  console.log('360 >>', ok ? 'enviado' : 'NO enviado', ':', respuesta.slice(0, 200));
}

// Mensaje que alguien del equipo envió desde la app del celular (coexistencia)
function manejarEco(eco) {
  if (!eco || yaProcesados.tiene(eco.id) || enviadosPorVerde.tiene(eco.id)) return;
  yaProcesados.agregar(eco.id);
  const cliente = eco.to ? String(eco.to) : (eco.to_user_id ? String(eco.to_user_id) : '');
  if (!cliente) return;
  const clave = 'wa:' + cliente;
  const info = interpretar(eco);
  const texto = info.clase === 'texto' ? info.texto : '[envió ' + (info.desc || 'un mensaje sin texto') + ']';
  const hasta = bot.pausar(clave, PAUSA_HORAS);
  bot.registrarMensaje(clave, 'assistant', '[Asesor humano] ' + texto);
  console.log('360 eco: una persona del equipo respondió desde el celular → Verde en pausa con ese cliente hasta', new Date(hasta).toLocaleString('es-UY', { timeZone: 'America/Montevideo' }));
}

// Mensajes de un mismo cliente: uno a la vez y en orden
const colasClientes = new Map();
function enColaCliente(clave, tarea) {
  const previa = colasClientes.get(clave) || Promise.resolve();
  const actual = previa.then(tarea, tarea);
  const fin = actual.catch(err => console.error('Error al atender un mensaje de 360dialog:', err));
  colasClientes.set(clave, fin);
  fin.then(() => { if (colasClientes.get(clave) === fin) colasClientes.delete(clave); });
  return fin;
}

async function procesarAviso360(body) {
  if (!body || typeof body !== 'object') return;
  const cambios = [];
  if (Array.isArray(body.entry)) {
    for (const e of body.entry) for (const c of (e.changes || [])) cambios.push({ campo: c.field || 'messages', valor: c.value || {} });
  } else if (Array.isArray(body.messages) || Array.isArray(body.statuses)) {
    cambios.push({ campo: 'messages', valor: body }); // formato antiguo
  }
  for (const { campo, valor } of cambios) {
    if (campo === 'messages') {
      for (const s of (valor.statuses || [])) {
        if (s && s.status === 'failed') console.error('360: un mensaje no se pudo entregar:', JSON.stringify(s.errors || s).slice(0, 300));
      }
      for (const m of (valor.messages || [])) {
        const clave = 'wa:' + (m && (m.from || m.from_user_id) || 'desconocido');
        await enColaCliente(clave, () => manejarEntrante(m));
      }
    } else if (campo === 'smb_message_echoes') {
      for (const eco of (valor.message_echoes || [])) manejarEco(eco);
    } else {
      console.log('360: aviso de tipo "' + campo + '" recibido (no requiere acción).');
    }
  }
}

app.post('/webhook/360/:clave', (req, res) => {
  if (!d360Configurado() || !claveWebhookValida(req.params.clave)) return res.sendStatus(404);
  res.sendStatus(200); // se responde enseguida; el mensaje se atiende a continuación
  procesarAviso360(req.body).catch(err => console.error('Error al procesar un aviso de 360dialog:', err));
});

app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('  Dashboard + Bot Verde funcionando ✅ (versión ' + VERSION + ')');
  console.log('  Atiende en http://' + HOST + ':' + PORT + ' (solo interno; el acceso público pasa por Nginx)');
  console.log('  Webhook Twilio:  POST /webhook');
  console.log('  Webhook 360dialog:  ' + (d360Configurado() ? 'configurado' : 'pendiente (faltan datos en .env)'));
  console.log('  Clave de IA cargada: ' + (process.env.ANTHROPIC_API_KEY ? 'SÍ' : 'NO (configurá .env)'));
  console.log('  Pausa cuando responde una persona del equipo: ' + PAUSA_HORAS + ' horas');
  console.log('====================================================');
});
