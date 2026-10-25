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
 *   6. Cuando Verde deriva un chat, lo deja en «Chats por responder», se calla
 *      con ese cliente y avisa a los celulares del equipo. Guarda el historial
 *      de cómo se atendió cada chat (3 meses) para la supervisión.
 *   7. Usuarios propios para el panel (se activa con VERDE_LOGIN=activo en .env).
 *
 * Las claves (IA y WhatsApp) viven en el archivo .env, NUNCA en la pantalla.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const bot = require('./bot.js');
const consumo = require('./consumo');
const cumplimiento = require('./cumplimiento');
const ayuda = require('./ayuda');
const archivos = require('./archivos');
const usuarios = require('./usuarios.js');
const atencion = require('./atencion.js');
const conversaciones = require('./conversaciones.js');

const VERSION = '1.4.1';
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
  // También son internos los celulares del equipo que reciben los avisos.
  return NUMEROS_INTERNOS.concat(leerAvisos().numeros).some(n => {
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

/* ============================================================
   USUARIOS Y PERMISOS
   El ingreso con usuario propio se activa con VERDE_LOGIN=activo en .env.
   Mientras no está activo, el panel funciona como siempre (protegido por Nginx).
   ============================================================ */
const COOKIE = 'verde_sesion';
function loginActivo() { return String(process.env.VERDE_LOGIN || '').trim().toLowerCase() === 'activo'; }
function leerCookie(req) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > -1 && parte.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(parte.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}
function ponerCookie(res, token) {
  res.setHeader('Set-Cookie', COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (7 * 24 * 3600));
}
function borrarCookie(res) {
  res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}
function ipDe(req) { return String(req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || ''); }
function responderError(res, e) {
  if (e && e.publico) return res.status(e.codigo || 400).json({ error: e.message });
  console.error('Error inesperado:', e);
  res.status(500).json({ error: 'Ocurrió un error inesperado.' });
}

app.use('/api', (req, res, next) => {
  // Los cambios solo se aceptan desde el propio panel (protección contra pedidos de otros sitios).
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
    let host = '';
    try { host = new URL(req.headers.origin).host; } catch (e) { host = ''; }
    if (host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido.' });
  }
  const token = leerCookie(req);
  req.usuario = token ? usuarios.validarSesion(token) : null;
  next();
});
// Exige sesión (y rol) solo cuando el ingreso con usuario propio está activo.
function requiere(roles) {
  return (req, res, next) => {
    if (!loginActivo()) return next();
    if (!req.usuario) return res.status(401).json({ error: 'La sesión no está iniciada o venció. Ingresar de nuevo.', sesion: false });
    if (req.usuario.debeCambiar) return res.status(403).json({ error: 'Antes de seguir hay que cambiar la contraseña temporal.', debeCambiar: true });
    if (roles && !roles.includes(req.usuario.rol)) return res.status(403).json({ error: 'Este usuario no tiene permiso para esta sección.' });
    next();
  };
}

app.post('/api/login', (req, res) => {
  const b = req.body || {};
  const r = usuarios.ingresar(b.usuario, b.clave, ipDe(req));
  if (!r.ok) {
    const bloqueado = r.motivo === 'bloqueado';
    return res.status(bloqueado ? 429 : 401).json({ error: bloqueado ? 'Demasiados intentos fallidos. Probar de nuevo en 15 minutos.' : 'Usuario o contraseña incorrectos.' });
  }
  ponerCookie(res, r.token);
  res.json({ ok: true, usuario: r.usuario });
});
app.post('/api/logout', (req, res) => {
  const token = leerCookie(req);
  if (token) usuarios.cerrarSesion(token);
  borrarCookie(res);
  res.json({ ok: true });
});
app.get('/api/sesion', (req, res) => {
  res.json({ loginActivo: loginActivo(), usuario: req.usuario || null, hayUsuarios: usuarios.hayUsuarios() });
});
app.post('/api/clave', (req, res) => {
  if (!req.usuario) return res.status(401).json({ error: 'La sesión no está iniciada o venció. Ingresar de nuevo.', sesion: false });
  try {
    const b = req.body || {};
    res.json({ ok: true, usuario: usuarios.cambiarClave(req.usuario.id, b.actual, b.nueva) });
  } catch (e) { responderError(res, e); }
});

/* ---------- Usuarios (solo administradores) ---------- */
app.get('/api/usuarios', requiere(['admin']), (req, res) => res.json({ usuarios: usuarios.listar() }));
app.post('/api/usuarios', requiere(['admin']), (req, res) => {
  try {
    const r = usuarios.crear(req.body || {});
    res.json({ ok: true, usuario: r.usuario, claveTemporal: r.claveTemporal });
  } catch (e) { responderError(res, e); }
});
app.put('/api/usuarios/:id', requiere(['admin']), (req, res) => {
  try {
    const b = req.body || {};
    res.json({ ok: true, usuario: usuarios.actualizar(req.params.id, { nombre: b.nombre, rol: b.rol, firma: b.firma, activo: b.activo }) });
  } catch (e) { responderError(res, e); }
});
app.post('/api/usuarios/:id/restablecer', requiere(['admin']), (req, res) => {
  try { res.json({ ok: true, claveTemporal: usuarios.restablecerClave(req.params.id) }); }
  catch (e) { responderError(res, e); }
});

/* ---------- IA disponibles para elegir en el panel ---------- */
app.get('/api/modelos', requiere(['admin']), (req, res) => res.json({ modelos: bot.listarModelos() }));

/* ---------- Consumo de la IA: costo estimado por período (solo administradores) ---------- */
app.get('/api/consumo-ia', requiere(['admin']), (req, res) => {
  try {
    const q = req.query || {};
    const texto = v => (v === undefined || v === null || v === '') ? undefined : String(v);
    const r = consumo.resumen({ mes: texto(q.mes), desde: texto(q.desde), hasta: texto(q.hasta) });
    if (r.error) return res.status(400).json({ error: r.error });
    const id = bot.modeloEnUso();
    const precio = consumo.PRECIOS[id];
    r.modeloActual = { id, nombre: precio ? precio.nombre : id, entrada: precio ? precio.entrada : null, salida: precio ? precio.salida : null };
    res.json(r);
  } catch (e) { responderError(res, e); }
});

/* ---------- API de configuración (Paso 1) ---------- */
app.get('/api/state', requiere(['admin']), (req, res) => {
  try {
    if (!fs.existsSync(STATE_FILE)) return res.json({ state: null });
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    res.json({ state: raw ? JSON.parse(raw) : null });
  } catch (err) {
    console.error('Error al leer el estado:', err);
    res.status(500).json({ error: 'No se pudo leer la configuración guardada.' });
  }
});

app.put('/api/state', requiere(['admin']), (req, res) => {
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
    wa360: d360Configurado(),                     // ¿están los datos de 360dialog en .env?
    login: loginActivo()                          // ¿está activo el ingreso con usuario propio?
  });
});

