/**
 * Archivos recibidos (versión 1.4.0).
 *
 * Ningún archivo se guarda automáticamente. Cuando un cliente envía una foto, un audio, un video o un documento,
 * solo se registran sus datos (identificador de WhatsApp, tipo, nombre, comentario y huella de control).
 * El archivo se descarga de WhatsApp y se guarda únicamente cuando alguien toca «Descargar» en el panel,
 * y se borra a los 3 meses de recibido, igual que las conversaciones.
 *
 * Seguridad: cada archivo se guarda con un nombre aleatorio (nunca con el nombre que puso el cliente), se comprueba
 * la huella de control que informa WhatsApp, se respeta un tamaño máximo, y solo se muestran dentro del panel los
 * formatos que el navegador no ejecuta; el resto se ofrece únicamente para guardar.
 *
 * 1.4.1: el modo de prueba (sandbox) de 360dialog no permite descargar archivos (lo indica su documentación), así
 * que en ese modo no se hace ningún pedido. Y como 360dialog bloquea por una hora la descarga si hay más de 5
 * pedidos rechazados en una hora, el sistema se frena solo después de 4 rechazos.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DIR = path.join(DATA_DIR, 'archivos');
const INDICE = path.join(DATA_DIR, 'archivos.json');
const RETENCION_MS = 90 * 24 * 3600000;    // 3 meses, igual que las conversaciones
const DISPONIBLE_MS = 7 * 24 * 3600000;    // plazo informado por 360dialog para descargar un archivo recibido
const TIPOS = ['image', 'audio', 'video', 'document'];
const EXTENSIONES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf', 'text/plain': 'txt',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
};
// Formatos que se muestran dentro del panel. Cualquier otro se entrega solo para guardar en la computadora.
const EN_PANEL = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'video/mp4', 'video/3gpp', 'application/pdf']);
const NOMBRE_TIPO = { image: 'imagen', audio: 'audio', video: 'video', document: 'documento' };
const FALLOS_MAX = 4;                       // 360dialog bloquea una hora a partir del 6.º rechazo en una hora
const VENTANA_FALLOS = 3600000;
let fallos = [];                            // momentos de los pedidos rechazados en la última hora
function frenoHasta(ahora) {
  ahora = ahora || Date.now();
  fallos = fallos.filter(t => t > ahora - VENTANA_FALLOS);
  return fallos.length >= FALLOS_MAX ? fallos[0] + VENTANA_FALLOS : null;
}
function anotarFallo() { fallos.push(Date.now()); }
function esSandbox(url) { try { return /(^|\.)waba-sandbox\./i.test(new URL(url).host); } catch (e) { return false; } }

function error(msg, codigo) { const e = new Error(msg); e.publico = true; e.codigo = codigo || 400; return e; }
function maxMB() { const mb = Number(process.env.VERDE_ARCHIVO_MAX_MB); return mb > 0 ? mb : 25; }
function mimeBase(m) { return String(m || '').split(';')[0].trim().toLowerCase(); }
function limpiarNombre(n) {
  return String(n || '').replace(/[\\/\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
}
function idValido(id) { return /^[a-f0-9]{24}$/.test(String(id || '')); }

/* ---------- Al llegar el mensaje: solo los datos, sin el archivo ---------- */
function desdeWebhook(msg) {
  const tipo = msg && msg.type;
  const m = tipo && msg[tipo];
  if (!TIPOS.includes(tipo) || !m || !m.id) return null;
  return {
    id: crypto.randomBytes(12).toString('hex'),
    tipo,
    mediaId: String(m.id).slice(0, 200),
    mime: mimeBase(m.mime_type).slice(0, 120),
    sha256: typeof m.sha256 === 'string' ? m.sha256.slice(0, 200) : '',
    nombre: limpiarNombre(m.filename),
    leyenda: typeof m.caption === 'string' ? m.caption.slice(0, 500) : '',
    recibido: Date.now()
  };
}

