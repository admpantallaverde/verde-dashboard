/*
 * leads.js — Leads clasificados y ordenados por prioridad (1.5.0)
 * --------------------------------------------------------------
 *  - Cada conversación se clasifica con la IA cuando pasan 10 minutos sin mensajes nuevos:
 *    tipo (reparación, compra, garantía, consulta, otro), producto o servicio, intención de
 *    compra, si ya se dio un presupuesto, la traba (categoría + frase textual del cliente),
 *    un resumen de una línea y el próximo paso sugerido. Se guarda en data/leads.json.
 *  - La etapa y la prioridad NO las decide la IA: salen de reglas sobre los hechos del chat
 *    (quién habló último, si está derivado, cuánto espera) y de la clasificación.
 *  - El vendedor puede corregir la clasificación; lo corregido queda fijo aunque la IA
 *    vuelva a clasificar.
 *  - Modelo: el elegido en la sección H (por defecto Haiku 5.5, el más económico).
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'leads.json');
const ESPERA_MS = 10 * 60 * 1000;          // minutos sin mensajes antes de clasificar
const VENTANA_DIAS = 30;                   // solo conversaciones con actividad reciente
const MAX_POR_VUELTA = 5;                  // clasificaciones por minuto como máximo
const NUEVO_HORAS = 24, SIN_RESPUESTA_HORAS = 48, DERIVADO_URGENTE_HORAS = 2;
const REINTENTO_MS = 30 * 60 * 1000, MAX_FALLOS = 3;   // 1.5.1: si la IA falla, reintenta a los 30 minutos, hasta 3 veces por mensaje
const MAX_MENSAJES = 30;

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }

const TIPOS = { reparacion: 'Reparación', compra: 'Compra', garantia: 'Garantía', consulta: 'Consulta general', otro: 'Otro' };
const INTENCIONES = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const TRABAS = { precio: 'Precio', demora: 'Demora', desconfianza: 'Desconfianza', distancia: 'Distancia', lo_piensa: 'Lo piensa', otra: 'Otra', ninguna: 'Ninguna' };
const ETAPAS = { nuevo: 'Nuevo', con_verde: 'Con Verde', derivado: 'Derivado', en_atencion: 'En atención', presupuesto_enviado: 'Presupuesto enviado', esperando_cliente: 'Esperando al cliente', sin_respuesta: 'Sin respuesta' };
const PRIORIDADES = { 3: 'alta', 2: 'media', 1: 'normal' };

/* ---------- archivo ---------- */
function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { leads: {}, fallos: {} };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    if (!d || !d.leads || typeof d.leads !== 'object') return { leads: {}, fallos: {} };
    if (!d.fallos || typeof d.fallos !== 'object') d.fallos = {};
    return d;
  } catch (e) { console.error('No se pudo leer leads.json:', e.message); return { leads: {}, fallos: {} }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
const t = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/* ---------- instrucciones para la IA ---------- */
function instrucciones(empresa) {
  return [
    'CLASIFICADOR DE CONVERSACIONES de ' + (empresa || 'la tienda') + ' (WhatsApp).',
    'Leé la conversación entre un cliente, el bot Verde y el equipo, y devolvé SOLO un objeto JSON válido, sin texto antes ni después, con esta forma:',
    '{"tipo":"reparacion|compra|garantia|consulta|otro","producto":"producto o servicio en pocas palabras, por ejemplo «Pantalla Samsung A54» o «Cargador iPhone 15»; vacío si no se sabe","intencion":"alta|media|baja","presupuesto":true o false,"traba":{"categoria":"precio|demora|desconfianza|distancia|lo_piensa|otra|ninguna","frase":"frase TEXTUAL del cliente que muestra la traba, copiada tal cual; vacío si no hay"},"resumen":"una línea de hasta 140 caracteres","proximoPaso":"qué debería hacer el vendedor ahora, hasta 120 caracteres"}',
    'Reglas:',
    '1. «tipo»: garantia si reclama por algo que la tienda vendió o reparó; reparacion si consulta por arreglar un equipo; compra si quiere comprar un producto; consulta si pregunta horarios, dirección u otra cosa general; otro si no es nada de eso.',
    '2. «intencion» mide cuánto quiere comprar o reparar ahora: alta si pide precio, horario para ir, forma de pago o dice que va; media si consulta con interés pero sin apuro; baja si solo averigua o se fue.',
    '3. «presupuesto» es true solo si el equipo o Verde ya le dieron un precio o presupuesto concreto.',
    '4. «traba» es el motivo por el que el cliente no avanza o no compra, si existe. La «frase» tiene que ser una frase literal del cliente, no una interpretación. Si no hay traba, categoria «ninguna» y frase vacía.',
    '5. Español rioplatense neutro. No inventes datos que no estén en la conversación.'
  ].join('\n');
}
function transcripcion(c) {
  const quien = { cliente: 'Cliente', verde: 'Verde', equipo: 'Equipo' };
  return (c.mensajes || []).filter(m => m && quien[m.tipo]).slice(-MAX_MENSAJES)
    .map(m => (m.tipo === 'equipo' && m.autor ? 'Equipo (' + m.autor + ')' : quien[m.tipo]) + ': ' + (m.archivo ? '[envió un archivo] ' : '') + t(m.texto, 400)).join('\n');
}
function limpiarJson(crudo) {
  let s = String(crudo == null ? '' : crudo).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
}
// Deja la respuesta de la IA en los valores permitidos.
function normalizar(j, c) {
  const o = j && typeof j === 'object' ? j : {};
  const tr = o.traba && typeof o.traba === 'object' ? o.traba : {};
  let categoria = TRABAS[tr.categoria] ? tr.categoria : 'ninguna';
  let frase = t(tr.frase, 160);
  if (categoria === 'ninguna') frase = '';
  if (frase) {   // la frase tiene que estar en lo que dijo el cliente
    const dicho = (c.mensajes || []).filter(m => m.tipo === 'cliente').map(m => String(m.texto || '').toLowerCase()).join('\n');
    if (!dicho.includes(frase.toLowerCase().slice(0, 40))) frase = '';
  }
  if (!frase && categoria !== 'ninguna') categoria = 'otra';
  return {
    tipo: TIPOS[o.tipo] ? o.tipo : 'otro',
    producto: t(o.producto, 60),
    intencion: INTENCIONES[o.intencion] ? o.intencion : 'baja',
    presupuesto: o.presupuesto === true,
    traba: { categoria, frase },
    resumen: t(o.resumen, 140),
    proximoPaso: t(o.proximoPaso, 120)
  };
}

/* ---------- etapa, prioridad y espera (reglas, sin IA) ---------- */
function calcular(c, lead, ctx, ahora) {
  const ms = (c.mensajes || []).filter(m => m && ['cliente', 'verde', 'equipo'].includes(m.tipo));
  const ultimo = ms[ms.length - 1] || null;
  const primero = ms[0] || null;
  const equipoRespondio = ms.some(m => m.tipo === 'equipo');
  const pendiente = !!(ctx && ctx.pendientes && ctx.pendientes.has(c.clave));
  const h = n => n * 3600000;
  const l = lead || {};
  let etapa;
  if (pendiente) etapa = 'derivado';
  else if (!ultimo || ultimo.tipo === 'cliente') etapa = equipoRespondio ? 'en_atencion' : (primero && ahora - primero.en < h(NUEVO_HORAS) ? 'nuevo' : 'con_verde');
  else if (ahora - ultimo.en > h(SIN_RESPUESTA_HORAS)) etapa = 'sin_respuesta';
  else if (ultimo.tipo === 'equipo') etapa = l.presupuesto ? 'presupuesto_enviado' : 'esperando_cliente';
  else etapa = equipoRespondio ? 'esperando_cliente' : (primero && ahora - primero.en < h(NUEVO_HORAS) ? 'nuevo' : 'con_verde');
  const esperaDesde = ['derivado', 'en_atencion', 'nuevo', 'con_verde'].includes(etapa) ? (c.ultimoClienteEn || (ultimo && ultimo.en) || ahora) : ((ultimo && ultimo.en) || ahora);
  const espera = Math.max(0, ahora - esperaDesde);
  let prioridad = 1;
  if (l.tipo === 'garantia' || (l.tipo === 'compra' && l.intencion === 'alta') || (etapa === 'derivado' && espera > h(DERIVADO_URGENTE_HORAS))) prioridad = 3;
  else if (l.intencion === 'alta' || l.intencion === 'media' || ['derivado', 'esperando_cliente', 'presupuesto_enviado'].includes(etapa)) prioridad = 2;
  const vendedor = [...ms].reverse().find(m => m.tipo === 'equipo' && m.autor);
  return { etapa, etapaNombre: ETAPAS[etapa], prioridad, prioridadNombre: PRIORIDADES[prioridad], espera, esperaTexto: esperaTexto(espera), vendedor: vendedor ? vendedor.autor : '', ultimoEn: ultimo ? ultimo.en : null };
}
function esperaTexto(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return m + ' min';
  const hh = Math.floor(m / 60);
  if (hh < 24) return hh + ' h' + (m % 60 ? ' ' + (m % 60) + ' m' : '');
  const d = Math.floor(hh / 24);
  return d + (d === 1 ? ' día' : ' días');
}

/* ---------- clasificación ---------- */
// 1.5.1: registra una falla para no reintentar cada minuto (cada intento se cobra).
function anotarFallo(c, motivo) {
  const d = cargar();
  const f = d.fallos[c.clave];
  const hasta = c.ultimoEn || 0;
  d.fallos[c.clave] = { hastaMensaje: hasta, intentos: f && f.hastaMensaje === hasta ? f.intentos + 1 : 1, en: reloj(), motivo: t(motivo, 160) };
  guardar(d);
  return d.fallos[c.clave];
}
// bot: { callClaude, getVerde, configClasificacion }. Devuelve el lead guardado o null si la IA falló.
async function clasificar(c, bot) {
  const v = bot.getVerde();
  const modelo = bot.configClasificacion(v).modelo;
  const d = cargar();
  const previo = d.leads[c.clave] || {};
  let crudo;
  try { crudo = await bot.callClaude(instrucciones(v.empresa), [{ role: 'user', content: 'CONVERSACIÓN (del más viejo al más nuevo):\n' + transcripcion(c) }], v, modelo, 'clasificacion'); }
  catch (e) { const f = anotarFallo(c, e.message); console.error('Clasificación de ' + c.clave + ': la IA no respondió (intento ' + f.intentos + ' de ' + MAX_FALLOS + '): ' + e.message); return null; }
  const j = limpiarJson(crudo);
  if (!j) { const f = anotarFallo(c, 'no devolvió JSON'); console.error('Clasificación de ' + c.clave + ': la IA no devolvió JSON (intento ' + f.intentos + ' de ' + MAX_FALLOS + ')'); return null; }
  const nuevo = normalizar(j, c);
  const fijos = previo.fijos && typeof previo.fijos === 'object' ? previo.fijos : {};
  for (const k of ['tipo', 'producto', 'intencion', 'traba']) if (fijos[k]) nuevo[k] = previo[k];   // lo corregido a mano no se pisa
  const lead = Object.assign({}, nuevo, { fijos, clasificadoEn: reloj(), hastaMensaje: c.ultimoEn || reloj(), modelo });
  const d2 = cargar();
  d2.leads[c.clave] = lead;
  delete d2.fallos[c.clave];
  guardar(d2);
  return lead;
}
// Conversaciones que esperan clasificación: con mensajes nuevos desde la última, quietas 10 minutos y de los últimos 30 días.
function pendientesDeClasificar(chats) {
  const ahora = reloj();
  const d = cargar();
  return chats.filter(c => c && c.ultimoClienteEn && c.ultimoEn >= ahora - VENTANA_DIAS * 86400000 && ahora - c.ultimoEn >= ESPERA_MS)
    .filter(c => { const l = d.leads[c.clave]; return !l || (l.hastaMensaje || 0) < c.ultimoEn; })
    .filter(c => { const f = d.fallos[c.clave]; return !f || f.hastaMensaje !== c.ultimoEn || (f.intentos < MAX_FALLOS && ahora - f.en >= REINTENTO_MS); })
    .sort((a, b) => a.ultimoEn - b.ultimoEn);
}
// Una vuelta: clasifica hasta 5 conversaciones. chats(): función que devuelve las conversaciones recientes.
async function revisar(chats, bot) {
  const lista = pendientesDeClasificar(chats()).slice(0, MAX_POR_VUELTA);
  let hechas = 0;
  for (const c of lista) { if (await clasificar(c, bot)) hechas++; }
  podar(chats());
  return { pendientes: lista.length, hechas };
}
// Borra los leads de conversaciones que ya no existen (las conversaciones se purgan a los 90 días).
function podar(chats) {
  const d = cargar();
  const vivas = new Set(chats.map(c => c.clave));
  let cambio = false;
  for (const k of Object.keys(d.leads)) if (!vivas.has(k)) { delete d.leads[k]; cambio = true; }
  for (const k of Object.keys(d.fallos)) if (!vivas.has(k)) { delete d.fallos[k]; cambio = true; }
  if (cambio) guardar(d);
}
let temporizador = null;
function programar(chats, bot) {
  if (temporizador || String(process.env.VERDE_CLASIFICACION || '').toLowerCase() === 'no') return;
  temporizador = setInterval(() => { revisar(chats, bot).catch(e => console.error('Clasificación de leads:', e.message)); }, 60 * 1000);
  if (temporizador.unref) temporizador.unref();
}

/* ---------- consultas para el panel ---------- */
function publico(c, lead, ctx, ahora) {
  const calc = calcular(c, lead, ctx, ahora);
  const l = lead || {};
  return Object.assign({
    clave: c.clave, nombre: c.nombre || '', numero: c.numero || '', clasificado: !!lead,
    tipo: l.tipo || null, tipoNombre: l.tipo ? TIPOS[l.tipo] : 'Sin clasificar', producto: l.producto || '',
    intencion: l.intencion || null, intencionNombre: l.intencion ? INTENCIONES[l.intencion] : '', presupuesto: !!l.presupuesto,
    traba: l.traba || { categoria: 'ninguna', frase: '' }, trabaNombre: l.traba ? TRABAS[l.traba.categoria] : '',
    resumen: l.resumen || '', proximoPaso: l.proximoPaso || '', clasificadoEn: l.clasificadoEn || null, fijos: l.fijos || {}
  }, calc);
}
// filtros: { etapa, tipo, vendedor, q }
function listar(chats, ctx, filtros) {
  const f = filtros || {};
  const ahora = reloj();
  const d = cargar();
  const q = t(f.q, 60).toLowerCase();
  const todos = chats.filter(c => c && c.ultimoClienteEn && c.ultimoEn >= ahora - VENTANA_DIAS * 86400000).map(c => publico(c, d.leads[c.clave], ctx, ahora));
  const conteo = { alta: 0, media: 0, normal: 0, sinClasificar: 0 };
  for (const x of todos) { conteo[x.prioridadNombre]++; if (!x.clasificado) conteo.sinClasificar++; }
  const vendedores = [...new Set(todos.map(x => x.vendedor).filter(Boolean))].sort();
  const lista = todos.filter(x => (!f.etapa || x.etapa === f.etapa) && (!f.tipo || x.tipo === f.tipo) && (!f.vendedor || x.vendedor === f.vendedor)
    && (!q || (x.nombre + ' ' + x.numero + ' ' + x.producto + ' ' + x.resumen).toLowerCase().includes(q)))
    .sort((a, b) => b.prioridad - a.prioridad || b.espera - a.espera);
  return { total: lista.length, conteo, vendedores, etapas: ETAPAS, tipos: TIPOS, lista };
}
function detalle(c, ctx) {
  if (!c) return null;
  return publico(c, cargar().leads[c.clave], ctx, reloj());
}
// Prioridad de una conversación (para ordenar «Chats por responder»). Sin clasificar devuelve 1.
function prioridadDe(c, ctx) {
  if (!c) return 1;
  return calcular(c, cargar().leads[c.clave], ctx, reloj()).prioridad;
}
// Corrección manual: { tipo, producto, intencion, traba: { categoria, frase } }. Lo corregido queda fijo.
function corregir(c, cambios) {
  const d = cargar();
  const l = d.leads[c.clave] || { tipo: 'otro', producto: '', intencion: 'baja', presupuesto: false, traba: { categoria: 'ninguna', frase: '' }, resumen: '', proximoPaso: '', fijos: {}, clasificadoEn: null, hastaMensaje: c.ultimoEn || 0, modelo: 'manual' };
  const x = cambios || {};
  l.fijos = l.fijos || {};
  if (TIPOS[x.tipo]) { l.tipo = x.tipo; l.fijos.tipo = true; }
  if (typeof x.producto === 'string') { l.producto = t(x.producto, 60); l.fijos.producto = true; }
  if (INTENCIONES[x.intencion]) { l.intencion = x.intencion; l.fijos.intencion = true; }
  if (x.traba && typeof x.traba === 'object') {
    const categoria = TRABAS[x.traba.categoria] ? x.traba.categoria : 'ninguna';
    l.traba = { categoria, frase: categoria === 'ninguna' ? '' : t(x.traba.frase, 160) };
    l.fijos.traba = true;
  }
  d.leads[c.clave] = l;
  guardar(d);
  return l;
}

module.exports = { TIPOS, INTENCIONES, TRABAS, ETAPAS, ESPERA_MS, instrucciones, limpiarJson, normalizar, calcular, esperaTexto, clasificar, pendientesDeClasificar, revisar, programar, listar, detalle, prioridadDe, corregir, _usarReloj };