/* ---------- Probar el bot desde el dashboard (sin WhatsApp) ---------- */
app.post('/api/simulate', requiere(['admin']), async (req, res) => {
  try {
    const message = (req.body && req.body.message || '').toString();
    const from = (req.body && req.body.from || 'simulador').toString();
    const modelo = (req.body && req.body.modelo || '').toString().trim();
    if (!message.trim()) return res.status(400).json({ error: 'Escribí un mensaje.' });
    if (modelo && !bot.modeloPermitido(modelo)) return res.status(400).json({ error: 'Esa IA no está disponible.' });
    const primera = !bot.tieneRespuestas('sim:' + from);
    const r = await bot.responderCliente('sim:' + from, message, { modelo: modelo || undefined });
    if (!r) return res.json({ reply: '(Verde está apagado y no enviaría ninguna respuesta.)', derivaria: false });
    res.json({
      reply: r.texto + (primera ? '\n\n' + cumplimiento.lineaInicial() : '') + (r.derivar ? '\n\n(Este chat pasaría a «Chats por responder».)' : ''),
      derivaria: !!r.derivar,
      modelo: modelo || null
    });
  } catch (err) {
    console.error('Error en /api/simulate:', err);
    res.status(500).json({ error: 'No se pudo generar la respuesta.' });
  }
});

/* ---------- Reiniciar la charla del simulador (borra su memoria) ---------- */
app.post('/api/simulate/reset', requiere(['admin']), (req, res) => {
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
    return { clase: 'adjunto', desc: DESCRIPCION_ADJUNTO[tipo], leyenda, archivo: archivos.desdeWebhook(msg) };
  }
  return { clase: 'ignorar', tipo: tipo || 'desconocido' };
}

