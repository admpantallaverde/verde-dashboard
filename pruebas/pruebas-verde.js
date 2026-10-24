/*
 * pruebas-verde.js — Pruebas automáticas de Verde.
 * Se ejecuta con probar.sh, en una carpeta temporal:
 * no toca los datos reales, no usa las claves reales y no sale a internet
 * (la IA y 360dialog se simulan).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const realFetch = global.fetch;
const BASE = 'http://127.0.0.1:39871';
const VERSION_ESPERADA = '1.2.1';

// Los mensajes del servidor se guardan aparte para no ensuciar el resultado.
const registro = [];
for (const k of ['log', 'warn', 'error']) console[k] = (...a) => registro.push(a.map(String).join(' '));
// Resultado compacto: se guarda todo y se muestra solo si algo falla (o con --detalle).
const DETALLE = process.argv.includes('--detalle');
const lineasGuardadas = [];
const mostrar = t => { if (DETALLE) process.stdout.write(t + '\n'); else lineasGuardadas.push(t); };
const final = t => process.stdout.write(t + '\n');

const llamadasIA = [];
const envios360 = [];
let modoIA = 'ok';
let contadorIA = 0;
let contadorEnvio = 0;

global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('http://127.0.0.1:') || /^http:\/\/\d+\.\d+\.\d+\.\d+:39871/.test(url)) return realFetch(url, opts);
  if (url.startsWith('https://api.anthropic.com/')) {
    llamadasIA.push({ body: JSON.parse(opts.body), headers: opts.headers });
    await new Promise(r => setTimeout(r, 150));
    if (modoIA === 'error400') return new Response('{"error":"bad request"}', { status: 400 });
    if (modoIA === 'vacio') return new Response(JSON.stringify({ content: [], stop_reason: 'refusal' }), { status: 200 });
    contadorIA++;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Respuesta de Verde ' + contadorIA }], stop_reason: 'end_turn' }), { status: 200 });
  }
  if (url.includes('360dialog.io')) {
    contadorEnvio++;
    envios360.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.verde' + contadorEnvio }] }), { status: 201 });
  }
  throw new Error('Salida a internet no permitida en la prueba: ' + url);
};

process.chdir(__dirname);
require('./server.js');

const espera = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, mal = 0;
function verificar(cond, nombre) {
  if (cond) { ok++; mostrar('  ✔ ' + nombre); } else { mal++; mostrar('  ✘ FALLÓ: ' + nombre); }
}
const aviso = (mensajes, campo = 'messages') => ({ entry: [{ changes: [{ field: campo, value: campo === 'messages' ? { contacts: [], messages: mensajes } : { message_echoes: mensajes } }] }] });
const post360 = (body, clave = 'secreto123abc') => realFetch(BASE + '/webhook/360/' + clave, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const simular = (message, from) => realFetch(BASE + '/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, from }) }).then(r => r.json());
const leer = f => { const p = path.join(__dirname, 'data', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}; };
const estado = () => leer('state.json');
const guardarEstado = s => fs.writeFileSync(path.join(__dirname, 'data', 'state.json'), JSON.stringify(s));

(async () => {
  await espera(400);

  mostrar('1) Estado del servidor');
  const h = await (await realFetch(BASE + '/api/health')).json();
  verificar(h.version === VERSION_ESPERADA, 'versión ' + VERSION_ESPERADA);
  verificar(h.ok && h.ia && h.bot && h.wa360, 'responde ok, IA, bot encendido y 360dialog configurado');

  mostrar('2) Modelo de IA y ajustes oficiales');
  let r = await simular('hola', 'dashboard');
  const p = llamadasIA[llamadasIA.length - 1].body;
  verificar(r.reply === 'Respuesta de Verde 1', 'el simulador devuelve la respuesta de la IA');
  verificar(p.model === 'claude-sonnet-5-5', 'el modelo viejo del panel se reemplaza por claude-sonnet-5-5');
  verificar(p.thinking && p.thinking.type === 'between_tools', 'razonamiento previo desactivado (between_tools)');
  verificar(p.output_config && p.output_config.effort === 'medium', 'esfuerzo fijado en "medium"');
  verificar(!('temperature' in p) && !('top_p' in p), 'no se envían parámetros rechazados por el modelo nuevo');
  verificar(/CONTEXTO ACTUAL/.test(p.system) && /Montevideo/.test(p.system), 'el cerebro recibe la fecha y la hora de Montevideo');

  mostrar('3) Seguridad');
  let res = await post360(aviso([{ id: 'x1', from: '59811111111', type: 'text', text: { body: 'hola' } }]), 'clave-incorrecta');
  await espera(400);
  verificar(res.status === 404 && envios360.length === 0, 'una clave incorrecta se rechaza y no se procesa nada');
  const externas = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  let cerrado = true;
  for (const ip of externas) {
    try { await realFetch('http://' + ip + ':39871/api/health', { signal: AbortSignal.timeout(2000) }); cerrado = false; } catch (e) { /* correcto: no responde */ }
  }
  verificar(cerrado, 'el servidor no atiende fuera del propio servidor (' + (externas.length ? externas.length + ' dirección(es) probada(s)' : 'sin direcciones externas') + ')');

  mostrar('4) Mensaje de un cliente por 360dialog');
  const antesIA = llamadasIA.length;
  res = await post360(aviso([{ id: 'm1', from: '59896254735', type: 'text', text: { body: 'tienen display de iphone 15?' } }]));
  verificar(res.status === 200, '360dialog recibe confirmación inmediata');
  await espera(700);
  let e = envios360[envios360.length - 1];
  verificar(envios360.length === 1 && e && e.body.to === '59896254735' && e.body.text.body === 'Respuesta de Verde 2', 'Verde responde al número correcto');
  verificar(e && e.url === 'https://waba-sandbox.360dialog.io/v1/messages' && e.headers['D360-API-KEY'] === 'clave-360-de-prueba', 'usa la dirección y la clave de 360dialog del .env');
  verificar(e && e.body.messaging_product === 'whatsapp' && e.body.type === 'text', 'el envío tiene el formato estándar de WhatsApp');

  mostrar('5) Aviso repetido');
  await post360(aviso([{ id: 'm1', from: '59896254735', type: 'text', text: { body: 'tienen display de iphone 15?' } }]));
  await espera(500);
  verificar(envios360.length === 1 && llamadasIA.length === antesIA + 1, 'un aviso repetido no genera otra respuesta');

  mostrar('6) Dos mensajes seguidos del mismo cliente');
  await post360(aviso([{ id: 'm2', from: '59896254735', type: 'text', text: { body: 'y cuanto sale?' } }]));
  await post360(aviso([{ id: 'm3', from: '59896254735', type: 'text', text: { body: 'abren hoy?' } }]));
  await espera(1300);
  const ult = llamadasIA[llamadasIA.length - 1].body.messages;
  verificar(envios360.length === 3, 'se responden los dos mensajes');
  verificar(ult[0].role === 'user' && ult[ult.length - 1].content === 'abren hoy?' && ult.some(m => m.content === 'y cuanto sale?'), 'se atienden en orden y el segundo ve el contexto del primero');
  const conv = leer('conversations.json')['wa:59896254735'];
  verificar(Array.isArray(conv) && conv.length <= 6, 'el historial respeta la memoria configurada');

  mostrar('7) Una persona del equipo responde desde el celular');
  await post360(aviso([{ id: 'eco1', from: '59893319060', to: '59896254735', type: 'text', text: { body: 'Hola, te atiendo yo' } }], 'smb_message_echoes'));
  await espera(300);
  const horas = (leer('pausas.json')['wa:59896254735'] - Date.now()) / 3600000;
  verificar(horas > 11.9 && horas <= 12, 'Verde queda en pausa 12 horas con ese cliente');
  const antesEnv = envios360.length;
  await post360(aviso([{ id: 'm4', from: '59896254735', type: 'text', text: { body: 'gracias, espero' } }]));
  await espera(500);
  verificar(envios360.length === antesEnv, 'durante la pausa Verde no responde');
  const conv2 = leer('conversations.json')['wa:59896254735'] || [];
  verificar(conv2.some(m => m.content.includes('[Asesor humano] Hola, te atiendo yo')) && conv2.some(m => m.content.includes('gracias, espero')), 'el historial guarda lo que dijo la persona del equipo y el cliente');

  mostrar('8) Mensajes de Verde no generan pausa');
  await post360(aviso([{ id: 'm5', from: '59822222222', type: 'text', text: { body: 'hola' } }]));
  await espera(500);
  await post360(aviso([{ id: 'wamid.verde' + envios360.length, to: '59822222222', type: 'text', text: { body: 'Respuesta de Verde' } }], 'smb_message_echoes'));
  await espera(300);
  verificar(!leer('pausas.json')['wa:59822222222'], 'Verde no se pausa por sus propios mensajes');

  mostrar('9) Adjuntos, stickers y clientes sin número visible');
  let antesIA2 = llamadasIA.length, antes2 = envios360.length;
  await post360(aviso([{ id: 'm6', from: '59833333333', type: 'image', image: { caption: 'comprobante' } }]));
  await espera(400);
  e = envios360[envios360.length - 1];
  verificar(envios360.length === antes2 + 1 && e.body.text.body === 'Gracias, recibí tu archivo. Un asesor lo revisa.' && llamadasIA.length === antesIA2, 'una imagen recibe la frase de adjunto del panel, sin consultar a la IA');
  antes2 = envios360.length;
  await post360(aviso([{ id: 'm7', from: '59833333333', type: 'sticker', sticker: {} }]));
  await espera(300);
  verificar(envios360.length === antes2, 'un sticker se ignora');
  await post360(aviso([{ id: 'm8', from_user_id: 'UY.abc123', type: 'text', text: { body: 'hola' } }]));
  await espera(500);
  e = envios360[envios360.length - 1];
  verificar(e.body.recipient === 'UY.abc123' && !e.body.to, 'sin número visible, responde con el identificador alternativo');

  mostrar('10) Formato antiguo de aviso');
  antes2 = envios360.length;
  await post360({ contacts: [], messages: [{ id: 'm9', from: '59844444444', type: 'text', text: { body: 'hola' } }] });
  await espera(500);
  verificar(envios360.length === antes2 + 1, 'también se entiende el formato antiguo');

  mostrar('11) Verde apagado');
  let s = estado(); s.verde.encendido = false; guardarEstado(s);
  antes2 = envios360.length;
  await post360(aviso([{ id: 'm10', from: '59855555555', type: 'text', text: { body: 'hola' } }]));
  await espera(400);
  verificar(envios360.length === antes2, 'por 360dialog no envía nada');
  r = await simular('hola', 'dashboard');
  verificar(/apagado/.test(r.reply), 'el simulador avisa que Verde está apagado');
  let tw = await (await realFetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=whatsapp%3A%2B59896254735&Body=hola&NumMedia=0' })).text();
  verificar(tw.includes('<Response></Response>'), 'por Twilio tampoco envía nada');
  s = estado(); s.verde.encendido = true; guardarEstado(s);

  mostrar('12) Twilio sigue funcionando');
  tw = await (await realFetch(BASE + '/webhook', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'From=whatsapp%3A%2B59896254735&Body=hola&NumMedia=0' })).text();
  verificar(/<Message>Respuesta de Verde \d+<\/Message>/.test(tw), 'Twilio recibe la respuesta de Verde');

  mostrar('13) Fallas de la IA');
  modoIA = 'vacio';
  r = await simular('hola', 'p2');
  verificar(r.reply === 'Error técnico, te paso con un asesor.', 'si la IA no devuelve texto, se usa la frase de error del panel');
  modoIA = 'error400';
  r = await simular('hola', 'p3');
  verificar(r.reply === 'Error técnico, te paso con un asesor.', 'si la IA rechaza el pedido, se usa la frase de error del panel');
  modoIA = 'ok';

  mostrar('14) Memoria larga');
  const convs = leer('conversations.json');
  convs['sim:larga'] = [{ role: 'assistant', content: 'a0' }];
  for (let i = 1; i <= 9; i++) convs['sim:larga'].push({ role: i % 2 ? 'user' : 'assistant', content: 'm' + i });
  fs.writeFileSync(path.join(__dirname, 'data', 'conversations.json'), JSON.stringify(convs));
  await simular('nueva', 'larga');
  const msgs = llamadasIA[llamadasIA.length - 1].body.messages;
  let alterna = true;
  for (let i = 1; i < msgs.length; i++) if (msgs[i].role === msgs[i - 1].role) alterna = false;
  verificar(msgs[0].role === 'user' && alterna && msgs.length <= 6, 'empieza por el cliente, alterna y respeta la memoria');

  mostrar('15) Reiniciar charla del simulador');
  await realFetch(BASE + '/api/simulate/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'dashboard' }) });
  verificar(!leer('conversations.json')['sim:dashboard'], 'la memoria del simulador se borra');

  mostrar('16) Otros modelos del panel');
  const bot = require('./bot.js');
  const ped = bot.armarPedido('claude-haiku-4-5', 's', [{ role: 'user', content: 'hola' }], 500);
  verificar(!ped.thinking && !ped.output_config, 'un modelo distinto recibe el pedido básico de siempre');

  mostrar('17) Archivo auxiliar configurar-360.js');
  fs.writeFileSync(path.join(__dirname, 'simular-config.js'),
    "global.fetch = async (url, opts) => { const b = JSON.parse(opts.body);" +
    " require('fs').writeFileSync(__dirname + '/config-recibida.json', JSON.stringify({ url, clave: opts.headers['D360-API-KEY'], webhook: b.url }));" +
    " return new Response('{}', { status: 200 }); };");
  const salida = spawnSync(process.execPath, ['-r', './simular-config.js', 'configurar-360.js'], { cwd: __dirname, encoding: 'utf8' });
  const recibida = leer('../config-recibida.json');
  verificar(recibida.url === 'https://waba-sandbox.360dialog.io/v1/configs/webhook' && recibida.clave === 'clave-360-de-prueba' && recibida.webhook === 'https://chat.pantallaverde.com/webhook/360/secreto123abc', 'registra la dirección correcta en 360dialog');
  verificar(salida.status === 0 && /Listo/.test(salida.stdout) && !/secreto123abc/.test(salida.stdout + salida.stderr), 'no muestra la clave secreta en pantalla');

  if (mal && !DETALLE) lineasGuardadas.forEach(l => final(l));
  if (mal) { final('--- últimos mensajes del servidor ---'); registro.slice(-30).forEach(l => final(l)); }
  final('Pruebas OK: ' + ok + ' · con fallas: ' + mal);
  process.exit(mal ? 1 : 0);
})().catch(err => { lineasGuardadas.forEach(l => final(l)); final('✘ FALLÓ: la prueba se interrumpió: ' + err.message); final('Pruebas OK: ' + ok + ' · con fallas: ' + (mal + 1)); process.exit(1); });
