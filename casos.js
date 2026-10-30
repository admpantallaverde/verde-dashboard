/*
 * casos.js — Casos resueltos (1.6.5)
 * ----------------------------------
 *  - Un caso es una ficha de experiencia real registrada por alguien del equipo desde el modo Entrenamiento:
 *    equipo o producto, cómo llegó, qué revisó y probó (paso a paso), diagnóstico, solución, repuestos y tiempo,
 *    qué conviene no hacer, quién lo registró y cuándo.
 *  - Queda disponible para el Instructor apenas se guarda, marcado como registrado por el equipo (sin revisar por
 *    Dirección). Un administrador puede retirarlo desde la biblioteca (pestaña «Casos»).
 *  - Se guarda en data/casos.json (hasta 2000).
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'casos.json');
const MAX = 2000;
const PARA_INSTRUCTOR = 150;    // casos (los más recientes) que viajan al Instructor
const CAMPOS = ['equipo', 'llegada', 'revision', 'diagnostico', 'solucion', 'repuestos', 'tiempo', 'evitar'];
const NOMBRES = { equipo: 'Equipo o producto', llegada: 'Cómo llegó (síntoma y lo que dijo el cliente)', revision: 'Qué revisó y probó, en orden', diagnostico: 'Diagnóstico', solucion: 'Solución', repuestos: 'Repuestos o materiales', tiempo: 'Tiempo que llevó', evitar: 'Qué conviene no hacer' };

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }
const t = (v, max) => String(v == null ? '' : v).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);

function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { casos: [] };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    return d && Array.isArray(d.casos) ? d : { casos: [] };
  } catch (e) { console.error('No se pudo leer casos.json:', e.message); return { casos: [] }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
function fechaCorta(ms) { const x = new Date(ms - 3 * 3600000); return String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0') + '/' + x.getUTCFullYear(); }

// datos: { area, titulo?, equipo, llegada, revision, diagnostico, solucion, repuestos, tiempo, evitar, por, conversacionId }
function crear(datos) {
  const area = t(datos.area, 80);
  if (!area) { const e = new Error('Falta el área del caso.'); e.publico = true; throw e; }
  const c = { id: 'c-' + crypto.randomBytes(5).toString('hex'), area, en: reloj(), por: t(datos.por, 80) || 'Acceso general', conversacionId: t(datos.conversacionId, 40), retirado: false };
  for (const k of CAMPOS) c[k] = t(datos[k], k === 'revision' ? 2000 : 800);
  if (!c.solucion && !c.revision) { const e = new Error('El caso no tiene ni revisión ni solución: contar al menos cómo se resolvió.'); e.publico = true; throw e; }
  c.titulo = t(datos.titulo, 100) || t((c.equipo ? c.equipo + ': ' : '') + (c.llegada || c.solucion), 100);
  const d = cargar();
  d.casos.push(c);
  while (d.casos.length > MAX) d.casos.shift();
  guardar(d);
  return Object.assign({}, c);
}
function retirar(id, quien) {
  const d = cargar();
  const c = d.casos.find(x => x.id === id);
  if (!c) return null;
  c.retirado = true; c.retiradoEn = reloj(); c.retiradoPor = t(quien, 80);
  guardar(d);
  return Object.assign({}, c);
}
function obtener(id) { const c = cargar().casos.find(x => x.id === id); return c ? Object.assign({}, c) : null; }
function listar(opciones) {
  const o = opciones || {};
  return cargar().casos.filter(c => !c.retirado && (!o.area || c.area === o.area)).sort((a, b) => b.en - a.en).map(c => Object.assign({}, c));
}
function porArea() {
  const out = {};
  for (const c of listar()) out[c.area] = (out[c.area] || 0) + 1;
  return out;
}
function fichaTexto(c) {
  return CAMPOS.filter(k => c[k]).map(k => NOMBRES[k] + ': ' + c[k]).join('\n');
}
// Bloque para el Instructor: los casos más recientes, por área, compactos.
function paraInstructor() {
  const l = listar().slice(0, PARA_INSTRUCTOR);
  if (!l.length) return '';
  const porA = {};
  for (const c of l) (porA[c.area] = porA[c.area] || []).push(c);
  return Object.keys(porA).map(a => '--- Área: ' + a + ' ---\n' + porA[a].map(c => '· Caso «' + c.titulo + '» (registrado por ' + c.por + ' el ' + fechaCorta(c.en) + ')\n' + fichaTexto(c).split('\n').map(x => '  ' + x).join('\n')).join('\n')).join('\n\n');
}
// Para armar un manual de casos frecuentes de un área.
function paraManual(area) { return listar({ area }).map(c => 'CASO «' + c.titulo + '» (' + c.por + ', ' + fechaCorta(c.en) + ')\n' + fichaTexto(c)).join('\n\n'); }

module.exports = { CAMPOS, NOMBRES, crear, retirar, obtener, listar, porArea, paraInstructor, paraManual, fichaTexto, _usarReloj };
