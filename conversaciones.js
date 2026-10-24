/*
 * conversaciones.js — Registro de cada chat para el panel (pantalla «Conversaciones»)
 * ------------------------------------------------------------------------------
 *  - Guarda los últimos mensajes de cada cliente con fecha y autor
 *    (cliente, Verde, equipo o sistema). La memoria de Verde no se toca: es otro archivo.
 *  - Guarda si Verde está apagado en un chat. Queda apagado hasta que alguien lo encienda.
 *  - Resguardo: con Verde apagado, si el cliente escribe y nadie del equipo responde
 *    en 5 minutos, el servidor pasa el chat a «Chats por responder» y avisa al equipo.
 *  - El historial se conserva 3 meses. Los chats con Verde apagado no se borran,
 *    para que siempre se puedan volver a encender desde el panel.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'conversaciones-panel.json');
const MAX_MENSAJES = 100;          // mensajes que se guardan por chat
const RETENCION_DIAS = 90;         // 3 meses
const VENTANA_HORAS = 24;          // WhatsApp: respuestas libres solo dentro de las 24 h del último mensaje del cliente
const ESPERA_MINUTOS = 5;          // resguardo con Verde apagado
const MAX_LISTA = 150;             // chats que muestra la lista (la búsqueda recorre todos)

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }   // solo para las pruebas

/* ---------- archivo ---------- */
function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { chats: {} };
    const raw = fs.readFileSync(ARCHIVO, 'utf8');
    const d = raw ? JSON.parse(raw) : { chats: {} };
    return d && d.chats && typeof d.chats === 'object' ? d : { chats: {} };
  } catch (e) {
    console.error('No se pudo leer conversaciones-panel.json:', e.message);
    return { chats: {} };
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
function corto(s, max) { return String(s == null ? '' : s).slice(0, max); }
function sinAcentos(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function soloDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
function claveValida(clave) { return typeof clave === 'string' && /^wa:[A-Za-z0-9._-]{3,64}$/.test(clave); }
function asegurar(d, datos) {
  let c = d.chats[datos.clave];
  if (!c) {
    c = d.chats[datos.clave] = {
      clave: datos.clave, numero: '', nombre: '', destino: null, creadoEn: reloj(), ultimoEn: reloj(),
      ultimoClienteEn: null, mensajes: [], apagado: null, esperaDesde: null
    };
  }
  if (datos.numero && !c.numero) c.numero = corto(soloDigitos(datos.numero), 20);
  if (datos.nombre) c.nombre = corto(datos.nombre, 80);
  if (datos.destino && !c.destino) c.destino = datos.destino;
  return c;
}
function agregarMensaje(c, m) {
  c.mensajes.push(m);
  if (c.mensajes.length > MAX_MENSAJES) c.mensajes = c.mensajes.slice(-MAX_MENSAJES);
  c.ultimoEn = m.en;
}

/* ---------- registro de mensajes ---------- */
// datos: { clave, numero, nombre, destino, tipo: 'cliente'|'verde'|'equipo'|'sistema', texto, autor, origen, firma }
function registrar(datos) {
  if (!datos || !claveValida(datos.clave)) return null;
  const d = cargar();
  const c = asegurar(d, datos);
  const m = { en: reloj(), tipo: datos.tipo, texto: corto(datos.texto, 2000) };
  if (datos.autor) m.autor = corto(datos.autor, 80);
  if (datos.origen) m.origen = datos.origen;
  if (datos.tipo === 'equipo') m.firma = !!datos.firma;
  agregarMensaje(c, m);
  if (datos.tipo === 'cliente') {
    c.ultimoClienteEn = m.en;
    if (c.apagado && !c.esperaDesde) { c.esperaDesde = m.en; c.esperaTipo = 'apagado'; }   // empieza a correr el resguardo
  }
  if (datos.tipo === 'equipo') { c.esperaDesde = null; c.esperaTipo = null; }   // alguien del equipo respondió
  if (datos.tipo === 'verde' && c.esperaTipo === 'pausa') { c.esperaDesde = null; c.esperaTipo = null; }   // Verde volvió a responder
  guardar(d);
  return c;
}
function anotarSistema(clave, texto) { return registrar({ clave, tipo: 'sistema', texto }); }

/* ---------- interruptor de Verde por chat ---------- */
function nombreDe(usuario) { return (usuario && usuario.nombre) || 'Acceso general'; }
function apagar(clave, usuario) {
  if (!claveValida(clave)) throw error('El chat no es válido.');
  const d = cargar();
  const c = asegurar(d, { clave });
  if (c.apagado) return c;
  c.apagado = { en: reloj(), porId: (usuario && usuario.id) || null, porNombre: nombreDe(usuario) };
  c.esperaDesde = null;
  c.esperaTipo = null;
  agregarMensaje(c, { en: reloj(), tipo: 'sistema', texto: nombreDe(usuario) + ' apagó a Verde en este chat.' });
  guardar(d);
  return c;
}
function encender(clave, usuario) {
  if (!claveValida(clave)) throw error('El chat no es válido.');
  const d = cargar();
  const c = d.chats[clave];
  if (!c) throw error('La conversación no existe.', 404);
  if (!c.apagado) return c;
  c.apagado = null;
  c.esperaDesde = null;
  c.esperaTipo = null;
  agregarMensaje(c, { en: reloj(), tipo: 'sistema', texto: nombreDe(usuario) + ' encendió a Verde en este chat.' });
  guardar(d);
  return c;
}
// Claves de los chats con Verde apagado (una sola lectura, para listas).
function apagados() {
  const r = new Set();
  for (const ch of Object.values(cargar().chats)) if (ch.apagado) r.add(ch.clave);
  return r;
}
function estaApagado(clave) {
  const c = cargar().chats[clave];
  return !!(c && c.apagado);
}

/* ---------- resguardo de 5 minutos ---------- */
// Chats cuyo cliente espera hace 5 minutos o más sin respuesta del equipo: con Verde apagado en el chat,
// o con Verde en pausa porque respondió una persona del equipo y el cliente volvió a escribir.
function esperasVencidas(minutos) {
  const limite = reloj() - (Number(minutos) > 0 ? Number(minutos) : ESPERA_MINUTOS) * 60000;
  return Object.values(cargar().chats).filter(c => c.esperaDesde && c.esperaDesde <= limite && (c.apagado || c.esperaTipo === 'pausa'));
}
// Verde está en pausa en este chat y el cliente volvió a escribir: empieza a correr el resguardo.
function iniciarEsperaPorPausa(clave) {
  const d = cargar();
  const c = d.chats[clave];
  if (!c || c.esperaDesde) return false;
  c.esperaDesde = c.ultimoClienteEn || reloj();
  c.esperaTipo = 'pausa';
  guardar(d);
  return true;
}
// «Devolver a Verde»: Verde retoma el chat, así que el resguardo de la pausa ya no corre.
function cerrarEsperaDePausa(clave) {
  const d = cargar();
  const c = d.chats[clave];
  if (!c || c.esperaTipo !== 'pausa') return false;
  c.esperaDesde = null;
  c.esperaTipo = null;
  guardar(d);
  return true;
}
// Mensajes del cliente desde que empezó la espera (para armar la atención).
function mensajesClienteDesde(clave, desde) {
  const c = cargar().chats[clave];
  if (!c) return [];
  return c.mensajes.filter(m => m.tipo === 'cliente' && m.en >= (desde || 0)).map(m => m.texto);
}
function cerrarEspera(clave, texto) {
  const d = cargar();
  const c = d.chats[clave];
  if (!c) return;
  c.esperaDesde = null;
  c.esperaTipo = null;
  if (texto) agregarMensaje(c, { en: reloj(), tipo: 'sistema', texto });
  guardar(d);
}

/* ---------- chats anteriores a la instalación ---------- */
// Si se abre un chat derivado que todavía no está en el registro, se arma con el recorrido de su atención.
const TIPO_DE_EVENTO = { cliente: 'cliente', verde: 'verde', whatsapp: 'equipo' };
function sembrarDesdeAtencion(a) {
  if (!a || !claveValida(a.clave)) return null;
  const d = cargar();
  if (d.chats[a.clave]) return d.chats[a.clave];
  const c = asegurar(d, { clave: a.clave, numero: a.numero, nombre: a.nombre, destino: a.destino });
  c.creadoEn = a.creadoEn || reloj();
  for (const ev of (a.eventos || [])) {
    const tipo = TIPO_DE_EVENTO[ev.tipo];
    if (!tipo) continue;
    const m = { en: ev.en, tipo, texto: corto(ev.texto, 2000) };
    if (tipo === 'equipo') { m.autor = ev.firma || ''; m.origen = ev.origen || 'celular'; m.firma = !!ev.firma; }
    c.mensajes.push(m);
    if (tipo === 'cliente') c.ultimoClienteEn = ev.en;
  }
  c.mensajes.sort((x, y) => x.en - y.en);
  c.mensajes = c.mensajes.slice(-MAX_MENSAJES);
  c.ultimoEn = c.mensajes.length ? c.mensajes[c.mensajes.length - 1].en : c.creadoEn;
  guardar(d);
  return c;
}

/* ---------- estado de cada chat ---------- */
// ctx: { pendientes: Set de claves con chat por responder, pausas: { clave: hastaMs } }
function estadoDe(c, ctx, ahora) {
  const pendiente = !!(ctx && ctx.pendientes && ctx.pendientes.has(c.clave));
  const hasta = ctx && ctx.pausas ? Number(ctx.pausas[c.clave]) || 0 : 0;
  const pausaHasta = hasta > ahora ? hasta : null;
  const apagado = !!c.apagado;
  const persona = !pendiente && !apagado && !!pausaHasta;
  const verde = !pendiente && !apagado && !persona;
  return { pendiente, apagado, persona, verde, pausaHasta };
}
const FILTROS = {
  todas: () => true,
  verde: e => e.verde,
  persona: e => e.persona,
  apagado: e => e.apagado,
  pendiente: e => e.pendiente
};

/* ---------- búsqueda: nombre, número (en cualquier formato) y mensajes ---------- */
function preparaBusqueda(q) {
  const texto = sinAcentos(String(q || '').trim());
  if (!texto) return null;
  const digitos = soloDigitos(texto);
  const esNumero = digitos.length >= 3 && !/[a-z]/.test(texto);
  const variantes = [];
  if (esNumero) {
    variantes.push(digitos);
    if (digitos.startsWith('0')) variantes.push('598' + digitos.slice(1));   // 099 123 456 → 59899123456
  }
  return { texto, esNumero, variantes };
}
function coincide(c, b) {
  if (!b) return { si: true, mensaje: null };
  if (b.esNumero) {
    const num = soloDigitos(c.numero || c.clave);
    return { si: b.variantes.some(v => num.includes(v)), mensaje: null };
  }
  if (sinAcentos(c.nombre).includes(b.texto)) return { si: true, mensaje: null };
  for (let i = c.mensajes.length - 1; i >= 0; i--) {
    const m = c.mensajes[i];
    if (m.tipo !== 'sistema' && sinAcentos(m.texto).includes(b.texto)) return { si: true, mensaje: m };
  }
  return { si: false, mensaje: null };
}
function ultimoVisible(c) {
  for (let i = c.mensajes.length - 1; i >= 0; i--) if (c.mensajes[i].tipo !== 'sistema') return c.mensajes[i];
  return null;
}
function resumenMensaje(m) {
  return m ? { en: m.en, tipo: m.tipo, autor: m.autor || '', origen: m.origen || '', texto: corto(m.texto, 240) } : null;
}

/* ---------- lista para la pantalla «Conversaciones» ---------- */
function lista(opciones, ctx) {
  opciones = opciones || {};
  const ahora = reloj();
  const b = preparaBusqueda(opciones.buscar);
  const base = [];
  for (const c of Object.values(cargar().chats)) {
    const r = coincide(c, b);
    if (!r.si) continue;
    const e = estadoDe(c, ctx, ahora);
    base.push({ c, e, mensaje: r.mensaje });
  }
  const totales = {};
  for (const k of Object.keys(FILTROS)) totales[k] = base.filter(x => FILTROS[k](x.e)).length;
  const filtro = FILTROS[opciones.estado] ? opciones.estado : 'todas';
  const elegidos = base.filter(x => FILTROS[filtro](x.e)).sort((x, y) => y.c.ultimoEn - x.c.ultimoEn);
  return {
    filtro, totales, total: elegidos.length,
    lista: elegidos.slice(0, MAX_LISTA).map(({ c, e, mensaje }) => Object.assign({
      clave: c.clave, numero: c.numero, nombre: c.nombre, ultimoEn: c.ultimoEn,
      ultimo: resumenMensaje(ultimoVisible(c)), coincidencia: resumenMensaje(mensaje),
      apagadoPor: c.apagado ? c.apagado.porNombre : null
    }, e))
  };
}

/* ---------- detalle de una conversación ---------- */
function detalle(clave, ctx) {
  const c = cargar().chats[clave];
  if (!c) return null;
  const ahora = reloj();
  const e = estadoDe(c, ctx, ahora);
  let puedeResponder = true;
  let motivoNoResponder = '';
  if (!c.destino) { puedeResponder = false; motivoNoResponder = 'Este chat no tiene un número al que se pueda responder desde el panel.'; }
  else if (!c.ultimoClienteEn) { puedeResponder = false; motivoNoResponder = 'Todavía no hay mensajes del cliente registrados en este chat.'; }
  else if (ahora - c.ultimoClienteEn >= VENTANA_HORAS * 3600000) {
    puedeResponder = false;
    motivoNoResponder = 'Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite responder desde el panel dentro de ese plazo. Para retomar la conversación, usar el WhatsApp de la tienda.';
  }
  return Object.assign({
    clave: c.clave, numero: c.numero, nombre: c.nombre, destino: c.destino, ultimoEn: c.ultimoEn,
    ultimoClienteEn: c.ultimoClienteEn, esperaDesde: c.esperaDesde,
    puedeResponder, motivoNoResponder, mensajes: c.mensajes.slice()
  }, e, { apagado: !!c.apagado, apagadoInfo: c.apagado });
}

/* ---------- borrado automático ---------- */
function purgar() {
  const d = cargar();
  const limite = reloj() - RETENCION_DIAS * 86400000;
  let borrados = 0;
  for (const k of Object.keys(d.chats)) {
    const c = d.chats[k];
    if (!c.apagado && (c.ultimoEn || 0) < limite) { delete d.chats[k]; borrados++; }
  }
  if (borrados) guardar(d);
  return borrados;
}

module.exports = {
  MAX_MENSAJES, RETENCION_DIAS, VENTANA_HORAS, ESPERA_MINUTOS,
  claveValida, registrar, anotarSistema, apagar, encender, estaApagado, apagados,
  esperasVencidas, mensajesClienteDesde, cerrarEspera, sembrarDesdeAtencion, iniciarEsperaPorPausa, cerrarEsperaDePausa,
  lista, detalle, purgar, _usarReloj
};
