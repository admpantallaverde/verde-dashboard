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
 *   8. 1.4.15: verificación en 2 pasos obligatoria, registro de accesos y respaldo
 *      diario cifrado de los datos (clave VERDE_RESPALDO_CLAVE en .env).
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
const recursos = require('./recursos');   // 1.4.8: biblioteca de recursos
const envios = require('./envios');       // 1.4.8: envío de archivos por WhatsApp
const usuarios = require('./usuarios.js');
const atencion = require('./atencion.js');
const conversaciones = require('./conversaciones.js');
const accesos = require('./accesos.js');       // 1.4.15: registro de accesos
const respaldos = require('./respaldos.js');   // 1.4.15: respaldo diario cifrado

const VERSION = '1.4.16';
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
function agenteDe(req) { return String(req.headers['user-agent'] || '').slice(0, 300); }
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

// 1.4.15: anota un intento fallido (y el bloqueo, si este intento lo produjo) en el registro de accesos.
function anotarFallo(req, tipo, r) {
  if (r.motivo !== 'incorrecto' && !r.nuevoBloqueo) return;   // los intentos durante un bloqueo no se anotan uno por uno
  const up = r.usuarioPublico;
  const base = { usuarioId: up ? up.id : null, usuario: up ? up.usuario : r.usuarioTexto, nombre: up ? up.nombre : '', ip: ipDe(req), agente: agenteDe(req) };
  accesos.registrar(Object.assign({ tipo }, base));
  if (r.nuevoBloqueo) accesos.registrar(Object.assign({ tipo: 'bloqueo' }, base));
}
const ERROR_BLOQUEO = 'Demasiados intentos fallidos. Probar de nuevo en 15 minutos.';

