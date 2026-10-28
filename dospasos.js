/*
 * dospasos.js — Verificación en 2 pasos con app autenticadora (1.4.15)
 * --------------------------------------------------------------
 *  - Códigos de 6 dígitos que cambian cada 30 segundos (estándar TOTP, RFC 6238),
 *    compatibles con Google Authenticator, Microsoft Authenticator y similares.
 *  - Se acepta el código anterior, el actual y el siguiente (por si el reloj del
 *    celular está un poco corrido), y un mismo código no se puede usar dos veces.
 *  - Códigos de recuperación: 10 por persona, de un solo uso; se guardan cifrados.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const crypto = require('crypto');

const PERIODO = 30;          // segundos que dura cada código
const DIGITOS = 6;
const EMISOR = 'Verde · Pantalla Verde';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ALFABETO_RECUPERACION = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin O, 0, I ni 1 para no confundirlos
const CANTIDAD_RECUPERACION = 10;

/* ---------- base32 (RFC 4648, sin relleno) ---------- */
function aBase32(buf) {
  let bits = 0, valor = 0, salida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte; bits += 8;
    while (bits >= 5) { salida += B32[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) salida += B32[(valor << (5 - bits)) & 31];
  return salida;
}
function deBase32(texto) {
  const limpio = String(texto == null ? '' : texto).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, valor = 0;
  const bytes = [];
  for (const c of limpio) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('La clave tiene caracteres no válidos.');
    valor = (valor << 5) | i; bits += 5;
    if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

/* ---------- códigos TOTP ---------- */
function codigoPara(secretoBuf, paso, digitos) {
  const n = digitos || DIGITOS;
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const h = crypto.createHmac('sha1', secretoBuf).update(contador).digest();
  const o = h[h.length - 1] & 15;
  const num = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(num % Math.pow(10, n)).padStart(n, '0');
}
function pasoDe(ms) { return Math.floor(ms / 1000 / PERIODO); }
function nuevoSecreto() { return aBase32(crypto.randomBytes(20)); }
function limpiarCodigo(c) { return String(c == null ? '' : c).replace(/\s+/g, ''); }

// Devuelve { ok: true, paso } si el código es válido y posterior al último usado.
function verificar(secreto, codigo, ahoraMs, ultimoPaso) {
  const c = limpiarCodigo(codigo);
  if (!/^\d{6}$/.test(c)) return { ok: false };
  let buf;
  try { buf = deBase32(secreto); } catch (e) { return { ok: false }; }
  if (!buf.length) return { ok: false };
  const actual = pasoDe(ahoraMs);
  const minimo = Number.isInteger(ultimoPaso) ? ultimoPaso + 1 : -Infinity;
  for (const p of [actual - 1, actual, actual + 1]) {
    if (p < minimo) continue;
    const esperado = Buffer.from(codigoPara(buf, p));
    if (crypto.timingSafeEqual(esperado, Buffer.from(c))) return { ok: true, paso: p };
  }
  return { ok: false };
}

// Dirección para la app autenticadora (la que va dentro del código QR).
function direccion(cuenta, secreto) {
  const e = encodeURIComponent(EMISOR);
  // SHA1, 6 dígitos y 30 segundos son los valores por defecto de las apps: no se repiten, así el QR es más simple.
  return 'otpauth://totp/' + e + ':' + encodeURIComponent(String(cuenta)) + '?secret=' + secreto + '&issuer=' + e;
}
// La clave en grupos de 4, para escribirla a mano en la app.
function enGrupos(secreto) { return String(secreto).replace(/(.{4})(?=.)/g, '$1 '); }

/* ---------- códigos de recuperación ---------- */
function normalizarRecuperacion(c) { return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function huellaRecuperacion(sal, codigo) {
  return crypto.createHash('sha256').update(String(sal) + ':' + normalizarRecuperacion(codigo)).digest('hex');
}
function nuevosCodigosRecuperacion() {
  const sal = crypto.randomBytes(16).toString('hex');
  const vistos = new Set();
  const codigos = [];
  while (codigos.length < CANTIDAD_RECUPERACION) {
    let s = '';
    for (const b of crypto.randomBytes(8)) s += ALFABETO_RECUPERACION[b % ALFABETO_RECUPERACION.length];
    if (vistos.has(s)) continue;
    vistos.add(s);
    codigos.push(s.slice(0, 4) + '-' + s.slice(4));
  }
  return { codigos, guardar: { sal, codigos: codigos.map(c => ({ h: huellaRecuperacion(sal, c), usadoEn: null })) } };
}
// Marca el código como usado si corresponde. Devuelve la cantidad que queda, o -1 si no es válido.
function usarRecuperacion(registro, codigo, ahoraMs) {
  if (!registro || !Array.isArray(registro.codigos)) return -1;
  const n = normalizarRecuperacion(codigo);
  if (n.length !== 8) return -1;
  const h = Buffer.from(huellaRecuperacion(registro.sal, n), 'hex');
  let encontrado = null;
  for (const c of registro.codigos) {
    if (c.usadoEn) continue;
    const x = Buffer.from(String(c.h), 'hex');
    if (x.length === h.length && crypto.timingSafeEqual(x, h)) encontrado = c;
  }
  if (!encontrado) return -1;
  encontrado.usadoEn = ahoraMs;
  return registro.codigos.filter(c => !c.usadoEn).length;
}

module.exports = {
  PERIODO, EMISOR, aBase32, deBase32, codigoPara, pasoDe, nuevoSecreto, verificar, direccion, enGrupos,
  nuevosCodigosRecuperacion, usarRecuperacion, normalizarRecuperacion
};
