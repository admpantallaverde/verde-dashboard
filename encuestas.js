/*
 * encuestas.js — Encuesta de calificación de la atención (1.5.9)
 * ---------------------------------------------------------------
 *  - Al marcar un chat atendido o cerrar un lead (si está activado en «Proceso de ventas»), o a mano con
 *    «Pedir calificación», Verde manda al cliente una pregunta con tres botones: Muy buena, Buena, Mala.
 *  - Solo se manda si la ventana de 24 horas del cliente está abierta, y como máximo una vez cada 30 días.
 *  - La respuesta (botón, o «1», «2», «3» escrito) se guarda por chat y por vendedor; no pasa por Verde.
 *  - Se guarda en data/encuestas.json (últimas 2000). Los reportes semanales la usan por vendedor.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'encuestas.json');
const MAX = 2000;
const VENTANA_CLIENTE_MS = 24 * 3600 * 1000;      // WhatsApp: solo se puede escribir dentro de las 24 h del último mensaje del cliente
const CADA_MS = 30 * 86400000;                    // una encuesta por cliente cada 30 días
const RESPUESTA_MS = 72 * 3600 * 1000;            // la respuesta vale hasta 72 h después de enviada
const OPCIONES = [{ id: 'enc_3', puntaje: 3, nombre: 'Muy buena' }, { id: 'enc_2', puntaje: 2, nombre: 'Buena' }, { id: 'enc_1', puntaje: 1, nombre: 'Mala' }];

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }

function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { enviadas: [] };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    return d && Array.isArray(d.enviadas) ? d : { enviadas: [] };
  } catch (e) { console.error('No se pudo leer encuestas.json:', e.message); return { enviadas: [] }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
const t = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function texto(vendedor) { return 'Gracias por escribirnos. ¿Cómo fue la atención' + (vendedor ? ' de ' + vendedor : '') + '? Toque una opción.'; }
function textoSinBotones(vendedor) { return texto(vendedor).replace('Toque una opción.', 'Responda con un número: 1 = Muy buena, 2 = Buena, 3 = Mala.'); }
function textoGracias() { return '¡Muchas gracias por su respuesta!'; }
function botones() { return OPCIONES.map(o => ({ type: 'reply', reply: { id: o.id, title: o.nombre } })); }
function ultimaDe(d, clave) { for (let i = d.enviadas.length - 1; i >= 0; i--) if (d.enviadas[i].clave === clave) return d.enviadas[i]; return null; }
// ¿Se puede mandar? { ok, motivo }
function puedeEnviar(c, forzar) {
  const ahora = reloj();
  if (!c || !c.ultimoClienteEn || ahora - c.ultimoClienteEn > VENTANA_CLIENTE_MS) return { ok: false, motivo: 'La ventana de 24 horas del cliente está cerrada: WhatsApp no permite escribirle hasta que vuelva a escribir.' };
  const u = ultimaDe(cargar(), c.clave);
  if (u && !forzar && ahora - u.en < CADA_MS) return { ok: false, motivo: 'A este cliente ya se le pidió una calificación en los últimos 30 días.' };
  if (u && forzar && ahora - u.en < 60000) return { ok: false, motivo: 'La encuesta se mandó hace menos de un minuto.' };
  return { ok: true };
}
function registrarEnvio(c, datos) {
  const d = cargar();
  const e = { clave: c.clave, numero: c.numero || '', nombre: c.nombre || '', vendedor: t(datos.vendedor, 80), por: t(datos.por, 80) || 'Automático', motivo: t(datos.motivo, 60), interactivo: !!datos.interactivo, en: reloj(), respondidaEn: null, puntaje: null, calificacion: '' };
  d.enviadas.push(e);
  while (d.enviadas.length > MAX) d.enviadas.shift();
  guardar(d);
  return e;
}
// Si el mensaje del cliente es la respuesta a una encuesta pendiente, la registra y devuelve la calificación.
function responder(clave, info, msg) {
  const d = cargar();
  const u = ultimaDe(d, clave);
  if (!u || u.respondidaEn || reloj() - u.en > RESPUESTA_MS) return null;
  let op = null;
  const i = msg && msg.interactive, r = i && (i.button_reply || i.list_reply);
  if (r && r.id) op = OPCIONES.find(o => o.id === r.id) || null;
  if (!op && info && info.clase === 'texto') {
    const x = String(info.texto || '').trim().toLowerCase();
    if (/^[123]$/.test(x)) op = OPCIONES.find(o => o.puntaje === 4 - Number(x)) || null;   // 1 = Muy buena, 2 = Buena, 3 = Mala
    else op = OPCIONES.find(o => o.nombre.toLowerCase() === x) || null;
  }
  if (!op) return null;
  u.respondidaEn = reloj(); u.puntaje = op.puntaje; u.calificacion = op.nombre;
  guardar(d);
  return { puntaje: op.puntaje, nombre: op.nombre, vendedor: u.vendedor };
}
function ultima(clave) { const u = ultimaDe(cargar(), clave); return u ? Object.assign({}, u) : null; }
function todas() { return cargar().enviadas.map(e => Object.assign({}, e)); }

module.exports = { OPCIONES, VENTANA_CLIENTE_MS, CADA_MS, texto, textoSinBotones, textoGracias, botones, puedeEnviar, registrarEnvio, responder, ultima, todas, _usarReloj };
