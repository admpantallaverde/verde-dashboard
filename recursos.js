/**
 * Biblioteca de recursos (versión 1.4.8).
 *
 * Archivos PDF, JPG y PNG que Verde puede ofrecer y enviar a los clientes, y que el equipo puede elegir al adjuntar
 * un archivo desde un chat del panel. Los administran los administradores desde «Comportamiento del bot › K».
 *
 * Seguridad: cada archivo se guarda con un nombre aleatorio; el tipo se comprueba por su contenido real (no solo por
 * la extensión del nombre) y se respetan los tamaños máximos de WhatsApp para imágenes y el tope del panel para PDF.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DIR = path.join(DATA_DIR, 'recursos');
const INDICE = path.join(DATA_DIR, 'recursos.json');
const MAX_RECURSOS = 60;
const MB = 1024 * 1024;
// Tipos admitidos para enviar por WhatsApp (imágenes: máximo de WhatsApp; PDF: tope del panel).
const TIPOS = {
  'application/pdf': { ext: 'pdf', maxMB: 25, nombre: 'PDF' },
  'image/jpeg': { ext: 'jpg', maxMB: 5, nombre: 'JPG' },
  'image/png': { ext: 'png', maxMB: 5, nombre: 'PNG' }
};

function error(msg, codigo) { const e = new Error(msg); e.publico = true; e.codigo = codigo || 400; return e; }
function limpiarNombre(n) {
  return String(n || '').replace(/[\\/\u0000-\u001f\u007f"<>|:*?]/g, '').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}
function texto(v, max) { return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max); }
function idValido(id) { return /^r[a-f0-9]{12}$/.test(String(id || '')); }

// Tipo real según los primeros bytes del archivo (no se confía en el nombre ni en lo que informa el navegador).
function tipoPorContenido(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'image/png';
  return null;
}
// Controla un archivo para enviar por WhatsApp. Devuelve { mime, ext, tamano, nombre } o lanza un error con el motivo.
function validarArchivo(buf, nombre) {
  if (!buf || !buf.length) throw error('El archivo está vacío.');
  const mime = tipoPorContenido(buf);
  if (!mime) throw error('Solo se pueden enviar archivos PDF, JPG o PNG.');
  const t = TIPOS[mime];
  if (buf.length > t.maxMB * MB) throw error((mime === 'application/pdf' ? 'El PDF' : 'La imagen') + ' supera ' + t.maxMB + ' MB.', 413);
  let n = limpiarNombre(nombre);
  const ext = path.extname(n).toLowerCase();
  const valida = mime === 'image/jpeg' ? ['.jpg', '.jpeg'] : ['.' + t.ext];
  if (!n || !path.basename(n, ext)) n = (mime === 'application/pdf' ? 'documento' : 'imagen') + '.' + t.ext;
  else if (!valida.includes(ext)) n = n + '.' + t.ext;   // el nombre siempre termina con la extensión de su tipo real
  return { mime, ext: t.ext, tamano: buf.length, nombre: n };
}

/* ---------- índice ---------- */
function leer() {
  try { const d = JSON.parse(fs.readFileSync(INDICE, 'utf8')); return d && Array.isArray(d.lista) ? d : { lista: [] }; }
  catch (e) { return { lista: [] }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = INDICE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, INDICE);
}
function rutaDe(r) { return r && r.archivo && r.archivo.guardado ? path.join(DIR, path.basename(r.archivo.guardado)) : null; }
function escribirArchivo(id, buf, ext) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const guardado = id + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  const destino = path.join(DIR, guardado);
  fs.writeFileSync(destino + '.tmp', buf, { mode: 0o600 });
  fs.renameSync(destino + '.tmp', destino);
  return guardado;
}
function publico(r) {
  return { id: r.id, nombre: r.nombre, cuando: r.cuando, verde: r.verde !== false,
    archivo: { nombre: r.archivo.nombre, mime: r.archivo.mime, tamano: r.archivo.tamano, tipo: TIPOS[r.archivo.mime] ? TIPOS[r.archivo.mime].nombre : '' },
    creadoEn: r.creadoEn, creadoPor: r.creadoPor || '', actualizadoEn: r.actualizadoEn || r.creadoEn, actualizadoPor: r.actualizadoPor || r.creadoPor || '' };
}
// Datos del recurso: nombre obligatorio; «cuándo usarlo» obligatorio si Verde puede ofrecerlo.
function datosValidos(datos, previo) {
  const nombre = texto(datos.nombre != null ? datos.nombre : (previo && previo.nombre), 80);
  const cuando = texto(datos.cuando != null ? datos.cuando : (previo && previo.cuando), 300);
  const verde = datos.verde != null ? datos.verde !== false && datos.verde !== 'false' : (previo ? previo.verde !== false : true);
  if (!nombre) throw error('Escribir el nombre del recurso.');
  if (verde && !cuando) throw error('Escribir cuándo usarlo: Verde lo necesita para saber cuándo ofrecerlo.');
  return { nombre, cuando, verde };
}

