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
const VERSION_ESPERADA = '1.3.0';

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
    const ultimo = (JSON.parse(opts.body).messages || []).slice(-1)[0] || {};
    if (/precio exacto/i.test(String(ultimo.content || ''))) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Te paso con un asesor para confirmarte el precio.\n[DERIVAR]' }], stop_reason: 'end_turn' }), { status: 200 });
    }
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
  verificar(h.ok && h.ia && h.bot && h.wa360 && h.login === false, 'responde ok, IA, bot encendido, 360dialog configurado e ingreso propio inactivo');

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
  let antes = envios360.length;
  await post360(avisoDe('59870000001', 'Lucía Fernández', 'quiero el precio exacto del cambio de pantalla', 'd1'));
  await espera(700);
  let nuevos = envios360.slice(antes);
  const alCliente = nuevos.find(x => x.body.to === '59870000001');
  const avisos = nuevos.filter(x => ['59899000101', '59899000102'].includes(x.body.to));
  verificar(alCliente && !/DERIVAR/.test(alCliente.body.text.body) && /asesor/.test(alCliente.body.text.body), 'el cliente recibe la respuesta sin la marca interna');
  verificar(avisos.length === 2 && avisos.every(x => /Chat por responder/.test(x.body.text.body) && /Lucía Fernández/.test(x.body.text.body)), 'llega el aviso a los 2 celulares del equipo, con el nombre del cliente');
  let pend = await json(await api('/api/chats/pendientes'));
  let luciaP = pend.lista.find(x => x.numero === '59870000001');
  verificar(luciaP && luciaP.nombre === 'Lucía Fernández' && /precio exacto/.test(luciaP.ultimoMensaje) && pend.total === pend.lista.length, 'el chat aparece en «Chats por responder»');
  antes = envios360.length;
  await post360(avisoDe('59870000001', 'Lucía Fernández', 'hola? sigo esperando', 'd2'));
  await espera(500);
  pend = await json(await api('/api/chats/pendientes'));
  luciaP = pend.lista.find(x => x.numero === '59870000001');
  verificar(envios360.length === antes && luciaP && /sigo esperando/.test(luciaP.ultimoMensaje), 'mientras espera, Verde no responde y se actualiza el último mensaje');
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
  rr = await api('/api/avisos', 'PUT', { numeros: ['59899000101'], plantilla: 'chat_por_responder', idioma: 'es' });
  verificar(rr.status === 200, 'se guarda el nombre de la plantilla');
  antes = envios360.length;
  await post360(avisoDe('59870000004', 'Sofía\nRodríguez', 'precio exacto\nde una funda', 'd7'));
  await espera(600);
  const plant = envios360.slice(antes).find(x => x.body.to === '59899000101');
  const params = plant && plant.body.template && plant.body.template.components[0].parameters.map(x => x.text);
  verificar(plant && plant.body.type === 'template' && plant.body.template.name === 'chat_por_responder' && params.length === 2 && params.every(t => !/\n/.test(t)), 'el aviso sale como plantilla, con datos sin saltos de línea');
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

  if (mal && !DETALLE) lineasGuardadas.forEach(l => final(l));
  if (mal) { final('--- últimos mensajes del servidor ---'); registro.slice(-30).forEach(l => final(l)); }
  final('Pruebas OK: ' + ok + ' · con fallas: ' + mal);
  process.exit(mal ? 1 : 0);
})().catch(err => { lineasGuardadas.forEach(l => final(l)); final('✘ FALLÓ: la prueba se interrumpió: ' + err.message); final('Pruebas OK: ' + ok + ' · con fallas: ' + (mal + 1)); process.exit(1); });
