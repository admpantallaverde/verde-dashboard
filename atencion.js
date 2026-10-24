/*
 * atencion.js — Chats que Verde deriva a una persona del equipo
 * --------------------------------------------------------------
 * Cada derivación es una "atención" con su recorrido completo:
 *   pendiente  → está en «Chats por responder» (Verde no le responde)
 *   respondido → alguien del equipo le respondió por WhatsApp (se detecta solo)
 *   atendido   → se marcó a mano desde el panel, con motivo obligatorio
 * Si después de un «Marcar atendido» el cliente vuelve a escribir, se abre
 * una atención nueva (vuelve a «Por responder») y la anterior queda señalada.
 * El historial se conserva 3 meses y después se borra solo.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'atenciones.json');
const RETENCION_DIAS = 90;
const MOTIVOS = {
  llamada: 'Atendido por llamada',
  local: 'Atendido en el local',
  no_necesita: 'Ya no necesita atención',
  otro: 'Otro motivo'
};

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }   // solo para las pruebas

/* ---------- archivo ---------- */
function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { lista: [] };
    const raw = fs.readFileSync(ARCHIVO, 'utf8');
    const d = raw ? JSON.parse(raw) : { lista: [] };
    return d && Array.isArray(d.lista) ? d : { lista: [] };
  } catch (e) {
    console.error('No se pudo leer atenciones.json:', e.message);
    return { lista: [] };
  }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}

