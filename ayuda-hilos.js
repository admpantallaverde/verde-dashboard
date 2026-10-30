/*
 * ayuda-hilos.js — Conversaciones guardadas del Centro de ayuda (1.5.3)
 * --------------------------------------------------------------------
 *  - Cada usuario del panel tiene sus conversaciones con el asistente, guardadas en
 *    data/ayuda-hilos.json. Con el ingreso desactivado hay una sola («general»).
 *  - Se conservan hasta 50 conversaciones por usuario y 200 mensajes por conversación
 *    (lo más viejo se borra). La IA recibe solo los últimos 10 intercambios.
 *  - Las imágenes adjuntas (JPG o PNG, hasta 5 MB) se guardan en data/ayuda-adjuntos/.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'ayuda-hilos.json');
const DIR_ADJUNTOS = path.join(DATA_DIR, 'ayuda-adjuntos');
const MAX_CONVERSACIONES = 50, MAX_MENSAJES = 200, INTERCAMBIOS_IA = 10;
const MAX_IMAGEN = 5 * 1024 * 1024;
const TIPOS_IMAGEN = { 'image/jpeg': 'jpg', 'image/png': 'png' };

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }

function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { usuarios: {} };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    return d && d.usuarios && typeof d.usuarios === 'object' ? d : { usuarios: {} };
  } catch (e) { console.error('No se pudo leer ayuda-hilos.json:', e.message); return { usuarios: {} }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
const uidDe = u => String(u || 'general').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'general';
const t = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
function cuenta(d, uid) { return d.usuarios[uid] || (d.usuarios[uid] = { actual: null, conversaciones: [] }); }
function resumen(c) { return { id: c.id, titulo: c.titulo, creadoEn: c.creadoEn, actualizadoEn: c.actualizadoEn, mensajes: c.mensajes.length }; }

function nueva(usuario) {
  const d = cargar(), uid = uidDe(usuario), cu = cuenta(d, uid);
  const vacia = cu.conversaciones.find(c => !c.mensajes.length);
  if (vacia) { cu.actual = vacia.id; guardar(d); return Object.assign({}, vacia); }   // no acumula conversaciones vacías
  const c = { id: crypto.randomBytes(6).toString('hex'), titulo: '', creadoEn: reloj(), actualizadoEn: reloj(), mensajes: [] };
  cu.conversaciones.push(c);
  while (cu.conversaciones.length > MAX_CONVERSACIONES) borrarImagenes(cu.conversaciones.shift());
  cu.actual = c.id;
  guardar(d);
  return Object.assign({}, c);
}
function borrarImagenes(c) {
  for (const m of c.mensajes || []) if (m.imagen && m.imagen.archivo) { try { fs.unlinkSync(path.join(DIR_ADJUNTOS, m.imagen.archivo)); } catch (e) { /* ya no estaba */ } }
}
// La conversación abierta del usuario; si no tiene ninguna, la crea.
function actual(usuario) {
  const d = cargar(), uid = uidDe(usuario), cu = cuenta(d, uid);
  const c = cu.conversaciones.find(x => x.id === cu.actual) || cu.conversaciones[cu.conversaciones.length - 1];
  if (c) { if (cu.actual !== c.id) { cu.actual = c.id; guardar(d); } return Object.assign({}, c); }
  return nueva(usuario);
}
function abrir(usuario, id) {
  const d = cargar(), uid = uidDe(usuario), cu = cuenta(d, uid);
  const c = cu.conversaciones.find(x => x.id === id);
  if (!c) return null;
  cu.actual = c.id;
  guardar(d);
  return Object.assign({}, c);
}
function listar(usuario) {
  const d = cargar(), uid = uidDe(usuario), cu = cuenta(d, uid);
  return { actual: cu.actual, conversaciones: cu.conversaciones.filter(c => c.mensajes.length || c.id === cu.actual).map(resumen).reverse() };
}
// Agrega un mensaje: { rol: 'usuario'|'asistente', texto, imagen?, fuentes?, textos? }
function agregar(usuario, id, mensaje) {
  const d = cargar(), uid = uidDe(usuario), cu = cuenta(d, uid);
  const c = cu.conversaciones.find(x => x.id === id);
  if (!c) throw new Error('La conversación no existe.');
  const m = { en: reloj(), rol: mensaje.rol === 'asistente' ? 'asistente' : 'usuario', texto: String(mensaje.texto || '').trim().slice(0, 6000) };
  if (mensaje.imagen) m.imagen = mensaje.imagen;
  if (Array.isArray(mensaje.fuentes) && mensaje.fuentes.length) m.fuentes = mensaje.fuentes.slice(0, 6);
  if (Array.isArray(mensaje.textos) && mensaje.textos.length) m.textos = mensaje.textos.slice(0, 3);
  if (mensaje.manual) m.manual = String(mensaje.manual).slice(0, 100);   // 1.6.0
  if (mensaje.seccion) m.seccion = String(mensaje.seccion).slice(0, 120);
  c.mensajes.push(m);
  while (c.mensajes.length > MAX_MENSAJES) { const viejo = c.mensajes.shift(); if (viejo.imagen) borrarImagenes({ mensajes: [viejo] }); }
  if (!c.titulo && m.rol === 'usuario') c.titulo = t(m.texto, 60) || (m.imagen ? 'Imagen adjunta' : 'Conversación');
  c.actualizadoEn = m.en;
  cu.actual = c.id;
  guardar(d);
  return Object.assign({}, c);
}
// Guarda una imagen adjunta (base64). Devuelve { archivo, tipo, bytes, nombre }.
function guardarImagen(usuario, imagen) {
  const tipo = String((imagen && imagen.tipo) || '').toLowerCase();
  if (!TIPOS_IMAGEN[tipo]) throw new Error('La imagen tiene que ser JPG o PNG.');
  let buf;
  try { buf = Buffer.from(String((imagen && imagen.datos) || '').replace(/^data:[^,]*,/, ''), 'base64'); } catch (e) { buf = Buffer.alloc(0); }
  if (!buf.length) throw new Error('La imagen llegó vacía.');
  if (buf.length > MAX_IMAGEN) throw new Error('La imagen pesa más de 5 MB.');
  if (!fs.existsSync(DIR_ADJUNTOS)) fs.mkdirSync(DIR_ADJUNTOS, { recursive: true });
  const archivo = uidDe(usuario) + '-' + reloj() + '-' + crypto.randomBytes(3).toString('hex') + '.' + TIPOS_IMAGEN[tipo];
  fs.writeFileSync(path.join(DIR_ADJUNTOS, archivo), buf, { mode: 0o600 });
  return { archivo, tipo, bytes: buf.length, nombre: t((imagen && imagen.nombre) || 'imagen', 80) };
}
// Ruta en disco de una imagen, solo si pertenece al usuario.
function rutaImagen(usuario, archivo) {
  const a = String(archivo || '');
  if (!/^[A-Za-z0-9_-]+-\d+-[0-9a-f]{6}\.(jpg|png)$/.test(a) || !a.startsWith(uidDe(usuario) + '-')) return null;
  const ruta = path.join(DIR_ADJUNTOS, a);
  return fs.existsSync(ruta) ? ruta : null;
}
// Mensajes para la IA: los últimos intercambios; las imágenes viejas van como texto, la última como imagen.
function paraIA(c, imagenActual) {
  const ult = c.mensajes.slice(-(INTERCAMBIOS_IA * 2 + 1));
  const out = [];
  ult.forEach((m, i) => {
    const esUltimo = i === ult.length - 1;
    if (m.rol === 'asistente') { out.push({ role: 'assistant', content: JSON.stringify({ respuesta: m.texto, fuentes: m.fuentes || [], textos: m.textos || [] }) }); return; }
    const texto = (m.imagen && !esUltimo ? '[imagen adjunta: ' + (m.imagen.nombre || 'imagen') + '] ' : '') + m.texto;
    if (esUltimo && m.imagen && imagenActual) out.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m.imagen.tipo, data: imagenActual } }, { type: 'text', text: texto || 'Explicar qué muestra esta imagen del panel y cómo se usa.' }] });
    else out.push({ role: 'user', content: texto || '(sin texto)' });
  });
  // La API exige que los turnos alternen y empiecen por el usuario.
  const limpio = [];
  for (const m of out) {
    if (!limpio.length && m.role !== 'user') continue;
    const prev = limpio[limpio.length - 1];
    if (prev && prev.role === m.role) {   // dos del mismo lado seguidos (una respuesta que falló): se unen
      if (typeof prev.content === 'string' && typeof m.content === 'string') { prev.content += '\n' + m.content; continue; }
      limpio.pop();
    }
    limpio.push(m);
  }
  return limpio;
}

module.exports = { MAX_CONVERSACIONES, MAX_MENSAJES, INTERCAMBIOS_IA, MAX_IMAGEN, nueva, actual, abrir, listar, agregar, guardarImagen, rutaImagen, paraIA, _usarReloj };
