/**
 * Envío de archivos por WhatsApp (versión 1.4.8): PDF, JPG y PNG.
 *
 * Con el número real (API de nube de 360dialog), el archivo se sube primero a /media, que devuelve un identificador
 * (válido 30 días desde el último uso), y después se envía el mensaje con ese identificador, como indica la
 * documentación de 360dialog. El modo de prueba (sandbox) de 360dialog no permite enviar archivos.
 */
const archivos = require('./archivos');

const LEYENDA_MAX = 1024;   // largo máximo del texto que acompaña a un archivo en WhatsApp

function error(msg, codigo) { const e = new Error(msg); e.publico = true; e.codigo = codigo || 502; return e; }
function disponible(conexion) {
  return !!(conexion && conexion.messagesUrl && conexion.apiKey) && !archivos.esSandbox(conexion.messagesUrl);
}
async function pedir(url, opciones, ms) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), ms || 60000);
  try { return await fetch(url, Object.assign({}, opciones, { signal: control.signal })); }
  finally { clearTimeout(t); }
}
// Sube el archivo a 360dialog y devuelve su identificador.
async function subir(buf, mime, nombre, conexion) {
  if (!disponible(conexion)) throw error('En el modo de prueba de 360dialog no se pueden enviar archivos. Se podrán enviar al conectar el número definitivo.', 409);
  const origen = new URL(conexion.messagesUrl).origin;
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([buf], { type: mime }), nombre);
  let r, txt;
  try {
    r = await pedir(origen + '/media', { method: 'POST', headers: { 'D360-API-KEY': conexion.apiKey }, body: fd });
    txt = await r.text();
  } catch (e) {
    throw error('No se pudo conectar con WhatsApp para enviar el archivo. Intentar de nuevo en unos minutos.');
  }
  if (!r.ok) {
    console.error('360dialog rechazó la subida del archivo (' + r.status + '):', String(txt || '').slice(0, 300));
    throw error('WhatsApp no aceptó el archivo (código ' + r.status + '). Intentar de nuevo en unos minutos.');
  }
  let j = null;
  try { j = JSON.parse(txt); } catch (e) { j = null; }
  if (!j || !j.id) throw error('WhatsApp no devolvió el identificador del archivo. Intentar de nuevo en unos minutos.');
  return String(j.id);
}
// Cuerpo del mensaje con el archivo ya subido (documento para PDF, imagen para JPG y PNG).
function cuerpoMedia(base, mediaId, mime, nombre, leyenda) {
  const clase = mime === 'application/pdf' ? 'document' : 'image';
  const c = Object.assign({}, base, { type: clase });
  c[clase] = { id: mediaId };
  if (clase === 'document') c.document.filename = nombre;
  const l = String(leyenda || '').trim();
  if (l) c[clase].caption = l.slice(0, LEYENDA_MAX);
  return c;
}

module.exports = { LEYENDA_MAX, disponible, subir, cuerpoMedia };