/* ---------- utilidades ---------- */
function error(mensaje, codigo) { const e = new Error(mensaje); e.publico = true; e.codigo = codigo || 400; return e; }
function nuevaId() { return 'a' + reloj().toString(36) + crypto.randomBytes(3).toString('hex'); }
function corto(s, max) { return String(s == null ? '' : s).slice(0, max); }
function evento(a, tipo, texto, extra) { a.eventos.push(Object.assign({ en: reloj(), tipo, texto: corto(texto, 1000) }, extra || {})); }
function pendienteDe(d, clave) { return d.lista.find(a => a.clave === clave && a.estado === 'pendiente'); }
function ultimaDe(d, clave) {
  let u = null;
  for (const a of d.lista) if (a.clave === clave && (!u || a.creadoEn >= u.creadoEn)) u = a;
  return u;
}
function nueva(datos) {
  return {
    id: nuevaId(), clave: datos.clave, destino: datos.destino || null, numero: datos.numero || '', nombre: datos.nombre || '',
    estado: 'pendiente', creadoEn: reloj(), ultimoMensaje: '', ultimoMensajeEn: reloj(), cerradoEn: null, cierre: null,
    volvioAEscribir: false, reabiertaDe: datos.reabiertaDe || null, eventos: []
  };
}
function anotarMensaje(a, texto) { evento(a, 'cliente', texto); a.ultimoMensaje = corto(texto, 500); a.ultimoMensajeEn = reloj(); }
function sinAcentos(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function resumen(a, ahora) {
  return {
    id: a.id, nombre: a.nombre, numero: a.numero, estado: a.estado, creadoEn: a.creadoEn,
    ultimoMensaje: a.ultimoMensaje, ultimoMensajeEn: a.ultimoMensajeEn, cerradoEn: a.cerradoEn,
    esperaMin: Math.max(0, Math.floor(((a.cerradoEn || ahora) - a.creadoEn) / 60000)),
    cierre: a.cierre, volvioAEscribir: !!a.volvioAEscribir, reabiertaDe: a.reabiertaDe || null
  };
}

/* ---------- consultas rápidas ---------- */
function tienePendiente(clave) { return !!pendienteDe(cargar(), clave); }
function pendienteId(clave) { const p = pendienteDe(cargar(), clave); return p ? p.id : null; }

/* ---------- Verde derivó al cliente ---------- */
function derivar(datos) {
  const d = cargar();
  let a = pendienteDe(d, datos.clave);
  let esNueva = false;
  if (!a) { a = nueva(datos); d.lista.push(a); esNueva = true; }
  if (datos.nombre && !a.nombre) a.nombre = corto(datos.nombre, 80);
  if (datos.mensajeCliente) anotarMensaje(a, datos.mensajeCliente);
  if (datos.respuestaVerde) evento(a, 'verde', datos.respuestaVerde);
  evento(a, 'derivado', datos.motivo || 'Verde lo derivó a una persona del equipo.');
  guardar(d);
  return { atencion: a, nueva: esNueva };
}

/* ---------- el cliente escribe mientras Verde no responde ---------- */
// Devuelve { estado: 'pendiente' | 'reabierta', atencion } o null si no corresponde a ninguna atención.
function mensajeCliente(datos) {
  const d = cargar();
  const p = pendienteDe(d, datos.clave);
  if (p) {
    anotarMensaje(p, datos.texto);
    if (datos.nombre && !p.nombre) p.nombre = corto(datos.nombre, 80);
    guardar(d);
    return { estado: 'pendiente', atencion: p };
  }
  const u = ultimaDe(d, datos.clave);
  if (datos.enPausa && u && u.estado === 'atendido' && !u.volvioAEscribir) {
    u.volvioAEscribir = true;
    evento(u, 'cliente', datos.texto);
    evento(u, 'reapertura', 'El cliente volvió a escribir y el chat regresó a «Por responder».');
    const n = nueva({ clave: datos.clave, destino: datos.destino || u.destino, numero: datos.numero || u.numero, nombre: datos.nombre || u.nombre, reabiertaDe: u.id });
    evento(n, 'reapertura', 'Regresó a «Por responder»: el cliente volvió a escribir después de un «Marcar atendido».');
    anotarMensaje(n, datos.texto);
    d.lista.push(n);
    guardar(d);
    return { estado: 'reabierta', atencion: n, anterior: u };
  }
  return null;
}

/* ---------- alguien del equipo respondió por WhatsApp ---------- */
function respuestaEquipo(datos) {
  const d = cargar();
  const firma = datos.firma || null;
  const p = pendienteDe(d, datos.clave);
  if (p) {
    p.estado = 'respondido';
    p.cerradoEn = reloj();
    p.cierre = { tipo: 'whatsapp', firma: !!firma, usuarioId: firma ? firma.usuarioId : null, usuarioNombre: firma ? firma.nombre : null, texto: corto(datos.texto, 500) };
    evento(p, 'whatsapp', datos.texto, { firma: firma ? firma.nombre : null });
    guardar(d);
    return p;
  }
  // Respuesta posterior a un cierre reciente: se suma a su recorrido para la supervisión.
  const u = ultimaDe(d, datos.clave);
  if (u && u.estado !== 'pendiente' && reloj() - (u.cerradoEn || 0) < 12 * 3600 * 1000) {
    evento(u, 'whatsapp', datos.texto, { firma: firma ? firma.nombre : null });
    guardar(d);
    return u;
  }
  return null;
}

/* ---------- «Marcar atendido» desde el panel ---------- */
function marcarAtendido(id, datos) {
  datos = datos || {};
  const motivo = String(datos.motivo || '');
  if (!Object.prototype.hasOwnProperty.call(MOTIVOS, motivo)) throw error('Falta indicar cómo se atendió el chat.');
  const detalle = String(datos.detalle == null ? '' : datos.detalle).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (motivo === 'otro' && detalle.length < 3) throw error('Con «Otro motivo» hay que escribir el detalle.');
  const d = cargar();
  const a = d.lista.find(x => x.id === id);
  if (!a) throw error('El chat no existe.', 404);
  if (a.estado !== 'pendiente') throw error('Ese chat ya no está por responder.', 409);
  a.estado = 'atendido';
  a.cerradoEn = reloj();
  a.cierre = { tipo: 'manual', motivo, motivoTexto: MOTIVOS[motivo], detalle, usuarioId: datos.usuarioId || null, usuarioNombre: datos.usuarioNombre || 'Acceso general' };
  evento(a, 'manual', 'Marcado como atendido por ' + a.cierre.usuarioNombre + ' · ' + MOTIVOS[motivo] + (detalle ? ': ' + detalle : ''));
  guardar(d);
  return a;
}

/* ---------- avisos enviados al equipo ---------- */
function anotarAvisos(id, texto) {
  const d = cargar();
  const a = d.lista.find(x => x.id === id);
  if (!a) return;
  evento(a, 'aviso', texto);
  guardar(d);
}

/* ---------- listas para el panel ---------- */
function pendientes() {
  const ahora = reloj();
  return cargar().lista.filter(a => a.estado === 'pendiente').sort((x, y) => x.creadoEn - y.creadoEn).map(a => resumen(a, ahora));
}

const FILTROS = {
  todos: () => true,
  whatsapp: a => a.cierre && a.cierre.tipo === 'whatsapp',
  manual: a => a.cierre && a.cierre.tipo === 'manual',
  volvio: a => !!a.volvioAEscribir
};
function inicioDelDiaMontevideo(ms) {
  const desfase = 3 * 3600 * 1000;   // Uruguay: UTC-3 todo el año
  return Math.floor((ms - desfase) / 86400000) * 86400000 + desfase;
}
function textoBuscable(a) {
  const c = a.cierre || {};
  return sinAcentos([a.nombre, a.numero, a.ultimoMensaje, c.usuarioNombre, c.texto, c.motivoTexto, c.detalle]
    .concat(a.eventos.map(e => e.texto)).filter(Boolean).join(' '));
}
function respondidos(opciones) {
  opciones = opciones || {};
  const ahora = reloj();
  const periodo = String(opciones.periodo || '7');
  let desde = 0;
  if (periodo === 'hoy') desde = inicioDelDiaMontevideo(ahora);
  else if (['7', '30', '90'].includes(periodo)) desde = ahora - Number(periodo) * 86400000;
  const q = sinAcentos(String(opciones.buscar || '').trim());
  const base = cargar().lista
    .filter(a => a.estado !== 'pendiente' && (a.cerradoEn || 0) >= desde)
    .filter(a => !q || textoBuscable(a).includes(q));
  const totales = {};
  for (const k of Object.keys(FILTROS)) totales[k] = base.filter(FILTROS[k]).length;
  const filtro = FILTROS[opciones.filtro] ? opciones.filtro : 'todos';
  const lista = base.filter(FILTROS[filtro]).sort((x, y) => y.cerradoEn - x.cerradoEn).map(a => resumen(a, ahora));
  return { lista, totales, filtro, periodo };
}
function detalle(id) {
  const a = cargar().lista.find(x => x.id === id);
  if (!a) return null;
  return Object.assign(resumen(a, reloj()), { eventos: a.eventos });
}

/* ---------- borrado automático ---------- */
function purgar(dias) {
  const limite = reloj() - (dias || RETENCION_DIAS) * 86400000;
  const d = cargar();
  const antes = d.lista.length;
  d.lista = d.lista.filter(a => a.estado === 'pendiente' || (a.cerradoEn || a.creadoEn) >= limite);
  const borradas = antes - d.lista.length;
  if (borradas) guardar(d);
  return borradas;
}

module.exports = {
  MOTIVOS, RETENCION_DIAS, tienePendiente, pendienteId, derivar, mensajeCliente, respuestaEquipo, marcarAtendido,
  anotarAvisos, pendientes, respondidos, detalle, purgar, _usarReloj
};
