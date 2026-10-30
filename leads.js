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
const ARCHIVO_PROCESO = path.join(DATA_DIR, 'proceso.json');
const DESFASE_MVD = 3 * 3600 * 1000;   // Uruguay: UTC-3 todo el año

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }

const TIPOS = { reparacion: 'Reparación', compra: 'Compra', garantia: 'Garantía', consulta: 'Consulta general', otro: 'Otro' };
const INTENCIONES = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const TRABAS = { precio: 'Precio', demora: 'Demora', desconfianza: 'Desconfianza', distancia: 'Distancia', lo_piensa: 'Lo piensa', otra: 'Otra', ninguna: 'Ninguna' };
const ETAPAS = { nuevo: 'Nuevo', con_verde: 'Con Verde', derivado: 'Derivado', en_atencion: 'En atención', presupuesto_enviado: 'Presupuesto enviado', esperando_cliente: 'Esperando al cliente', sin_respuesta: 'Sin respuesta', cerrado: 'Cerrado' };
const PRIORIDADES = { 3: 'alta', 2: 'media', 1: 'normal' };
/* ---------- 1.5.2: proceso de ventas (próxima acción y plazo por etapa), cierre y tareas ---------- */
const MOTIVOS_CIERRE = { precio: 'Precio', demora: 'Demora', desconfianza: 'Desconfianza', distancia: 'Distancia', lo_piensa: 'Lo piensa', otro_lado: 'Compró en otro lado', otro: 'Otro' };
const RESULTADOS = { ganado: 'Ganado', perdido: 'Perdido' };
const ETAPAS_CON_TAREA = ['derivado', 'en_atencion', 'presupuesto_enviado', 'esperando_cliente', 'sin_respuesta'];
const PROCESO_DEFECTO = {
  derivado: { accion: 'Responder al cliente', plazoHoras: 2, avisar: true },
  en_atencion: { accion: 'Responder al cliente', plazoHoras: 2, avisar: true },
  presupuesto_enviado: { accion: 'Hacer seguimiento del presupuesto', plazoHoras: 24, avisar: false },
  esperando_cliente: { accion: 'Volver a contactar (llamada o mensaje)', plazoHoras: 48, avisar: false },
  sin_respuesta: { accion: 'Último intento o cerrar como perdido', plazoHoras: 72, avisar: false }
};
const VER_EN = { manana: 1, dos_dias: 2, semana: 7, no: 0 };
function leerProceso() {
  let g = {};
  try { if (fs.existsSync(ARCHIVO_PROCESO)) g = JSON.parse(fs.readFileSync(ARCHIVO_PROCESO, 'utf8') || '{}'); } catch (e) { console.error('No se pudo leer proceso.json:', e.message); }
  const etapas = {};
  for (const k of ETAPAS_CON_TAREA) {
    const d = PROCESO_DEFECTO[k], x = (g.etapas && g.etapas[k]) || {};
    const horas = Number(x.plazoHoras);
    etapas[k] = { accion: t(x.accion, 80) || d.accion, plazoHoras: Number.isInteger(horas) && horas >= 1 && horas <= 720 ? horas : d.plazoHoras, avisar: typeof x.avisar === 'boolean' ? x.avisar : d.avisar };
  }
  // 1.5.9: encuesta de calificación automática al marcar atendido o cerrar un lead
  const encuesta = { automatica: !(g.encuesta && g.encuesta.automatica === false) };
  return { etapas, encuesta };
}
function guardarProceso(datos) {
  const actual = leerProceso();
  const nuevas = datos && datos.etapas && typeof datos.etapas === 'object' ? datos.etapas : {};
  for (const k of ETAPAS_CON_TAREA) {
    const x = nuevas[k];
    if (!x || typeof x !== 'object') continue;
    if (typeof x.accion === 'string' && t(x.accion, 80)) actual.etapas[k].accion = t(x.accion, 80);
    const horas = Number(x.plazoHoras);
    if (Number.isInteger(horas) && horas >= 1 && horas <= 720) actual.etapas[k].plazoHoras = horas;
    if (typeof x.avisar === 'boolean') actual.etapas[k].avisar = x.avisar;
  }
  if (datos && datos.encuesta && typeof datos.encuesta.automatica === 'boolean') actual.encuesta.automatica = datos.encuesta.automatica;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO_PROCESO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(actual), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO_PROCESO);
  return actual;
}
// Fecha y hora cortas en hora de Montevideo: «hoy 18:00», «mañana 10:00», «03/11 10:00».
function diaMvd(ms) { return Math.floor((ms - DESFASE_MVD) / 86400000); }
function horaMvd(ms) { const d = new Date(ms - DESFASE_MVD); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }
function fechaCorta(ms, ahora) {
  const dd = diaMvd(ms) - diaMvd(ahora);
  if (dd === 0) return 'hoy ' + horaMvd(ms);
  if (dd === 1) return 'mañana ' + horaMvd(ms);
  if (dd === -1) return 'ayer ' + horaMvd(ms);
  const d = new Date(ms - DESFASE_MVD);
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + ' ' + horaMvd(ms);
}
// Las 10:00 de Montevideo de dentro de «dias» días.
function alas10En(dias, ahora) { return (diaMvd(ahora) + dias) * 86400000 + DESFASE_MVD + 10 * 3600000; }
// Corta al final de una palabra, con puntos suspensivos (1.5.2: el «próximo paso» se cortaba a lo bruto).
function recortar(v, max) {
  const x = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (x.length <= max) return x;
  const corte = x.lastIndexOf(' ', max - 1);
  return x.slice(0, corte > max * 0.6 ? corte : max - 1).replace(/[\s,;:]+$/, '') + '…';
}

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
    '{"tipo":"reparacion|compra|garantia|consulta|otro","producto":"producto o servicio en pocas palabras, por ejemplo «Pantalla Samsung A54» o «Cargador iPhone 15»; vacío si no se sabe","intencion":"alta|media|baja","presupuesto":true o false,"traba":{"categoria":"precio|demora|desconfianza|distancia|lo_piensa|otra|ninguna","frase":"frase TEXTUAL del cliente que muestra la traba, copiada tal cual; vacío si no hay"},"resumen":"una línea, breve, de hasta 140 caracteres","proximoPaso":"qué debería hacer el vendedor ahora, en una frase breve de hasta 120 caracteres","cierre":"ganado|perdido|ninguno","cierreMotivo":"precio|demora|desconfianza|distancia|lo_piensa|otro_lado|otro; vacío si cierre no es perdido"}',
    'Reglas:',
    '1. «tipo»: garantia si reclama por algo que la tienda vendió o reparó; reparacion si consulta por arreglar un equipo; compra si quiere comprar un producto; consulta si pregunta horarios, dirección u otra cosa general; otro si no es nada de eso.',
    '2. «intencion» mide cuánto quiere comprar o reparar ahora: alta si pide precio, horario para ir, forma de pago o dice que va; media si consulta con interés pero sin apuro; baja si solo averigua o se fue.',
    '3. «presupuesto» es true solo si el equipo o Verde ya le dieron un precio o presupuesto concreto.',
    '4. «traba» es el motivo por el que el cliente no avanza o no compra, si existe. La «frase» tiene que ser una frase literal del cliente, no una interpretación. Si no hay traba, categoria «ninguna» y frase vacía.',
    '5. «cierre»: ganado si el cliente ya compró, pagó, dejó el equipo o pasó por el local y la venta se concretó; perdido si dijo que no, compró en otro lado o desistió claramente. Si no está claro, ninguno. Nunca adivines.',
    '6. Español rioplatense neutro. No inventes datos que no estén en la conversación.'
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
    resumen: recortar(o.resumen, 160),
    proximoPaso: recortar(o.proximoPaso, 200),
    cierreSugerido: RESULTADOS[o.cierre] ? { resultado: o.cierre, motivo: o.cierre === 'perdido' && MOTIVOS_CIERRE[o.cierreMotivo] ? o.cierreMotivo : (o.cierre === 'perdido' ? 'otro' : '') } : null
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
  if (l.cierre) etapa = 'cerrado';
  else if (pendiente) etapa = 'derivado';
  else if (!ultimo || ultimo.tipo === 'cliente') etapa = equipoRespondio ? 'en_atencion' : (primero && ahora - primero.en < h(NUEVO_HORAS) ? 'nuevo' : 'con_verde');
  else if (ahora - ultimo.en > h(SIN_RESPUESTA_HORAS)) etapa = 'sin_respuesta';
  else if (ultimo.tipo === 'equipo') etapa = l.presupuesto ? 'presupuesto_enviado' : 'esperando_cliente';
  else etapa = equipoRespondio ? 'esperando_cliente' : (primero && ahora - primero.en < h(NUEVO_HORAS) ? 'nuevo' : 'con_verde');
  const esperaDesde = ['derivado', 'en_atencion', 'nuevo', 'con_verde'].includes(etapa) ? (c.ultimoClienteEn || (ultimo && ultimo.en) || ahora) : ((ultimo && ultimo.en) || ahora);
  const espera = etapa === 'cerrado' ? 0 : Math.max(0, ahora - esperaDesde);
  let prioridad = 1;
  if (etapa === 'cerrado') prioridad = 1;
  else if (l.tipo === 'garantia' || (l.tipo === 'compra' && l.intencion === 'alta') || (etapa === 'derivado' && espera > h(DERIVADO_URGENTE_HORAS))) prioridad = 3;
  else if (l.intencion === 'alta' || l.intencion === 'media' || ['derivado', 'esperando_cliente', 'presupuesto_enviado'].includes(etapa)) prioridad = 2;
  const ultimoEquipo = [...ms].reverse().find(m => m.tipo === 'equipo' && m.autor);
  const vendedorAuto = ultimoEquipo ? ultimoEquipo.autor : '';
  // 1.5.2: desde cuándo está en la etapa (para la tarea y su plazo)
  const etapaDesde = ['derivado', 'en_atencion'].includes(etapa) ? esperaDesde : etapa === 'sin_respuesta' ? ((ultimo && ultimo.en) || ahora) + h(SIN_RESPUESTA_HORAS) : esperaDesde;
  return { etapa, etapaNombre: ETAPAS[etapa], prioridad, prioridadNombre: PRIORIDADES[prioridad], espera, esperaTexto: esperaTexto(espera), vendedorAuto, vendedor: (l.vendedorAsignado && l.vendedorAsignado.nombre) || vendedorAuto, etapaDesde, ultimoEn: ultimo ? ultimo.en : null };
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
  const sug = nuevo.cierreSugerido; delete nuevo.cierreSugerido;
  const lead = Object.assign({}, previo, nuevo, { fijos, clasificadoEn: reloj(), hastaMensaje: c.ultimoEn || reloj(), modelo });
  // 1.5.2: la IA propone el cierre; el vendedor lo confirma. No insiste si ya la rechazaron para estos mismos mensajes.
  lead.sugerencia = sug && !lead.cierre && previo.sugerenciaRechazada !== (c.ultimoEn || 0) ? { resultado: sug.resultado, motivo: sug.motivo, en: reloj() } : null;
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
// 1.5.2: además de clasificar, cada minuto avisa las tareas vencidas (alVencer(chat, lead) manda el aviso).
function programar(chats, bot, ctx, alVencer) {
  if (temporizador || String(process.env.VERDE_CLASIFICACION || '').toLowerCase() === 'no') return;
  temporizador = setInterval(async () => {
    try { await revisar(chats, bot); } catch (e) { console.error('Clasificación de leads:', e.message); }
    if (!ctx || !alVencer) return;
    try {
      for (const x of tareasVencidasSinAviso(chats(), ctx())) { marcarAvisoTarea(x.chat, x.lead.tarea.vence); await alVencer(x.chat, x.lead); }
    } catch (e) { console.error('Avisos de tareas:', e.message); }
  }, 60 * 1000);
  if (temporizador.unref) temporizador.unref();
}