// Paso 1: usuario y contraseña. Ya no abre sesión: devuelve el segundo paso (código o configuración).
app.post('/api/login', (req, res) => {
  const b = req.body || {};
  const r = usuarios.ingresar(b.usuario, b.clave, ipDe(req));
  if (!r.ok) {
    anotarFallo(req, 'clave_incorrecta', r);
    const bloqueado = r.motivo === 'bloqueado';
    return res.status(bloqueado ? 429 : 401).json({ error: bloqueado ? ERROR_BLOQUEO : 'Usuario o contraseña incorrectos.' });
  }
  const out = { ok: true, paso: r.paso, desafio: r.desafio, usuario: { nombre: r.usuario.nombre, usuario: r.usuario.usuario } };
  if (r.paso === 'configurar') { out.secreto = r.secreto; out.claveEnGrupos = r.claveEnGrupos; out.direccion = r.direccion; }
  res.json(out);
});
// Paso 2: código de la app, código de recuperación o activación de la verificación (primera vez).
function rutaSegundoPaso(modo) {
  return (req, res) => {
    const b = req.body || {};
    const r = usuarios.segundoPaso(b.desafio, b.codigo, ipDe(req), modo);
    if (!r.ok) {
      anotarFallo(req, 'codigo_incorrecto', r);
      if (r.motivo === 'vencido') return res.status(410).json({ error: 'El ingreso venció. Volver a escribir el usuario y la contraseña.', vencido: true });
      if (r.motivo === 'bloqueado') return res.status(429).json({ error: ERROR_BLOQUEO, vencido: true });
      return res.status(401).json({ error: modo === 'recuperacion' ? 'El código de recuperación no es válido o ya se usó.' : 'El código no es correcto. Escribir el código que muestra la app en este momento.' });
    }
    ponerCookie(res, r.token);
    const base = { usuarioId: r.usuario.id, usuario: r.usuario.usuario, nombre: r.usuario.nombre, ip: ipDe(req), agente: agenteDe(req) };
    if (modo === 'activar') accesos.registrar(Object.assign({ tipo: 'dos_pasos_activada' }, base));
    if (modo === 'recuperacion') accesos.registrar(Object.assign({ tipo: 'ingreso_recuperacion', detalle: r.restantes === 1 ? 'queda 1' : 'quedan ' + r.restantes }, base));
    else accesos.registrar(Object.assign({ tipo: 'ingreso' }, base));
    const out = { ok: true, usuario: r.usuario };
    if (r.codigos) out.codigos = r.codigos;
    if (r.restantes !== undefined) out.restantes = r.restantes;
    res.json(out);
  };
}
app.post('/api/login/codigo', rutaSegundoPaso('codigo'));
app.post('/api/login/recuperacion', rutaSegundoPaso('recuperacion'));
app.post('/api/login/activar', rutaSegundoPaso('activar'));
app.post('/api/logout', (req, res) => {
  const token = leerCookie(req);
  if (req.usuario) accesos.registrar({ tipo: 'salida', usuarioId: req.usuario.id, usuario: req.usuario.usuario, nombre: req.usuario.nombre, ip: ipDe(req), agente: agenteDe(req) });
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
// 1.4.15: si alguien perdió o cambió el celular. Cierra sus sesiones; en el próximo ingreso la configura de nuevo.
app.post('/api/usuarios/:id/restablecer-2pasos', requiere(['admin']), (req, res) => {
  try {
    const u = usuarios.restablecerDosPasos(req.params.id);
    accesos.registrar({ tipo: 'dos_pasos_restablecida', usuarioId: u.id, usuario: u.usuario, nombre: u.nombre, ip: ipDe(req), agente: agenteDe(req), porNombre: quienEs(req) });
    console.log('Panel: ' + quienEs(req) + ' restableció la verificación en 2 pasos de ' + u.usuario);
    res.json({ ok: true, usuario: u });
  } catch (e) { responderError(res, e); }
});

/* ---------- 1.4.15: registro de accesos (solo administradores) ---------- */
app.get('/api/accesos', requiere(['admin']), (req, res) => {
  try {
    const q = req.query || {};
    const r = accesos.consultar({ usuario: q.usuario, grupo: q.evento, dias: q.dias });
    r.usuarios = usuarios.listar().map(u => ({ id: u.id, nombre: u.nombre, usuario: u.usuario }));
    res.json(r);
  } catch (e) { responderError(res, e); }
});

/* ---------- 1.4.15: respaldos (solo administradores) ---------- */
app.get('/api/respaldos', requiere(['admin']), (req, res) => {
  try { res.json(respaldos.estado()); } catch (e) { responderError(res, e); }
});
app.post('/api/respaldos', requiere(['admin']), (req, res) => {
  if (!respaldos.claveConfigurada()) return res.status(400).json({ error: 'Falta configurar la clave de cifrado de los respaldos en el servidor.' });
  if (respaldos.estado().enCurso) return res.status(409).json({ error: 'Ya hay un respaldo en curso.' });
  respaldos.crear({ automatico: false, porNombre: quienEs(req) }).catch(e => console.error('Respaldo manual:', e.message));
  console.log('Panel: ' + quienEs(req) + ' pidió un respaldo ahora');
  res.json({ ok: true, estado: respaldos.estado() });
});
const DIA_LARGO = new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', weekday: 'long', day: '2-digit', month: '2-digit' });
app.get('/api/respaldos/:archivo', requiere(['admin']), (req, res) => {
  try {
    const d = respaldos.prepararDescarga(req.params.archivo, { id: req.usuario ? req.usuario.id : null, nombre: quienEs(req) });
    if (!d) return res.status(404).json({ error: 'Ese respaldo no existe.' });
    accesos.registrar({ tipo: 'descarga_respaldo', usuarioId: req.usuario ? req.usuario.id : null, usuario: req.usuario ? req.usuario.usuario : '', nombre: quienEs(req), ip: ipDe(req), agente: agenteDe(req), detalle: DIA_LARGO.format(new Date(d.fechaRespaldo)).replace(',', '') });
    console.log('Panel: ' + quienEs(req) + ' descargó el respaldo ' + d.nombre);
    res.download(d.ruta, d.nombre);
  } catch (e) { responderError(res, e); }
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
    respaldos: respaldos.claveConfigurada(),     // 1.4.15: ¿está la clave de cifrado de los respaldos?
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
    const r = await bot.responderCliente('sim:' + from, message, { modelo: modelo || undefined, presentacion: primera ? cumplimiento.lineaInicial(bot.getVerde()) : null, biblioteca: true });
    if (!r) return res.json({ reply: '(Verde está apagado y no enviaría ninguna respuesta.)', derivaria: false });
    res.json({
      reply: r.texto + (primera ? '\n\n' + cumplimiento.lineaInicial(bot.getVerde()) : '') + (r.reclamo ? '\n\n(Ficha del reclamo que vería el asesor: ' + Object.entries(r.reclamo).map(([k, v]) => k + ': ' + v).join(' · ') + ')' : '') + (r.recurso ? '\n\n(Verde enviaría el archivo «' + r.recurso.nombre + '» (' + (r.recurso.mime === 'application/pdf' ? 'PDF' : 'imagen') + ') junto con este mensaje' + (puedeEnviarArchivos() ? '.)' : '; en el modo de prueba de 360dialog no se envían archivos.)') : '') + (r.consulta ? '\n\n(Ficha de la consulta que vería el asesor: ' + ['tipo: ' + r.consulta.tipo].concat(r.consulta.campos.filter(c => c.valor).map(c => c.dato + ': ' + c.valor), r.consulta.notas ? ['notas: ' + r.consulta.notas] : []).join(' · ') + ')' : '') + ((r.derivar || r.reclamo) ? '\n\n(Este chat pasaría a «Chats por responder».)' : ''),
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
  if (motivo === 'reclamo de garantía') return 'Reclamo de garantía: Verde juntó los datos para el asesor';
  if (motivo === 'consulta de reparación') return 'Consulta de reparación: Verde juntó los datos para el asesor';
  if (motivo === 'consulta de compra') return 'Consulta de compra: Verde juntó los datos para el asesor';
  if (motivo === 'archivo no enviado') return 'Verde no pudo enviar un archivo: hay que enviarlo desde el panel';
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
function yaHuboRespuesta(clave) {
  const d = conversaciones.detalle(clave, contexto());
  return !!(d && (d.mensajes || []).some(m => m.tipo === 'verde' || m.tipo === 'equipo'));
}
function conPresentacion(clave, texto) {
  return yaHuboRespuesta(clave) ? texto : (texto ? texto + '\n\n' : '') + cumplimiento.lineaInicialWhatsApp(bot.getVerde());
}
// 1.4.7: si la respuesta va a llevar la presentación, Verde lo sabe y no se presenta por su cuenta.
function presentacionPara(clave) { return yaHuboRespuesta(clave) ? null : cumplimiento.lineaInicial(bot.getVerde()); }
/* ---------- 1.4.8: envío de archivos ---------- */
function conexion360() { return { messagesUrl: process.env.D360_MESSAGES_URL, apiKey: process.env.D360_API_KEY }; }
// Solo con el número real: el modo de prueba (sandbox) de 360dialog no permite enviar archivos.
function puedeEnviarArchivos() { return d360Configurado() && envios.disponible(conexion360()); }
function estadoEnvio() {
  return { disponible: puedeEnviarArchivos(), modoPrueba: d360Configurado() && archivos.esSandbox(process.env.D360_MESSAGES_URL),
    pdfMB: recursos.TIPOS['application/pdf'].maxMB, imagenMB: recursos.TIPOS['image/png'].maxMB };
}
// Envía la respuesta de Verde. Si trae un recurso de la biblioteca, lo envía con el texto como comentario (si el texto
// es largo, primero el texto y después el archivo). Si el archivo no sale, el texto sale igual y se avisa.
// 1.4.9: aclaración que recibe el cliente cuando un archivo no sale (Verde nunca deja una promesa sin cumplir).
const AVISO_ARCHIVO_FALLIDO = 'No pude enviar el archivo en este momento: una persona del equipo te lo envía en breve.';
async function enviarRespuestaVerde(clave, destino, texto, recurso) {
  const res = { ok: false, archivoFallido: null };
  const conTexto = async t => { const ok = await enviarWhatsApp(destino, t); if (ok) conversaciones.registrar({ clave, tipo: 'verde', texto: t }); return ok; };
  const fallo = async t => {
    res.archivoFallido = recurso.nombre;
    bot.corregirEnvioFallido(clave, recurso.nombre);
    const ok = await conTexto((t ? t + '\n\n' : '') + AVISO_ARCHIVO_FALLIDO);
    res.ok = res.ok || ok;
  };
  const info = recurso && puedeEnviarArchivos() ? recursos.paraEnviar(recurso.id) : null;
  if (!info) {
    if (recurso) await fallo(texto);
    else if (texto) res.ok = await conTexto(texto);
    return res;
  }
  const comoLeyenda = !!texto && texto.length <= envios.LEYENDA_MAX;
  if (texto && !comoLeyenda) res.ok = await conTexto(texto);
  try {
    const mediaId = await envios.subir(info.buf, info.mime, info.nombre, conexion360());
    if (await enviar360(envios.cuerpoMedia(baseDestino(destino), mediaId, info.mime, info.nombre, comoLeyenda ? texto : ''))) {
      const a = Object.assign(archivos.registrarEnviado(info.buf, info.mime, info.nombre, 'Verde'), { biblioteca: true });
      conversaciones.registrar({ clave, tipo: 'verde', texto: comoLeyenda ? texto : '', archivo: a, origen: 'biblioteca' });
      res.ok = true;
      return res;
    }
  } catch (e) { console.error('Verde no pudo enviar el archivo «' + info.nombre + '»:', e.message); }
  await fallo(comoLeyenda ? texto : '');
  return res;
}
// Si Verde no pudo enviar un archivo, queda anotado y el chat pasa a «Chats por responder» para que lo envíe una persona.
async function archivoNoEnviado(clave, datos, nombreArchivo) {
  conversaciones.anotarSistema(clave, 'Verde no pudo enviar el archivo «' + nombreArchivo + '»: hay que enviarlo desde el panel.');
  if (atencion.tienePendiente(clave)) return;
  const d = atencion.derivar(Object.assign({}, datos, { clave, motivo: 'Verde no pudo enviar el archivo «' + nombreArchivo + '»: una persona del equipo tiene que enviarlo.' }));
  await avisarEquipo(d.atencion, 'archivo no enviado');
}

// Motivo con que se deriva y se avisa al equipo, según la ficha que haya armado Verde.
function motivoDerivacion(r) {
  if (r.error) return 'Verde tuvo un problema técnico y lo derivó a una persona del equipo.';
  if (r.reclamo) return 'Reclamo de garantía: Verde juntó los datos para el asesor.';
  if (r.consulta) return 'Consulta de ' + r.consulta.tipo + ': Verde lo derivó a una persona del equipo con la ficha de la consulta.';
  return 'Verde lo derivó a una persona del equipo.';
}
function claseDeAviso(r) { return r.reclamo ? 'reclamo de garantía' : (r.consulta ? 'consulta de ' + r.consulta.tipo : undefined); }

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

  // 1) 1.4.3: estar en «Chats por responder» ya no calla a Verde. Sigue conversando hasta que responde una persona
  //    del equipo (ahí hace su pausa de 12 horas). Solo lo callan el interruptor del chat y la pausa (pasos 1b y 2).

  // 1b) Verde está apagado en este chat: no responde. Si nadie del equipo responde en 5 minutos,
  //     el resguardo pasa el chat a «Chats por responder» y avisa al equipo.
  if (conversaciones.estaApagado(clave)) {
    bot.registrarMensaje(clave, 'user', textoCliente);
    if (atencion.tienePendiente(clave)) atencion.mensajeCliente({ clave, destino, numero, nombre, texto: textoCliente });
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

  // 3) Archivos (1.4.2): Verde no ve su contenido, pero sigue conversando. El chat queda en «Chats por responder»
  //    con la marca «Archivo para revisar» para que una persona lo revise; el aviso al equipo sale solo la primera vez.
  const pendienteAntes = atencion.tienePendiente(clave);
  const revisionAntes = pendienteAntes && atencion.pendienteRevision(clave);
  let avisoArchivo = null;   // el aviso por un archivo sale después de la respuesta de Verde: si Verde deriva, sale uno solo
  if (info.clase === 'adjunto') {
    if (pendienteAntes) {
      atencion.mensajeCliente({ clave, destino, numero, nombre, texto: textoCliente });
    } else {
      const d = atencion.derivar({ clave, destino, numero, nombre, mensajeCliente: textoCliente, revision: true, motivo: 'El cliente envió ' + info.desc + ': hay un archivo para revisar. Verde sigue conversando.' });
      console.log('360 << archivo de', quien, '→ «Archivo para revisar» en «Chats por responder» (Verde sigue conversando)');
      avisoArchivo = d.atencion;
    }
  } else if (pendienteAntes) {
    atencion.mensajeCliente({ clave, destino, numero, nombre, texto: textoCliente });   // el asesor ve el último mensaje
  }
  const yaAnotado = pendienteAntes || info.clase === 'adjunto';
  const yaDerivado = pendienteAntes && !revisionAntes;
  const estadoChat = yaDerivado ? 'derivado' : (pendienteAntes || avisoArchivo ? 'revision' : null);

  // 4) Verde responde (texto o archivo) y, si deriva, el chat pasa a «Chats por responder» con Verde en espera.
  if (!textoCliente.trim()) { if (avisoArchivo) await avisarEquipo(avisoArchivo); return; }
  console.log('360 << de', quien, ':', textoCliente.slice(0, 200));
  const turno = { clave, destino, numero, nombre, quien, textoCliente, avisoArchivo, yaAnotado, yaDerivado, estadoChat };
  // 1.4.6: con «Tiempo de espera antes de responder», Verde espera por si el cliente sigue escribiendo y responde todo junto.
  if (esperaSegundos() > 0) { encolarEspera(turno); return; }
  await responderTurno(turno);
}

/* ---------- 1.4.6: espera antes de responder (se configura en «Comportamiento del bot › H») ---------- */
const ESPERA_MAX_SEG = 60;         // tope del campo del panel
const ESPERA_TOPE_MS = 90000;      // si el cliente no para de escribir, Verde responde igual a los 90 segundos
const esperas = new Map();         // clave → { turnos, timer, inicio }
function esperaSegundos() {
  const t = (bot.getVerde().tecnico || {});
  const n = parseInt(t.espera, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), ESPERA_MAX_SEG) : 0;
}
function encolarEspera(turno) {
  const e = esperas.get(turno.clave) || { turnos: [], timer: null, inicio: Date.now() };
  e.turnos.push(turno);
  if (e.timer) clearTimeout(e.timer);
  const restante = Math.max(0, Math.min(esperaSegundos() * 1000, ESPERA_TOPE_MS - (Date.now() - e.inicio)));
  e.timer = setTimeout(() => {
    esperas.delete(turno.clave);
    responderAgrupado(e.turnos).catch(err => console.error('No se pudo responder el grupo de mensajes:', err.message));
  }, restante);
  esperas.set(turno.clave, e);
  console.log('360 ⏱ espera de', esperaSegundos(), 's por si el cliente sigue escribiendo (' + e.turnos.length + ' mensaje' + (e.turnos.length === 1 ? '' : 's') + ' en espera)');
}
async function responderAgrupado(turnos) {
  if (!turnos.length) return;
  const ultimo = turnos[turnos.length - 1];
  const sinAnotar = turnos.filter(t => !t.yaAnotado).map(t => t.textoCliente);
  const agrupado = Object.assign({}, ultimo, {
    textoCliente: turnos.map(t => t.textoCliente).join('\n'),
    avisoArchivo: turnos.map(t => t.avisoArchivo).find(Boolean) || null,
    yaAnotado: sinAnotar.length === 0,
    textoSinAnotar: sinAnotar.join('\n')
  });
  if (turnos.length > 1) console.log('360 ⏱ espera cumplida:', turnos.length, 'mensajes de', ultimo.quien, 'se responden juntos');
  await responderTurno(agrupado);
}
async function responderTurno(turno) {
  const { clave, destino, numero, nombre, textoCliente, avisoArchivo, yaAnotado, yaDerivado, estadoChat } = turno;
  // Si mientras la IA prepara la respuesta alguien apaga a Verde en este chat, la respuesta se descarta.
  const r = await bot.responderCliente(clave, textoCliente, { puedeResponder: () => !conversaciones.estaApagado(clave), atencion: estadoChat, presentacion: presentacionPara(clave), biblioteca: puedeEnviarArchivos() });
  if (!r) {
    console.log('360 >> sin respuesta (Verde apagado o una persona del equipo tomó la conversación)');
    if (avisoArchivo) await avisarEquipo(avisoArchivo);
    return;
  }
  const enviado = conPresentacion(clave, r.texto);
  const envio = await enviarRespuestaVerde(clave, destino, enviado, r.recurso);
  const ok = envio.ok;
  console.log('360 >>', ok ? 'enviado' : 'NO enviado', ':', enviado.slice(0, 200) + (r.recurso ? ' · con el archivo «' + r.recurso.nombre + '»' + (envio.archivoFallido ? ' (no se pudo enviar)' : '') : ''));
  // 1.4.4: una ficha de reclamo también deriva (aunque la IA no agregue la marca de derivación).
  const reclamo = r.reclamo || null;
  const consulta = r.consulta || null;   // 1.4.7: la ficha de la consulta se guarda solo si el chat está derivado
  if ((r.derivar || reclamo) && !yaDerivado) {
    const d = atencion.derivar({
      clave, destino, numero, nombre, mensajeCliente: yaAnotado ? null : (turno.textoSinAnotar || textoCliente), respuestaVerde: ok ? r.texto : null,
      motivo: motivoDerivacion(r)
    });
    if (reclamo) atencion.guardarReclamo(clave, reclamo);
    if (consulta) atencion.guardarConsulta(clave, consulta);
    console.log('360 → derivado: pasa a «Chats por responder» (Verde sigue conversando)' + (reclamo ? ' · con ficha de reclamo de garantía' : (consulta ? ' · con ficha de la consulta de ' + consulta.tipo : '')));
    await avisarEquipo(d.atencion, claseDeAviso(r));
  } else {
    if (reclamo && atencion.guardarReclamo(clave, reclamo)) console.log('360 → ficha del reclamo de garantía actualizada');
    if (consulta && atencion.guardarConsulta(clave, consulta)) console.log('360 → ficha de la consulta actualizada');
    if (avisoArchivo) await avisarEquipo(avisoArchivo);
    else if (r.derivar) console.log('360 → el chat ya estaba derivado: Verde sigue conversando sin repetir el aviso');
  }
  if (envio.archivoFallido) await archivoNoEnviado(clave, { destino, numero, nombre, mensajeCliente: yaAnotado ? null : (turno.textoSinAnotar || textoCliente), respuestaVerde: ok ? r.texto : null }, envio.archivoFallido);
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
  const pausas = bot.pausasVigentes(), ahora = Date.now(), encendido = bot.getVerde().encendido !== false;
  // verdeActivo (1.4.3): Verde sigue conversando en ese chat (no está apagado ni en pausa).
  const lista = atencion.pendientes().map(p => Object.assign(p, { apagado: apagados.has(p.clave), verdeActivo: encendido && !apagados.has(p.clave) && !(Number(pausas[p.clave]) > ahora) }));
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
  return { reglas: r.reglas, lineaInicial: r.linea, lineaVista: cumplimiento.completarLinea(r.linea, bot.getVerde()), recomendadas: r.recomendadas, sinEnlace: r.sinEnlace, modificadoEn: r.modificadoEn, modificadoPor: r.modificadoPor,
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
    // 1.4.11: asistente del equipo: conoce la empresa, puede recibir la conversación abierta y usa el modelo y esfuerzo de la sección H.
    const claveChat = String((req.body && req.body.clave) || '').trim();
    const conversacion = claveChat ? ayuda.textoConversacion(detalleConversacion(claveChat)) : '';
    const v = bot.getVerde();
    const asis = bot.configAsistente(v);
    const sistema = ayuda.instrucciones(rol, configAyuda(), { empresa: bot.resumenEmpresa(v, recursos.listar()), conversacion, nombreEmpresa: v.empresa });
    let crudo;
    try { crudo = await bot.callClaude(sistema, mensajes, v, asis.modelo, 'ayuda', { esfuerzo: asis.esfuerzo }); }
    catch (e) { console.error('Centro de ayuda: la IA no respondió:', e.message); return res.status(502).json({ error: 'El asistente no está disponible en este momento. Intentar de nuevo en unos minutos.' }); }
    res.json(ayuda.interpretar(crudo, rol));
  } catch (e) { responderError(res, e); }
});
/* ---------- 1.4.10: corregir y aclarar el texto del asesor con la IA ---------- */
const correcciones = new Map();      // usuario → momentos de sus últimas correcciones
const LIMITE_CORRECCIONES = 30;      // por hora y por usuario
app.post('/api/corregir', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const texto = String((req.body && req.body.texto) || '').replace(/\r\n/g, '\n').trim();
    const tono = String((req.body && req.body.tono) || 'rioplatense');
    if (!texto) return res.status(400).json({ error: 'Escribir el mensaje antes de corregirlo.' });
    if (texto.length > 3900) return res.status(400).json({ error: 'El mensaje es demasiado largo (máximo 3900 caracteres).' });
    if (!bot.TONOS_CORRECCION[tono]) return res.status(400).json({ error: 'El tono no es válido.' });
    const clave = req.usuario ? req.usuario.id : 'general';
    const hace1h = Date.now() - 3600000;
    const previas = (correcciones.get(clave) || []).filter(t => t > hace1h);
    if (previas.length >= LIMITE_CORRECCIONES) return res.status(429).json({ error: 'Se alcanzó el límite de ' + LIMITE_CORRECCIONES + ' correcciones por hora. Intentar más tarde.' });
    previas.push(Date.now());
    correcciones.set(clave, previas);
    const v = bot.getVerde();
    const vc = Object.assign({}, v, { tecnico: Object.assign({}, v.tecnico || {}, { maxTokens: Math.max(2000, (v.tecnico && v.tecnico.maxTokens) || 0) }) });
    let crudo;
    try { crudo = await bot.callClaude(bot.instruccionesCorreccion(tono, v), [{ role: 'user', content: texto }], vc, null, 'correccion'); }
    catch (e) { console.error('Corrección: la IA no respondió:', e.message); return res.status(502).json({ error: 'La IA no está disponible en este momento. El texto quedó como estaba.' }); }
    const corregido = bot.limpiarCorreccion(crudo);
    if (!corregido) return res.status(502).json({ error: 'La IA no devolvió un texto. El texto quedó como estaba.' });
    console.log('Panel: ' + quienEs(req) + ' corrigió un mensaje con la IA (' + tono + ')');
    res.json({ ok: true, texto: corregido.slice(0, 3900), tono });
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
function contexto() { return { pendientes: atencion.clavesPendientes(), revision: atencion.clavesRevision(), pausas: bot.pausasVigentes() }; }
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
  d.envioArchivos = estadoEnvio();   // 1.4.8: si se pueden enviar archivos (no en el modo de prueba) y sus límites
  // 1.4.4: ficha del reclamo de garantía, con la cantidad de archivos que mandó el cliente desde que empezó la atención.
  const rec = atencion.reclamoDe(d.clave);
  d.reclamo = rec ? Object.assign(rec, { pruebas: (d.mensajes || []).filter(m => m.tipo === 'cliente' && m.archivo && m.en >= (rec.creadoEn || 0) - 3600000).length }) : null;
  // 1.4.7: ficha de la consulta, con los archivos que mandó el cliente desde que empezó la atención.
  const con = atencion.consultaDe(d.clave);
  d.consulta = con ? Object.assign(con, { archivos: (d.mensajes || []).filter(m => m.tipo === 'cliente' && m.archivo && m.en >= (con.creadoEn || 0) - 3600000).length }) : null;
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
  if (bot.getVerde().encendido === false) return sin('Verde está apagado para todos los chats desde «Comportamiento del bot».');
  if (conversaciones.estaApagado(clave)) return sin();
  const pend = atencion.tienePendiente(clave), yaDerivado = pend && !atencion.pendienteRevision(clave);
  if (!d360Configurado()) return sin('La conexión con WhatsApp (360dialog) no está configurada en el servidor.');
  if (!d.puedeResponder) return sin(d.motivoNoResponder);
  const r = await bot.responderPendiente(clave, { puedeResponder: () => !conversaciones.estaApagado(clave), atencion: yaDerivado ? 'derivado' : (pend ? 'revision' : null), presentacion: presentacionPara(clave), biblioteca: puedeEnviarArchivos() });
  if (!r) return sin();
  const enviado = conPresentacion(clave, r.texto);
  const envio = await enviarRespuestaVerde(clave, d.destino, enviado, r.recurso);
  const ok = envio.ok;
  console.log('360 >> (chat devuelto a Verde)', ok ? 'enviado' : 'NO enviado', ':', enviado.slice(0, 200));
  if (!ok) return sin('WhatsApp no aceptó la respuesta de Verde. Si el cliente vuelve a escribir, Verde le responde.');
  if ((r.derivar || r.reclamo) && !yaDerivado) {
    const a = atencion.derivar({ clave, destino: d.destino, numero: d.numero, nombre: d.nombre, mensajeCliente: pend ? null : ultimo.texto, respuestaVerde: r.texto,
      motivo: motivoDerivacion(r) });
    if (r.reclamo) atencion.guardarReclamo(clave, r.reclamo);
    if (r.consulta) atencion.guardarConsulta(clave, r.consulta);
    console.log('360 → derivado: pasa a «Chats por responder»');
    await avisarEquipo(a.atencion, claseDeAviso(r));
  } else {
    if (r.reclamo) atencion.guardarReclamo(clave, r.reclamo);
    if (r.consulta) atencion.guardarConsulta(clave, r.consulta);
  }
  if (envio.archivoFallido) await archivoNoEnviado(clave, { destino: d.destino, numero: d.numero, nombre: d.nombre, mensajeCliente: pend ? null : ultimo.texto, respuestaVerde: r.texto }, envio.archivoFallido);
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

/* ---------- 1.4.8: archivos que llegan desde el panel (cuerpo binario, con sus datos en una cabecera) ---------- */
const parserBinario = express.raw({ type: 'application/octet-stream', limit: '26mb' });
function leerBinario(req, res, next) {
  parserBinario(req, res, err => {
    if (err) return res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? 'El archivo supera el tamaño máximo (PDF hasta 25 MB; JPG o PNG hasta 5 MB).' : 'No se pudo leer el archivo.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No llegó ningún archivo.' });
    next();
  });
}
function datosDeCabecera(req, nombre) {
  try { const j = JSON.parse(decodeURIComponent(String(req.headers[nombre] || ''))); return j && typeof j === 'object' ? j : {}; }
  catch (e) { return {}; }
}
function servirArchivo(res, f, guardar) {
  const ascii = f.nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', (guardar ? 'attachment' : 'inline') + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(f.nombre));
  if (f.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  fs.createReadStream(f.ruta).on('error', () => res.end()).pipe(res);
}

/* ---------- 1.4.8: biblioteca de recursos (la editan los administradores; el equipo la usa al adjuntar) ---------- */
function idRecurso(req) { const id = String(req.params.id || ''); if (!recursos.idValido(id)) throw Object.assign(new Error('El recurso no existe.'), { publico: true, codigo: 404 }); return id; }
app.get('/api/recursos', requiere(['admin', 'asesor']), (req, res) => res.json({ lista: recursos.listar(), envio: estadoEnvio() }));
app.post('/api/recursos', requiere(['admin']), leerBinario, (req, res) => {
  try {
    const d = datosDeCabecera(req, 'x-recurso');
    const r = recursos.crear(d, req.body, d.archivo, quienEs(req));
    console.log('Panel: ' + quienEs(req) + ' subió «' + r.nombre + '» a la biblioteca de recursos');
    res.json({ ok: true, recurso: r, lista: recursos.listar() });
  } catch (e) { responderError(res, e); }
});
app.put('/api/recursos/:id', requiere(['admin']), (req, res) => {
  try {
    const r = recursos.editar(idRecurso(req), req.body || {}, null, null, quienEs(req));
    console.log('Panel: ' + quienEs(req) + ' modificó el recurso «' + r.nombre + '»');
    res.json({ ok: true, recurso: r, lista: recursos.listar() });
  } catch (e) { responderError(res, e); }
});
app.post('/api/recursos/:id/archivo', requiere(['admin']), leerBinario, (req, res) => {
  try {
    const d = datosDeCabecera(req, 'x-recurso');
    const r = recursos.editar(idRecurso(req), d, req.body, d.archivo, quienEs(req));
    console.log('Panel: ' + quienEs(req) + ' reemplazó el archivo del recurso «' + r.nombre + '»');
    res.json({ ok: true, recurso: r, lista: recursos.listar() });
  } catch (e) { responderError(res, e); }
});
app.delete('/api/recursos/:id', requiere(['admin']), (req, res) => {
  try {
    const r = recursos.quitar(idRecurso(req));
    console.log('Panel: ' + quienEs(req) + ' quitó «' + r.nombre + '» de la biblioteca de recursos');
    res.json({ ok: true, lista: recursos.listar() });
  } catch (e) { responderError(res, e); }
});
app.get('/api/recursos/:id/archivo', requiere(['admin', 'asesor']), (req, res) => {
  try {
    const f = recursos.paraServir(idRecurso(req));
    if (!f) return res.status(404).json({ error: 'El archivo del recurso no está disponible.' });
    servirArchivo(res, f, req.query.guardar === '1');
  } catch (e) { responderError(res, e); }
});

/* ---------- 1.4.8: enviar un archivo desde el panel (desde la computadora o desde la biblioteca) ---------- */
async function enviarArchivoDelPanel(req, res, clave, archivo) {
  const d = detalleConversacion(clave);
  if (!d) return res.status(404).json({ error: 'La conversación no existe.' });
  if (!d360Configurado()) return res.status(503).json({ error: 'La conexión con WhatsApp (360dialog) no está configurada en el servidor.' });
  if (!puedeEnviarArchivos()) return res.status(409).json({ error: 'En el modo de prueba de 360dialog no se pueden enviar archivos. Se podrán enviar al conectar el número definitivo.' });
  if (!d.puedeResponder) return res.status(409).json({ error: d.motivoNoResponder });
  let texto = String(archivo.texto || '').replace(/\r\n/g, '\n').trim();
  if (texto.length > 1000) return res.status(400).json({ error: 'El texto que acompaña al archivo puede tener hasta 1000 caracteres.' });
  const u = req.usuario;
  const firma = u && u.firma ? String(u.firma).trim() : '';
  if (firma && !texto.endsWith(firma)) texto = texto ? texto + '\n' + firma : firma;
  // La pausa se pone antes de enviar, como con los mensajes de texto: si Verde estaba preparando una respuesta, la descarta.
  const habiaPausa = bot.estaPausado(clave);
  bot.pausar(clave, PAUSA_HORAS);
  try {
    const mediaId = await envios.subir(archivo.buf, archivo.mime, archivo.nombre, conexion360());
    const ok = await enviar360(envios.cuerpoMedia(baseDestino(d.destino), mediaId, archivo.mime, archivo.nombre, texto));
    if (!ok) throw Object.assign(new Error('WhatsApp no aceptó el archivo. Probar de nuevo en unos segundos.'), { publico: true, codigo: 502 });
  } catch (e) {
    if (!habiaPausa) bot.quitarPausa(clave);
    return responderError(res, e);
  }
  const a = archivos.registrarEnviado(archivo.buf, archivo.mime, archivo.nombre, quienEs(req));
  if (archivo.origen === 'biblioteca') a.biblioteca = true;
  bot.registrarMensaje(clave, 'assistant', '[Asesor humano] [Archivo enviado: «' + archivo.nombre + '»]' + (texto ? ' ' + texto : ''));
  conversaciones.registrar({ clave, tipo: 'equipo', texto, autor: quienEs(req), origen: 'panel', firma: !!firma, archivo: a });
  const cerrada = atencion.respuestaEquipo({ clave, texto: texto || '[Archivo] ' + archivo.nombre, firma: u ? { usuarioId: u.id, nombre: u.nombre, firma } : null, origen: 'panel' });
  console.log('Panel: ' + quienEs(req) + ' envió el archivo «' + archivo.nombre + '» a ' + clave + (archivo.origen === 'biblioteca' ? ' (desde la biblioteca)' : '') + (cerrada && cerrada.estado === 'respondido' ? ' · el chat pasa a «Chats respondidos»' : ''));
  res.json({ ok: true, conversacion: conDatosDelPanel(detalleConversacion(clave), req) });
}
app.post('/api/conversaciones/:clave/archivo', requiere(['admin', 'asesor']), leerBinario, async (req, res) => {
  try {
    const d = datosDeCabecera(req, 'x-archivo');
    const f = recursos.validarArchivo(req.body, d.nombre);
    await enviarArchivoDelPanel(req, res, claveDeRuta(req), { buf: req.body, mime: f.mime, nombre: f.nombre, texto: d.texto, origen: 'computadora' });
  } catch (e) { responderError(res, e); }
});
app.post('/api/conversaciones/:clave/recurso', requiere(['admin', 'asesor']), async (req, res) => {
  try {
    const id = String((req.body && req.body.recursoId) || '');
    const f = recursos.idValido(id) ? recursos.paraEnviar(id) : null;
    if (!f) return res.status(404).json({ error: 'El recurso ya no está en la biblioteca.' });
    await enviarArchivoDelPanel(req, res, claveDeRuta(req), { buf: f.buf, mime: f.mime, nombre: f.nombre, texto: req.body && req.body.texto, origen: 'biblioteca' });
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

respaldos.programar();   // 1.4.15: respaldo automático todas las noches a las 03:30

app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('  Dashboard + Bot Verde funcionando ✅ (versión ' + VERSION + ')');
  console.log('  Atiende en http://' + HOST + ':' + PORT + ' (solo interno; el acceso público pasa por Nginx)');
  console.log('  Webhook Twilio:  POST /webhook');
  console.log('  Webhook 360dialog:  ' + (d360Configurado() ? 'configurado' : 'pendiente (faltan datos en .env)'));
  console.log('  Clave de IA cargada: ' + (process.env.ANTHROPIC_API_KEY ? 'SÍ' : 'NO (configurá .env)'));
  console.log('  Pausa cuando responde una persona del equipo: ' + PAUSA_HORAS + ' horas');
  console.log('  Ingreso con usuario propio: ' + (loginActivo() ? 'ACTIVO, con verificación en 2 pasos' : 'inactivo (el panel lo protege Nginx)'));
  console.log('  Respaldos automáticos (03:30): ' + (respaldos.claveConfigurada() ? 'ACTIVOS, cifrados' : 'pendientes (falta VERDE_RESPALDO_CLAVE en .env)'));
  console.log('====================================================');
});

// Para las pruebas automáticas (no cambia el funcionamiento).
module.exports = { app, revisarEsperas };