/* ---------- Índice de archivos guardados ---------- */
function leerIndice() {
  try { const d = JSON.parse(fs.readFileSync(INDICE, 'utf8')); return d && typeof d === 'object' ? d : {}; }
  catch (e) { return {}; }
}
function guardarIndice(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = INDICE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, INDICE);
}
function rutaDe(info) { return info && info.archivo ? path.join(DIR, path.basename(info.archivo)) : null; }

// Estado de un archivo para el panel. «indice» permite resolver muchos mensajes con una sola lectura.
// «contexto.sandbox»: la conexión es el modo de prueba de 360dialog, que no permite descargar archivos.
function estado(a, indice, contexto) {
  if (!a || !idValido(a.id)) return null;
  const i = (indice || leerIndice())[a.id];
  const base = { id: a.id, tipo: a.tipo, mime: a.mime, nombre: a.nombre, leyenda: a.leyenda, recibido: a.recibido, limite: a.recibido + DISPONIBLE_MS, enPanel: EN_PANEL.has(a.mime) };
  if (i && i.guardado && fs.existsSync(rutaDe(i))) return Object.assign(base, { estado: 'guardado', mime: i.mime, enPanel: EN_PANEL.has(i.mime), tamano: i.tamano, guardadoPor: i.por || '' });
  if (contexto && contexto.sandbox) return Object.assign(base, { estado: 'sandbox' });
  if (i && i.vencido) return Object.assign(base, { estado: 'vencido' });
  if (i && i.grande) return Object.assign(base, { estado: 'grande', error: i.error });
  const freno = frenoHasta();
  if (freno) return Object.assign(base, { estado: 'frenado', hasta: freno });
  if (i && i.error) base.error = i.error;
  return Object.assign(base, { estado: Date.now() > base.limite ? 'antiguo' : 'pendiente' });
}
function anotar(a, datos) {
  const ind = leerIndice();
  ind[a.id] = Object.assign({ recibido: a.recibido, tipo: a.tipo, nombre: a.nombre }, datos);
  guardarIndice(ind);
}

/* ---------- Descarga a pedido ---------- */
async function pedir(url, opciones) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 30000);
  try { return await fetch(url, Object.assign({}, opciones, { signal: control.signal })); }
  finally { clearTimeout(t); }
}
function huellaCoincide(buf, esperada) {
  if (!esperada || process.env.VERDE_ARCHIVO_VERIFICAR === 'no') return true;
  const h = crypto.createHash('sha256').update(buf).digest();
  return h.toString('hex') === esperada.toLowerCase() || h.toString('base64') === esperada;
}
const enCurso = new Map();   // evita descargar dos veces el mismo archivo si dos personas tocan a la vez