/* ---------- consultas para el panel ---------- */
function tareaDe(calc, lead, proceso, ahora) {
  const cfg = proceso.etapas[calc.etapa];
  if (!cfg || calc.etapa === 'cerrado') return null;
  const s = lead && lead.seguimiento;
  let accion = cfg.accion, vence = calc.etapaDesde + cfg.plazoHoras * 3600000, origen = 'etapa';
  if (s && s.etapa === calc.etapa && s.desde === calc.etapaDesde) {   // la tarea de esta etapa ya se hizo
    if (!s.verEn) return null;
    accion = 'Seguimiento' + (s.nota ? ': ' + s.nota : ''); vence = s.verEn; origen = 'seguimiento';
  }
  const estado = vence <= ahora ? 'vencida' : (diaMvd(vence) === diaMvd(ahora) ? 'hoy' : 'proxima');
  return { accion, vence, estado, origen, avisar: !!cfg.avisar && origen === 'etapa', venceTexto: estado === 'vencida' ? 'venció hace ' + esperaTexto(ahora - vence) : 'vence ' + fechaCorta(vence, ahora) };
}
function publico(c, lead, ctx, ahora, proceso) {
  const calc = calcular(c, lead, ctx, ahora);
  const l = lead || {};
  const cierre = l.cierre ? Object.assign({}, l.cierre, { resultadoNombre: RESULTADOS[l.cierre.resultado], motivoNombre: l.cierre.motivo ? MOTIVOS_CIERRE[l.cierre.motivo] : '' }) : null;
  const sugerencia = l.sugerencia && !l.cierre ? Object.assign({}, l.sugerencia, { resultadoNombre: RESULTADOS[l.sugerencia.resultado], motivoNombre: l.sugerencia.motivo ? MOTIVOS_CIERRE[l.sugerencia.motivo] : '' }) : null;
  return Object.assign({
    tarea: tareaDe(calc, lead, proceso || leerProceso(), ahora), vendedorAsignado: l.vendedorAsignado ? l.vendedorAsignado.nombre : '', cierre, sugerencia,
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
  const d = cargar(), proceso = leerProceso();
  const q = t(f.q, 60).toLowerCase();
  const todos = chats.filter(c => c && c.ultimoClienteEn && c.ultimoEn >= ahora - VENTANA_DIAS * 86400000).map(c => publico(c, d.leads[c.clave], ctx, ahora, proceso));
  const conteo = { alta: 0, media: 0, normal: 0, sinClasificar: 0, cerrados: 0 };
  for (const x of todos) { if (x.etapa === 'cerrado') { conteo.cerrados++; continue; } conteo[x.prioridadNombre]++; if (!x.clasificado) conteo.sinClasificar++; }
  const vendedores = [...new Set(todos.map(x => x.vendedor).filter(Boolean))].sort();
  // 1.5.2: los cerrados salen de la lista, salvo que se filtre por «Cerrado».
  const lista = todos.filter(x => (f.etapa === 'cerrado' ? x.etapa === 'cerrado' : x.etapa !== 'cerrado' && (!f.etapa || x.etapa === f.etapa)) && (!f.tipo || x.tipo === f.tipo) && (!f.vendedor || x.vendedor === f.vendedor)
    && (!q || (x.nombre + ' ' + x.numero + ' ' + x.producto + ' ' + x.resumen).toLowerCase().includes(q)))
    .sort((a, b) => b.prioridad - a.prioridad || b.espera - a.espera);
  return { total: lista.length, conteo, vendedores, etapas: ETAPAS, tipos: TIPOS, lista };
}
function detalle(c, ctx) {
  if (!c) return null;
  return publico(c, cargar().leads[c.clave], ctx, reloj(), leerProceso());
}
/* ---------- 1.5.2: vendedor, cierre, sugerencia y tareas ---------- */
function leadDe(d, c) {
  return d.leads[c.clave] || (d.leads[c.clave] = { tipo: 'otro', producto: '', intencion: 'baja', presupuesto: false, traba: { categoria: 'ninguna', frase: '' }, resumen: '', proximoPaso: '', fijos: {}, clasificadoEn: null, hastaMensaje: 0, modelo: 'manual' });
}
function asignar(c, nombre) {
  const d = cargar(), l = leadDe(d, c);
  const n = t(nombre, 80);
  if (n) l.vendedorAsignado = { nombre: n, en: reloj() }; else delete l.vendedorAsignado;
  guardar(d);
  return l;
}
function cerrar(c, datos, quien) {
  const x = datos || {};
  if (!RESULTADOS[x.resultado]) throw new Error('El resultado tiene que ser «ganado» o «perdido».');
  const d = cargar(), l = leadDe(d, c);
  l.cierre = { resultado: x.resultado, motivo: x.resultado === 'perdido' ? (MOTIVOS_CIERRE[x.motivo] ? x.motivo : 'otro') : '', nota: t(x.nota, 200), por: t(quien, 80) || 'Acceso general', en: reloj(), porIA: !!x.porIA };
  l.sugerencia = null;
  guardar(d);
  return l;
}
function reabrir(c) {
  const d = cargar(), l = leadDe(d, c);
  delete l.cierre;
  guardar(d);
  return l;
}
function responderSugerencia(c, aceptar, quien) {
  const d = cargar(), l = leadDe(d, c);
  const s = l.sugerencia;
  if (!s) throw new Error('No hay ninguna propuesta de cierre para este lead.');
  if (aceptar) return cerrar(c, { resultado: s.resultado, motivo: s.motivo, nota: 'Propuesto por la IA', porIA: true }, quien);
  l.sugerencia = null;
  l.sugerenciaRechazada = l.hastaMensaje || 0;
  guardar(d);
  return l;
}
// «Hecho»: la tarea de la etapa actual queda hecha; «verEn» decide si hay un seguimiento después.
function marcarHecha(c, datos, ctx, quien) {
  const x = datos || {};
  if (!(x.verEn in VER_EN)) throw new Error('Indicar cuándo volver a verlo: mañana, en 2 días, en una semana o sin seguimiento.');
  const d = cargar(), l = leadDe(d, c);
  const ahora = reloj();
  const calc = calcular(c, l, ctx, ahora);
  const tareaActual = tareaDe(calc, l, leerProceso(), ahora);
  if (!tareaActual) throw new Error('Este lead no tiene ninguna tarea pendiente.');
  const dias = VER_EN[x.verEn];
  l.seguimiento = { etapa: calc.etapa, desde: calc.etapaDesde, hechaEn: ahora, por: t(quien, 80) || 'Acceso general', nota: t(x.nota, 160), verEn: dias ? alas10En(dias, ahora) : null, accion: tareaActual.accion };
  guardar(d);
  return l;
}
function textoHecha(l) {
  const s = l.seguimiento;
  return 'Tarea hecha por ' + s.por + ': ' + s.accion + (s.nota ? '. Nota: ' + s.nota : '') + '. ' + (s.verEn ? 'Próximo seguimiento: ' + fechaCorta(s.verEn, reloj()) + '.' : 'Sin seguimiento.');
}
function textoCierre(l) {
  const x = l.cierre;
  return 'Lead cerrado como ' + RESULTADOS[x.resultado].toLowerCase() + (x.motivo ? ' (' + MOTIVOS_CIERRE[x.motivo].toLowerCase() + ')' : '') + ' por ' + x.por + (x.nota ? '. Nota: ' + x.nota : '') + '.';
}
// Tareas pendientes, agrupadas: vencidas, para hoy y próximas. «vendedor» filtra por el vendedor efectivo.
function tareas(chats, ctx, filtros) {
  const f = filtros || {};
  const ahora = reloj();
  const d = cargar(), proceso = leerProceso();
  const items = [];
  const vendedores = new Set();
  for (const c of chats) {
    if (!c || !c.ultimoClienteEn || c.ultimoEn < ahora - VENTANA_DIAS * 86400000) continue;
    const x = publico(c, d.leads[c.clave], ctx, ahora, proceso);
    if (x.etapa === 'cerrado' || !x.tarea) continue;
    if (x.vendedor) vendedores.add(x.vendedor);
    if (f.vendedor && x.vendedor !== f.vendedor) continue;
    items.push(x);
  }
  items.sort((a, b) => a.tarea.vence - b.tarea.vence || b.prioridad - a.prioridad);
  const g = { vencidas: items.filter(x => x.tarea.estado === 'vencida'), hoy: items.filter(x => x.tarea.estado === 'hoy'), proximas: items.filter(x => x.tarea.estado === 'proxima') };
  return Object.assign(g, { total: items.length, totalVencidas: g.vencidas.length, vendedores: [...vendedores].sort() });
}
// Tareas vencidas que todavía no se avisaron (para el aviso al celular).
function tareasVencidasSinAviso(chats, ctx) {
  const ahora = reloj();
  const d = cargar(), proceso = leerProceso();
  const lista = [];
  for (const c of chats) {
    if (!c || !c.ultimoClienteEn || c.ultimoEn < ahora - VENTANA_DIAS * 86400000) continue;
    const l = d.leads[c.clave];
    const x = publico(c, l, ctx, ahora, proceso);
    if (x.etapa === 'cerrado' || !x.tarea || x.tarea.estado !== 'vencida' || !x.tarea.avisar) continue;
    if (l && l.avisoTarea === x.tarea.vence) continue;
    lista.push({ chat: c, lead: x });
  }
  return lista;
}
function marcarAvisoTarea(c, vence) { const d = cargar(), l = leadDe(d, c); l.avisoTarea = vence; guardar(d); }
function crudos() { return cargar().leads; }   // 1.5.7: para los reportes semanales
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

module.exports = { TIPOS, INTENCIONES, TRABAS, ETAPAS, MOTIVOS_CIERRE, RESULTADOS, ETAPAS_CON_TAREA, ESPERA_MS, instrucciones, limpiarJson, normalizar, recortar, fechaCorta, calcular, esperaTexto, clasificar, pendientesDeClasificar, revisar, programar, listar, detalle, prioridadDe, corregir,
  leerProceso, guardarProceso, tareaDe, asignar, cerrar, reabrir, responderSugerencia, marcarHecha, textoHecha, textoCierre, tareas, tareasVencidasSinAviso, marcarAvisoTarea, crudos, _usarReloj };
