/*
 * respaldos.js — Respaldo automático de los datos de Verde (1.4.15)
 * --------------------------------------------------------------
 *  - Todas las noches a las 03:30 (hora de Montevideo) comprime la carpeta «data»
 *    (configuración, conversaciones, usuarios, consumo, archivos guardados y biblioteca)
 *    y la guarda CIFRADA (AES-256-GCM) en la carpeta «respaldos».
 *  - Se conservan los últimos 14. Si a las 03:30 el servidor estaba apagado, lo hace
 *    apenas vuelve a funcionar ese día.
 *  - La clave de cifrado está en .env (VERDE_RESPALDO_CLAVE) y NUNCA va dentro de un
 *    respaldo. Sin esa clave, un respaldo no se puede abrir: guardarla también fuera
 *    del servidor (por ejemplo, en el gestor de contraseñas).
 *  - Los administradores descargan los respaldos desde el panel; cada descarga queda
 *    registrada. Si pasan más de 7 días sin descargar uno, el panel lo avisa.
 *  - Para generar la clave, revisar un respaldo o restaurarlo: respaldos-cli.js
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pipeline } = require('stream');

const BASE = __dirname;
const MAX_RESPALDOS = 14;
const HORA = 3, MINUTO = 30;              // hora del respaldo automático (Montevideo)
const DIAS_AVISO = 7;
const MAX_INTENTOS_DIA = 3;               // reintentos automáticos si algo falla
const MAGIA = Buffer.from('VRSP1');       // encabezado del archivo cifrado
const LARGO_IV = 12, LARGO_TAG = 16;
const NOMBRE_RE = /^verde-respaldo-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.cifrado$/;
const ZONA = 'America/Montevideo';

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }   // solo para las pruebas

function dirRespaldos() { return process.env.VERDE_RESPALDOS_DIR || path.join(BASE, 'respaldos'); }
function archivoIndice() { return path.join(dirRespaldos(), 'indice.json'); }

/* ---------- clave de cifrado ---------- */
function clave() {
  const v = String(process.env.VERDE_RESPALDO_CLAVE || '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(v)) return null;
  const b = Buffer.from(v, 'base64');
  return b.length === 32 ? b : null;
}
function claveConfigurada() { return !!clave(); }
function nuevaClave() { return crypto.randomBytes(32).toString('base64'); }

/* ---------- fechas en hora de Montevideo ---------- */
const FORMATO = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function partes(ms) {
  const p = {};
  for (const x of FORMATO.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute };
}
function dia(ms) { const p = partes(ms); return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0'); }
// Momento (en milisegundos) de las 03:30 de Montevideo del día de «ms», más «masDias».
function objetivo(ms, masDias) {
  const p = partes(ms);
  const desfase = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
  return Date.UTC(p.y, p.m - 1, p.d + (masDias || 0), HORA, MINUTO) - desfase;
}

/* ---------- índice ---------- */
function cargarIndice() {
  try {
    const f = archivoIndice();
    if (!fs.existsSync(f)) return { respaldos: [], primeroEn: null, ultimaDescarga: null };
    const d = JSON.parse(fs.readFileSync(f, 'utf8') || '{}');
    return { respaldos: Array.isArray(d.respaldos) ? d.respaldos : [], primeroEn: d.primeroEn || null, ultimaDescarga: d.ultimaDescarga || null };
  } catch (e) {
    console.error('No se pudo leer el índice de respaldos:', e.message);
    return { respaldos: [], primeroEn: null, ultimaDescarga: null };
  }
}
function guardarIndice(d) {
  const dir = dirRespaldos();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = archivoIndice() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, archivoIndice());
}
// Deja los últimos 14 correctos (borra los archivos más viejos) y los errores de los últimos 7 días.
function podar(d) {
  const correctos = d.respaldos.filter(r => r.ok).sort((a, b) => b.fecha - a.fecha);
  const quedan = new Set(correctos.slice(0, MAX_RESPALDOS));
  for (const r of correctos.slice(MAX_RESPALDOS)) {
    try { fs.unlinkSync(path.join(dirRespaldos(), r.archivo)); } catch (e) { /* ya no estaba */ }
  }
  const limiteErrores = reloj() - 7 * 24 * 3600 * 1000;
  d.respaldos = d.respaldos.filter(r => (r.ok && quedan.has(r)) || (!r.ok && r.fecha >= limiteErrores)).sort((a, b) => b.fecha - a.fecha);
}

/* ---------- crear un respaldo ---------- */
let enCurso = null;
function nombreLibre(ms) {
  const p = partes(ms);
  const base = 'verde-respaldo-' + dia(ms) + '-' + String(p.h).padStart(2, '0') + String(p.mi).padStart(2, '0');
  let nombre = base + '.cifrado', n = 2;
  while (fs.existsSync(path.join(dirRespaldos(), nombre))) nombre = base + '-' + (n++) + '.cifrado';
  return nombre;
}
// opciones: { automatico, porNombre }. Devuelve una promesa con { ok, error, respaldo }.
function crear(opciones) {
  const o = opciones || {};
  if (enCurso) return Promise.resolve({ ok: false, error: 'Ya hay un respaldo en curso.' });
  const k = clave();
  if (!k) return Promise.resolve({ ok: false, error: 'Falta configurar la clave de cifrado de los respaldos (VERDE_RESPALDO_CLAVE).' });
  const dir = dirRespaldos();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const inicio = reloj();
  const nombre = nombreLibre(inicio);
  const final = path.join(dir, nombre);
  const tmp = final + '.parcial';
  enCurso = new Promise(resolver => {
    let terminado = false, tarCerrado = false, salidaCerrada = false, codigoTar = null, avisoTar = '';
    const fin = (ok, error) => {
      if (terminado) return;
      terminado = true;
      if (!ok) { try { fs.unlinkSync(tmp); } catch (e) { /* no quedó nada */ } }
      const entrada = {
        archivo: ok ? nombre : null, fecha: inicio, tamano: ok ? fs.statSync(final).size : 0, ok: !!ok,
        error: ok ? '' : String(error || 'Error desconocido.').slice(0, 300), automatico: !!o.automatico,
        porNombre: o.porNombre ? String(o.porNombre).slice(0, 60) : '', duracionMs: reloj() - inicio, descargas: []
      };
      try {
        const d = cargarIndice();
        d.respaldos.push(entrada);
        if (ok && !d.primeroEn) d.primeroEn = inicio;
        podar(d);
        guardarIndice(d);
      } catch (e) { console.error('No se pudo actualizar el índice de respaldos:', e.message); }
      if (ok) console.log('Respaldo creado: ' + nombre + ' (' + Math.round(entrada.tamano / 1024) + ' KB)' + (codigoTar === 1 ? ' · aviso de tar: ' + avisoTar.trim().slice(0, 160) : ''));
      else console.error('Respaldo con error: ' + entrada.error);
      enCurso = null;
      resolver({ ok: !!ok, error: entrada.error, respaldo: entrada });
    };
    try {
      const iv = crypto.randomBytes(LARGO_IV);
      const cifrador = crypto.createCipheriv('aes-256-gcm', k, iv);
      const salida = fs.createWriteStream(tmp, { mode: 0o600 });
      salida.on('error', e => fin(false, 'No se pudo escribir el respaldo: ' + e.message));
      salida.write(Buffer.concat([MAGIA, iv]));
      const tar = spawn('tar', ['-czf', '-', '-C', BASE, 'data'], { stdio: ['ignore', 'pipe', 'pipe'] });
      tar.on('error', e => fin(false, 'No se pudo comprimir los datos: ' + e.message));
      tar.stderr.on('data', c => { if (avisoTar.length < 2000) avisoTar += c.toString(); });
      tar.stdout.pipe(cifrador).pipe(salida, { end: false });
      cifrador.on('end', () => salida.end(cifrador.getAuthTag()));
      const revisar = () => {
        if (!tarCerrado || !salidaCerrada || terminado) return;
        // tar devuelve 1 si un archivo cambió mientras se leía: el respaldo igual es válido.
        if (codigoTar !== 0 && codigoTar !== 1) return fin(false, 'La compresión de los datos falló (código ' + codigoTar + '). ' + avisoTar.trim().slice(0, 160));
        try { fs.renameSync(tmp, final); } catch (e) { return fin(false, 'No se pudo guardar el respaldo: ' + e.message); }
        fin(true);
      };
      tar.on('close', code => { codigoTar = code; tarCerrado = true; revisar(); });
      salida.on('finish', () => { salidaCerrada = true; revisar(); });
    } catch (e) { fin(false, e.message); }
  });
  return enCurso;
}

/* ---------- respaldo automático ---------- */
// El respaldo del día está hecho si hay uno correcto de hoy después de las 03:30 (automático o manual),
// o si el automático ya falló 3 veces hoy.
function hoyListo(d, ahora) {
  const desde = objetivo(ahora, 0), hoy = dia(ahora);
  if (d.respaldos.some(r => r.ok && r.fecha >= desde && dia(r.fecha) === hoy)) return true;
  return d.respaldos.filter(r => r.automatico && dia(r.fecha) === hoy).length >= MAX_INTENTOS_DIA;
}
function revisarProgramado() {
  if (enCurso || !clave()) return null;
  const ahora = reloj();
  if (ahora < objetivo(ahora, 0)) return null;           // todavía no son las 03:30
  if (hoyListo(cargarIndice(), ahora)) return null;
  return crear({ automatico: true });
}
function programar() {
  if (String(process.env.VERDE_RESPALDOS_AUTOMATICOS || '').toLowerCase() === 'no') return;
  const t = setInterval(() => { try { revisarProgramado(); } catch (e) { console.error('Respaldo automático:', e.message); } }, 60 * 1000);
  if (t.unref) t.unref();
}

/* ---------- estado para el panel ---------- */
function estado() {
  const d = cargarIndice();
  const ahora = reloj();
  const lista = d.respaldos.slice().sort((a, b) => b.fecha - a.fecha).map(r => {
    const ds = r.descargas || [];
    const ultimaDesc = ds[ds.length - 1] || null;
    return {
      archivo: r.archivo, fecha: r.fecha, tamano: r.tamano, ok: r.ok, error: r.error || '', automatico: !!r.automatico,
      porNombre: r.porNombre || '', disponible: !!(r.ok && r.archivo && fs.existsSync(path.join(dirRespaldos(), r.archivo))),
      descargadoPor: ultimaDesc ? { nombre: ultimaDesc.nombre, fecha: ultimaDesc.fecha } : null
    };
  });
  const listo = hoyListo(d, ahora);
  const objHoy = objetivo(ahora, 0);
  const proximo = listo ? objetivo(ahora, 1) : (ahora < objHoy ? objHoy : ahora);
  const referencia = d.ultimaDescarga ? d.ultimaDescarga.fecha : d.primeroEn;
  const dias = referencia ? Math.floor((ahora - referencia) / (24 * 3600 * 1000)) : 0;
  return {
    claveConfigurada: claveConfigurada(), enCurso: !!enCurso, maximo: MAX_RESPALDOS, diasAviso: DIAS_AVISO,
    respaldos: lista, ultimo: lista[0] || null, ultimaDescarga: d.ultimaDescarga, proximo,
    aviso: { mostrar: !!(referencia && lista.some(r => r.ok) && ahora - referencia > DIAS_AVISO * 24 * 3600 * 1000), dias, nuncaDescargado: !d.ultimaDescarga }
  };
}

/* ---------- descarga ---------- */
// Registra la descarga y devuelve la ruta del archivo. quien: { id, nombre }
function prepararDescarga(archivo, quien) {
  const nombre = String(archivo || '');
  if (!NOMBRE_RE.test(nombre)) return null;
  const d = cargarIndice();
  const r = d.respaldos.find(x => x.ok && x.archivo === nombre);
  const ruta = path.join(dirRespaldos(), nombre);
  if (!r || !fs.existsSync(ruta)) return null;
  const q = quien || {};
  const ahora = reloj();
  r.descargas = (r.descargas || []).concat([{ usuarioId: q.id || null, nombre: String(q.nombre || 'Acceso general').slice(0, 60), fecha: ahora }]).slice(-20);
  d.ultimaDescarga = { fecha: ahora, nombre: String(q.nombre || 'Acceso general').slice(0, 60), archivo: nombre, fechaRespaldo: r.fecha };
  guardarIndice(d);
  return { ruta, nombre, fechaRespaldo: r.fecha };
}

/* ---------- abrir y restaurar (para respaldos-cli.js y las pruebas) ---------- */
function descifrar(entrada, salidaRuta, k) {
  return new Promise((resolver, rechazar) => {
    try {
      const key = k || clave();
      if (!key) throw new Error('Falta la clave de cifrado (VERDE_RESPALDO_CLAVE).');
      const st = fs.statSync(entrada);
      if (st.size < MAGIA.length + LARGO_IV + LARGO_TAG) throw new Error('El archivo es demasiado chico para ser un respaldo.');
      const fd = fs.openSync(entrada, 'r');
      const cab = Buffer.alloc(MAGIA.length + LARGO_IV), tag = Buffer.alloc(LARGO_TAG);
      fs.readSync(fd, cab, 0, cab.length, 0);
      fs.readSync(fd, tag, 0, LARGO_TAG, st.size - LARGO_TAG);
      fs.closeSync(fd);
      if (!cab.subarray(0, MAGIA.length).equals(MAGIA)) throw new Error('El archivo no es un respaldo de Verde.');
      const descifrador = crypto.createDecipheriv('aes-256-gcm', key, cab.subarray(MAGIA.length));
      descifrador.setAuthTag(tag);
      const lectura = fs.createReadStream(entrada, { start: cab.length, end: st.size - LARGO_TAG - 1 });
      pipeline(lectura, descifrador, fs.createWriteStream(salidaRuta, { mode: 0o600 }), err => {
        if (err) {
          try { fs.unlinkSync(salidaRuta); } catch (e) { /* nada */ }
          return rechazar(new Error(/auth|unable to authenticate/i.test(err.message) ? 'La clave no corresponde a este respaldo o el archivo está dañado.' : err.message));
        }
        resolver();
      });
    } catch (e) { rechazar(e); }
  });
}
function ejecutar(comando, args) {
  return new Promise((resolver, rechazar) => {
    const p = spawn(comando, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', c => { out += c.toString(); });
    p.stderr.on('data', c => { err += c.toString(); });
    p.on('error', rechazar);
    p.on('close', code => code === 0 ? resolver(out) : rechazar(new Error((err || out || 'código ' + code).trim().slice(0, 300))));
  });
}
// Revisa que el respaldo se pueda abrir y cuenta sus archivos.
async function verificarArchivo(entrada, k) {
  const tmp = path.join(path.dirname(path.resolve(entrada)), '.verificando-' + crypto.randomBytes(4).toString('hex') + '.tar.gz');
  try {
    await descifrar(entrada, tmp, k);
    const lista = (await ejecutar('tar', ['-tzf', tmp])).split('\n').filter(Boolean);
    if (!lista.some(x => x === 'data/' || x.startsWith('data/'))) throw new Error('El respaldo no contiene la carpeta de datos.');
    return { archivos: lista.filter(x => !x.endsWith('/')).length };
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* nada */ } }
}
// Reemplaza la carpeta «data» de baseDir por la del respaldo. La actual queda guardada al lado.
async function restaurarEn(entrada, baseDir, k) {
  const base = path.resolve(baseDir || BASE);
  const trabajo = path.join(base, '.restaurando-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(trabajo, { mode: 0o700 });
  try {
    const tgz = path.join(trabajo, 'respaldo.tar.gz');
    await descifrar(entrada, tgz, k);
    await ejecutar('tar', ['-xzf', tgz, '-C', trabajo]);
    const nueva = path.join(trabajo, 'data');
    if (!fs.existsSync(nueva) || !fs.statSync(nueva).isDirectory()) throw new Error('El respaldo no contiene la carpeta de datos.');
    const p = partes(reloj());
    const sello = p.y + String(p.m).padStart(2, '0') + String(p.d).padStart(2, '0') + '-' + String(p.h).padStart(2, '0') + String(p.mi).padStart(2, '0');
    const actual = path.join(base, 'data');
    let anterior = null;
    if (fs.existsSync(actual)) {
      anterior = path.join(base, 'data-antes-de-restaurar-' + sello);
      let n = 2;
      while (fs.existsSync(anterior)) anterior = path.join(base, 'data-antes-de-restaurar-' + sello + '-' + (n++));
      fs.renameSync(actual, anterior);
    }
    fs.renameSync(nueva, actual);
    return { anterior: anterior ? path.basename(anterior) : null };
  } finally { fs.rmSync(trabajo, { recursive: true, force: true }); }
}

module.exports = {
  MAX_RESPALDOS, DIAS_AVISO, NOMBRE_RE, clave, claveConfigurada, nuevaClave, crear, revisarProgramado, programar,
  estado, prepararDescarga, descifrar, verificarArchivo, restaurarEn, dirRespaldos, _usarReloj
};