function baseDestino(destino) {
  return destino.to
    ? { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino.to }
    : { messaging_product: 'whatsapp', recipient: destino.recipient };
}
function enviarWhatsApp(destino, texto) {
  const cuerpo = baseDestino(destino);
  cuerpo.type = 'text';
  cuerpo.text = { body: String(texto).slice(0, 4096) };
  return enviar360(cuerpo);
}
// Plantilla aprobada por Meta (necesaria para avisar fuera de la ventana de 24 horas).
function limpiarParametro(t) { return String(t == null ? '' : t).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200) || '-'; }
function enviarPlantilla(destino, nombre, idioma, parametros) {
  const cuerpo = baseDestino(destino);
  cuerpo.type = 'template';
  cuerpo.template = { name: nombre, language: { code: idioma || 'es' }, components: [{ type: 'body', parameters: parametros.map(t => ({ type: 'text', text: limpiarParametro(t) })) }] };
  return enviar360(cuerpo);
}
async function enviar360(cuerpo) {
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

/* ---------- Avisos a los celulares del equipo ---------- */
const AVISOS_FILE = path.join(DATA_DIR, 'avisos.json');
function leerAvisos() {
  try {
    const d = JSON.parse(fs.readFileSync(AVISOS_FILE, 'utf8'));
    return { numeros: Array.isArray(d.numeros) ? d.numeros.map(soloDigitos).filter(Boolean) : [], plantilla: d.plantilla || '', idioma: d.idioma || 'es' };
  } catch (e) {
    return { numeros: [], plantilla: '', idioma: 'es' };
  }
}
function guardarAvisos(datos) {
  const numeros = [];
  for (const n of (Array.isArray(datos.numeros) ? datos.numeros : [])) {
    const d = soloDigitos(n);
    if (!d) continue;
    if (d.length < 8 || d.length > 15) { const e = new Error('El número «' + n + '» no es válido: debe incluir el código de país (por ejemplo, +598 9X XXX XXX).'); e.publico = true; throw e; }
    if (!numeros.includes(d)) numeros.push(d);
  }
  if (numeros.length > 10) { const e = new Error('Se pueden cargar hasta 10 números.'); e.publico = true; throw e; }
  const plantilla = String(datos.plantilla || '').trim();
  if (plantilla && !/^[a-z0-9_]{1,512}$/.test(plantilla)) { const e = new Error('El nombre de la plantilla solo admite minúsculas, números y guion bajo.'); e.publico = true; throw e; }
  const idioma = String(datos.idioma || 'es').trim();
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) { const e = new Error('El idioma de la plantilla no es válido (por ejemplo: es).'); e.publico = true; throw e; }
  const cfg = { numeros, plantilla, idioma };
  const tmp = AVISOS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, AVISOS_FILE);
  return cfg;
}
/* ---------- Ventana de 24 horas de cada celular del equipo (1.3.7) ---------- */
// La ventana se abre cuando el celular le escribe al número de la tienda. Con la ventana abierta, el aviso sale
// como mensaje común; con la ventana cerrada, WhatsApp solo acepta la plantilla aprobada por Meta.
const VENTANAS_FILE = path.join(DATA_DIR, 'avisos-ventanas.json');
const MARGEN_VENTANA = 10 * 60000;   // se considera cerrada 10 minutos antes de vencer, por seguridad
function leerVentanas() {
  try { const d = JSON.parse(fs.readFileSync(VENTANAS_FILE, 'utf8')); return d && typeof d === 'object' ? d : {}; }
  catch (e) { return {}; }
}
function registrarVentanaEquipo(numero) {
  const f = soloDigitos(numero);
  const n = leerAvisos().numeros.find(d => f === d || f.endsWith(d) || d.endsWith(f));
  if (!n) return false;
  const v = leerVentanas();
  v[n] = Date.now();
  const tmp = VENTANAS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v), 'utf8');
  fs.renameSync(tmp, VENTANAS_FILE);
  return true;
}
function ventanaHasta(v, n) { return v[n] ? v[n] + 24 * 3600000 : null; }
function ventanaAbierta(v, n) { const h = ventanaHasta(v, n); return !!h && Date.now() < h - MARGEN_VENTANA; }
// Configuración de avisos más el estado de cada número (para el panel).
function estadoAvisos() {
  const cfg = leerAvisos();
  const v = leerVentanas();
  return Object.assign({}, cfg, {
    estados: cfg.numeros.map(n => {
      const abierta = ventanaAbierta(v, n);
      return { numero: n, ventanaHasta: abierta ? ventanaHasta(v, n) : null, proximo: abierta ? 'comun' : (cfg.plantilla ? 'plantilla' : 'sin_envio') };
    })
  });
}
// Motivo del aviso. Nunca incluye el contenido del mensaje del cliente, para proteger su privacidad.
function motivoAviso(a, motivo) {
  if (motivo === 'volvió a escribir') return 'El cliente volvió a escribir';
  if (motivo === 'Verde en pausa en ese chat') return 'Verde estaba en pausa y el cliente esperó 5 minutos';
  if (motivo === 'Verde apagado en ese chat') return 'Verde está apagado en ese chat y el cliente esperó 5 minutos';
  if (a && /envió /.test(a.motivo || '')) return 'El cliente envió un archivo';
  if (a && /problema técnico/.test(a.motivo || '')) return 'Verde tuvo un problema técnico';
  return 'Verde lo derivó a una persona del equipo';
}
function textoAviso(cliente, motivo) {
  return 'Pantalla Verde: hay un chat por responder de ' + cliente + '. Motivo: ' + motivo + '. Se puede atender desde el panel.';
}
async function avisarEquipo(a, motivo) {
  const cfg = leerAvisos();
  if (!cfg.numeros.length || !d360Configurado()) return;
  const cliente = ((a.nombre ? a.nombre + ' ' : '') + (a.numero ? '(+' + a.numero + ')' : '(sin número visible)')).trim();
  const mot = motivoAviso(a, motivo);
  const ventanas = leerVentanas();
  let enviados = 0, sinEnvio = 0;
  for (const num of cfg.numeros) {
    const abierta = ventanaAbierta(ventanas, num);
    let ok = false;
    if (abierta) ok = await enviarWhatsApp({ to: num }, textoAviso(cliente, mot));
    // Ventana cerrada (o WhatsApp rechazó el mensaje común): solo con la plantilla aprobada.
    if (!ok && cfg.plantilla) ok = await enviarPlantilla({ to: num }, cfg.plantilla, cfg.idioma, [cliente, mot]);
    if (!ok && !abierta && !cfg.plantilla) sinEnvio++;
    if (ok) enviados++;
  }
  atencion.anotarAvisos(a.id, enviados === cfg.numeros.length
    ? 'Aviso enviado a ' + enviados + (enviados === 1 ? ' celular' : ' celulares') + ' del equipo.'
    : sinEnvio
      ? 'Aviso enviado a ' + enviados + ' de ' + cfg.numeros.length + ' celulares del equipo: ' + sinEnvio + (sinEnvio === 1 ? ' no tenía' : ' no tenían') + ' la ventana de 24 horas abierta y no hay plantilla configurada.'
      : 'Aviso enviado a ' + enviados + ' de ' + cfg.numeros.length + ' celulares del equipo: revisar los números o la plantilla.');
  console.log('360 avisos: ' + enviados + ' de ' + cfg.numeros.length + ' enviados' + (sinEnvio ? ' (' + sinEnvio + ' sin ventana ni plantilla)' : ''));
}

// Primera respuesta de la conversación (sin mensajes de Verde ni del equipo en los últimos 3 meses):
// se agrega la presentación fija como asistente virtual, con el enlace a la página de privacidad.
function conPresentacion(clave, texto) {
  const d = conversaciones.detalle(clave, contexto());
  const hubo = !!(d && (d.mensajes || []).some(m => m.tipo === 'verde' || m.tipo === 'equipo'));
  return hubo ? texto : texto + '\n\n' + cumplimiento.lineaInicialWhatsApp();
}

