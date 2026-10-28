/*
 * respaldos-cli.js — Respaldos de Verde desde la terminal del servidor (1.4.15)
 * --------------------------------------------------------------
 * Uso, dentro de la carpeta de Verde:
 *   node respaldos-cli.js clave                 Genera la clave de cifrado y la agrega a .env (una sola vez)
 *   node respaldos-cli.js clave mostrar         Muestra la clave actual (para guardarla en el gestor de contraseñas)
 *   node respaldos-cli.js verificar <archivo>   Revisa que un respaldo se pueda abrir con la clave
 *   node respaldos-cli.js restaurar <archivo>   Reemplaza los datos por los del respaldo (con Verde detenido)
 *
 * La clave NUNCA va dentro de los respaldos: sin ella no se pueden abrir.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const BASE = path.resolve(process.env.VERDE_BASE_DIR || __dirname);
const ENV = path.join(BASE, '.env');
require('dotenv').config({ path: ENV });
const respaldos = require('./respaldos.js');

const [, , comando, arg1] = process.argv;

function verdeFunciona() {
  return new Promise(resolver => {
    const puerto = Number(process.env.PORT) || 3003;
    const pedido = http.get({ host: '127.0.0.1', port: puerto, path: '/api/health', timeout: 1500 }, r => { r.resume(); resolver(true); });
    pedido.on('timeout', () => { pedido.destroy(); resolver(false); });
    pedido.on('error', () => resolver(false));
  });
}
function rutaRespaldo(nombre) {
  if (!nombre) throw new Error('Falta el archivo del respaldo. Ejemplo: node respaldos-cli.js verificar respaldos/verde-respaldo-2026-10-28-0330.cifrado');
  const candidatos = [path.resolve(nombre), path.join(respaldos.dirRespaldos(), path.basename(nombre))];
  const r = candidatos.find(c => fs.existsSync(c));
  if (!r) throw new Error('No se encontró el archivo «' + nombre + '».');
  return r;
}

(async () => {
  try {
    if (comando === 'clave' && arg1 === 'mostrar') {
      const v = String(process.env.VERDE_RESPALDO_CLAVE || '').trim();
      if (!respaldos.claveConfigurada()) throw new Error('No hay una clave válida en .env. Para crearla: node respaldos-cli.js clave');
      console.log('Clave de cifrado de los respaldos (guardarla en un lugar seguro, fuera del servidor):');
      console.log(v);
    } else if (comando === 'clave') {
      const actual = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
      if (/^\s*VERDE_RESPALDO_CLAVE\s*=/m.test(actual)) {
        console.log('Ya hay una clave de cifrado en .env: no se reemplaza, porque los respaldos existentes dependen de ella.');
        console.log('Para verla: node respaldos-cli.js clave mostrar');
        return;
      }
      const nueva = respaldos.nuevaClave();
      fs.appendFileSync(ENV, (actual && !actual.endsWith('\n') ? '\n' : '') + 'VERDE_RESPALDO_CLAVE=' + nueva + '\n', { mode: 0o600 });
      console.log('Clave de cifrado creada y guardada en .env.');
      console.log('');
      console.log('  ' + nueva);
      console.log('');
      console.log('IMPORTANTE: copiarla ahora en el gestor de contraseñas. Sin esta clave, los respaldos no se pueden abrir.');
      console.log('Después, reiniciar Verde para que empiece a hacer los respaldos.');
    } else if (comando === 'verificar') {
      const r = await respaldos.verificarArchivo(rutaRespaldo(arg1));
      console.log('Respaldo válido: se abrió con la clave y contiene ' + r.archivos + ' archivos de datos.');
    } else if (comando === 'restaurar') {
      const archivo = rutaRespaldo(arg1);
      if (await verdeFunciona()) throw new Error('Verde está funcionando. Detenerlo antes de restaurar: pm2 stop verde-comportamiento');
      await respaldos.verificarArchivo(archivo);
      const r = await respaldos.restaurarEn(archivo, BASE);
      console.log('Datos restaurados desde ' + path.basename(archivo) + '.');
      if (r.anterior) console.log('Los datos que había quedaron guardados en la carpeta ' + r.anterior + '.');
      console.log('Para volver a encender Verde: pm2 start verde-comportamiento');
    } else {
      console.log('Uso:');
      console.log('  node respaldos-cli.js clave');
      console.log('  node respaldos-cli.js clave mostrar');
      console.log('  node respaldos-cli.js verificar <archivo>');
      console.log('  node respaldos-cli.js restaurar <archivo>');
      process.exitCode = 1;
    }
  } catch (e) {
    console.log('No se pudo completar: ' + e.message);
    process.exitCode = 1;
  }
})();
