/*
 * manuales.js — Biblioteca de conocimiento (1.6.0)
 * ------------------------------------------------
 *  - Manuales por área: nombre, área, descripción, contenido (texto extraído de un PDF, .txt, .md o pegado),
 *    estado (borrador / aprobado), activo, fechas y quién lo cargó. Metadatos en data/manuales.json; el texto
 *    en data/manuales/<id>.txt y el archivo original (si lo hubo) en data/manuales/<id>.<ext>.
 *  - Áreas previstas con su responsable (data/manuales.json › areas). Las que no tienen manual aprobado se
 *    listan solas en «Áreas previstas sin manual todavía».
 *  - El Instructor (ayuda.js) usa solo los manuales aprobados y activos, más los manuales del sistema
 *    (manual del panel, configuración de Verde, guías de Meta), que no se guardan acá.
 *  - La lectura de PDF usa pdfjs-dist (npm install pdfjs-dist@4.10.38). Si no está instalada, avisa.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'manuales.json');
const DIR = path.join(DATA_DIR, 'manuales');
const MAX_TEXTO = 400000;              // caracteres por manual
const MAX_ARCHIVO = 25 * 1024 * 1024;  // 25 MB
const CARACTERES_POR_PAGINA = 2500;
const BASE_BIEN_PAGINAS = 150;         // hasta acá, «bien»; más, aviso
const TIPOS = { 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md' };
const AREAS_DEFECTO = ['Ventas y atención al cliente', 'Logística, almacén y Mercado Libre', 'Caja: apertura, arqueo y cierre', 'Sistema de gestión de órdenes', 'Soporte técnico, repuestos y proveedores', 'Reglamento interno'];
const SISTEMA = [
  { id: 'sistema-panel', nombre: 'Manual completo del panel', area: 'Panel', descripcion: 'Cada pantalla y cada botón del panel, según el rol.' },
  { id: 'sistema-verde', nombre: 'Configuración de Verde', area: 'Ventas y atención al cliente', descripcion: 'Identidad, ventajas, pasos de venta, objeciones, reglas de oro, garantía y biblioteca de recursos, tal como están configurados.' },
  { id: 'sistema-meta', nombre: 'Guías de Meta (reglas de WhatsApp)', area: 'Panel', descripcion: 'Ventana de 24 horas, plantillas, calidad del número y límites de WhatsApp Business.' }
];

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }
const t = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function cargar() {
  let d = { manuales: [], areas: [] };
  try { if (fs.existsSync(ARCHIVO)) { const x = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}'); if (x && Array.isArray(x.manuales)) d = { manuales: x.manuales, areas: Array.isArray(x.areas) ? x.areas : [] }; } }
  catch (e) { console.error('No se pudo leer manuales.json:', e.message); }
  if (!d.areas.length) d.areas = AREAS_DEFECTO.map(n => ({ id: idDe(n), nombre: n, responsable: '' }));
  return d;
}
function guardar(d) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
function idDe(nombre) { return String(nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'area'; }
const rutaTexto = id => path.join(DIR, id + '.txt');
function paginas(caracteres) { return Math.max(1, Math.round(caracteres / CARACTERES_POR_PAGINA)); }
function publico(m) { return Object.assign({}, m, { sistema: false, paginas: paginas(m.caracteres || 0) }); }

/* ---------- lectura de archivos ---------- */
async function extraerPdf(buffer) {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
  catch (e) { const err = new Error('La lectura de PDF no está instalada en el servidor. Instalar con: npm install pdfjs-dist@4.10.38'); err.publico = true; throw err; }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, disableFontFace: true }).promise;
  const partes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const c = await p.getTextContent();
    let linea = '', y = null, texto = '';
    for (const it of c.items) {
      if (!('str' in it)) continue;
      const yy = it.transform ? Math.round(it.transform[5]) : null;
      if (y !== null && yy !== null && Math.abs(yy - y) > 2) { texto += linea.trim() + '\n'; linea = ''; }
      y = yy; linea += (linea && !linea.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
    }
    texto += linea.trim();
    partes.push(texto.trim());
  }
  return { texto: partes.join('\n\n').replace(/\n{3,}/g, '\n\n').trim(), paginas: doc.numPages };
}
// archivo: { nombre, tipo, datos (base64) } → { texto, paginas, ext }
async function leerArchivo(archivo) {
  const nombre = t((archivo && archivo.nombre) || 'archivo', 120);
  let tipo = String((archivo && archivo.tipo) || '').toLowerCase();
  const extNombre = (nombre.match(/\.([a-z0-9]+)$/i) || [])[1];
  if (!TIPOS[tipo]) tipo = extNombre === 'pdf' ? 'application/pdf' : extNombre === 'md' ? 'text/markdown' : extNombre === 'txt' ? 'text/plain' : '';
  if (!TIPOS[tipo]) { const e = new Error('El archivo tiene que ser PDF, .txt o .md.'); e.publico = true; throw e; }
  let buf;
  try { buf = Buffer.from(String((archivo && archivo.datos) || '').replace(/^data:[^,]*,/, ''), 'base64'); } catch (e) { buf = Buffer.alloc(0); }
  if (!buf.length) { const e = new Error('El archivo llegó vacío.'); e.publico = true; throw e; }
  if (buf.length > MAX_ARCHIVO) { const e = new Error('El archivo pesa más de 25 MB.'); e.publico = true; throw e; }
  if (tipo === 'application/pdf') {
    const r = await extraerPdf(buf);
    if (t(r.texto, 50).length < 20) { const e = new Error('El PDF no tiene texto seleccionable (parece escaneado). Pegar el texto a mano.'); e.publico = true; throw e; }
    return { texto: r.texto, paginas: r.paginas, ext: 'pdf', buffer: buf, nombre };
  }
  const texto = buf.toString('utf8').replace(/\r\n/g, '\n').trim();
  return { texto, paginas: paginas(texto.length), ext: TIPOS[tipo], buffer: buf, nombre };
}

