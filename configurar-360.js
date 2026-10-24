/*
 * configurar-360.js — Registra en 360dialog la dirección donde Verde recibe los mensajes.
 * --------------------------------------------------------------
 * Uso (en el servidor, dentro de la carpeta de Verde):
 *     node configurar-360.js
 *
 * Lee los datos del archivo .env y NUNCA muestra las claves en pantalla.
 * Sirve tanto para el entorno de pruebas como para el número real:
 * detecta cuál es según la dirección de envío (D360_MESSAGES_URL).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

(async () => {
  const clave = process.env.D360_API_KEY;
  const urlMensajes = process.env.D360_MESSAGES_URL;
  const secreto = process.env.D360_WEBHOOK_SECRET;
  const publica = String(process.env.PUBLIC_URL || 'https://chat.pantallaverde.com').replace(/\/+$/, '');

  const faltan = [];
  if (!clave) faltan.push('D360_API_KEY');
  if (!urlMensajes) faltan.push('D360_MESSAGES_URL');
  if (!secreto) faltan.push('D360_WEBHOOK_SECRET');
  if (faltan.length) {
    console.log('Faltan datos en el archivo .env: ' + faltan.join(', '));
    process.exit(1);
  }

  const esPrueba = urlMensajes.includes('waba-sandbox');
  const urlConfig = process.env.D360_CONFIG_URL || (esPrueba
    ? 'https://waba-sandbox.360dialog.io/v1/configs/webhook'
    : 'https://waba-v2.360dialog.io/v1/configs/webhook');
  const webhook = publica + '/webhook/360/' + secreto;
  const oculta = s => String(s).split(secreto).join('••••••');

  try {
    const r = await fetch(urlConfig, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'D360-API-KEY': clave },
      body: JSON.stringify({ url: webhook })
    });
    const txt = await r.text();
    if (r.ok) {
      console.log('Listo (' + (esPrueba ? 'entorno de pruebas' : 'número real') + '): 360dialog enviará los mensajes a ' + publica + '/webhook/360/••••••');
    } else {
      console.log('360dialog respondió con error ' + r.status + ': ' + oculta(txt).slice(0, 300));
      process.exit(1);
    }
  } catch (e) {
    console.log('No se pudo contactar a 360dialog: ' + e.message);
    process.exit(1);
  }
})();
