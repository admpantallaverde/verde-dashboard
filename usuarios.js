/*
 * usuarios.js — Usuarios del panel, contraseñas y sesiones
 * --------------------------------------------------------------
 *  - Las contraseñas se guardan cifradas (scrypt con sal propia): nadie puede verlas.
 *  - La sesión vence tras 8 horas sin uso y, siempre, a los 7 días.
 *  - Después de 5 intentos fallidos, ese usuario queda bloqueado 15 minutos.
 *  - Los usuarios no se eliminan: se desactivan, para que el historial
 *    siga mostrando quién atendió cada chat.
 *  - Cada usuario tiene una firma para WhatsApp (por ejemplo "— Carla"):
 *    así se sabe quién respondió desde el celular.
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USUARIOS_FILE = path.join(DATA_DIR, 'usuarios.json');
const SESIONES_FILE = path.join(DATA_DIR, 'sesiones.json');

const ROLES = { admin: 'Administrador', asesor: 'Asesor' };
const INACTIVIDAD_MS = 8 * 3600 * 1000;
const TOPE_MS = 7 * 24 * 3600 * 1000;
const MAX_FALLOS = 5;
const MAX_FALLOS_IP = 20;
const BLOQUEO_MS = 15 * 60 * 1000;
const LARGO_MINIMO = 8;

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }   // solo para las pruebas

/* ---------- archivos ---------- */
function leer(archivo, porDefecto) {
  try {
    if (!fs.existsSync(archivo)) return porDefecto;
    const raw = fs.readFileSync(archivo, 'utf8');
    return raw ? JSON.parse(raw) : porDefecto;
  } catch (e) {
    console.error('No se pudo leer ' + path.basename(archivo) + ':', e.message);
    return porDefecto;
  }
}
function guardar(archivo, obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = archivo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, archivo);
  try { fs.chmodSync(archivo, 0o600); } catch (e) { /* sin efecto en algunos sistemas */ }
}
function cargarUsuarios() {
  const d = leer(USUARIOS_FILE, { usuarios: [] });
  return d && Array.isArray(d.usuarios) ? d : { usuarios: [] };
}
function guardarUsuarios(d) { guardar(USUARIOS_FILE, d); }

