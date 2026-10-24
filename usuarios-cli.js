/*
 * usuarios-cli.js — Usuarios del panel desde la terminal del servidor
 * --------------------------------------------------------------
 * Sirve para crear el primer administrador y para emergencias
 * (por ejemplo, si el administrador olvida su contraseña).
 *
 * Uso, dentro de la carpeta de Verde:
 *   node usuarios-cli.js crear-admin <usuario> "<Nombre y apellido>"
 *   node usuarios-cli.js restablecer <usuario>
 *   node usuarios-cli.js listar
 *
 * La contraseña temporal se muestra UNA sola vez: anotarla y cambiarla al ingresar.
 */
'use strict';
const usuarios = require('./usuarios.js');

const [, , comando, arg1, arg2] = process.argv;

function fecha(ms) { return ms ? new Date(ms).toLocaleString('es-UY', { timeZone: 'America/Montevideo' }) : '—'; }

try {
  if (comando === 'crear-admin') {
    if (!arg1) throw new Error('Falta el usuario. Ejemplo: node usuarios-cli.js crear-admin adrian "Adrián Abril"');
    const r = usuarios.crear({ usuario: arg1, nombre: arg2 || arg1, rol: 'admin', firma: '' });
    console.log('Administrador creado: ' + r.usuario.usuario + ' (' + r.usuario.nombre + ')');
    console.log('Contraseña temporal (se muestra una sola vez): ' + r.claveTemporal);
    console.log('Al ingresar al panel se pide cambiarla por una propia.');
  } else if (comando === 'restablecer') {
    if (!arg1) throw new Error('Falta el usuario. Ejemplo: node usuarios-cli.js restablecer adrian');
    const u = usuarios.buscarPorUsuario(arg1);
    if (!u) throw new Error('No existe el usuario «' + arg1 + '».');
    const temporal = usuarios.restablecerClave(u.id);
    console.log('Contraseña restablecida para ' + u.usuario + '. Sus sesiones abiertas se cerraron.');
    console.log('Contraseña temporal (se muestra una sola vez): ' + temporal);
  } else if (comando === 'listar') {
    const lista = usuarios.listar();
    if (!lista.length) console.log('Todavía no hay usuarios. Crear el primero con: node usuarios-cli.js crear-admin <usuario> "<Nombre>"');
    for (const u of lista) {
      console.log([u.usuario, u.nombre, u.rolNombre, u.activo ? 'activo' : 'inactivo', 'último ingreso: ' + fecha(u.ultimoIngreso)].join(' · '));
    }
  } else {
    console.log('Uso:');
    console.log('  node usuarios-cli.js crear-admin <usuario> "<Nombre y apellido>"');
    console.log('  node usuarios-cli.js restablecer <usuario>');
    console.log('  node usuarios-cli.js listar');
    process.exitCode = 1;
  }
} catch (e) {
  console.log('No se pudo completar: ' + e.message);
  process.exitCode = 1;
}