// Mensaje de un cliente
async function manejarEntrante(msg, nombres) {
  if (!msg || yaProcesados.tiene(msg.id)) return;
  yaProcesados.agregar(msg.id);
  const numero = msg.from ? String(msg.from) : '';
  const usuario = msg.from_user_id ? String(msg.from_user_id) : '';
  if (!numero && !usuario) return;
  const clave = 'wa:' + (numero || usuario);
  const destino = numero ? { to: numero } : { recipient: usuario };
  const quien = numero ? '+' + numero : 'cliente sin número visible';
  const nombre = (nombres && (nombres[numero] || nombres[usuario])) || '';

  if (numero && esNumeroInterno(numero)) {
    // Un celular del equipo le escribió a la tienda: su ventana de 24 horas para recibir avisos queda abierta.
    const ventana = registrarVentanaEquipo(numero);
    console.log('360 << número interno', quien, '→ sin respuesta' + (ventana ? ' (ventana de avisos abierta por 24 horas)' : ''));
    return;
  }

  const info = interpretar(msg);
  if (info.clase === 'ignorar') { console.log('360 <<', info.tipo, 'de', quien, '→ se ignora'); return; }
  const textoCliente = info.clase === 'adjunto' ? '[El cliente envió ' + info.desc + info.leyenda + ']' : info.texto;
  conversaciones.registrar({ clave, numero, nombre, destino, tipo: 'cliente', texto: textoCliente, archivo: info.archivo || null });

  const v = bot.getVerde();
  if (v.encendido === false) { console.log('360 << de', quien, '→ Verde apagado, sin respuesta'); return; }

  // 1) El chat ya espera a una persona del equipo: Verde no responde y el mensaje se suma a «Por responder».
  if (atencion.tienePendiente(clave)) {
    bot.registrarMensaje(clave, 'user', textoCliente);
    atencion.mensajeCliente({ clave, destino, numero, nombre, texto: textoCliente, enPausa: bot.estaPausado(clave) });
    console.log('360 << de', quien, '→ espera a una persona del equipo (Verde no responde)');
    return;
  }

  // 1b) Verde está apagado en este chat: no responde. Si nadie del equipo responde en 5 minutos,
  //     el resguardo pasa el chat a «Chats por responder» y avisa al equipo.
  if (conversaciones.estaApagado(clave)) {
    bot.registrarMensaje(clave, 'user', textoCliente);
    console.log('360 << de', quien, '→ Verde está apagado en este chat (lo atiende una persona del equipo)');
    return;
  }

  // 2) Conversación en pausa: la atiende una persona del equipo, o se marcó como atendida.
  if (bot.estaPausado(clave)) {
    bot.registrarMensaje(clave, 'user', textoCliente);
    const r = atencion.mensajeCliente({ clave, destino, numero, nombre, texto: textoCliente, enPausa: true });
    if (r && r.estado === 'reabierta') {
      console.log('360 << de', quien, '→ volvió a escribir después de «Marcar atendido»: regresa a «Por responder»');
      await avisarEquipo(r.atencion, 'volvió a escribir');
    } else {
      // Si nadie del equipo le responde en 5 minutos, el resguardo pasa el chat a «Chats por responder».
      if (!atencion.tienePendiente(clave)) conversaciones.iniciarEsperaPorPausa(clave);
      console.log('360 << de', quien, '→ conversación en pausa (la atiende una persona del equipo)');
    }
    return;
  }

  // 3) Archivos: Verde no los interpreta; agradece y deriva a una persona.
  if (info.clase === 'adjunto') {
    const fr = v.frases || {};
    const resp = fr.adjunto || '¡Gracias! 🙌 Recibí tu archivo. En un momento un asesor lo revisa y te confirma todo. Si querés, dejame por acá cualquier dato que quieras sumar.';
    bot.registrarMensaje(clave, 'user', textoCliente);
    const enviado = conPresentacion(clave, resp);
    const ok = await enviarWhatsApp(destino, enviado);
    if (ok) bot.registrarMensaje(clave, 'assistant', resp);
    if (ok) conversaciones.registrar({ clave, tipo: 'verde', texto: enviado });
    const d = atencion.derivar({ clave, destino, numero, nombre, mensajeCliente: textoCliente, respuestaVerde: ok ? resp : null, motivo: 'El cliente envió ' + info.desc + ': lo revisa una persona del equipo.' });
    console.log('360 << adjunto de', quien, '→', ok ? 'derivado a una persona' : 'NO se pudo responder', '· pasa a «Chats por responder»');
    await avisarEquipo(d.atencion);
    return;
  }

  // 4) Texto: responde Verde y, si deriva, el chat pasa a «Chats por responder».
  if (!textoCliente.trim()) return;
  console.log('360 << de', quien, ':', textoCliente.slice(0, 200));
  // Si mientras la IA prepara la respuesta alguien apaga a Verde en este chat, la respuesta se descarta.
  const r = await bot.responderCliente(clave, textoCliente, { puedeResponder: () => !conversaciones.estaApagado(clave) });
  if (!r) { console.log('360 >> sin respuesta (Verde apagado o una persona del equipo tomó la conversación)'); return; }
  const enviado = conPresentacion(clave, r.texto);
  const ok = await enviarWhatsApp(destino, enviado);
  if (ok) conversaciones.registrar({ clave, tipo: 'verde', texto: enviado });
  console.log('360 >>', ok ? 'enviado' : 'NO enviado', ':', enviado.slice(0, 200));
  if (r.derivar) {
    const d = atencion.derivar({
      clave, destino, numero, nombre, mensajeCliente: textoCliente, respuestaVerde: ok ? r.texto : null,
      motivo: r.error ? 'Verde tuvo un problema técnico y lo derivó a una persona del equipo.' : 'Verde lo derivó a una persona del equipo.'
    });
    console.log('360 → derivado: pasa a «Chats por responder»');
    await avisarEquipo(d.atencion);
  }
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
  const firma = info.clase === 'texto' ? usuarios.detectarFirma(info.texto) : null;
  conversaciones.registrar({ clave, numero: eco.to ? String(eco.to) : '', destino: eco.to ? { to: String(eco.to) } : { recipient: cliente },
    tipo: 'equipo', texto, autor: firma ? firma.nombre : '', origen: 'celular', firma: !!firma });
  const a = atencion.respuestaEquipo({ clave, texto, firma, origen: 'celular' });
  console.log('360 eco: una persona del equipo respondió desde el celular' + (firma ? ' (firma: ' + firma.nombre + ')' : ' (sin firma)') +
    (a && a.estado === 'respondido' ? ' · el chat pasa a «Chats respondidos»' : '') +
    ' → Verde en pausa con ese cliente hasta', new Date(hasta).toLocaleString('es-UY', { timeZone: 'America/Montevideo' }));
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
      const nombres = {};
      for (const c of (valor.contacts || [])) {
        const id = c && (c.wa_id || c.user_id);
        if (id && c.profile && c.profile.name) nombres[String(id)] = String(c.profile.name).slice(0, 80);
      }
      for (const m of (valor.messages || [])) {
        const clave = 'wa:' + (m && (m.from || m.from_user_id) || 'desconocido');
        await enColaCliente(clave, () => manejarEntrante(m, nombres));
      }
    } else if (campo === 'smb_message_echoes') {
      for (const eco of (valor.message_echoes || [])) manejarEco(eco);
    } else {
      console.log('360: aviso de tipo "' + campo + '" recibido (no requiere acción).');
    }
  }
}