function descargar(a, quien, conexion) {
  if (!a || !idValido(a.id) || !a.mediaId) return Promise.reject(error('El archivo no es válido.'));
  if (enCurso.has(a.id)) return enCurso.get(a.id);
  const p = descargarAhora(a, quien, conexion || {}).finally(() => enCurso.delete(a.id));
  enCurso.set(a.id, p);
  return p;
}
async function descargarAhora(a, quien, conexion) {
  const previo = leerIndice()[a.id];
  if (previo && previo.guardado && fs.existsSync(rutaDe(previo))) return estado(a);
  if (!conexion.messagesUrl || !conexion.apiKey) throw error('La conexión con WhatsApp no está configurada.');
  if (esSandbox(conexion.messagesUrl)) return estado(a, null, { sandbox: true });   // el sandbox no entrega archivos
  if (frenoHasta()) return estado(a);   // freno de seguridad activo: no se hace ningún pedido
  const origen = new URL(conexion.messagesUrl).origin;
  const cab = { 'D360-API-KEY': conexion.apiKey };
  const tope = maxMB() * 1024 * 1024;
  const grande = () => { anotar(a, { grande: true, error: 'El archivo supera ' + maxMB() + ' MB: verlo en el WhatsApp de la tienda.' }); return estado(a); };
  const vencido = () => { anotar(a, { vencido: Date.now() }); return estado(a); };
  let resp, mime = a.mime, huella = a.sha256;
  try {
    {
      // Cloud API. Paso 1: pedir la dirección del archivo con su identificador. Paso 2: descargarlo desde 360dialog.
      const r1 = await pedir(origen + '/' + encodeURIComponent(a.mediaId), { headers: cab });
      if ([400, 404, 410].includes(r1.status)) { anotarFallo(); return vencido(); }   // 400: no reintentar (documentación)
      if (!r1.ok) { anotarFallo(); throw error('WhatsApp no entregó el archivo (código ' + r1.status + '). Intentar de nuevo en unos minutos.', 502); }
      const info = await r1.json().catch(() => null);
      if (!info || !info.url) throw error('WhatsApp no informó la dirección del archivo. Intentar de nuevo en unos minutos.', 502);
      if (Number(info.file_size) > tope) return grande();
      if (info.mime_type) mime = mimeBase(info.mime_type);
      if (info.sha256) huella = String(info.sha256);
      const u = new URL(info.url);   // se reemplaza el servidor de Facebook por el de 360dialog, como indica su documentación
      resp = await pedir(origen + u.pathname + u.search, { headers: cab });
    }
  } catch (e) {
    if (e.publico) throw e;
    throw error('No se pudo conectar con WhatsApp para descargar el archivo. Intentar de nuevo en unos minutos.', 502);
  }
  if ([404, 410].includes(resp.status)) { anotarFallo(); return vencido(); }
  if (!resp.ok) { anotarFallo(); throw error('WhatsApp no entregó el archivo (código ' + resp.status + '). Intentar de nuevo en unos minutos.', 502); }
  if (Number(resp.headers.get('content-length')) > tope) return grande();
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw error('WhatsApp entregó el archivo vacío. Intentar de nuevo en unos minutos.', 502);
  if (buf.length > tope) return grande();
  if (!huellaCoincide(buf, huella)) throw error('El archivo no coincide con la huella de control que informó WhatsApp, por eso no se guardó. Intentar de nuevo.', 502);
  if (!mime) mime = mimeBase(resp.headers.get('content-type'));
  const archivo = a.id + '.' + (EXTENSIONES[mime] || 'bin');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const destino = path.join(DIR, archivo);
  fs.writeFileSync(destino + '.tmp', buf, { mode: 0o600 });
  fs.renameSync(destino + '.tmp', destino);
  anotar(a, { guardado: Date.now(), por: String(quien || '').slice(0, 80), tamano: buf.length, mime, archivo });
  return estado(a);
}

/* ---------- Para servir un archivo guardado ---------- */
function paraServir(id) {
  if (!idValido(id)) return null;
  const i = leerIndice()[id];
  const ruta = i && i.guardado ? rutaDe(i) : null;
  if (!ruta || !fs.existsSync(ruta)) return null;
  const ext = path.extname(ruta);
  const fecha = new Date(i.recibido || i.guardado).toISOString().slice(0, 10);
  const nombre = i.nombre || (NOMBRE_TIPO[i.tipo] || 'archivo') + '-' + fecha + ext;
  return { ruta, mime: i.mime || 'application/octet-stream', enPanel: EN_PANEL.has(i.mime), nombre, tamano: i.tamano };
}

/* ---------- Borrado a los 3 meses ---------- */
function limpiar(ahora) {
  ahora = ahora || Date.now();
  const ind = leerIndice();
  let borrados = 0;
  for (const [id, i] of Object.entries(ind)) {
    if ((i.recibido || i.guardado || 0) + RETENCION_MS < ahora) {
      const r = rutaDe(i);
      if (r) { try { fs.unlinkSync(r); } catch (e) { /* ya no estaba */ } }
      delete ind[id];
      borrados++;
    }
  }
  if (borrados) guardarIndice(ind);
  return borrados;
}

module.exports = { desdeWebhook, leerIndice, estado, descargar, paraServir, limpiar, idValido, maxMB, esSandbox, frenoHasta, DISPONIBLE_MS, RETENCION_MS, EN_PANEL,
  _anotarFallo: anotarFallo, _reiniciarFreno: () => { fallos = []; } };