/* ---------- utilidades ---------- */
function error(mensaje, codigo) { const e = new Error(mensaje); e.publico = true; e.codigo = codigo || 400; return e; }
function cifrar(clave, sal) { return crypto.scryptSync(String(clave == null ? '' : clave), String(sal), 64).toString('hex'); }
function igualSeguro(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function claveTemporal() {
  let s = '';
  for (const b of crypto.randomBytes(12)) s += ALFABETO[b % ALFABETO.length];
  return s;
}
function limpiarTexto(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }
function normalizarUsuario(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function usuarioValido(s) { return /^[a-z0-9._-]{3,30}$/.test(s); }
function publico(u) {
  return {
    id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol, rolNombre: ROLES[u.rol] || u.rol,
    firma: u.firma || '', activo: u.activo !== false, debeCambiar: !!u.debeCambiar,
    creadoEn: u.creadoEn || null, ultimoIngreso: u.ultimoIngreso || null
  };
}
function adminsActivosSalvo(lista, id) { return lista.filter(u => u.rol === 'admin' && u.activo !== false && u.id !== id).length; }

/* ---------- usuarios ---------- */
function hayUsuarios() { return cargarUsuarios().usuarios.length > 0; }
function listar() { return cargarUsuarios().usuarios.map(publico); }
function buscarPorId(id) { const u = cargarUsuarios().usuarios.find(x => x.id === id); return u ? publico(u) : null; }
function buscarPorUsuario(usuario) {
  const n = normalizarUsuario(usuario);
  const u = cargarUsuarios().usuarios.find(x => x.usuario === n);
  return u ? publico(u) : null;
}

function crear(datos) {
  datos = datos || {};
  const d = cargarUsuarios();
  const nombre = limpiarTexto(datos.nombre, 60);
  const usuario = normalizarUsuario(datos.usuario);
  const rol = Object.prototype.hasOwnProperty.call(ROLES, datos.rol) ? datos.rol : null;
  const firma = limpiarTexto(datos.firma, 40);
  if (!nombre) throw error('Falta el nombre.');
  if (!usuarioValido(usuario)) throw error('El usuario debe tener entre 3 y 30 caracteres: letras sin acentos, números, punto, guion o guion bajo.');
  if (!rol) throw error('El rol no es válido.');
  if (d.usuarios.some(u => u.usuario === usuario)) throw error('Ese usuario ya existe.');
  const temporal = claveTemporal();
  const sal = crypto.randomBytes(16).toString('hex');
  const u = {
    id: 'u' + crypto.randomBytes(5).toString('hex'), nombre, usuario, rol, firma, activo: true,
    sal, hash: cifrar(temporal, sal), debeCambiar: true, creadoEn: reloj(), ultimoIngreso: null, sesionesDesde: 0
  };
  d.usuarios.push(u);
  guardarUsuarios(d);
  return { usuario: publico(u), claveTemporal: temporal };
}

function actualizar(id, cambios) {
  cambios = cambios || {};
  const d = cargarUsuarios();
  const u = d.usuarios.find(x => x.id === id);
  if (!u) throw error('El usuario no existe.', 404);
  if (cambios.nombre !== undefined) {
    const n = limpiarTexto(cambios.nombre, 60);
    if (!n) throw error('Falta el nombre.');
    u.nombre = n;
  }
  if (cambios.firma !== undefined) u.firma = limpiarTexto(cambios.firma, 40);
  if (cambios.rol !== undefined && cambios.rol !== u.rol) {
    if (!Object.prototype.hasOwnProperty.call(ROLES, cambios.rol)) throw error('El rol no es válido.');
    if (u.rol === 'admin' && adminsActivosSalvo(d.usuarios, u.id) === 0) throw error('Tiene que quedar al menos un administrador activo.');
    u.rol = cambios.rol;
  }
  if (cambios.activo !== undefined) {
    const activo = !!cambios.activo;
    if (!activo && u.rol === 'admin' && adminsActivosSalvo(d.usuarios, u.id) === 0) throw error('Tiene que quedar al menos un administrador activo.');
    if (!activo && u.activo !== false) u.sesionesDesde = reloj() + 1;   // cierra sus sesiones abiertas
    u.activo = activo;
  }
  guardarUsuarios(d);
  return publico(u);
}

function restablecerClave(id) {
  const d = cargarUsuarios();
  const u = d.usuarios.find(x => x.id === id);
  if (!u) throw error('El usuario no existe.', 404);
  const temporal = claveTemporal();
  u.sal = crypto.randomBytes(16).toString('hex');
  u.hash = cifrar(temporal, u.sal);
  u.debeCambiar = true;
  u.sesionesDesde = reloj() + 1;   // cierra sus sesiones abiertas
  guardarUsuarios(d);
  return temporal;
}

function cambiarClave(id, actual, nueva) {
  const d = cargarUsuarios();
  const u = d.usuarios.find(x => x.id === id);
  if (!u) throw error('El usuario no existe.', 404);
  if (!igualSeguro(cifrar(actual, u.sal), u.hash)) throw error('La contraseña actual no es correcta.');
  nueva = String(nueva == null ? '' : nueva);
  if (nueva.length < LARGO_MINIMO) throw error('La contraseña nueva debe tener al menos ' + LARGO_MINIMO + ' caracteres.');
  if (nueva === String(actual)) throw error('La contraseña nueva tiene que ser distinta de la actual.');
  u.sal = crypto.randomBytes(16).toString('hex');
  u.hash = cifrar(nueva, u.sal);
  u.debeCambiar = false;
  guardarUsuarios(d);
  return publico(u);
}

/* ---------- intentos fallidos ---------- */
const fallos = new Map();
function registrarFallo(k, maximo) {
  const ahora = reloj();
  const f = fallos.get(k) || { n: 0, desde: ahora, hasta: 0 };
  if (ahora - f.desde > BLOQUEO_MS) { f.n = 0; f.desde = ahora; }
  f.n++;
  if (f.n >= maximo) f.hasta = ahora + BLOQUEO_MS;
  fallos.set(k, f);
}
function bloqueado(k) { const f = fallos.get(k); return !!(f && f.hasta > reloj()); }

function ingresar(usuarioTexto, clave, ip) {
  const usuario = normalizarUsuario(usuarioTexto);
  const ku = 'u:' + usuario;
  const ki = 'ip:' + String(ip || '');
  if (bloqueado(ku) || bloqueado(ki)) return { ok: false, motivo: 'bloqueado' };
  const d = cargarUsuarios();
  const u = d.usuarios.find(x => x.usuario === usuario);
  let valido = false;
  if (u) valido = u.activo !== false && igualSeguro(cifrar(clave, u.sal), u.hash);
  else cifrar(clave, 'relleno');   // mismo tiempo de respuesta exista o no el usuario
  if (!valido) {
    registrarFallo(ku, MAX_FALLOS);
    registrarFallo(ki, MAX_FALLOS_IP);
    return { ok: false, motivo: bloqueado(ku) || bloqueado(ki) ? 'bloqueado' : 'incorrecto' };
  }
  fallos.delete(ku);
  u.ultimoIngreso = reloj();
  guardarUsuarios(d);
  return { ok: true, usuario: publico(u), token: crearSesion(u.id) };
}

/* ---------- sesiones ---------- */
let sesiones = null;
let guardadoDiferido = null;
function mapaSesiones() {
  if (!sesiones) sesiones = new Map(Object.entries(leer(SESIONES_FILE, {}) || {}));
  return sesiones;
}
function persistirSesiones(inmediato) {
  const escribir = () => {
    guardadoDiferido = null;
    try { guardar(SESIONES_FILE, Object.fromEntries(mapaSesiones())); }
    catch (e) { console.error('No se pudo guardar sesiones.json:', e.message); }
  };
  if (inmediato) { if (guardadoDiferido) clearTimeout(guardadoDiferido); escribir(); return; }
  if (!guardadoDiferido) {
    guardadoDiferido = setTimeout(escribir, 60000);
    if (guardadoDiferido.unref) guardadoDiferido.unref();
  }
}
function huella(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
function vencida(ses, ahora) { return ahora - ses.ultima > INACTIVIDAD_MS || ahora - ses.creada > TOPE_MS; }
function crearSesion(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const ahora = reloj();
  const mapa = mapaSesiones();
  for (const [h, s] of mapa) if (vencida(s, ahora)) mapa.delete(h);
  mapa.set(huella(token), { usuarioId, creada: ahora, ultima: ahora });
  persistirSesiones(true);
  return token;
}
function validarSesion(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const mapa = mapaSesiones();
  const h = huella(token);
  const ses = mapa.get(h);
  if (!ses) return null;
  const ahora = reloj();
  const u = cargarUsuarios().usuarios.find(x => x.id === ses.usuarioId);
  if (vencida(ses, ahora) || !u || u.activo === false || ses.creada < (u.sesionesDesde || 0)) {
    mapa.delete(h);
    persistirSesiones(true);
    return null;
  }
  ses.ultima = ahora;
  persistirSesiones(false);
  return publico(u);
}
function cerrarSesion(token) {
  if (typeof token !== 'string') return;
  if (mapaSesiones().delete(huella(token))) persistirSesiones(true);
}

/* ---------- firmas en WhatsApp ---------- */
function sinAcentos(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function normalizarFirma(s) {
  return sinAcentos(String(s == null ? '' : s)).toLowerCase()
    .replace(/^[\s\-\u2013\u2014_.:|~*]+/, '').replace(/[\s.!*~]+$/, '').replace(/\s+/g, ' ').trim();
}
// Busca la firma de un usuario en la última línea de un mensaje enviado desde el celular.
function detectarFirma(texto) {
  const lineas = String(texto == null ? '' : texto).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lineas.length) return null;
  const ultima = normalizarFirma(lineas[lineas.length - 1]);
  for (const u of cargarUsuarios().usuarios) {
    const f = normalizarFirma(u.firma);
    if (f.length < 2) continue;
    if (ultima === f || ultima.endsWith(' ' + f) || ultima.endsWith('-' + f) || ultima.endsWith('\u2014' + f) || ultima.endsWith('\u2013' + f)) {
      return { usuarioId: u.id, nombre: u.nombre, firma: u.firma };
    }
  }
  return null;
}

module.exports = {
  ROLES, LARGO_MINIMO, hayUsuarios, listar, buscarPorId, buscarPorUsuario, crear, actualizar, restablecerClave,
  cambiarClave, ingresar, validarSesion, cerrarSesion, detectarFirma, _usarReloj
};