/* ============================================================
   CHATS POR RESPONDER Y CHATS RESPONDIDOS (para el panel)
   ============================================================ */
app.get('/api/chats/pendientes', requiere(['admin', 'asesor']), (req, res) => {
  const apagados = conversaciones.apagados();
  const lista = atencion.pendientes().map(p => Object.assign(p, { apagado: apagados.has(p.clave) }));
  res.json({ total: lista.length, lista });
});
app.get('/api/chats/respondidos', requiere(['admin', 'asesor']), (req, res) => {
  res.json(atencion.respondidos({ buscar: req.query.buscar, periodo: req.query.periodo, filtro: req.query.filtro }));
});
app.get('/api/chats/:id', requiere(['admin', 'asesor']), (req, res) => {
  const d = atencion.detalle(req.params.id);
  if (!d) return res.status(404).json({ error: 'El chat no existe.' });
  res.json(d);
});
app.post('/api/chats/:id/atendido', requiere(['admin', 'asesor']), (req, res) => {
  try {
    const b = req.body || {};
    const u = req.usuario;
    const a = atencion.marcarAtendido(req.params.id, { motivo: b.motivo, detalle: b.detalle, usuarioId: u ? u.id : null, usuarioNombre: u ? u.nombre : 'Acceso general' });
    bot.pausar(a.clave, PAUSA_HORAS);   // Verde sigue en silencio; si el cliente vuelve a escribir, regresa a «Por responder»
    res.json({ ok: true, chat: atencion.detalle(a.id) });
  } catch (e) { responderError(res, e); }
});
app.get('/api/avisos', requiere(['admin']), (req, res) => res.json(estadoAvisos()));
app.put('/api/avisos', requiere(['admin']), (req, res) => {
  try { guardarAvisos(req.body || {}); res.json({ ok: true, avisos: estadoAvisos() }); }
  catch (e) { responderError(res, e); }
});

/* ---------- Cumplimiento (1.3.7): reglas fijas y datos de la página de privacidad ---------- */
const fmtHoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' });
function datosCumplimiento() {
  const r = cumplimiento.leerReglas();
  return { reglas: r.reglas, lineaInicial: r.linea, recomendadas: r.recomendadas, sinEnlace: r.sinEnlace, modificadoEn: r.modificadoEn, modificadoPor: r.modificadoPor,
    maxReglas: cumplimiento.MAX_REGLAS, url: 'https://' + cumplimiento.URL_PRIVACIDAD, enlace: cumplimiento.URL_PRIVACIDAD, privacidad: cumplimiento.leerPrivacidad() };
}
app.get('/api/cumplimiento', requiere(['admin']), (req, res) => res.json(datosCumplimiento()));
// Reglas fijas del sistema: editables por un administrador, con registro de quién las cambió (1.3.8).
app.put('/api/reglas-fijas', requiere(['admin']), (req, res) => {
  try {
    cumplimiento.guardarReglas(req.body || {}, quienEs(req));
    console.log('Panel: ' + quienEs(req) + ' modificó las reglas fijas del sistema');
    res.json(Object.assign({ ok: true }, datosCumplimiento()));
  } catch (e) { responderError(res, e); }
});
app.post('/api/reglas-fijas/restaurar', requiere(['admin']), (req, res) => {
  try {
    cumplimiento.restaurarReglas(quienEs(req));
    console.log('Panel: ' + quienEs(req) + ' restauró las reglas fijas recomendadas');
    res.json(Object.assign({ ok: true }, datosCumplimiento()));
  } catch (e) { responderError(res, e); }
});

