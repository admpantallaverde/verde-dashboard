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
const VERSION_ESPERADA = '1.4.5';

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
    if (modoIA === 'vacio') return new Response(JSON.stringify({ content: [], stop_reason: 'refusal', usage: { input_tokens: 1000, output_tokens: 0 } }), { status: 200 });
    if (JSON.stringify(JSON.parse(opts.body).system || '').includes('ASISTENTE DE AYUDA')) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"respuesta":"Para devolver un chat a Verde, usar el botón «Devolver a Verde» del encabezado.","fuentes":["conversaciones","portafolio"]}' }], stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 80 } }), { status: 200 });
    }
    const ultimo = (JSON.parse(opts.body).messages || []).slice(-1)[0] || {};
    const ult = String(ultimo.content || '');
    const respuestaIA = t => new Response(JSON.stringify({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
    if (/garantía/i.test(ult)) return respuestaIA('Lamento el inconveniente 🙏 ¿Tenés la boleta de garantía?\n[RECLAMO]{"boleta":"4582","producto":"Cambio de pantalla hace 2 semanas","mismo":"sí","falla":"El touch no responde a veces","desde":"ayer","reinicio":"forzado hecho"}\n[DERIVAR]');
    if (/actualizar ficha/i.test(ult)) return respuestaIA('Anotado, gracias.\n[RECLAMO]{"golpes":"no","notas":"video recibido"}');
    if (/ficha rota/i.test(ult)) return respuestaIA('Te paso con un asesor.\n[RECLAMO]{boleta: 1}\n[DERIVAR]');
    if (/precio exacto/i.test(ult)) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Te paso con un asesor para confirmarte el precio.\n[DERIVAR]' }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
    }
    contadorIA++;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Respuesta de Verde ' + contadorIA }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200 });
  }
  if (url.includes('360dialog.io') && (!opts || !opts.method || String(opts.method).toUpperCase() === 'GET')) {
    // 1.4.0: descarga de archivos. Sandbox: /v1/media/{id}. Número real: /{id} (dirección) y /whatsapp_business/attachments/ (archivo).
    pedidosMedia.push(url);
    const u = new URL(url);
    let mid, paso = 'archivo';
    if (u.pathname.startsWith('/v1/media/')) mid = decodeURIComponent(u.pathname.slice(10));
    else if (u.pathname.startsWith('/whatsapp_business/attachments/')) mid = u.searchParams.get('mid');
    else { mid = decodeURIComponent(u.pathname.slice(1)); paso = 'info'; }
    const m = medios360[mid];
    if (!m || m.vencido) return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    if (paso === 'info') return new Response(JSON.stringify({ messaging_product: 'whatsapp', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=' + encodeURIComponent(mid) + '&ext=1&hash=x', mime_type: m.mime, file_size: m.tamanoInformado || m.datos.length, id: mid }), { status: 200 });
    const cuerpo = m.alterado ? Buffer.from('otro contenido') : m.datos;
    return new Response(cuerpo, { status: 200, headers: { 'Content-Type': m.mime, 'Content-Length': String(cuerpo.length) } });
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
var medios360 = {}, pedidosMedia = [];

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
  verificar(h.ok && h.ia && h.bot && h.wa360 && h.login === false, 'responde ok, IA, bot encendido, 360dialog configurado e ingreso propio inactivo');

  mostrar('2) Modelo de IA y ajustes oficiales');
  let r = await simular('hola', 'dashboard');
  const p = llamadasIA[llamadasIA.length - 1].body;
  verificar(r.reply.startsWith('Respuesta de Verde 1\n\nSoy Verde, el asistente virtual'), 'el simulador devuelve la respuesta de la IA (con la presentación, por ser la primera)');
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
  verificar(envios360.length === 1 && e && e.body.to === '59896254735' && e.body.text.body.startsWith('Respuesta de Verde 2\n\n_Soy Verde, el asistente virtual'), 'Verde responde al número correcto (la primera vez, con la presentación)');
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
  const ped9 = llamadasIA[llamadasIA.length - 1];
  verificar(envios360.length === antes2 + 1 && /^Respuesta de Verde \d+\n\n_Soy Verde, el asistente virtual/.test(e.body.text.body) && llamadasIA.length === antesIA2 + 1 && /\[El cliente envió una imagen: comprobante\]/.test(JSON.stringify(ped9.body.messages.slice(-1))), 'una imagen: Verde responde con la IA (sabe que llegó una imagen) y sigue la conversación');
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
  verificar(r.reply.startsWith('Error técnico, te paso con un asesor.') && r.derivaria === true, 'si la IA no devuelve texto, se usa la frase de error del panel y se deriva');
  modoIA = 'error400';
  r = await simular('hola', 'p3');
  verificar(r.reply.startsWith('Error técnico, te paso con un asesor.') && r.derivaria === true, 'si la IA rechaza el pedido, se usa la frase de error del panel y se deriva');
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


  // ===================== 1.3.0 =====================
  const api = (ruta, metodo, cuerpo, cookie, extra) => realFetch(BASE + ruta, {
    method: metodo || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}, extra || {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const json = async r => { try { return await r.json(); } catch (e) { return {}; } };
  const avisoDe = (numero, nombre, texto, id) => ({ entry: [{ changes: [{ field: 'messages', value: { contacts: nombre ? [{ wa_id: numero, profile: { name: nombre } }] : [], messages: [{ id, from: numero, type: 'text', text: { body: texto } }] } }] }] });
  const eco = (cliente, texto, id) => aviso([{ id, from: '59893319060', to: cliente, type: 'text', text: { body: texto } }], 'smb_message_echoes');
  const atencionMod = require('./atencion.js');
  const usuariosMod = require('./usuarios.js');

  mostrar('18) Verde deriva: el chat pasa a «Chats por responder» y avisa al equipo');
  let rr = await api('/api/avisos', 'PUT', { numeros: ['+598 99 000 101', '59899000102'] });
  verificar(rr.status === 200 && (await json(rr)).avisos.numeros.length === 2, 'se guardan los 2 celulares que reciben avisos');
  await post360(avisoDe('59899000101', '', 'inicio de turno', 'v101'));
  await post360(avisoDe('59899000102', '', 'inicio de turno', 'v102'));
  await espera(300);
  let antes = envios360.length;
  await post360(avisoDe('59870000001', 'Lucía Fernández', 'quiero el precio exacto del cambio de pantalla', 'd1'));
  await espera(700);
  let nuevos = envios360.slice(antes);
  const alCliente = nuevos.find(x => x.body.to === '59870000001');
  const avisos = nuevos.filter(x => ['59899000101', '59899000102'].includes(x.body.to));
  verificar(alCliente && !/DERIVAR/.test(alCliente.body.text.body) && /asesor/.test(alCliente.body.text.body), 'el cliente recibe la respuesta sin la marca interna');
  verificar(avisos.length === 2 && avisos.every(x => /hay un chat por responder de Lucía Fernández/.test(x.body.text.body) && !/precio exacto/.test(x.body.text.body)), 'llega el aviso a los 2 celulares del equipo, con el nombre del cliente y sin el contenido de su mensaje');
  let pend = await json(await api('/api/chats/pendientes'));
  let luciaP = pend.lista.find(x => x.numero === '59870000001');
  verificar(luciaP && luciaP.nombre === 'Lucía Fernández' && /precio exacto/.test(luciaP.ultimoMensaje) && pend.total === pend.lista.length, 'el chat aparece en «Chats por responder»');
  antes = envios360.length;
  await post360(avisoDe('59870000001', 'Lucía Fernández', 'hola? sigo esperando', 'd2'));
  await espera(500);
  pend = await json(await api('/api/chats/pendientes'));
  luciaP = pend.lista.find(x => x.numero === '59870000001');
  const sigue18 = envios360.slice(antes);
  verificar(sigue18.some(x => x.body.to === '59870000001') && !sigue18.some(x => /^598990001/.test(x.body.to)) && luciaP && /sigo esperando/.test(luciaP.ultimoMensaje), 'mientras espera a una persona, Verde sigue conversando, el aviso no se repite y se actualiza el último mensaje');
  antes = envios360.length;
  await post360(avisoDe('59899000101', '', 'ok, lo veo', 'd3'));
  await espera(400);
  verificar(envios360.length === antes, 'los celulares que reciben avisos son internos: Verde no les responde');

  mostrar('19) Una persona del equipo responde con su firma');
  rr = await api('/api/usuarios', 'POST', { nombre: 'Carla Méndez', usuario: 'carla', rol: 'asesor', firma: '— Carla' });
  const carlaAlta = await json(rr);
  verificar(rr.status === 200 && /^[A-Za-z0-9]{12}$/.test(carlaAlta.claveTemporal || ''), 'se crea un usuario con contraseña temporal');
  await post360(eco('59870000001', 'Hola Lucía, ya te paso el precio.\n— Carla', 'e1'));
  await espera(300);
  pend = await json(await api('/api/chats/pendientes'));
  let resp = await json(await api('/api/chats/respondidos?periodo=hoy'));
  const lucia = resp.lista.find(x => x.nombre === 'Lucía Fernández');
  verificar(!pend.lista.some(x => x.numero === '59870000001') && lucia && lucia.cierre.tipo === 'whatsapp' && lucia.cierre.usuarioNombre === 'Carla Méndez' && lucia.cierre.firma === true, 'el chat pasa solo a «Chats respondidos» y se identifica a Carla por su firma');

  mostrar('20) Respuesta sin firma');
  await post360(avisoDe('59870000002', 'Martín Silva', 'necesito el precio exacto de la batería', 'd4'));
  await espera(600);
  await post360(eco('59870000002', 'Hola Martín, te confirmo en un rato', 'e2'));
  await espera(300);
  resp = await json(await api('/api/chats/respondidos'));
  const martin = resp.lista.find(x => x.nombre === 'Martín Silva');
  verificar(martin && martin.cierre.tipo === 'whatsapp' && martin.cierre.firma === false && !martin.cierre.usuarioNombre, 'queda registrado como respondido sin firma');

  mostrar('21) «Marcar atendido» con motivo obligatorio');
  await post360(avisoDe('59870000003', '', 'precio exacto de la reparación?', 'd5'));
  await espera(600);
  pend = await json(await api('/api/chats/pendientes'));
  const idTres = (pend.lista.find(x => x.numero === '59870000003') || {}).id;
  rr = await api('/api/chats/' + idTres + '/atendido', 'POST', {});
  verificar(rr.status === 400 && /cómo se atendió/.test((await json(rr)).error), 'sin motivo no se puede marcar');
  rr = await api('/api/chats/' + idTres + '/atendido', 'POST', { motivo: 'otro' });
  verificar(rr.status === 400 && /detalle/.test((await json(rr)).error), 'con «Otro motivo» el detalle es obligatorio');
  rr = await api('/api/chats/' + idTres + '/atendido', 'POST', { motivo: 'llamada' });
  const marcado = await json(rr);
  verificar(rr.status === 200 && marcado.chat.estado === 'atendido' && marcado.chat.cierre.motivoTexto === 'Atendido por llamada' && marcado.chat.cierre.usuarioNombre === 'Acceso general', 'se marca con el motivo y queda registrado quién (sin ingreso propio: acceso general)');
  rr = await api('/api/chats/' + idTres + '/atendido', 'POST', { motivo: 'llamada' });
  verificar(rr.status === 409, 'no se puede marcar dos veces');

  mostrar('22) El cliente vuelve a escribir después de «Marcar atendido»');
  antes = envios360.length;
  await post360(avisoDe('59870000003', '', 'hola? nadie me llamó', 'd6'));
  await espera(600);
  pend = await json(await api('/api/chats/pendientes'));
  const reab = pend.lista.find(x => x.numero === '59870000003');
  const avisosReab = envios360.slice(antes).filter(x => ['59899000101', '59899000102'].includes(x.body.to));
  verificar(reab && reab.reabiertaDe === idTres && avisosReab.length === 2 && avisosReab.every(x => /volvió a escribir/.test(x.body.text.body)), 'el chat regresa solo a «Por responder» y se avisa de nuevo');
  verificar(envios360.slice(antes).every(x => x.body.to !== '59870000003'), 'Verde sigue sin responderle al cliente');
  resp = await json(await api('/api/chats/respondidos?filtro=volvio'));
  verificar(resp.lista.length === 1 && resp.lista[0].id === idTres && resp.lista[0].volvioAEscribir, 'en «Chats respondidos» queda señalado como «Volvió a escribir»');

  mostrar('23) Historial: buscador, filtros y período');
  resp = await json(await api('/api/chats/respondidos?periodo=7'));
  verificar(resp.totales.todos === 3 && resp.totales.whatsapp === 2 && resp.totales.manual === 1 && resp.totales.volvio === 1, 'los contadores de los filtros son correctos');
  resp = await json(await api('/api/chats/respondidos?buscar=CARLA'));
  verificar(resp.lista.length === 1 && resp.lista[0].nombre === 'Lucía Fernández', 'el buscador encuentra por asesor');
  resp = await json(await api('/api/chats/respondidos?buscar=lucia'));
  verificar(resp.lista.length === 1, 'el buscador ignora tildes y mayúsculas');
  resp = await json(await api('/api/chats/respondidos?filtro=manual'));
  verificar(resp.lista.length === 1 && resp.lista[0].cierre.tipo === 'manual', 'el filtro «Marcados a mano» funciona');

  mostrar('24) Detalle de una atención');
  const det = await json(await api('/api/chats/' + idTres));
  const tipos = (det.eventos || []).map(e => e.tipo);
  verificar(['cliente', 'verde', 'derivado', 'aviso', 'manual', 'reapertura'].every(t => tipos.includes(t)), 'el recorrido muestra cliente, Verde, derivación, aviso, marcado y reapertura');
  rr = await api('/api/chats/noexiste');
  verificar(rr.status === 404, 'un chat inexistente devuelve «no existe»');

  mostrar('25) Avisos con plantilla de Meta');
  rr = await api('/api/avisos', 'PUT', { numeros: ['59899000103'], plantilla: 'chat_por_responder', idioma: 'es' });
  verificar(rr.status === 200, 'se guarda el nombre de la plantilla');
  antes = envios360.length;
  await post360(avisoDe('59870000004', 'Sofía\nRodríguez', 'precio exacto\nde una funda', 'd7'));
  await espera(600);
  const plant = envios360.slice(antes).find(x => x.body.to === '59899000103');
  const params = plant && plant.body.template && plant.body.template.components[0].parameters.map(x => x.text);
  verificar(plant && plant.body.type === 'template' && plant.body.template.name === 'chat_por_responder' && params.length === 2 && params.every(t => !/\n/.test(t)) && params[1] === 'Verde lo derivó a una persona del equipo' && !params.some(t => /funda/.test(t)), 'con la ventana cerrada, el aviso sale como plantilla: cliente y motivo, sin el mensaje del cliente');
  rr = await api('/api/avisos', 'PUT', { numeros: ['123'] });
  verificar(rr.status === 400, 'un número inválido se rechaza');
  rr = await api('/api/avisos', 'PUT', { numeros: [], plantilla: 'Plantilla Mal' });
  verificar(rr.status === 400, 'un nombre de plantilla inválido se rechaza');

  mostrar('26) Archivos: derivan y avisan');
  await api('/api/avisos', 'PUT', { numeros: ['59899000102'] });
  antes = envios360.length;
  await post360(aviso([{ id: 'd8', from: '59870000005', type: 'image', image: {} }]));
  await espera(600);
  pend = await json(await api('/api/chats/pendientes'));
  verificar(pend.lista.some(x => x.numero === '59870000005') && envios360.slice(antes).some(x => x.body.to === '59899000102'), 'una imagen pasa a «Chats por responder» con aviso al equipo');

  mostrar('27) Borrado automático a los 3 meses');
  const pendAntes = (await json(await api('/api/chats/pendientes'))).total;
  atencionMod._usarReloj(() => Date.now() + 91 * 86400000);
  const borradas = atencionMod.purgar();
  atencionMod._usarReloj(null);
  verificar(borradas === 3 && (await json(await api('/api/chats/respondidos?periodo=90'))).totales.todos === 0, 'a los 3 meses se borran los chats cerrados');
  verificar((await json(await api('/api/chats/pendientes'))).total === pendAntes, 'los chats que siguen esperando no se borran');

  mostrar('28) Ingreso con usuario propio');
  process.env.VERDE_LOGIN = 'activo';
  rr = await api('/api/state');
  verificar(rr.status === 401, 'sin sesión, el panel no entrega la configuración');
  rr = await realFetch(BASE + '/api/health');
  verificar(rr.status === 200 && (await json(rr)).login === true, 'el estado del servidor sigue disponible para controles');
  const jefe = usuariosMod.crear({ nombre: 'Jefe Prueba', usuario: 'jefe', rol: 'admin', firma: '' });
  rr = await api('/api/login', 'POST', { usuario: 'jefe', clave: 'equivocada' });
  verificar(rr.status === 401 && /incorrectos/.test((await json(rr)).error), 'una contraseña equivocada se rechaza');
  rr = await api('/api/login', 'POST', { usuario: 'JEFE', clave: jefe.claveTemporal });
  const galletaJefe = (rr.headers.get('set-cookie') || '').split(';')[0];
  const cab = rr.headers.get('set-cookie') || '';
  verificar(rr.status === 200 && /HttpOnly/.test(cab) && /Secure/.test(cab) && /SameSite=Strict/.test(cab), 'ingresa y recibe una sesión protegida (HttpOnly, Secure, SameSite)');
  rr = await api('/api/state', 'GET', null, galletaJefe);
  verificar(rr.status === 403 && (await json(rr)).debeCambiar === true, 'con contraseña temporal, primero debe cambiarla');
  rr = await api('/api/clave', 'POST', { actual: jefe.claveTemporal, nueva: 'corta' }, galletaJefe);
  verificar(rr.status === 400, 'una contraseña nueva demasiado corta se rechaza');
  rr = await api('/api/clave', 'POST', { actual: jefe.claveTemporal, nueva: 'ClaveNueva2026' }, galletaJefe);
  verificar(rr.status === 200, 'cambia su contraseña');
  rr = await api('/api/state', 'GET', null, galletaJefe);
  verificar(rr.status === 200, 'con la contraseña propia, el administrador accede a la configuración');
  rr = await api('/api/usuarios/' + carlaAlta.usuario.id + '/restablecer', 'POST', {}, galletaJefe);
  const claveCarla = (await json(rr)).claveTemporal;
  rr = await api('/api/login', 'POST', { usuario: 'carla', clave: claveCarla });
  const galletaCarla = (rr.headers.get('set-cookie') || '').split(';')[0];
  await api('/api/clave', 'POST', { actual: claveCarla, nueva: 'CarlaSegura2026' }, galletaCarla);
  rr = await api('/api/usuarios', 'GET', null, galletaCarla);
  verificar(rr.status === 403, 'un asesor no puede administrar usuarios');
  rr = await api('/api/state', 'GET', null, galletaCarla);
  verificar(rr.status === 403, 'un asesor no puede ver ni cambiar la configuración de Verde');
  rr = await api('/api/consumo-ia', 'GET', null, galletaCarla);
  verificar(rr.status === 403, 'un asesor no puede ver el consumo de IA');
  rr = await api('/api/cumplimiento', 'GET', null, galletaCarla);
  let rr2 = await api('/api/privacidad', 'PUT', { correo: 'x@y.com' }, galletaCarla);
  verificar(rr.status === 403 && rr2.status === 403, 'un asesor no puede ver ni cambiar los datos de privacidad');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: ['Una regla cualquiera de prueba.'], linea: 'x' }, galletaCarla);
  rr2 = await api('/api/reglas-fijas/restaurar', 'POST', {}, galletaCarla);
  verificar(rr.status === 403 && rr2.status === 403, 'un asesor no puede editar ni restaurar las reglas fijas');
  rr = await realFetch(BASE + '/api/archivos/' + 'a'.repeat(24));
  verificar(rr.status === 401, 'sin sesión no se puede ver ningún archivo');
  rr = await api('/api/ayuda', 'GET', null, galletaCarla);
  const ayC = await json(rr);
  verificar(rr.status === 200 && ayC.rol === 'asesor' && !ayC.articulos.some(a => a.soloAdmin) && ayC.articulos.map(a => a.id).join(',') === 'chats-por-responder,conversaciones,chats-respondidos,garantia,apariencia', 'un asesor ve solo los 5 temas para atender los chats');
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '¿Cómo devuelvo un chat a Verde?' }, galletaCarla);
  const pC = await json(rr);
  const sysC = JSON.stringify(llamadasIA[llamadasIA.length - 1].body.system);
  verificar(rr.status === 200 && pC.fuentes.length && pC.fuentes.every(f => f.id !== 'portafolio') && /Asesor\. No dar instrucciones/.test(sysC) && !sysC.includes('Portafolio comercial de Meta'), 'al asesor el asistente le responde sin las guías de administración, aunque la IA las cite');
  rr = await realFetch(BASE + '/privacidad');
  verificar(rr.status === 200 && /Privacidad del canal de WhatsApp/.test(await rr.text()), 'con el ingreso propio activo, la página de privacidad sigue siendo pública');
  rr = await api('/api/consumo-ia', 'GET', null, galletaJefe);
  verificar(rr.status === 200, 'el administrador sí ve el consumo de IA');
  await post360(avisoDe('59870000006', 'Diego Pérez', 'precio exacto del cargador', 'd9'));
  await espera(600);
  pend = await json(await api('/api/chats/pendientes', 'GET', null, galletaCarla));
  const idSeis = (pend.lista || []).find(x => x.numero === '59870000006').id;
  rr = await api('/api/chats/' + idSeis + '/atendido', 'POST', { motivo: 'local' }, galletaCarla);
  verificar(rr.status === 200 && (await json(rr)).chat.cierre.usuarioNombre === 'Carla Méndez', 'el asesor marca un chat y queda registrado con su nombre');
  rr = await api('/api/logout', 'POST', {}, galletaCarla, { Origin: 'https://sitio-ajeno.com' });
  verificar(rr.status === 403, 'se rechazan pedidos que vienen de otro sitio');
  await api('/api/logout', 'POST', {}, galletaCarla);
  rr = await api('/api/chats/pendientes', 'GET', null, galletaCarla);
  verificar(rr.status === 401, 'después de «Cerrar sesión» la sesión ya no sirve');
  for (let i = 0; i < 5; i++) await api('/api/login', 'POST', { usuario: 'intruso', clave: 'x' + i });
  rr = await api('/api/login', 'POST', { usuario: 'intruso', clave: 'otra' });
  verificar(rr.status === 429, 'después de 5 intentos fallidos el ingreso se bloquea');
  usuariosMod._usarReloj(() => Date.now() + 9 * 3600 * 1000);
  rr = await api('/api/state', 'GET', null, galletaJefe);
  usuariosMod._usarReloj(null);
  verificar(rr.status === 401, 'la sesión vence tras 8 horas sin uso');
  rr = await api('/api/login', 'POST', { usuario: 'jefe', clave: 'ClaveNueva2026' });
  const galleta2 = (rr.headers.get('set-cookie') || '').split(';')[0];
  rr = await api('/api/usuarios/' + jefe.usuario.id, 'PUT', { activo: false }, galleta2);
  verificar(rr.status === 400 && /administrador activo/.test((await json(rr)).error), 'no se puede desactivar al único administrador');
  const archivoU = fs.readFileSync(path.join(__dirname, 'data', 'usuarios.json'), 'utf8');
  const permisos = (fs.statSync(path.join(__dirname, 'data', 'usuarios.json')).mode & 0o777).toString(8);
  verificar(!archivoU.includes('ClaveNueva2026') && !archivoU.includes(jefe.claveTemporal) && permisos === '600', 'las contraseñas se guardan cifradas y el archivo es privado');
  process.env.VERDE_LOGIN = '';

  mostrar('29) Elegir otra IA');
  const mods = await json(await api('/api/modelos'));
  verificar(mods.modelos && mods.modelos.map(m => m.id).join(',') === 'claude-sonnet-5-5,claude-opus-5-5,claude-fable-5-1', 'están las 3 IA para elegir');
  r = await json(await api('/api/simulate', 'POST', { message: 'hola', from: 'opus', modelo: 'claude-opus-5-5' }));
  let pedIA = llamadasIA[llamadasIA.length - 1].body;
  verificar(pedIA.model === 'claude-opus-5-5' && !pedIA.thinking && pedIA.output_config.effort === 'low' && pedIA.max_tokens >= 4000, 'Opus 5.5 va con esfuerzo bajo y margen de tokens');
  r = await json(await api('/api/simulate', 'POST', { message: 'hola', from: 'fable', modelo: 'claude-fable-5-1' }));
  pedIA = llamadasIA[llamadasIA.length - 1].body;
  verificar(pedIA.model === 'claude-fable-5-1' && !pedIA.thinking && pedIA.output_config.effort === 'low' && pedIA.max_tokens >= 4000, 'Fable 5.1 va con esfuerzo bajo y margen de tokens');
  rr = await api('/api/simulate', 'POST', { message: 'hola', modelo: 'gpt-cualquiera' });
  verificar(rr.status === 400, 'una IA que no está en la lista se rechaza');

  mostrar('30) El simulador muestra si derivaría');
  r = await json(await api('/api/simulate', 'POST', { message: 'quiero el precio exacto', from: 'deriva' }));
  verificar(r.derivaria === true && /pasaría a «Chats por responder»/.test(r.reply) && !/DERIVAR/.test(r.reply), 'avisa que el chat pasaría a «Chats por responder», sin mostrar la marca');
  pend = await json(await api('/api/chats/pendientes'));
  verificar(!pend.lista.some(x => /precio exacto"?$/.test(x.ultimoMensaje) && !x.numero), 'las pruebas del simulador no generan chats por responder');

  mostrar('31) Herramienta de usuarios desde la terminal');
  let cli = spawnSync(process.execPath, ['usuarios-cli.js', 'crear-admin', 'dueno', 'Dueño Prueba'], { cwd: __dirname, encoding: 'utf8' });
  verificar(cli.status === 0 && /Administrador creado: dueno/.test(cli.stdout) && /Contraseña temporal/.test(cli.stdout), 'crea el administrador y muestra su contraseña temporal una vez');
  cli = spawnSync(process.execPath, ['usuarios-cli.js', 'restablecer', 'noexiste'], { cwd: __dirname, encoding: 'utf8' });
  verificar(cli.status === 1 && /No existe el usuario/.test(cli.stdout), 'avisa si el usuario no existe');
  cli = spawnSync(process.execPath, ['usuarios-cli.js', 'listar'], { cwd: __dirname, encoding: 'utf8' });
  verificar(cli.status === 0 && /dueno/.test(cli.stdout) && /carla/.test(cli.stdout), 'lista los usuarios');

  mostrar('32) Conversaciones: cada chat queda registrado para el panel');
  const conversacionesMod = require('./conversaciones.js');
  const { revisarEsperas } = require('./server.js');
  await post360(avisoDe('59871000001', 'Valeria Conv', 'hola, ¿tienen fundas para el iPhone 15?', 'cv1'));
  await espera(500);
  let lc = await json(await api('/api/conversaciones'));
  let fila = (lc.lista || []).find(x => x.numero === '59871000001');
  verificar(fila && fila.nombre === 'Valeria Conv' && fila.verde === true && fila.ultimo && fila.ultimo.tipo === 'verde', 'el chat aparece con su nombre, el último mensaje y el estado «Verde atendiendo»');
  const claveV = encodeURIComponent('wa:59871000001');
  let dc = await json(await api('/api/conversaciones/' + claveV));
  verificar(dc.mensajes && dc.mensajes.length === 2 && dc.mensajes[0].tipo === 'cliente' && dc.mensajes[1].tipo === 'verde' && dc.puedeResponder === true, 'el detalle muestra los mensajes con su autor y permite responder');
  rr = await api('/api/conversaciones/' + encodeURIComponent('wa:../../etc/passwd'));
  verificar(rr.status === 400, 'una identificación de chat no válida se rechaza');
  rr = await api('/api/conversaciones/' + encodeURIComponent('wa:59800000000'));
  verificar(rr.status === 404, 'un chat que no existe devuelve «no existe»');

  mostrar('33) Buscar en Conversaciones: nombre, número en cualquier formato y mensajes');
  await post360(avisoDe('59899123456', 'Lucía Búsqueda', 'necesito cambiar la pantalla del Samsung A54', 'cv2'));
  await espera(500);
  const buscarConv = async q => ((await json(await api('/api/conversaciones?buscar=' + encodeURIComponent(q)))).lista || []).map(x => x.numero);
  verificar((await buscarConv('lucia busqueda')).includes('59899123456'), 'encuentra por nombre sin importar tildes ni mayúsculas');
  verificar((await buscarConv('099 123 456')).includes('59899123456') && (await buscarConv('+598 99 123 456')).includes('59899123456') && (await buscarConv('99123456')).includes('59899123456'), 'encuentra el número escrito de cualquier forma');
  let rb = await json(await api('/api/conversaciones?buscar=' + encodeURIComponent('PANTALLA del samsung')));
  fila = (rb.lista || []).find(x => x.numero === '59899123456');
  verificar(fila && fila.coincidencia && /pantalla del Samsung/.test(fila.coincidencia.texto), 'encuentra por el contenido de los mensajes e indica cuál coincide');
  verificar(!(await buscarConv('zzzz-no-existe')).length, 'sin coincidencias, la lista queda vacía');

  mostrar('34) Apagar a Verde en un chat puntual');
  let antesEnvN = envios360.length;
  rr = await api('/api/conversaciones/' + claveV + '/apagar', 'POST', {});
  dc = (await json(rr)).conversacion || {};
  verificar(rr.status === 200 && dc.apagado === true && dc.apagadoInfo && dc.apagadoInfo.porNombre === 'Acceso general' && /apagó a Verde/.test(dc.mensajes[dc.mensajes.length - 1].texto), 'se apaga, queda registrado quién lo hizo y se anota en la conversación');
  await post360(avisoDe('59871000001', 'Valeria Conv', '¿y en color negro?', 'cv3'));
  await espera(500);
  verificar(envios360.length === antesEnvN, 'con Verde apagado en ese chat, Verde no responde');
  await post360(avisoDe('59871000002', 'Otro Cliente', 'hola', 'cv4'));
  await espera(500);
  verificar(envios360.length === antesEnvN + 1 && envios360[envios360.length - 1].body.to === '59871000002', 'los demás chats siguen atendidos por Verde');
  lc = await json(await api('/api/conversaciones?estado=apagado'));
  verificar((lc.lista || []).some(x => x.numero === '59871000001' && x.apagado) && lc.totales.apagado >= 1, 'el filtro «Verde apagado» muestra el chat');
  await revisarEsperas();
  verificar(!(await json(await api('/api/chats/pendientes'))).lista.some(x => x.numero === '59871000001'), 'antes de los 5 minutos el chat no pasa a «Chats por responder»');
  conversacionesMod._usarReloj(() => Date.now() + 6 * 60000);
  const avisosAntes = envios360.length;
  await revisarEsperas();
  conversacionesMod._usarReloj(null);
  let pendV = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59871000001');
  verificar(pendV && pendV.apagado === true && /color negro/.test(pendV.ultimoMensaje), 'a los 5 minutos sin respuesta pasa a «Chats por responder» marcado «Verde apagado»');
  verificar(envios360.slice(avisosAntes).some(x => ['59899000101', '59899000102'].includes(x.body.to)), 'y se avisa a los celulares del equipo');
  await revisarEsperas();
  verificar((await json(await api('/api/chats/pendientes'))).lista.filter(x => x.numero === '59871000001').length === 1, 'el resguardo no duplica el chat');
  rr = await api('/api/conversaciones/' + claveV + '/encender', 'POST', {});
  dc = (await json(rr)).conversacion || {};
  verificar(rr.status === 200 && dc.apagado === false && /encendió a Verde/.test(dc.mensajes[dc.mensajes.length - 1].texto), 'se vuelve a encender y queda anotado');

  mostrar('35) Responder desde el panel');
  process.env.VERDE_LOGIN = 'activo';
  rr = await api('/api/login', 'POST', { usuario: 'carla', clave: 'CarlaSegura2026' });
  const galletaC = (rr.headers.get('set-cookie') || '').split(';')[0];
  antesEnvN = envios360.length;
  rr = await api('/api/conversaciones/' + claveV + '/responder', 'POST', { texto: 'Hola Valeria, sí tenemos en negro.' }, galletaC);
  let respP = await json(rr);
  const enviadoP = envios360[envios360.length - 1] || { body: { text: {} } };
  verificar(rr.status === 200 && envios360.length === antesEnvN + 1 && enviadoP.body.to === '59871000001' && enviadoP.body.text.body === 'Hola Valeria, sí tenemos en negro.\n— Carla', 'el mensaje sale por WhatsApp con la firma de quien responde');
  const msgsP = (respP.conversacion || {}).mensajes || [];
  const ultimoP = msgsP[msgsP.length - 1] || {};
  verificar(ultimoP.tipo === 'equipo' && ultimoP.origen === 'panel' && ultimoP.autor === 'Carla Méndez', 'queda en la conversación como respuesta del equipo desde el panel');
  verificar(respP.conversacion && respP.conversacion.persona === true && respP.conversacion.pausaHasta > Date.now(), 'Verde queda en pausa en ese chat');
  pendV = (await json(await api('/api/chats/pendientes', 'GET', null, galletaC))).lista.find(x => x.numero === '59871000001');
  const respV = ((await json(await api('/api/chats/respondidos?periodo=7', 'GET', null, galletaC))).lista || []).find(x => x.numero === '59871000001');
  verificar(!pendV && respV && respV.cierre.origen === 'panel' && respV.cierre.usuarioNombre === 'Carla Méndez', 'el chat pasa a «Chats respondidos» como respondido desde el panel por Carla');
  rr = await api('/api/conversaciones/' + claveV + '/responder', 'POST', { texto: 'Gracias — Carla' }, galletaC);
  verificar(rr.status === 200 && envios360[envios360.length - 1].body.text.body === 'Gracias — Carla', 'si el mensaje ya termina con la firma, no se repite');
  rr = await api('/api/conversaciones/' + claveV + '/responder', 'POST', { texto: '   ' }, galletaC);
  verificar(rr.status === 400, 'un mensaje vacío no se envía');
  conversacionesMod._usarReloj(() => Date.now() + 25 * 3600000);
  rr = await api('/api/conversaciones/' + claveV + '/responder', 'POST', { texto: 'hola' }, galletaC);
  conversacionesMod._usarReloj(null);
  verificar(rr.status === 409 && /24 horas/.test((await json(rr)).error || ''), 'pasadas 24 horas del último mensaje del cliente, no se puede responder desde el panel');
  rr = await api('/api/conversaciones/' + claveV + '/responder', 'POST', { texto: 'hola' });
  verificar(rr.status === 401, 'sin sesión no se puede responder');
  rr = await api('/api/conversaciones/' + claveV + '/apagar', 'POST', {});
  verificar(rr.status === 401, 'sin sesión no se puede apagar a Verde');
  await api('/api/logout', 'POST', {}, galletaC);
  process.env.VERDE_LOGIN = '';

  mostrar('36) «Devolver a Verde» termina la pausa automática');
  rr = await api('/api/conversaciones/' + claveV + '/reanudar', 'POST', {});
  dc = (await json(rr)).conversacion || {};
  verificar(rr.status === 200 && !dc.pausaHasta && dc.verde === true && /devolvió el chat a Verde/.test(dc.mensajes[dc.mensajes.length - 1].texto), 'Verde vuelve a atender el chat y queda anotado quién se lo devolvió');
  antesEnvN = envios360.length;
  await post360(avisoDe('59871000001', 'Valeria Conv', 'perfecto, gracias', 'cv5'));
  await espera(500);
  verificar(envios360.length === antesEnvN + 1 && envios360[envios360.length - 1].body.to === '59871000001', 'y responde el siguiente mensaje del cliente');

  mostrar('37) Si alguien interviene mientras Verde prepara la respuesta, no la envía');
  antesEnvN = envios360.length;
  let envioCarrera = post360(avisoDe('59871000003', 'Carrera Uno', 'hola, ¿abren mañana?', 'cv6'));
  await espera(60);
  await api('/api/conversaciones/' + encodeURIComponent('wa:59871000003') + '/apagar', 'POST', {});
  await envioCarrera; await espera(400);
  verificar(envios360.length === antesEnvN, 'si apagan a Verde en ese chat mientras prepara la respuesta, la descarta');
  antesEnvN = envios360.length;
  envioCarrera = post360(avisoDe('59871000004', 'Carrera Dos', 'hola, ¿tienen cargadores?', 'cv7'));
  await espera(60);
  await post360(eco('59871000004', 'Hola, te atiendo yo.\n— Carla', 'cv7eco'));
  await envioCarrera; await espera(400);
  verificar(envios360.length === antesEnvN, 'si una persona responde desde el celular mientras Verde prepara la respuesta, Verde no la envía');
  modoIA = 'error400';
  antesEnvN = envios360.length;
  envioCarrera = post360(avisoDe('59871000005', 'Carrera Tres', 'una consulta', 'cv8'));
  await espera(60);
  await api('/api/conversaciones/' + encodeURIComponent('wa:59871000005') + '/apagar', 'POST', {});
  await envioCarrera; await espera(500);
  modoIA = 'ok';
  verificar(envios360.length === antesEnvN && !(await json(await api('/api/chats/pendientes'))).lista.some(x => x.numero === '59871000005'), 'tampoco envía la frase de error si la IA falla y alguien ya intervino');

  mostrar('38) Chats derivados antes de instalar esta versión');
  atencionMod.derivar({ clave: 'wa:59871000009', destino: { to: '59871000009' }, numero: '59871000009', nombre: 'Cliente Anterior', mensajeCliente: 'consulta de antes', respuestaVerde: 'Te paso con un asesor', motivo: 'Verde lo derivó a una persona del equipo.' });
  dc = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59871000009')));
  verificar((dc.mensajes || []).some(m => m.tipo === 'cliente' && m.texto === 'consulta de antes') && dc.pendiente === true && dc.puedeResponder === true, 'al abrirlo, la conversación se arma con su recorrido y se puede responder');

  mostrar('39) «Chats por responder» trae lo necesario para el buscador');
  const pAnt = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59871000009');
  verificar(pAnt && pAnt.clave === 'wa:59871000009' && Array.isArray(pAnt.textos) && pAnt.textos.includes('consulta de antes') && pAnt.apagado === false, 'cada chat trae su identificación, los mensajes del cliente y si Verde está apagado');

  mostrar('40) Conversaciones: borrado automático a los 3 meses');
  conversacionesMod._usarReloj(() => Date.now() + 91 * 86400000);
  const borradasC = conversacionesMod.purgar();
  conversacionesMod._usarReloj(null);
  lc = await json(await api('/api/conversaciones'));
  verificar(borradasC >= 1 && (lc.lista || []).length >= 1 && lc.lista.every(x => x.apagado), 'se borran los chats sin movimiento, salvo los que tienen a Verde apagado');
  const permisosC = (fs.statSync(path.join(__dirname, 'data', 'conversaciones-panel.json')).mode & 0o777).toString(8);
  verificar(permisosC === '600', 'el archivo de conversaciones es privado');

  mostrar('41) La conversación abierta permite «Marcar atendido»');
  dc = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59871000009')));
  const pend41 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59871000009');
  verificar(pend41 && dc.pendienteId === pend41.id, 'un chat por responder trae la identificación de su atención');
  rr = await api('/api/chats/' + dc.pendienteId + '/atendido', 'POST', { motivo: 'llamada' });
  dc = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59871000009')));
  verificar(rr.status === 200 && dc.pendienteId === null && dc.pendiente === false, 'después de marcarlo, la conversación ya no figura por responder');


  mostrar('42) «Devolver a Verde»: responde enseguida la consulta que quedó pendiente');
  const claveL = encodeURIComponent('wa:59872000001');
  await post360(avisoDe('59872000001', 'Lucía Devolver', 'quiero el precio exacto de la pantalla del A54', 'dv1'));
  await espera(500);
  verificar((await json(await api('/api/chats/pendientes'))).lista.some(x => x.numero === '59872000001'), 'al pedir el precio, Verde deriva y el chat pasa a «Chats por responder»');
  rr = await api('/api/conversaciones/' + claveL + '/responder', 'POST', { texto: 'Hola Lucía, el cambio de pantalla cuesta $ 4.900.' });
  dc = (await json(rr)).conversacion || {};
  verificar(rr.status === 200 && dc.pausaHasta && !dc.pendiente, 'el asesor pasa el precio desde el panel y Verde queda en pausa');
  antesEnvN = envios360.length;
  let antesIA42 = llamadasIA.length;
  await post360(avisoDe('59872000001', 'Lucía Devolver', '¿y tienen fundas para ese modelo?', 'dv2'));
  await espera(500);
  verificar(envios360.length === antesEnvN && llamadasIA.length === antesIA42, 'durante la pausa Verde no responde la consulta nueva');
  rr = await api('/api/conversaciones/' + claveL + '/reanudar', 'POST', {});
  let rj = await json(rr);
  dc = rj.conversacion || {};
  const salio42 = envios360[envios360.length - 1] || { body: { text: {} } };
  verificar(rr.status === 200 && rj.verde && rj.verde.respondio === true && rj.verde.derivo === false, 'al devolverle el chat, Verde responde enseguida');
  verificar(envios360.length === antesEnvN + 1 && salio42.body.to === '59872000001' && /^Respuesta de Verde \d+$/.test(salio42.body.text.body), 'la respuesta sale por WhatsApp al cliente');
  const pedido42 = (llamadasIA[llamadasIA.length - 1] || { body: { messages: [] } }).body.messages;
  verificar(pedido42.some(m => m.role === 'assistant' && /\[Asesor humano\].*4\.900/.test(String(m.content))) && /fundas/.test(String((pedido42[pedido42.length - 1] || {}).content)), 'Verde responde sabiendo lo que dijo el asesor y la consulta pendiente');
  verificar(!dc.pausaHasta && dc.mensajes.some(m => m.tipo === 'sistema' && /Acceso general devolvió el chat a Verde/.test(m.texto)) && dc.mensajes[dc.mensajes.length - 1].tipo === 'verde', 'queda anotado quién devolvió el chat y la respuesta de Verde');

  mostrar('43) Sin consulta pendiente, Verde espera el próximo mensaje');
  await api('/api/conversaciones/' + claveL + '/responder', 'POST', { texto: 'Cualquier otra cosa, me escribís.' });
  antesEnvN = envios360.length; antesIA42 = llamadasIA.length;
  rr = await api('/api/conversaciones/' + claveL + '/reanudar', 'POST', {});
  rj = await json(rr);
  verificar(rr.status === 200 && rj.verde && rj.verde.respondio === false && envios360.length === antesEnvN && llamadasIA.length === antesIA42 && !rj.conversacion.pausaHasta, 'si la última palabra fue del asesor, Verde no envía nada y queda listo para el próximo mensaje');
  await post360(avisoDe('59872000001', 'Lucía Devolver', 'gracias', 'dv2b'));
  await espera(500);
  verificar(envios360.length === antesEnvN + 1, 'cuando el cliente vuelve a escribir, Verde responde');

  mostrar('44) Si la consulta pendiente vuelve a ser un precio, Verde deriva de nuevo');
  await api('/api/conversaciones/' + claveL + '/responder', 'POST', { texto: 'Te confirmo el stock enseguida.' });
  await post360(avisoDe('59872000001', 'Lucía Devolver', '¿y el precio exacto de la batería?', 'dv3'));
  await espera(500);
  rr = await api('/api/conversaciones/' + claveL + '/reanudar', 'POST', {});
  rj = await json(rr);
  verificar(rj.verde && rj.verde.respondio === true && rj.verde.derivo === true && (await json(await api('/api/chats/pendientes'))).lista.some(x => x.numero === '59872000001'), 'Verde responde y deriva: el chat vuelve a «Chats por responder»');

  mostrar('45) Resguardo: el cliente escribe durante la pausa y nadie responde en 5 minutos');
  await post360(avisoDe('59872000002', 'Mario Pausa', 'hola, ¿tienen cargadores?', 'dv4'));
  await espera(500);
  await post360(eco('59872000002', 'Hola Mario, sí tenemos.\n— Carla', 'dv4eco'));
  await espera(300);
  antesEnvN = envios360.length;
  await post360(avisoDe('59872000002', 'Mario Pausa', '¿y de carga rápida?', 'dv5'));
  await espera(500);
  verificar(envios360.length === antesEnvN, 'durante la pausa Verde no responde');
  await revisarEsperas();
  verificar(!(await json(await api('/api/chats/pendientes'))).lista.some(x => x.numero === '59872000002'), 'antes de los 5 minutos el chat no pasa a «Chats por responder»');
  conversacionesMod._usarReloj(() => Date.now() + 6 * 60000);
  const avisos45 = envios360.length;
  await revisarEsperas();
  conversacionesMod._usarReloj(null);
  const pend45 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59872000002');
  verificar(pend45 && /carga rápida/.test(pend45.ultimoMensaje), 'a los 5 minutos sin respuesta pasa a «Chats por responder»');
  const det45 = pend45 ? await json(await api('/api/chats/' + pend45.id)) : {};
  verificar(/estaba en pausa/.test(JSON.stringify(det45)), 'el motivo indica que Verde estaba en pausa');
  verificar(envios360.slice(avisos45).some(x => ['59899000101', '59899000102'].includes(x.body.to)), 'y se avisa a los celulares del equipo');
  await revisarEsperas();
  verificar((await json(await api('/api/chats/pendientes'))).lista.filter(x => x.numero === '59872000002').length === 1, 'el resguardo no duplica el chat');

  mostrar('46) Si el equipo responde a tiempo o devuelve el chat a Verde, el resguardo no deriva');
  await post360(avisoDe('59872000003', 'Nora Pausa', 'hola', 'dv6'));
  await espera(500);
  await post360(eco('59872000003', 'Hola Nora, te atiendo yo.\n— Carla', 'dv6eco'));
  await espera(300);
  await post360(avisoDe('59872000003', 'Nora Pausa', '¿abren el sábado?', 'dv7'));
  await espera(500);
  rr = await api('/api/conversaciones/' + encodeURIComponent('wa:59872000003') + '/reanudar', 'POST', {});
  rj = await json(rr);
  verificar(rj.verde && rj.verde.respondio === true, 'al devolverle el chat, Verde responde la consulta del sábado');
  await post360(avisoDe('59872000004', 'Pablo Pausa', 'hola', 'dv8'));
  await espera(500);
  await post360(eco('59872000004', 'Hola Pablo.\n— Carla', 'dv8eco'));
  await espera(300);
  await post360(avisoDe('59872000004', 'Pablo Pausa', '¿tienen fundas?', 'dv9'));
  await espera(500);
  await post360(eco('59872000004', 'Sí, tenemos varias.\n— Carla', 'dv9eco'));
  await espera(300);
  conversacionesMod._usarReloj(() => Date.now() + 6 * 60000);
  await revisarEsperas();
  conversacionesMod._usarReloj(null);
  const pend46 = (await json(await api('/api/chats/pendientes'))).lista.map(x => x.numero);
  verificar(!pend46.includes('59872000003'), 'después de «Devolver a Verde» el resguardo ya no deriva ese chat');
  verificar(!pend46.includes('59872000004'), 'si una persona del equipo responde dentro de los 5 minutos, el chat no se deriva');


  mostrar('47) Consumo de IA: cada consulta queda registrada con su costo');
  const consumoMod = require('./consumo.js');
  const consumoIA = async (q) => json(await api('/api/consumo-ia' + (q || ''), 'GET'));
  let c0 = await consumoIA();
  verificar(c0.total && c0.total.consultas > 0 && c0.tipo === 'mes' && c0.desde.endsWith('-01') && c0.hasta === c0.hoy, 'por defecto muestra el mes en curso, hasta hoy');
  const precioPorConsulta = (1000 * c0.modeloActual.entrada + 100 * c0.modeloActual.salida) / 1e6;
  await post360(avisoDe('59872000010', 'Consumo Prueba', 'hola, ¿abren hoy?', 'cs1'));
  await espera(500);
  await post360(avisoDe('59872000010', 'Consumo Prueba', '¿y mañana?', 'cs2'));
  await espera(500);
  await api('/api/simulate', 'POST', { message: 'hola desde el simulador', from: 'consumo' });
  let c1 = await consumoIA();
  verificar(c1.total.consultas - c0.total.consultas === 3, 'cada consulta a la IA queda registrada (dos por WhatsApp y una de prueba)');
  verificar(Math.abs((c1.total.costo - c0.total.costo) - 3 * precioPorConsulta) < 1e-9, 'el costo se calcula con el precio del modelo en uso (1.000 tokens de entrada y 100 de salida por consulta)');
  verificar(c1.porOrigen.whatsapp.consultas - c0.porOrigen.whatsapp.consultas === 2 && c1.porOrigen.pruebas.consultas - c0.porOrigen.pruebas.consultas === 1, 'separa las consultas de WhatsApp de las pruebas en el panel');
  verificar(c1.modeloActual.id === 'claude-sonnet-5-5' && c1.modeloActual.entrada === 2 && c1.modeloActual.salida === 10 && c1.modelos.some(m => m.id === 'claude-sonnet-5-5'), 'informa el modelo en uso con su precio oficial');
  verificar(c1.dias.length >= 1 && c1.dias[0].fecha === c1.hoy && Math.abs(c1.dias.reduce((a, d) => a + d.costo, 0) - c1.total.costo) < 1e-6, 'el detalle por día suma el total del período');
  verificar(Math.abs(c1.promedio - c1.total.costo / c1.total.consultas) < 1e-6, 'calcula el costo promedio por consulta');
  modoIA = 'vacio';
  await api('/api/simulate', 'POST', { message: 'consulta que vuelve vacía', from: 'consumo2' });
  modoIA = 'error400';
  await api('/api/simulate', 'POST', { message: 'consulta con error', from: 'consumo3' });
  modoIA = 'ok';
  let c2 = await consumoIA();
  verificar(c2.total.consultas - c1.total.consultas === 1, 'se registra la consulta que Anthropic cobra aunque vuelva sin texto, y no la que da error');

  mostrar('48) Consumo de IA: filtros de período');
  let rc = await api('/api/consumo-ia?desde=2020-01-01&hasta=2020-01-31', 'GET');
  let cr = await json(rc);
  verificar(rc.status === 200 && cr.tipo === 'rango' && cr.total.consultas === 0 && cr.dias.length === 0 && cr.total.costo === 0, 'un rango sin datos devuelve cero');
  cr = await consumoIA('?desde=' + c2.hoy + '&hasta=' + c2.hoy);
  verificar(cr.total.consultas === c2.dias[0].consultas && cr.dias.length === 1, 'un rango de un solo día devuelve ese día');
  cr = await consumoIA('?mes=' + c2.hoy.slice(0, 7));
  verificar(cr.tipo === 'mes' && cr.total.consultas === c2.total.consultas, 'filtrar por el mes en curso coincide con la vista por defecto');
  verificar(cr.meses[0] === c2.hoy.slice(0, 7), 'la lista de meses empieza por el mes en curso');
  consumoMod._usarReloj(() => Date.parse('2026-10-01T02:30:00Z'));   // 23:30 del 30/09/2026 en Montevideo
  consumoMod.registrar({ modelo: 'claude-sonnet-5-5', origen: 'whatsapp', usage: { input_tokens: 500000, output_tokens: 0 } });
  consumoMod._usarReloj(null);
  cr = await consumoIA('?mes=2026-09');
  verificar(cr.dias.some(x => x.fecha === '2026-09-30' && x.costo === 1) && cr.hasta === '2026-09-30', 'el día se calcula en hora de Montevideo (23:30 del 30/09 cuenta en septiembre) y un mes cerrado se muestra completo');
  verificar((await consumoIA()).meses.includes('2026-09'), 'los meses con datos aparecen en la lista para filtrar');
  consumoMod.registrar({ modelo: 'modelo-sin-precio', origen: 'pruebas', usage: { input_tokens: 10, output_tokens: 10 } });
  cr = await consumoIA();
  verificar(cr.total.sinPrecio === 1 && cr.modelos.some(m => m.id === 'modelo-sin-precio' && m.costo === 0), 'una consulta de un modelo sin precio registrado se cuenta y se señala, sin inventar un costo');
  rc = await api('/api/consumo-ia?desde=2026-13-01&hasta=2026-12-31', 'GET');
  verificar(rc.status === 400, 'rechaza una fecha inválida');
  rc = await api('/api/consumo-ia?desde=2026-10-10&hasta=2026-10-01', 'GET');
  verificar(rc.status === 400, 'rechaza un rango con inicio posterior al fin');
  rc = await api('/api/consumo-ia?desde=2020-01-01&hasta=2026-12-31', 'GET');
  verificar(rc.status === 400, 'rechaza rangos de más de 400 días');
  rc = await api('/api/consumo-ia?mes=2026-13', 'GET');
  verificar(rc.status === 400, 'rechaza un mes inválido');


  mostrar('49) Reglas fijas: van siempre en el prompt de Verde');
  const cumplimientoMod = require('./cumplimiento.js');
  await post360(avisoDe('59872000020', 'Reglas Prueba', 'hola, ¿qué horario tienen?', 'rf1'));
  await espera(500);
  const sys49 = JSON.stringify((llamadasIA[llamadasIA.length - 1] || { body: {} }).body.system || '');
  verificar(/REGLAS FIJAS DEL SISTEMA/.test(sys49) && cumplimientoMod.REGLAS_FIJAS.every(r => sys49.includes(r)), 'las cuatro reglas fijas van en cada consulta a la IA');

  mostrar('50) Presentación como asistente virtual en la primera respuesta');
  const pres50 = envios360.filter(x => x.body.to === '59872000020').pop();
  verificar(pres50 && pres50.body.text.body.endsWith(cumplimientoMod.lineaInicialWhatsApp()) && /\n\n_Soy Verde, el asistente virtual de Pantalla Verde\./.test(pres50.body.text.body), 'la primera respuesta termina con la presentación fija, en cursiva');
  verificar(/Más información:_ chat\.pantallaverde\.com\/privacidad$/.test(pres50.body.text.body), 'el enlace queda fuera de la cursiva, para que WhatsApp lo reconozca completo');
  await post360(avisoDe('59872000020', 'Reglas Prueba', '¿y los sábados?', 'rf2'));
  await espera(500);
  const pres50b = envios360.filter(x => x.body.to === '59872000020').pop();
  verificar(pres50b && pres50b !== pres50 && !/asistente virtual/.test(pres50b.body.text.body), 'las respuestas siguientes no repiten la presentación');
  const conv50 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59872000020'), 'GET'));
  const verdes50 = (conv50.mensajes || []).filter(m => m.tipo === 'verde');
  verificar(verdes50.length >= 2 && /asistente virtual/.test(verdes50[0].texto) && !/asistente virtual/.test(verdes50[1].texto), 'el panel muestra exactamente lo que recibió el cliente');
  const ia50 = (llamadasIA[llamadasIA.length - 1] || { body: { messages: [] } }).body.messages;
  verificar(!ia50.some(m => /asistente virtual/.test(String(m.content))), 'la presentación no se suma al historial que lee la IA');

  mostrar('51) Presentación en «Probar a Verde»');
  await api('/api/simulate/reset', 'POST', { from: 'presentacion' });
  let s51 = await json(await api('/api/simulate', 'POST', { message: 'hola', from: 'presentacion' }));
  verificar(s51.reply && s51.reply.includes(cumplimientoMod.lineaInicial()), 'la primera respuesta del simulador muestra la presentación');
  s51 = await json(await api('/api/simulate', 'POST', { message: '¿y el horario?', from: 'presentacion' }));
  verificar(s51.reply && !/asistente virtual/.test(s51.reply), 'la segunda no la repite');

  mostrar('52) Avisos según la ventana de 24 horas de cada celular');
  await api('/api/avisos', 'PUT', { numeros: ['59899000201', '59899000202'], plantilla: '' });
  await post360(avisoDe('59899000201', '', 'inicio de turno', 'av201'));
  await espera(300);
  let est52 = await json(await api('/api/avisos', 'GET'));
  const e201 = est52.estados.find(x => x.numero === '59899000201'), e202 = est52.estados.find(x => x.numero === '59899000202');
  verificar(e201 && e201.proximo === 'comun' && e201.ventanaHasta > Date.now() + 23 * 3600000 && e202 && e202.proximo === 'sin_envio' && e202.ventanaHasta === null, 'el panel sabe qué celular tiene la ventana abierta y cuál no');
  antesEnvN = envios360.length;
  await post360(avisoDe('59872000021', 'Aviso Prueba', 'necesito el precio exacto de la batería', 'av1'));
  await espera(600);
  const env52 = envios360.slice(antesEnvN);
  const a201 = env52.find(x => x.body.to === '59899000201'), a202 = env52.find(x => x.body.to === '59899000202');
  verificar(a201 && a201.body.type === 'text' && /hay un chat por responder de Aviso Prueba/.test(a201.body.text.body) && /Motivo: Verde lo derivó a una persona del equipo/.test(a201.body.text.body) && !/batería/.test(a201.body.text.body), 'con la ventana abierta, el aviso sale como mensaje común y sin el mensaje del cliente');
  verificar(!a202, 'con la ventana cerrada y sin plantilla, no se intenta un envío que WhatsApp rechazaría');
  const pend52 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59872000021');
  const det52 = JSON.stringify(pend52 ? await json(await api('/api/chats/' + pend52.id)) : {});
  verificar(/1 de 2 celulares/.test(det52) && /no hay plantilla configurada/.test(det52), 'la atención deja constancia de qué celular quedó sin aviso y por qué');
  await api('/api/avisos', 'PUT', { numeros: ['59899000201', '59899000202'], plantilla: 'chat_por_responder', idioma: 'es' });
  est52 = await json(await api('/api/avisos', 'GET'));
  verificar(est52.estados.find(x => x.numero === '59899000202').proximo === 'plantilla', 'con plantilla configurada, el celular sin ventana pasa a recibir la plantilla');
  antesEnvN = envios360.length;
  await post360(avisoDe('59872000022', 'Plantilla Prueba', 'precio exacto de un glass', 'av2'));
  await espera(600);
  const env52b = envios360.slice(antesEnvN);
  const p202 = env52b.find(x => x.body.to === '59899000202'), p201 = env52b.find(x => x.body.to === '59899000201');
  const par52 = p202 && p202.body.template ? p202.body.template.components[0].parameters.map(x => x.text) : [];
  verificar(p202 && p202.body.type === 'template' && par52[0] === 'Plantilla Prueba (+59872000022)' && par52[1] === 'Verde lo derivó a una persona del equipo', 'la plantilla lleva el cliente y el motivo');
  verificar(p201 && p201.body.type === 'text', 'el celular con la ventana abierta sigue recibiendo el mensaje común');
  await api('/api/avisos', 'PUT', { numeros: ['59899000102'] });

  mostrar('53) Página pública de privacidad');
  rr = await realFetch(BASE + '/privacidad');
  let html53 = await rr.text();
  verificar(rr.status === 200 && /text\/html/.test(rr.headers.get('content-type') || '') && /Privacidad del canal de WhatsApp/.test(html53) && /RUT 218621040016/.test(html53), 'la página se ve sin iniciar sesión');
  verificar(/por este mismo canal de WhatsApp/.test(html53) && !/inscripta ante la Unidad/.test(html53), 'sin datos cargados, indica el canal y el local, y no afirma una inscripción inexistente');
  rr = await api('/api/privacidad', 'PUT', { correo: 'no-es-un-correo', urcdp: '' });
  verificar(rr.status === 400, 'rechaza un correo inválido');
  rr = await api('/api/privacidad', 'PUT', { correo: 'privacidad@pantallaverde.com', urcdp: '' });
  const pr53 = await json(rr);
  verificar(rr.status === 200 && pr53.privacidad.correo === 'privacidad@pantallaverde.com' && /^\d{4}-\d{2}-\d{2}$/.test(pr53.privacidad.actualizada), 'guarda el correo y la fecha de actualización');
  html53 = await (await realFetch(BASE + '/privacidad')).text();
  verificar(/mailto:privacidad@pantallaverde\.com/.test(html53) && !/inscripta ante la Unidad/.test(html53), 'la página muestra el correo para ejercer los derechos');
  rr = await api('/api/privacidad', 'PUT', { correo: 'privacidad@pantallaverde.com', urcdp: '<script>' });
  verificar(rr.status === 400, 'rechaza un número de inscripción con caracteres no válidos');
  await api('/api/privacidad', 'PUT', { correo: 'privacidad@pantallaverde.com', urcdp: 'URCDP-12345' });
  html53 = await (await realFetch(BASE + '/privacidad')).text();
  verificar(/inscripta ante la Unidad Reguladora y de Control de Datos Personales \(URCDP\) con el número URCDP-12345/.test(html53), 'con el número cargado, aparece la sección de inscripción');
  const cu53 = await json(await api('/api/cumplimiento', 'GET'));
  verificar(cu53.reglas.length === 4 && /asistente virtual/.test(cu53.lineaInicial) && cu53.url === 'https://chat.pantallaverde.com/privacidad' && cu53.privacidad.urcdp === 'URCDP-12345', 'el panel recibe las reglas fijas, la presentación y los datos de privacidad');


  mostrar('54) Reglas fijas del sistema: editables con resguardos');
  let cf = await json(await api('/api/cumplimiento', 'GET'));
  verificar(cf.recomendadas === true && cf.modificadoPor === null && cf.reglas.length === 4, 'sin cambios, rigen las reglas recomendadas');
  const nuevas54 = cf.reglas.slice(0, 3).concat(['Ofrece siempre el diagnóstico antes de cualquier reparación.']);
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: nuevas54, linea: cf.lineaInicial });
  cf = await json(rr);
  verificar(rr.status === 200 && cf.recomendadas === false && cf.reglas[3] === nuevas54[3] && cf.modificadoPor === 'Acceso general' && cf.modificadoEn > 0, 'se guardan las reglas editadas, con registro de quién y cuándo');
  await post360(avisoDe('59872000030', 'Reglas Editadas', 'hola', 're1'));
  await espera(500);
  const sys54 = JSON.stringify((llamadasIA[llamadasIA.length - 1] || { body: {} }).body.system || '');
  verificar(sys54.includes('Ofrece siempre el diagnóstico antes de cualquier reparación.') && !sys54.includes('No informa precios de repuestos ni de reparaciones'), 'Verde usa las reglas editadas');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: [], linea: cf.lineaInicial });
  verificar(rr.status === 400, 'no se puede dejar sin reglas');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: nuevas54.concat(['corta']), linea: cf.lineaInicial });
  verificar(rr.status === 400, 'rechaza una regla demasiado corta');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: nuevas54, linea: 'Soy Verde, el asistente virtual de la tienda.' });
  const sin54 = await json(rr);
  verificar(rr.status === 200 && sin54.sinEnlace === true && sin54.lineaInicial === 'Soy Verde, el asistente virtual de la tienda.', 'desde la 1.3.9 la presentación se puede guardar sin el enlace, y el servidor lo informa para el aviso');
  await post360(avisoDe('59872000032', 'Sin Enlace', 'hola', 're3'));
  await espera(500);
  const env54b = envios360.filter(x => x.body.to === '59872000032').pop();
  verificar(env54b && env54b.body.text.body.endsWith('\n\n_Soy Verde, el asistente virtual de la tienda._'), 'sin enlace, la presentación sale completa en cursiva');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: nuevas54, linea: 'Soy _Verde_, el asistente. Más información: chat.pantallaverde.com/privacidad' });
  verificar(rr.status === 400, 'rechaza los caracteres de formato de WhatsApp en la presentación');
  rr = await api('/api/reglas-fijas', 'PUT', { reglas: nuevas54, linea: 'Hola, soy Verde, el asistente virtual. Privacidad: chat.pantallaverde.com/privacidad (3 meses).' });
  verificar(rr.status === 200, 'acepta una presentación nueva que incluye el enlace');
  await post360(avisoDe('59872000031', 'Linea Nueva', 'hola', 're2'));
  await espera(500);
  const env54 = envios360.filter(x => x.body.to === '59872000031').pop();
  verificar(env54 && env54.body.text.body.endsWith('\n\n_Hola, soy Verde, el asistente virtual. Privacidad:_ chat.pantallaverde.com/privacidad (3 meses).'), 'la primera respuesta usa la presentación nueva, con el enlace fuera de la cursiva');
  rr = await api('/api/reglas-fijas/restaurar', 'POST', {});
  cf = await json(rr);
  verificar(rr.status === 200 && cf.recomendadas === true && cf.reglas.length === 4 && /^Soy Verde/.test(cf.lineaInicial) && cf.modificadoPor === 'Acceso general', 'restaurar vuelve a las reglas recomendadas y deja constancia de quién lo hizo');

  mostrar('55) Centro de ayuda: manual y guías según el rol');
  const ay55 = await json(await api('/api/ayuda', 'GET'));
  verificar(ay55.rol === 'admin' && ay55.articulos.filter(a => a.grupo === 'manual').length === 9 && ay55.articulos.filter(a => a.grupo === 'meta').length === 6 && ay55.revisionMeta === '2026-10-24', 'el administrador ve los 9 temas del manual y las 6 guías de Meta');
  verificar(ay55.articulos.every(a => a.titulo && a.resumen && a.bloques && a.bloques.length), 'cada tema tiene título, resumen y contenido');

  mostrar('56) Asistente de ayuda');
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '¿Cómo devuelvo un chat a Verde?' });
  const pa56 = await json(rr);
  const ped56 = llamadasIA[llamadasIA.length - 1].body;
  const sys56 = JSON.stringify(ped56.system);
  verificar(rr.status === 200 && /Devolver a Verde/.test(pa56.respuesta) && pa56.fuentes.some(f => f.id === 'conversaciones' && f.titulo), 'responde con el contenido del manual e indica la fuente');
  verificar(ped56.model === 'claude-sonnet-5-5', 'usa siempre Sonnet 5.5, el modelo más económico');
  verificar(sys56.includes('ASISTENTE DE AYUDA') && sys56.includes('12 horas') && sys56.includes('Conversaciones y «Devolver a Verde»') && sys56.includes('Portafolio comercial de Meta'), 'el asistente conoce el manual, las guías y la configuración real');
  const c56 = await json(await api('/api/consumo-ia', 'GET'));
  verificar(c56.porOrigen.ayuda && c56.porOrigen.ayuda.consultas >= 1, 'la consulta se registra en «Consumo de IA» como origen «Ayuda»');
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '¿y si no responde?', historial: [{ pregunta: '¿Cómo devuelvo un chat a Verde?', respuesta: pa56.respuesta }] });
  const msgs56 = llamadasIA[llamadasIA.length - 1].body.messages;
  verificar(rr.status === 200 && msgs56.length === 3 && msgs56[0].content === '¿Cómo devuelvo un chat a Verde?' && msgs56[2].content === '¿y si no responde?', 'mantiene el hilo de la conversación');
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '' });
  verificar(rr.status === 400, 'rechaza una pregunta vacía');
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: 'x'.repeat(501) });
  verificar(rr.status === 400, 'rechaza una pregunta de más de 500 caracteres');
  process.env.VERDE_AYUDA_LIMITE_HORA = '2';
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '¿Qué es la ventana de 24 horas?' });
  verificar(rr.status === 429 && /límite/.test((await json(rr)).error), 'respeta el límite de preguntas por hora');
  delete process.env.VERDE_AYUDA_LIMITE_HORA;
  modoIA = 'error400';
  rr = await api('/api/ayuda/preguntar', 'POST', { pregunta: '¿Qué hago si no anda?' });
  modoIA = 'ok';
  verificar(rr.status === 502 && /no está disponible/.test((await json(rr)).error), 'si la IA falla, avisa sin romper el panel');


  mostrar('57) Archivos recibidos: se guardan solo al tocar «Descargar»');
  const cripto57 = require('crypto'), fs57 = require('fs'), path57 = require('path'), arch57 = require('./archivos.js');
  const huella = (b, f) => cripto57.createHash('sha256').update(b).digest(f || 'hex');
  const clave57 = 'wa:59873000001';
  const ultimoArchivo = async () => { const d = await json(await api('/api/conversaciones/' + encodeURIComponent(clave57), 'GET')); return (d.mensajes || []).filter(m => m.archivo).pop().archivo; };
  const descargar57 = async id => { const r = await api('/api/archivos/' + id + '/descargar', 'POST', { clave: clave57 }); return { status: r.status, j: await json(r) }; };
  const foto57 = Buffer.from('FOTO-DE-PRUEBA-' + 'x'.repeat(200));
  medios360['med-foto-1'] = { datos: foto57, mime: 'image/jpeg' };
  await post360(aviso([{ id: 'ar1', from: '59873000001', type: 'image', image: { id: 'med-foto-1', mime_type: 'image/jpeg', sha256: huella(foto57), caption: 'Así quedó la pantalla' } }]));
  await espera(500);
  let a57 = await ultimoArchivo();
  verificar(a57 && a57.estado === 'sandbox' && a57.tipo === 'image' && a57.leyenda === 'Así quedó la pantalla', 'en el modo de prueba (sandbox) la tarjeta avisa que el archivo se ve en el celular');
  verificar(!a57.mediaId && !a57.sha256, 'el panel no recibe el identificador de WhatsApp ni la huella');
  verificar(pedidosMedia.length === 0 && !fs57.existsSync(path57.join(__dirname, 'data', 'archivos')), 'ningún archivo se descarga ni se guarda automáticamente');
  let r57 = await descargar57(a57.id);
  verificar(r57.status === 200 && !r57.j.ok && r57.j.archivo.estado === 'sandbox' && pedidosMedia.length === 0, 'en el modo de prueba no se hace ningún pedido a 360dialog (no lo permite)');
  const urlPrevia57 = process.env.D360_MESSAGES_URL;
  process.env.D360_MESSAGES_URL = 'https://waba-v2.360dialog.io/messages';
  a57 = await ultimoArchivo();
  verificar(a57.estado === 'pendiente' && a57.limite > Date.now() + 6 * 86400000, 'con el número real, la misma tarjeta ofrece «Descargar» con el plazo');
  r57 = await descargar57(a57.id);
  verificar(r57.status === 200 && r57.j.ok && r57.j.archivo.estado === 'guardado' && r57.j.archivo.tamano === foto57.length && r57.j.archivo.enPanel, 'al tocar «Descargar», el archivo se baja de WhatsApp, se verifica y se guarda');
  verificar(pedidosMedia.includes('https://waba-v2.360dialog.io/med-foto-1') && pedidosMedia.some(u => u.startsWith('https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=med-foto-1')), 'usa los dos pasos de la documentación de 360dialog (dirección y descarga)');
  rr = await realFetch(BASE + '/api/archivos/' + a57.id);
  const buf57 = Buffer.from(await rr.arrayBuffer());
  verificar(rr.status === 200 && rr.headers.get('content-type') === 'image/jpeg' && /^inline/.test(rr.headers.get('content-disposition')) && rr.headers.get('x-content-type-options') === 'nosniff' && buf57.equals(foto57), 'la foto se ve en el panel tal cual llegó');
  rr = await realFetch(BASE + '/api/archivos/' + a57.id + '?guardar=1');
  verificar(/^attachment; filename="imagen-\d{4}-\d{2}-\d{2}\.jpg"/.test(rr.headers.get('content-disposition')), '«Guardar en la computadora» la entrega como descarga, con un nombre claro');
  const pedidosAntes = pedidosMedia.length;
  r57 = await descargar57(a57.id);
  verificar(r57.status === 200 && pedidosMedia.length === pedidosAntes, 'si ya estaba guardado, no se vuelve a pedir a WhatsApp');
  verificar((await ultimoArchivo()).estado === 'guardado', 'la conversación muestra el archivo como guardado');

  medios360['med-pdf-1'] = { datos: Buffer.from('%PDF-1.4 presupuesto de prueba'), mime: 'application/pdf' };
  await post360(aviso([{ id: 'ar2', from: '59873000001', type: 'document', document: { id: 'med-pdf-1', mime_type: 'application/pdf', filename: '../../presupuesto.pdf' } }]));
  await espera(400);
  const p57 = await ultimoArchivo();
  verificar(p57.nombre === 'presupuesto.pdf', 'el nombre del documento se limpia (sin rutas de carpetas)');
  r57 = await descargar57(p57.id);
  verificar(r57.j.archivo.estado === 'guardado' && pedidosMedia.includes('https://waba-v2.360dialog.io/med-pdf-1') && pedidosMedia.some(u => u.startsWith('https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=med-pdf-1')), 'con el número real usa los dos pasos de la documentación de 360dialog');
  rr = await realFetch(BASE + '/api/archivos/' + p57.id);
  verificar(rr.headers.get('content-type') === 'application/pdf' && /filename="presupuesto\.pdf"/.test(rr.headers.get('content-disposition')) && !rr.headers.get('content-security-policy'), 'el PDF se abre en el navegador con su nombre');
  medios360['med-html-1'] = { datos: Buffer.from('<script>alert(1)</script>'), mime: 'text/html' };
  await post360(aviso([{ id: 'ar3', from: '59873000001', type: 'document', document: { id: 'med-html-1', mime_type: 'text/html', filename: 'pagina.html' } }]));
  await espera(400);
  const h57 = await ultimoArchivo();
  verificar(h57.enPanel === false, 'un formato que el navegador podría ejecutar no se ofrece para ver en el panel');
  await descargar57(h57.id);
  rr = await realFetch(BASE + '/api/archivos/' + h57.id);
  verificar(rr.headers.get('content-type') === 'application/octet-stream' && /^attachment/.test(rr.headers.get('content-disposition')), 'y se entrega solo para guardar, nunca para abrir');
  medios360['med-alt-1'] = { datos: Buffer.from('original'), mime: 'image/png', alterado: true };
  await post360(aviso([{ id: 'ar4', from: '59873000001', type: 'image', image: { id: 'med-alt-1', mime_type: 'image/png', sha256: huella(Buffer.from('original'), 'base64') } }]));
  await espera(400);
  const x57 = await ultimoArchivo();
  r57 = await descargar57(x57.id);
  verificar(r57.status === 502 && /huella de control/.test(r57.j.error) && (await ultimoArchivo()).estado === 'pendiente', 'un archivo alterado no se guarda');
  process.env.VERDE_ARCHIVO_MAX_MB = '1';
  medios360['med-grande-1'] = { datos: Buffer.alloc(10), mime: 'video/mp4', tamanoInformado: 5 * 1024 * 1024 };
  await post360(aviso([{ id: 'ar5', from: '59873000001', type: 'video', video: { id: 'med-grande-1', mime_type: 'video/mp4' } }]));
  await espera(400);
  r57 = await descargar57((await ultimoArchivo()).id);
  verificar(r57.status === 200 && r57.j.archivo.estado === 'grande' && /supera 1 MB/.test(r57.j.archivo.error), 'respeta el tamaño máximo por archivo');
  delete process.env.VERDE_ARCHIVO_MAX_MB;
  medios360['med-venc-1'] = { vencido: true };
  await post360(aviso([{ id: 'ar6', from: '59873000001', type: 'audio', audio: { id: 'med-venc-1', mime_type: 'audio/ogg' } }]));
  await espera(400);
  r57 = await descargar57((await ultimoArchivo()).id);
  verificar(r57.j.archivo.estado === 'vencido', 'si WhatsApp ya lo eliminó, queda marcado como no disponible');
  for (const k of [2, 3, 4]) {
    medios360['med-venc-' + k] = { vencido: true };
    await post360(aviso([{ id: 'arv' + k, from: '59873000001', type: 'audio', audio: { id: 'med-venc-' + k, mime_type: 'audio/ogg' } }]));
    await espera(300);
    await descargar57((await ultimoArchivo()).id);
  }
  medios360['med-frena-1'] = { datos: Buffer.from('x'), mime: 'image/jpeg' };
  await post360(aviso([{ id: 'arf1', from: '59873000001', type: 'image', image: { id: 'med-frena-1', mime_type: 'image/jpeg' } }]));
  await espera(300);
  const fr57 = await ultimoArchivo(), antesFreno = pedidosMedia.length;
  r57 = await descargar57(fr57.id);
  verificar(fr57.estado === 'frenado' && r57.j.archivo.estado === 'frenado' && r57.j.archivo.hasta > Date.now() + 50 * 60000 && pedidosMedia.length === antesFreno, 'después de 4 pedidos rechazados en una hora, el sistema frena solo para evitar el bloqueo de 360dialog');
  arch57._reiniciarFreno();
  verificar((await ultimoArchivo()).estado === 'pendiente', 'pasada la hora, la tarjeta vuelve a ofrecer «Descargar»');
  medios360['med-par-1'] = { datos: Buffer.from('paralelo'), mime: 'image/jpeg' };
  await post360(aviso([{ id: 'ar7', from: '59873000001', type: 'image', image: { id: 'med-par-1', mime_type: 'image/jpeg' } }]));
  await espera(400);
  const par57 = await ultimoArchivo();
  const antesPar = pedidosMedia.length;
  await Promise.all([descargar57(par57.id), descargar57(par57.id)]);
  verificar(pedidosMedia.length - antesPar === 2, 'si dos personas tocan «Descargar» a la vez, se descarga una sola vez');
  process.env.D360_MESSAGES_URL = urlPrevia57;
  verificar(arch57.estado({ id: 'a'.repeat(24), tipo: 'image', mime: 'image/jpeg', recibido: Date.now() - 8 * 86400000 }).estado === 'antiguo', 'pasados 7 días sin descargar, el archivo se marca como posiblemente eliminado');
  verificar(arch57.limpiar(Date.now() + 91 * 86400000) >= 1 && !arch57.paraServir(a57.id), 'a los 3 meses los archivos guardados se borran solos');


  mostrar('58) Archivos: Verde sigue conversando y el chat queda «Archivo para revisar»');
  const botMod = require('./bot.js');
  await api('/api/avisos', 'PUT', { numeros: ['59899000102'] });
  let antes58 = envios360.length, antesIA58 = llamadasIA.length;
  await post360(aviso([{ id: 'rv1', from: '59876000001', type: 'image', image: { id: 'med-rv-1', mime_type: 'image/jpeg', caption: 'Pantalla rota' } }]));
  await espera(500);
  const env58 = envios360.slice(antes58);
  const sys58 = JSON.stringify(llamadasIA[llamadasIA.length - 1].body.system);
  verificar(llamadasIA.length === antesIA58 + 1 && env58.some(x => x.body.to === '59876000001' && /^Respuesta de Verde/.test(x.body.text.body)), 'al llegar una foto, Verde responde con la IA en lugar de una frase fija');
  verificar(sys58.includes('Cuando el cliente envía un archivo') && sys58.includes(botMod.instruccionesArchivo((botMod.getVerde() || {}).frases)) && sys58.includes('No es posible ver el contenido de los archivos'), 'Verde recibe las indicaciones para archivos y sabe que no puede ver su contenido');
  let pend58 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59876000001');
  verificar(pend58 && pend58.revision === true, 'el chat queda en «Chats por responder» marcado como «Archivo para revisar»');
  verificar(env58.filter(x => x.body.to === '59899000102').length === 1, 'se avisa al equipo una vez');
  antes58 = envios360.length; antesIA58 = llamadasIA.length;
  await post360(aviso([{ id: 'rv2', from: '59876000001', type: 'text', text: { body: 'Es un Samsung A54, se me cayó' } }]));
  await espera(500);
  pend58 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59876000001');
  verificar(llamadasIA.length === antesIA58 + 1 && envios360.slice(antes58).some(x => x.body.to === '59876000001'), 'Verde sigue conversando: responde el mensaje siguiente');
  verificar(pend58 && pend58.revision && pend58.ultimoMensaje === 'Es un Samsung A54, se me cayó', 'el chat sigue para revisar y el asesor ve el último mensaje');
  antes58 = envios360.length;
  await post360(aviso([{ id: 'rv3', from: '59876000001', type: 'image', image: { id: 'med-rv-2', mime_type: 'image/jpeg' } }]));
  await espera(500);
  verificar(!envios360.slice(antes58).some(x => x.body.to === '59899000102') && envios360.slice(antes58).some(x => x.body.to === '59876000001'), 'otro archivo en el mismo chat: Verde responde y no se repite el aviso al equipo');
  const det58 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59876000001'), 'GET'));
  verificar(det58.pendiente && det58.revision && det58.verde, 'la conversación figura por responder y con Verde atendiendo a la vez');
  const listaV58 = JSON.stringify(await json(await api('/api/conversaciones?estado=verde', 'GET'))), listaP58 = JSON.stringify(await json(await api('/api/conversaciones?estado=pendiente', 'GET')));
  verificar(listaV58.includes('59876000001') && listaP58.includes('59876000001'), 'aparece en los filtros «Verde atendiendo» y «Por responder»');
  await post360(aviso([{ id: 'rv4', from: '59876000001', type: 'text', text: { body: 'cuál es el precio exacto del cambio de pantalla?' } }]));
  await espera(500);
  pend58 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59876000001');
  verificar(pend58 && pend58.revision === false, 'si el cliente pide un precio, Verde deriva y el chat pasa a esperar a una persona');
  const at58 = await json(await api('/api/chats/' + pend58.id));
  const evs58 = (at58.eventos || (at58.atencion && at58.atencion.eventos) || []).filter(x => x.tipo === 'cliente' && /precio exacto del cambio de pantalla/.test(x.texto));
  verificar(evs58.length === 1, 'el mensaje del cliente queda anotado una sola vez');
  antesIA58 = llamadasIA.length;
  await post360(aviso([{ id: 'rv5', from: '59876000001', type: 'text', text: { body: 'hola?' } }]));
  await espera(400);
  verificar(llamadasIA.length === antesIA58 + 1 && /ESTADO DE ESTE CHAT: ya está derivado/.test(JSON.stringify(llamadasIA[llamadasIA.length - 1].body.system)), 'después de derivar, Verde sigue conversando y sabe que el chat ya está derivado');
  verificar(botMod.buildSystemPrompt({ frases: { adjunto: 'Pedir la foto del IMEI.' } }).includes('Pedir la foto del IMEI.') && !botMod.buildSystemPrompt({ frases: { adjunto: 'Pedir la foto del IMEI.' } }).includes(botMod.ADJUNTO_POR_DEFECTO), 'las indicaciones configuradas en el panel reemplazan a las sugeridas');


  mostrar('59) Verde sigue conversando también después de derivar');
  await api('/api/avisos', 'PUT', { numeros: ['59899000102'] });
  const aviso59 = desde => envios360.slice(desde).filter(x => x.body.to === '59899000102').length;
  let antes59 = envios360.length, antesIA59 = llamadasIA.length;
  await post360(aviso([{ id: 'dr59-1', from: '59877000001', type: 'text', text: { body: 'hola, ¿cuál es el precio exacto del cambio de pantalla?' } }]));
  await espera(500);
  let p59 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59877000001');
  verificar(p59 && !p59.revision && p59.verdeActivo === true && aviso59(antes59) === 1, 'al pedir un precio, Verde deriva: el chat pasa a «Chats por responder», se avisa al equipo y Verde sigue activo');
  antes59 = envios360.length; antesIA59 = llamadasIA.length;
  await post360(aviso([{ id: 'dr59-2', from: '59877000001', type: 'text', text: { body: 'iPhone 13 Pro Max' } }]));
  await espera(500);
  verificar(llamadasIA.length === antesIA59 + 1 && envios360.slice(antes59).some(x => x.body.to === '59877000001') && aviso59(antes59) === 0, 'el cliente manda el modelo: Verde le responde y no se repite el aviso');
  verificar(/ESTADO DE ESTE CHAT: ya está derivado/.test(JSON.stringify(llamadasIA[llamadasIA.length - 1].body.system)), 'Verde sabe que el chat ya está derivado (no vuelve a derivar ni repite que lo pasa a un asesor)');
  antes59 = envios360.length;
  await post360(aviso([{ id: 'dr59-3', from: '59877000001', type: 'text', text: { body: '¿y el precio exacto entonces?' } }]));
  await espera(500);
  const at59 = await json(await api('/api/chats/' + p59.id));
  const derivados59 = (at59.eventos || (at59.atencion && at59.atencion.eventos) || []).filter(x => x.tipo === 'derivado').length;
  verificar(envios360.slice(antes59).some(x => x.body.to === '59877000001') && aviso59(antes59) === 0 && derivados59 === 1, 'si insiste con el precio, Verde responde sin repetir la derivación ni el aviso');
  const det59 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59877000001'), 'GET'));
  verificar(det59.pendiente && det59.verde && !det59.revision, 'la conversación figura por responder y con Verde atendiendo');
  antes59 = envios360.length;
  await post360(aviso([{ id: 'dr59-4', from: '59877000002', type: 'image', image: { id: 'med-dv-1', mime_type: 'image/jpeg', caption: 'precio exacto de esto' } }]));
  await espera(500);
  const p59b = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59877000002');
  verificar(p59b && !p59b.revision && aviso59(antes59) === 1, 'un archivo que además pide precio genera un solo aviso, por la derivación');
  await api('/api/conversaciones/' + encodeURIComponent('wa:59877000001') + '/apagar', 'POST', {});
  p59 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59877000001');
  verificar(p59 && p59.verdeActivo === false, 'con Verde apagado en ese chat, la fila no lo muestra como activo');
  await api('/api/conversaciones/' + encodeURIComponent('wa:59877000001') + '/encender', 'POST', {});
  await post360(aviso([{ id: 'dr59-5', from: '59877000003', type: 'text', text: { body: 'hola, quiero un presupuesto' } }]));
  await espera(400);
  rr = await api('/api/conversaciones/' + encodeURIComponent('wa:59877000003') + '/responder', 'POST', { texto: 'Hola, ¿qué equipo es?' });
  await espera(200);
  antesIA59 = llamadasIA.length;
  await post360(aviso([{ id: 'dr59-6', from: '59877000003', type: 'image', image: { id: 'med-dv-2', mime_type: 'image/jpeg' } }]));
  await espera(400);
  verificar(llamadasIA.length === antesIA59, 'durante la pausa (respondió una persona), Verde no responde, ni siquiera a un archivo');
  rr = await api('/api/conversaciones/' + encodeURIComponent('wa:59877000003') + '/reanudar', 'POST', {});
  const rj59 = await json(rr);
  verificar(rr.status === 200 && rj59.verde && rj59.verde.respondio === true && llamadasIA.length === antesIA59 + 1, '«Devolver a Verde» con un archivo como última consulta: Verde responde enseguida');


  mostrar('60) Reclamos y garantía: protocolo, ficha y aviso al asesor');
  await api('/api/avisos', 'PUT', { numeros: ['59899000102'] });
  const aviso60 = desde => envios360.slice(desde).filter(x => x.body.to === '59899000102');
  let antes60 = envios360.length;
  await post360(aviso([{ id: 'ga60-1', from: '59879000001', type: 'text', text: { body: 'hola, me cambiaron la pantalla hace 2 semanas y quiero la garantía porque el touch no anda' } }]));
  await espera(600);
  const botG0 = require('./bot.js');
  const sys60 = JSON.stringify(llamadasIA[llamadasIA.length - 1].body.system);
  verificar(sys60.includes('== RECLAMOS Y GARANTÍA ==') && sys60.includes('El touch no responde') && sys60.includes('Número de la boleta de garantía') && sys60.includes('nunca afirmar ni dar a entender que la garantía corresponde'), 'Verde recibe el protocolo: datos a juntar, síntomas y la regla de no prometer la garantía');
  verificar(/^Presentar la orden de trabajo/.test(botG0.GARANTIA_REQUISITOS_DEFECTO) && /^La garantía es de 30 días/.test(botG0.GARANTIA_COBERTURA_DEFECTO) && !/['\\]/.test(botG0.GARANTIA_REQUISITOS_DEFECTO + botG0.GARANTIA_COBERTURA_DEFECTO), 'los textos precargados de la política no arrastran comillas ni barras');
  verificar(sys60.includes('REQUISITOS INDISPENSABLES') && sys60.includes('orden de trabajo (boleta de garantía)') && sys60.includes('30 días corridos desde la entrega') && sys60.includes('No inventar procedimientos ni ofrecer alternativas'), 'la política real de la tienda va precargada: requisitos, plazos y cobertura, y la regla de no inventar procedimientos');
  const env60 = envios360.slice(antes60).find(x => x.body.to === '59879000001');
  verificar(env60 && /¿Tenés la boleta de garantía\?/.test(env60.body.text.body) && !/RECLAMO|\{|\}|DERIVAR/.test(env60.body.text.body), 'el cliente recibe la respuesta sin la ficha ni las marcas internas');
  let p60 = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59879000001');
  verificar(p60 && p60.reclamo === true && p60.verdeActivo === true, 'el chat pasa a «Chats por responder» marcado como reclamo de garantía, con Verde activo');
  verificar(aviso60(antes60).length === 1 && /Reclamo de garantía: Verde juntó los datos para el asesor/.test(aviso60(antes60)[0].body.text.body), 'el aviso al equipo dice que es un reclamo de garantía');
  let det60 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59879000001'), 'GET'));
  verificar(det60.reclamo && det60.reclamo.boleta === '4582' && det60.reclamo.mismo === 'sí' && det60.reclamo.pruebas === 0 && det60.reclamo.estado === 'pendiente', 'la conversación trae la ficha del reclamo que armó Verde');
  await post360(aviso([{ id: 'ga60-2', from: '59879000001', type: 'video', video: { id: 'med-ga-1', mime_type: 'video/mp4' } }]));
  await espera(500);
  det60 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59879000001'), 'GET'));
  verificar(det60.reclamo.pruebas === 1, 'la ficha cuenta los archivos que mandó el cliente como pruebas');
  antes60 = envios360.length;
  await post360(aviso([{ id: 'ga60-3', from: '59879000001', type: 'text', text: { body: 'actualizar ficha: no se golpeó' } }]));
  await espera(500);
  det60 = await json(await api('/api/conversaciones/' + encodeURIComponent('wa:59879000001'), 'GET'));
  verificar(det60.reclamo.boleta === '4582' && det60.reclamo.golpes === 'no' && det60.reclamo.notas === 'video recibido' && aviso60(antes60).length === 0 && envios360.slice(antes60).some(x => x.body.to === '59879000001'), 'si el cliente aporta más datos, la ficha se actualiza sin perder lo anterior ni repetir el aviso');
  const at60 = await json(await api('/api/chats/' + p60.id));
  const ev60 = (at60.eventos || (at60.atencion && at60.atencion.eventos) || []).filter(x => x.tipo === 'reclamo');
  verificar((at60.reclamo || (at60.atencion && at60.atencion.reclamo)) && ev60.length === 2, 'el detalle de la atención conserva la ficha y el recorrido');
  antes60 = envios360.length;
  await post360(aviso([{ id: 'ga60-4', from: '59879000002', type: 'text', text: { body: 'ficha rota' } }]));
  await espera(500);
  const p60b = (await json(await api('/api/chats/pendientes'))).lista.find(x => x.numero === '59879000002');
  const env60b = envios360.slice(antes60).find(x => x.body.to === '59879000002');
  verificar(p60b && p60b.reclamo === false && env60b && !/RECLAMO|\{/.test(env60b.body.text.body), 'si la ficha llega mal formada, se ignora sin romper nada: el chat se deriva igual y el cliente no ve la marca');
  const botG = require('./bot.js');
  verificar(!botG.buildSystemPrompt({ garantia: { activo: false } }).includes('== RECLAMOS Y GARANTÍA =='), 'con el protocolo desactivado, el bloque no entra al prompt');
  const promptG = botG.buildSystemPrompt({ garantia: { condiciones: 'Las reparaciones tienen 90 días de garantía.', sintomas: [{ sintoma: 'La batería dura poco', preguntar: 'Cuántas horas dura.', sugerir: 'Revisar apps en segundo plano.' }] } });
  verificar(promptG.includes('Las reparaciones tienen 90 días de garantía.') && !promptG.includes('solo sobre la reparación realizada y por defectos del repuesto, sin rayas') && promptG.includes('La batería dura poco') && promptG.includes('Número de la boleta de garantía'), 'lo cargado en el panel reemplaza la cobertura precargada; los síntomas y los datos a juntar también entran');
  const promptR = botG.buildSystemPrompt({ garantia: { requisitos: 'Solo con factura electrónica.' } });
  verificar(promptR.includes('REQUISITOS INDISPENSABLES (sin ellos no hay garantía): Solo con factura electrónica.') && !promptR.includes('Presentar la orden de trabajo') && promptR.includes('30 días corridos desde la entrega'), 'los requisitos cargados reemplazan a los precargados sin tocar la cobertura');
  const sim60 = await json(await api('/api/simulate', 'POST', { message: 'quiero la garantía de la pantalla', from: 'garantia-sim' }));
  verificar(/\(Ficha del reclamo que vería el asesor: boleta: 4582/.test(sim60.reply) && !/\[RECLAMO\]/.test(sim60.reply), 'en «Probar a Verde» se ve la ficha que armaría Verde');

  if (mal && !DETALLE) lineasGuardadas.forEach(l => final(l));
  if (mal) { final('--- últimos mensajes del servidor ---'); registro.slice(-30).forEach(l => final(l)); }
  final('Pruebas OK: ' + ok + ' · con fallas: ' + mal);
  process.exit(mal ? 1 : 0);
})().catch(err => { lineasGuardadas.forEach(l => final(l)); final('✘ FALLÓ: la prueba se interrumpió: ' + err.message); final('Pruebas OK: ' + ok + ' · con fallas: ' + (mal + 1)); process.exit(1); });