/* ---------- manuales ---------- */
function validar(datos, d, idActual) {
  const nombre = t(datos.nombre, 80);
  if (!nombre) { const e = new Error('Escribir el nombre del manual.'); e.publico = true; throw e; }
  if (d.manuales.some(m => m.id !== idActual && m.nombre.toLowerCase() === nombre.toLowerCase())) { const e = new Error('Ya hay un manual con ese nombre.'); e.publico = true; throw e; }
  const area = t(datos.area, 80);
  if (!area) { const e = new Error('Elegir el área del manual.'); e.publico = true; throw e; }
  return { nombre, area, descripcion: t(datos.descripcion, 140) };
}
function textoValido(texto) {
  const x = String(texto == null ? '' : texto).replace(/\r\n/g, '\n').trim();
  if (x.length < 20) { const e = new Error('El contenido es demasiado corto.'); e.publico = true; throw e; }
  if (x.length > MAX_TEXTO) { const e = new Error('El contenido supera los 400.000 caracteres: dividirlo en dos manuales.'); e.publico = true; throw e; }
  return x;
}
// datos: { nombre, area, descripcion, texto?, archivo?, origen?, por }
async function crear(datos) {
  const d = cargar();
  const v = validar(datos, d, null);
  let texto, original = null, pag = null;
  if (datos.archivo) { const r = await leerArchivo(datos.archivo); texto = textoValido(r.texto); original = r; pag = r.ext === 'pdf' ? r.paginas : null; }
  else texto = textoValido(datos.texto);
  const id = 'm-' + crypto.randomBytes(5).toString('hex');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(rutaTexto(id), texto, { encoding: 'utf8', mode: 0o600 });
  let archivoOriginal = null;
  if (original) { archivoOriginal = id + '.' + original.ext; fs.writeFileSync(path.join(DIR, archivoOriginal), original.buffer, { mode: 0o600 }); }
  const m = Object.assign(v, { id, estado: 'borrador', activo: false, origen: datos.origen === 'entrenamiento' ? 'entrenamiento' : (original ? 'archivo' : 'texto'), archivoOriginal, nombreOriginal: original ? original.nombre : '', caracteres: texto.length, paginasPdf: pag, creadoEn: reloj(), actualizadoEn: reloj(), por: t(datos.por, 80) || 'Acceso general', aprobadoEn: null, aprobadoPor: '', entrevista: datos.origen === 'entrenamiento' ? { por: t(datos.por, 80) || 'Acceso general', en: reloj() } : null });
  d.manuales.push(m);
  guardar(d);
  return publico(m);
}
async function actualizar(id, datos) {
  const d = cargar();
  const m = d.manuales.find(x => x.id === id);
  if (!m) return null;
  const v = validar(Object.assign({ nombre: m.nombre, area: m.area, descripcion: m.descripcion }, datos), d, id);
  Object.assign(m, v);
  if (datos.archivo) {
    const r = await leerArchivo(datos.archivo);
    const texto = textoValido(r.texto);
    fs.writeFileSync(rutaTexto(id), texto, { encoding: 'utf8', mode: 0o600 });
    if (m.archivoOriginal) { try { fs.unlinkSync(path.join(DIR, m.archivoOriginal)); } catch (e) { /* no estaba */ } }
    m.archivoOriginal = id + '.' + r.ext; fs.writeFileSync(path.join(DIR, m.archivoOriginal), r.buffer, { mode: 0o600 });
    m.nombreOriginal = r.nombre; m.caracteres = texto.length; m.paginasPdf = r.ext === 'pdf' ? r.paginas : null; m.origen = 'archivo';
  } else if (typeof datos.texto === 'string') {
    const texto = textoValido(datos.texto);
    fs.writeFileSync(rutaTexto(id), texto, { encoding: 'utf8', mode: 0o600 });
    m.caracteres = texto.length;
  }
  m.actualizadoEn = reloj();
  if (datos.por) m.por = t(datos.por, 80);
  guardar(d);
  return publico(m);
}
function aprobar(id, quien) {
  const d = cargar();
  const m = d.manuales.find(x => x.id === id);
  if (!m) return null;
  m.estado = 'aprobado'; m.activo = true; m.aprobadoEn = reloj(); m.aprobadoPor = t(quien, 80) || 'Acceso general'; m.actualizadoEn = reloj();
  guardar(d);
  return publico(m);
}
function activar(id, activo) {
  const d = cargar();
  const m = d.manuales.find(x => x.id === id);
  if (!m) return null;
  if (m.estado !== 'aprobado') { const e = new Error('Primero hay que aprobar el manual.'); e.publico = true; throw e; }
  m.activo = !!activo; m.actualizadoEn = reloj();
  guardar(d);
  return publico(m);
}
function eliminar(id) {
  const d = cargar();
  const i = d.manuales.findIndex(x => x.id === id);
  if (i < 0) return false;
  const m = d.manuales[i];
  try { fs.unlinkSync(rutaTexto(id)); } catch (e) { /* no estaba */ }
  if (m.archivoOriginal) { try { fs.unlinkSync(path.join(DIR, m.archivoOriginal)); } catch (e) { /* no estaba */ } }
  d.manuales.splice(i, 1);
  guardar(d);
  return true;
}
function texto(id) { try { return fs.readFileSync(rutaTexto(id), 'utf8'); } catch (e) { return ''; } }
function obtener(id) { const m = cargar().manuales.find(x => x.id === id); return m ? Object.assign(publico(m), { texto: texto(id) }) : null; }
function rutaOriginal(id) { const m = cargar().manuales.find(x => x.id === id); if (!m || !m.archivoOriginal) return null; const r = path.join(DIR, m.archivoOriginal); return fs.existsSync(r) ? { ruta: r, nombre: m.nombreOriginal || m.archivoOriginal } : null; }
// Los que usa el Instructor: aprobados y activos, con su texto.
function activos() { return cargar().manuales.filter(m => m.estado === 'aprobado' && m.activo).map(m => Object.assign(publico(m), { texto: texto(m.id) })); }
function resumenBase() {
  const act = cargar().manuales.filter(m => m.estado === 'aprobado' && m.activo);
  const caracteres = act.reduce((n, m) => n + (m.caracteres || 0), 0);
  const pag = act.length ? paginas(caracteres) : 0;
  return { activos: act.length, caracteres, paginas: pag, estado: pag > BASE_BIEN_PAGINAS ? 'grande' : 'bien' };
}
function listar() {
  const d = cargar();
  return { sistema: SISTEMA.map(s => Object.assign({}, s, { sistema: true, estado: 'aprobado', activo: true })), manuales: d.manuales.map(publico).sort((a, b) => b.actualizadoEn - a.actualizadoEn), areas: areas(), base: resumenBase() };
}
/* ---------- áreas ---------- */
function areas() {
  const d = cargar();
  const aprobadas = new Set(d.manuales.filter(m => m.estado === 'aprobado' && m.activo).map(m => m.area.toLowerCase()));
  const conSistema = new Set(SISTEMA.map(s => s.area.toLowerCase()));
  return d.areas.map(a => ({ id: a.id, nombre: a.nombre, responsable: a.responsable || '', conManual: aprobadas.has(a.nombre.toLowerCase()) || conSistema.has(a.nombre.toLowerCase()) }));
}
function guardarAreas(lista) {
  const d = cargar();
  const nuevas = [];
  for (const x of (Array.isArray(lista) ? lista : [])) {
    const nombre = t(x && x.nombre, 80);
    if (!nombre || nuevas.some(n => n.nombre.toLowerCase() === nombre.toLowerCase())) continue;
    nuevas.push({ id: idDe(nombre), nombre, responsable: t(x.responsable, 80) });
  }
  if (!nuevas.length) { const e = new Error('Tiene que quedar al menos un área.'); e.publico = true; throw e; }
  if (nuevas.length > 30) { const e = new Error('Hasta 30 áreas.'); e.publico = true; throw e; }
  d.areas = nuevas;
  guardar(d);
  return areas();
}
// Para el prompt del Instructor: manuales disponibles y áreas sin manual.
function listasInstructor() {
  const disponibles = SISTEMA.map(s => ({ nombre: s.nombre, descripcion: s.descripcion, area: s.area })).concat(activos().map(m => ({ nombre: m.nombre, descripcion: m.descripcion, area: m.area })));
  const sinManual = areas().filter(a => !a.conManual).map(a => ({ nombre: a.nombre, responsable: a.responsable || 'Dirección' }));
  return { disponibles, sinManual };
}

module.exports = { SISTEMA, AREAS_DEFECTO, MAX_TEXTO, BASE_BIEN_PAGINAS, leerArchivo, extraerPdf, crear, actualizar, aprobar, activar, eliminar, obtener, texto, rutaOriginal, activos, resumenBase, listar, areas, guardarAreas, listasInstructor, paginas, _usarReloj };