/* ---------- Centro de ayuda (1.3.8): manual, guías de Meta y asistente ---------- */
function rolDe(req) { return req.usuario ? req.usuario.rol : 'admin'; }
function configAyuda() {
  const v = bot.getVerde();
  const avisos = leerAvisos();
  const priv = cumplimiento.leerPrivacidad();
  const precio = consumo.PRECIOS[bot.modeloEnUso()];
  return {
    'Versión del sistema': VERSION,
    'Verde': v.encendido === false ? 'apagado para todos los chats' : 'encendido',
    'Modelo de IA de Verde': precio ? precio.nombre : bot.modeloEnUso(),
    'Pausa después de que responde una persona': PAUSA_HORAS + ' horas',
    'Resguardo si nadie responde': '5 minutos',
    'Ventana para responder desde el panel': '24 horas desde el último mensaje del cliente',
    'Ingreso con usuario propio': loginActivo() ? 'activo' : 'inactivo (acceso general)',
    'Conexión con WhatsApp': d360Configurado() ? (/sandbox/i.test(process.env.D360_MESSAGES_URL || '') ? 'conectada en modo de prueba (sandbox de 360dialog)' : 'conectada (360dialog)') : 'sin configurar',
    'Celulares que reciben avisos': String(avisos.numeros.length),
    'Plantilla de avisos': avisos.plantilla ? avisos.plantilla + ' (' + avisos.idioma + ')' : 'sin configurar',
    'Correo de contacto de privacidad': priv.correo ? 'cargado' : 'sin cargar',
    'Base inscripta ante la URCDP': priv.urcdp ? 'sí' : 'no',
    'Reglas fijas del sistema': cumplimiento.leerReglas().recomendadas ? 'las recomendadas' : 'modificadas por un administrador'
  };
}
const preguntasAyuda = new Map();   // límite de preguntas por usuario y por hora (protege el costo)
function limiteAyuda() { return Number(process.env.VERDE_AYUDA_LIMITE_HORA) > 0 ? Number(process.env.VERDE_AYUDA_LIMITE_HORA) : 30; }
app.get('/api/ayuda', requiere(['admin', 'asesor']), (req, res) => {
  res.json({ rol: rolDe(req), revisionMeta: ayuda.REVISION_META, articulos: ayuda.articulosPara(rolDe(req)) });
});
app.post('/api/ayuda/preguntar', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const rol = rolDe(req);
    const pregunta = String((req.body && req.body.pregunta) || '').replace(/\s+/g, ' ').trim();
    if (pregunta.length < 3) return res.status(400).json({ error: 'Escribir una pregunta.' });
    if (pregunta.length > 500) return res.status(400).json({ error: 'La pregunta puede tener hasta 500 caracteres.' });
    const clave = req.usuario ? req.usuario.id : 'general';
    const hace1h = Date.now() - 3600000;
    const previas = (preguntasAyuda.get(clave) || []).filter(t => t > hace1h);
    if (previas.length >= limiteAyuda()) return res.status(429).json({ error: 'Se alcanzó el límite de ' + limiteAyuda() + ' preguntas por hora. Intentar más tarde.' });
    previas.push(Date.now());
    preguntasAyuda.set(clave, previas);
    const historial = (Array.isArray(req.body.historial) ? req.body.historial : []).slice(-3);
    const mensajes = [];
    for (const h of historial) {
      const p = String((h && h.pregunta) || '').trim().slice(0, 500), r = String((h && h.respuesta) || '').trim().slice(0, 2500);
      if (p && r) mensajes.push({ role: 'user', content: p }, { role: 'assistant', content: JSON.stringify({ respuesta: r, fuentes: [] }) });
    }
    mensajes.push({ role: 'user', content: pregunta });
    let crudo;
    try { crudo = await bot.callClaude(ayuda.instrucciones(rol, configAyuda()), mensajes, bot.getVerde(), 'claude-sonnet-5-5', 'ayuda'); }
    catch (e) { console.error('Centro de ayuda: la IA no respondió:', e.message); return res.status(502).json({ error: 'El asistente no está disponible en este momento. Intentar de nuevo en unos minutos.' }); }
    res.json(ayuda.interpretar(crudo, rol));
  } catch (e) { responderError(res, e); }
});
app.put('/api/privacidad', requiere(['admin']), (req, res) => {
  try { res.json({ ok: true, privacidad: cumplimiento.guardarPrivacidad(req.body || {}, fmtHoy.format(new Date())) }); }
  catch (e) { responderError(res, e); }
});
// Página pública de privacidad: no pide ingreso (en Nginx, esta ruta también queda sin contraseña).
app.get('/privacidad', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(cumplimiento.paginaPrivacidad());
});

/* ============================================================
   CONVERSACIONES: todos los chats, interruptor de Verde por chat y respuesta desde el panel
   ============================================================ */
