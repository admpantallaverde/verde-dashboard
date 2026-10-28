/*
 * accesos.js — Registro de accesos al panel (1.4.15)
 * --------------------------------------------------------------
 *  - Guarda ingresos, intentos fallidos, bloqueos, cierres de sesión, cambios
 *    en la verificación en 2 pasos y descargas de respaldos, con la dirección IP
 *    y el dispositivo (navegador y sistema).
 *  - Se conserva 90 días (como las conversaciones). Solo lo ven los administradores.
 *  - Se guarda en data/accesos.json.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'accesos.json');
const RETENCION_MS = 90 * 24 * 3600 * 1000;
const MAXIMO = 20000;          // tope de seguridad de eventos guardados
const MAX_LISTA = 500;         // eventos que se devuelven por consulta

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }   // solo para las pruebas

const TIPOS = {
  ingreso: 'Ingreso correcto',
  ingreso_recuperacion: 'Ingreso con código de recuperación',
  clave_incorrecta: 'Contraseña incorrecta',
  codigo_incorrecto: 'Código incorrecto',
  bloqueo: 'Bloqueo por intentos (15 min)',
  salida: 'Cierre de sesión',
  dos_pasos_activada: 'Verificación en 2 pasos activada',
  dos_pasos_restablecida: 'Verificación restablecida',
  descarga_respaldo: 'Descarga de respaldo'
};
// Grupos del filtro «Evento» del panel
const GRUPOS = {
  ingresos: ['ingreso', 'ingreso_recuperacion'],
  fallidos: ['clave_incorrecta', 'codigo_incorrecto'],
  bloqueos: ['bloqueo'],
  salidas: ['salida'],
  dos_pasos: ['dos_pasos_activada', 'dos_pasos_restablecida'],
  descargas: ['descarga_respaldo']
};

function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { eventos: [] };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    return d && Array.isArray(d.eventos) ? d : { eventos: [] };
  } catch (e) {
    console.error('No se pudo leer accesos.json:', e.message);
    return { eventos: [] };
  }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
function texto(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

// Navegador y sistema a partir del «user agent», en palabras simples.
function dispositivo(agente) {
  const a = String(agente || '');
  if (!a) return 'Desconocido';
  let nav = 'Otro navegador';
  if (/Edg(e|A|iOS)?\//.test(a)) nav = 'Edge';
  else if (/OPR\/|Opera/.test(a)) nav = 'Opera';
  else if (/SamsungBrowser\//.test(a)) nav = 'Samsung Internet';
  else if (/Firefox\/|FxiOS\//.test(a)) nav = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(a)) nav = 'Chrome';
  else if (/Safari\//.test(a)) nav = 'Safari';
  else if (/curl|wget|python|node/i.test(a)) nav = 'Programa automático';
  let so = '';
  if (/iPhone/.test(a)) so = 'iPhone';
  else if (/iPad/.test(a)) so = 'iPad';
  else if (/Android/.test(a)) so = 'Android';
  else if (/Windows/.test(a)) so = 'Windows';
  else if (/Mac OS X|Macintosh/.test(a)) so = 'Mac';
  else if (/CrOS/.test(a)) so = 'ChromeOS';
  else if (/Linux/.test(a)) so = 'Linux';
  return so ? nav + ' en ' + so : nav;
}

// e: { tipo, usuarioId, usuario (lo tipeado), nombre, ip, agente, detalle, porNombre }
function registrar(e) {
  if (!e || !TIPOS[e.tipo]) return null;
  try {
    const ahora = reloj();
    const d = cargar();
    const ev = {
      id: crypto.randomBytes(6).toString('hex'), fecha: ahora, tipo: e.tipo,
      usuarioId: e.usuarioId ? texto(e.usuarioId, 40) : null, usuario: texto(e.usuario, 40), nombre: texto(e.nombre, 60),
      ip: texto(e.ip, 64), agente: texto(e.agente, 300), detalle: texto(e.detalle, 120), porNombre: texto(e.porNombre, 60)
    };
    d.eventos.push(ev);
    const limite = ahora - RETENCION_MS;
    d.eventos = d.eventos.filter(x => x.fecha >= limite).slice(-MAXIMO);
    guardar(d);
    return ev;
  } catch (err) {
    console.error('No se pudo registrar el acceso:', err.message);
    return null;
  }
}

function descripcion(ev) {
  const base = TIPOS[ev.tipo] || ev.tipo;
  if (ev.tipo === 'ingreso_recuperacion' && ev.detalle) return base + ' (' + ev.detalle + ')';
  if (ev.tipo === 'dos_pasos_restablecida' && ev.porNombre) return base + ' por ' + ev.porNombre;
  if (ev.tipo === 'descarga_respaldo' && ev.detalle) return 'Descarga del respaldo del ' + ev.detalle;
  return base;
}

// filtros: { usuario: id de usuario o '' , grupo: clave de GRUPOS o '', dias: 7|30|90 }
function consultar(filtros) {
  const f = filtros || {};
  const dias = [7, 30, 90].includes(Number(f.dias)) ? Number(f.dias) : 7;
  const desde = reloj() - dias * 24 * 3600 * 1000;
  const grupo = GRUPOS[f.grupo] ? f.grupo : '';
  const usuario = texto(f.usuario, 40);
  const delPeriodo = cargar().eventos.filter(ev => ev.fecha >= desde && (!usuario || ev.usuarioId === usuario));
  const resumen = {
    ingresos: delPeriodo.filter(ev => GRUPOS.ingresos.includes(ev.tipo)).length,
    fallidos: delPeriodo.filter(ev => GRUPOS.fallidos.includes(ev.tipo)).length,
    bloqueos: delPeriodo.filter(ev => ev.tipo === 'bloqueo').length,
    descargas: delPeriodo.filter(ev => ev.tipo === 'descarga_respaldo').length
  };
  const filtrados = grupo ? delPeriodo.filter(ev => GRUPOS[grupo].includes(ev.tipo)) : delPeriodo;
  const eventos = filtrados.slice().sort((a, b) => b.fecha - a.fecha).slice(0, MAX_LISTA).map(ev => ({
    id: ev.id, fecha: ev.fecha, tipo: ev.tipo, texto: descripcion(ev), usuarioId: ev.usuarioId, usuario: ev.usuario,
    nombre: ev.nombre, existe: !!ev.usuarioId, ip: ev.ip, dispositivo: dispositivo(ev.agente)
  }));
  return { dias, grupo, usuario, resumen, total: filtrados.length, eventos };
}

module.exports = { TIPOS, GRUPOS, registrar, consultar, dispositivo, _usarReloj };