/* ---------- operaciones ---------- */
function listar() { return leer().lista.map(publico); }
function obtener(id) { const r = leer().lista.find(x => x.id === id); return r ? publico(r) : null; }
function crear(datos, buf, nombreArchivo, quien) {
  const d = leer();
  if (d.lista.length >= MAX_RECURSOS) throw error('La biblioteca admite hasta ' + MAX_RECURSOS + ' recursos. Quitar alguno antes de subir otro.');
  const v = datosValidos(datos || {}, null);
  const f = validarArchivo(buf, nombreArchivo);
  const id = 'r' + crypto.randomBytes(6).toString('hex');
  const ahora = Date.now();
  const r = Object.assign({ id }, v, {
    archivo: { nombre: f.nombre, mime: f.mime, tamano: f.tamano, guardado: escribirArchivo(id, buf, f.ext) },
    creadoEn: ahora, creadoPor: texto(quien, 80)
  });
  d.lista.push(r);
  guardar(d);
  return publico(r);
}
function editar(id, datos, buf, nombreArchivo, quien) {
  const d = leer();
  const r = d.lista.find(x => x.id === id);
  if (!r) throw error('El recurso no existe.', 404);
  const v = datosValidos(datos || {}, r);
  let viejo = null;
  if (buf) {
    const f = validarArchivo(buf, nombreArchivo);
    viejo = rutaDe(r);
    r.archivo = { nombre: f.nombre, mime: f.mime, tamano: f.tamano, guardado: escribirArchivo(id, buf, f.ext) };
  }
  Object.assign(r, v, { actualizadoEn: Date.now(), actualizadoPor: texto(quien, 80) });
  guardar(d);
  if (viejo) { try { fs.unlinkSync(viejo); } catch (e) { /* ya no estaba */ } }
  return publico(r);
}
function quitar(id) {
  const d = leer();
  const i = d.lista.findIndex(x => x.id === id);
  if (i < 0) throw error('El recurso no existe.', 404);
  const [r] = d.lista.splice(i, 1);
  guardar(d);
  const ruta = rutaDe(r);
  if (ruta) { try { fs.unlinkSync(ruta); } catch (e) { /* ya no estaba */ } }
  return publico(r);
}
// Para enviar o mostrar: el contenido y sus datos. null si no existe o falta el archivo.
function paraEnviar(id) {
  const r = leer().lista.find(x => x.id === id);
  const ruta = rutaDe(r);
  if (!r || !ruta || !fs.existsSync(ruta)) return null;
  return { id: r.id, recurso: r.nombre, buf: fs.readFileSync(ruta), mime: r.archivo.mime, nombre: r.archivo.nombre, tamano: r.archivo.tamano, ruta };
}
// Para mostrar el archivo en el panel (sin leerlo entero en memoria).
function paraServir(id) {
  const r = leer().lista.find(x => x.id === id);
  const ruta = rutaDe(r);
  if (!r || !ruta || !fs.existsSync(ruta)) return null;
  return { ruta, mime: r.archivo.mime, nombre: r.archivo.nombre };
}
// Los que Verde puede ofrecer, en el orden en que se cargaron (de ahí sale el código R1, R2… del prompt).
function paraVerde() {
  return leer().lista.filter(r => r.verde !== false && r.cuando && rutaDe(r) && fs.existsSync(rutaDe(r)))
    .map(r => ({ id: r.id, nombre: r.nombre, cuando: r.cuando, mime: r.archivo.mime }));
}

module.exports = { TIPOS, MAX_RECURSOS, idValido, tipoPorContenido, validarArchivo, listar, obtener, crear, editar, quitar, paraEnviar, paraServir, paraVerde };