function contexto() { return { pendientes: atencion.clavesPendientes(), pausas: bot.pausasVigentes() }; }
function quienEs(req) { return req.usuario ? req.usuario.nombre : 'Acceso general'; }
function claveDeRuta(req) {
  const clave = String(req.params.clave || '');
  if (!conversaciones.claveValida(clave)) { const e = new Error('El chat no es válido.'); e.publico = true; e.codigo = 400; throw e; }
  return clave;
}
// Si el chat todavía no está en el registro (por ejemplo, derivado antes de instalar esta versión), se arma con su atención.
function detalleConversacion(clave) {
  let d = conversaciones.detalle(clave, contexto());
  if (!d) {
    const a = atencion.ultimaPorClave(clave);
    if (a && conversaciones.sembrarDesdeAtencion(a)) d = conversaciones.detalle(clave, contexto());
  }
  return d;
}
function conDatosDelPanel(d, req) {
  if (!d) return d;
  d.verdeGeneral = bot.getVerde().encendido !== false;
  d.firmaUsuario = req.usuario ? (req.usuario.firma || '') : '';
  d.d360 = d360Configurado();
  d.pendienteId = atencion.pendienteId(d.clave);   // para «Marcar atendido» desde la conversación abierta
  // 1.4.0: estado de cada archivo recibido (sin descargar, guardado, vencido…), con una sola lectura del índice.
  const indice = archivos.leerIndice();
  const ctxArchivos = { sandbox: archivos.esSandbox(process.env.D360_MESSAGES_URL) };
  if (Array.isArray(d.mensajes)) d.mensajes = d.mensajes.map(m => m.archivo ? Object.assign({}, m, { archivo: archivos.estado(m.archivo, indice, ctxArchivos) }) : m);
  return d;
}
/* ---------- Archivos recibidos (1.4.0): se descargan de WhatsApp solo cuando alguien toca «Descargar» ---------- */
app.post('/api/archivos/:id/descargar', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const id = String(req.params.id || '');
    const clave = String((req.body && req.body.clave) || '');
    if (!archivos.idValido(id)) return res.status(400).json({ error: 'El archivo no es válido.' });
    const d = detalleConversacion(clave);
    const m = d && (d.mensajes || []).find(x => x.archivo && x.archivo.id === id);
    if (!m) return res.status(404).json({ error: 'El archivo no existe en esta conversación.' });
    const r = await archivos.descargar(m.archivo, quienEs(req), { messagesUrl: process.env.D360_MESSAGES_URL, apiKey: process.env.D360_API_KEY });
    if (r && r.estado === 'guardado') console.log('Archivos: ' + quienEs(req) + ' descargó un archivo de ' + clave);
    res.json({ ok: r && r.estado === 'guardado', archivo: r });
  } catch (e) { responderError(res, e); }
});
app.get('/api/archivos/:id', requiere(['admin', 'asesor']), (req, res) => {
  const f = archivos.paraServir(req.params.id);
  if (!f) return res.status(404).json({ error: 'El archivo no está guardado en el panel.' });
  const enPanel = f.enPanel && req.query.guardar !== '1';
  const ascii = f.nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', f.enPanel ? f.mime : 'application/octet-stream');   // los formatos que no se muestran nunca se interpretan
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', (enPanel ? 'inline' : 'attachment') + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(f.nombre));
  if (f.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  fs.createReadStream(f.ruta).on('error', () => res.end()).pipe(res);
});

app.get('/api/conversaciones', requiere(['admin', 'asesor']), (req, res) => {
  res.json(conversaciones.lista({ buscar: req.query.buscar, estado: req.query.estado }, contexto()));
});
app.get('/api/conversaciones/:clave', requiere(['admin', 'asesor']), (req, res) => {
  try {
    const d = detalleConversacion(claveDeRuta(req));
    if (!d) return res.status(404).json({ error: 'La conversación no existe.' });
    res.json(conDatosDelPanel(d, req));
  } catch (e) { responderError(res, e); }
});
app.post('/api/conversaciones/:clave/apagar', requiere(['admin', 'asesor']), (req, res) => {
  try {
    const clave = claveDeRuta(req);
    if (!detalleConversacion(clave)) return res.status(404).json({ error: 'La conversación no existe.' });
    conversaciones.apagar(clave, req.usuario);
    console.log('Panel: ' + quienEs(req) + ' apagó a Verde en el chat ' + clave);
    res.json({ ok: true, conversacion: conDatosDelPanel(detalleConversacion(clave), req) });
  } catch (e) { responderError(res, e); }
});
app.post('/api/conversaciones/:clave/encender', requiere(['admin', 'asesor']), (req, res) => {
  try {
    const clave = claveDeRuta(req);
    conversaciones.encender(clave, req.usuario);
    console.log('Panel: ' + quienEs(req) + ' encendió a Verde en el chat ' + clave);
    res.json({ ok: true, conversacion: conDatosDelPanel(detalleConversacion(clave), req) });
  } catch (e) { responderError(res, e); }
});
// Después de «Devolver a Verde»: si la última palabra del chat fue del cliente, Verde la responde enseguida.
async function responderConsultaPendiente(clave) {
  const sin = motivo => ({ respondio: false, derivo: false, motivo: motivo || '' });
  const d = detalleConversacion(clave);
  if (!d) return sin();
  const ultimo = (d.mensajes || []).filter(m => m.tipo !== 'sistema').pop();
  if (!ultimo || ultimo.tipo !== 'cliente') return sin();   // no quedó ninguna consulta sin responder
  if (/^\[El cliente envió /.test(ultimo.texto)) return sin('La última consulta es un archivo: Verde no interpreta archivos y responde cuando el cliente escriba.');
  if (bot.getVerde().encendido === false) return sin('Verde está apagado para todos los chats desde «Comportamiento del bot».');
  if (conversaciones.estaApagado(clave) || atencion.tienePendiente(clave)) return sin();
  if (!d360Configurado()) return sin('La conexión con WhatsApp (360dialog) no está configurada en el servidor.');
  if (!d.puedeResponder) return sin(d.motivoNoResponder);
  const r = await bot.responderPendiente(clave, { puedeResponder: () => !conversaciones.estaApagado(clave) && !atencion.tienePendiente(clave) });
  if (!r) return sin();
  const enviado = conPresentacion(clave, r.texto);
  const ok = await enviarWhatsApp(d.destino, enviado);
  console.log('360 >> (chat devuelto a Verde)', ok ? 'enviado' : 'NO enviado', ':', enviado.slice(0, 200));
  if (!ok) return sin('WhatsApp no aceptó la respuesta de Verde. Si el cliente vuelve a escribir, Verde le responde.');
  conversaciones.registrar({ clave, tipo: 'verde', texto: enviado });
  if (r.derivar) {
    const a = atencion.derivar({ clave, destino: d.destino, numero: d.numero, nombre: d.nombre, mensajeCliente: ultimo.texto, respuestaVerde: r.texto,
      motivo: r.error ? 'Verde tuvo un problema técnico y lo derivó a una persona del equipo.' : 'Verde lo derivó a una persona del equipo.' });
    console.log('360 → derivado: pasa a «Chats por responder»');
    await avisarEquipo(a.atencion);
  }
  return { respondio: true, derivo: !!r.derivar, motivo: '' };
}
// «Devolver a Verde»: termina la pausa de 12 horas y, si el cliente dejó una consulta sin responder, Verde la responde enseguida.
app.post('/api/conversaciones/:clave/reanudar', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const clave = claveDeRuta(req);
    if (!detalleConversacion(clave)) return res.status(404).json({ error: 'La conversación no existe.' });
    let verde = { respondio: false, derivo: false, motivo: '' };
    if (bot.quitarPausa(clave)) {
      conversaciones.cerrarEsperaDePausa(clave);
      conversaciones.anotarSistema(clave, quienEs(req) + ' devolvió el chat a Verde.');
      console.log('Panel: ' + quienEs(req) + ' devolvió el chat ' + clave + ' a Verde');
      // Pasa por la misma cola que los mensajes del cliente, para no cruzarse con uno que llegue en ese momento.
      verde = (await enColaCliente(clave, () => responderConsultaPendiente(clave))) || verde;
    }
    res.json({ ok: true, conversacion: conDatosDelPanel(detalleConversacion(clave), req), verde });
  } catch (e) { responderError(res, e); }
});
// Respuesta de una persona del equipo desde el panel (solo texto, con su firma).
app.post('/api/conversaciones/:clave/responder', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const clave = claveDeRuta(req);
    const d = detalleConversacion(clave);
    if (!d) return res.status(404).json({ error: 'La conversación no existe.' });
    if (!d360Configurado()) return res.status(503).json({ error: 'La conexión con WhatsApp (360dialog) no está configurada en el servidor.' });
    if (!d.puedeResponder) return res.status(409).json({ error: d.motivoNoResponder });
    let texto = String((req.body && req.body.texto) || '').replace(/\r\n/g, '\n').trim();
    if (!texto) return res.status(400).json({ error: 'Escribir el mensaje antes de enviar.' });
    if (texto.length > 3900) return res.status(400).json({ error: 'El mensaje es demasiado largo (máximo 3900 caracteres).' });
    const u = req.usuario;
    const firma = u && u.firma ? String(u.firma).trim() : '';
    if (firma && !texto.endsWith(firma)) texto = texto + '\n' + firma;
    // La pausa se pone antes de enviar: si Verde estaba preparando una respuesta, la descarta.
    const habiaPausa = bot.estaPausado(clave);
    bot.pausar(clave, PAUSA_HORAS);
    const ok = await enviarWhatsApp(d.destino, texto);
    if (!ok) {
      if (!habiaPausa) bot.quitarPausa(clave);
      return res.status(502).json({ error: 'WhatsApp no aceptó el mensaje. Probar de nuevo en unos segundos.' });
    }
    bot.registrarMensaje(clave, 'assistant', '[Asesor humano] ' + texto);
    conversaciones.registrar({ clave, tipo: 'equipo', texto, autor: quienEs(req), origen: 'panel', firma: !!firma });
    const cerrada = atencion.respuestaEquipo({ clave, texto, firma: u ? { usuarioId: u.id, nombre: u.nombre, firma } : null, origen: 'panel' });
    console.log('Panel: ' + quienEs(req) + ' respondió a ' + clave + (cerrada && cerrada.estado === 'respondido' ? ' · el chat pasa a «Chats respondidos»' : ''));
    res.json({ ok: true, conversacion: conDatosDelPanel(detalleConversacion(clave), req) });
  } catch (e) { responderError(res, e); }
});

/* ---------- Resguardo: el cliente espera 5 minutos sin respuesta con Verde apagado o en pausa en su chat ---------- */
let revisandoEsperas = false;
async function revisarEsperas() {
  if (revisandoEsperas) return;
  revisandoEsperas = true;
  try {
    for (const c of conversaciones.esperasVencidas()) {
      if (atencion.tienePendiente(c.clave)) { conversaciones.cerrarEspera(c.clave, null); continue; }
      const porPausa = !c.apagado;
      const textos = conversaciones.mensajesClienteDesde(c.clave, c.esperaDesde);
      const d = atencion.derivar({ clave: c.clave, destino: c.destino, numero: c.numero, nombre: c.nombre, mensajeCliente: textos[0] || '',
        motivo: porPausa ? 'Verde estaba en pausa en este chat y el cliente esperó 5 minutos sin respuesta.' : 'Verde está apagado en este chat y el cliente esperó 5 minutos sin respuesta.' });
      for (const t of textos.slice(1)) atencion.mensajeCliente({ clave: c.clave, texto: t });
      conversaciones.cerrarEspera(c.clave, 'El cliente esperó 5 minutos sin respuesta: el chat pasó a «Chats por responder».');
      console.log('Resguardo: el chat ' + c.clave + ' pasó a «Chats por responder» (' + (porPausa ? 'Verde en pausa' : 'Verde apagado') + ' y 5 minutos sin respuesta)');
      await avisarEquipo(d.atencion, porPausa ? 'Verde en pausa en ese chat' : 'Verde apagado en ese chat');
    }
  } catch (e) {
    console.error('No se pudieron revisar las esperas de 5 minutos:', e.message);
  } finally {
    revisandoEsperas = false;
  }
}
setInterval(revisarEsperas, 30000).unref();

/* ---------- Borrado automático del historial (3 meses) ---------- */
function purgarHistorial() {
  try {
    const n = atencion.purgar();
    if (n) console.log('Historial: se borraron ' + n + ' chats de más de 3 meses.');
    const m = conversaciones.purgar();
    if (m) console.log('Conversaciones: se borraron ' + m + ' chats sin movimiento hace más de 3 meses.');
    const f = archivos.limpiar();
    if (f) console.log('Archivos: se borraron ' + f + ' archivos de más de 3 meses.');
  } catch (e) { console.error('No se pudo limpiar el historial:', e.message); }
}
purgarHistorial();
setInterval(purgarHistorial, 6 * 3600 * 1000).unref();

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
  console.log('  Ingreso con usuario propio: ' + (loginActivo() ? 'ACTIVO' : 'inactivo (el panel lo protege Nginx)'));
  console.log('====================================================');
});

// Para las pruebas automáticas (no cambia el funcionamiento).
module.exports = { app, revisarEsperas };
