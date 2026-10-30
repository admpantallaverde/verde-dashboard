/*
 * reportes.js — Reportes semanales de atención y ventas (1.5.7)
 * --------------------------------------------------------------
 *  - Cada lunes a las 07:00 (Montevideo) arma el reporte de la semana anterior (lunes a domingo):
 *    atención por vendedor (chats atendidos, primera respuesta, respuestas de más de 2 horas,
 *    clientes colgados, tareas), lo más pedido, trabas con frases textuales, resultados de leads
 *    y una evaluación cualitativa hecha por la IA sobre las conversaciones atendidas por el equipo.
 *  - Todo lo que cita lleva la conversación y el momento del mensaje, para abrirla desde el panel.
 *  - Se guarda en data/reportes.json (últimos 26). A las 07:05 avisa por WhatsApp a los números
 *    configurados en «Avisos a celulares del equipo › Reporte semanal».
 *
 * No hace falta tocar este archivo.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'reportes.json');
const DESFASE_MVD = 3 * 3600 * 1000;          // Uruguay: UTC-3 todo el año
const MAX_REPORTES = 26;
const UMBRAL_LENTA_MS = 2 * 3600 * 1000;     // respuesta «lenta»: más de 2 horas
const MAX_CHATS_IA = 40;
const HORA_ARMADO = 7, MINUTO_AVISO = 5;      // lunes 07:00 arma, 07:05 avisa

let reloj = () => Date.now();
function _usarReloj(f) { reloj = f || (() => Date.now()); }

/* ---------- semanas (lunes 00:00 de Montevideo) ---------- */
function lunesDe(ms) {
  const local = new Date(ms - DESFASE_MVD);
  const dia = local.getUTCDay();                     // 0 domingo … 6 sábado
  const resta = (dia + 6) % 7;                       // días desde el lunes
  const inicio = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - resta) + DESFASE_MVD;
  return inicio;
}
function idDe(desde) { const d = new Date(desde - DESFASE_MVD); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }
function fechaCorta(ms) { const d = new Date(ms - DESFASE_MVD); return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
// cual: 'anterior' (la semana completa que terminó el domingo) o 'actual' (en curso)
function semana(cual, ahora) {
  ahora = ahora == null ? reloj() : ahora;
  const lunes = lunesDe(ahora);
  const desde = cual === 'actual' ? lunes : lunes - 7 * 86400000;
  const hasta = desde + 7 * 86400000;
  return { id: idDe(desde), desde, hasta, titulo: 'Semana del ' + fechaCorta(desde) + ' al ' + fechaCorta(hasta - 1), completa: hasta <= ahora };
}

/* ---------- archivo ---------- */
function cargar() {
  try {
    if (!fs.existsSync(ARCHIVO)) return { reportes: [] };
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8') || '{}');
    return d && Array.isArray(d.reportes) ? d : { reportes: [] };
  } catch (e) { console.error('No se pudo leer reportes.json:', e.message); return { reportes: [] }; }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
const t = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
// 1.5.8: corta al final de una palabra, con puntos suspensivos (antes cortaba a lo bruto)
function recortar(v, max) {
  const x = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (x.length <= max) return x;
  const corte = x.lastIndexOf(' ', max - 1);
  return x.slice(0, corte > max * 0.6 ? corte : max - 1).replace(/[\s,;:]+$/, '') + '…';
}
const en = (ms, s) => ms >= s.desde && ms < s.hasta;
function mediana(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
function duracion(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return '< 1 min';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return h + ' h' + (r ? ' ' + r + ' min' : '');
  const d = Math.floor(h / 24);
  return d + (d === 1 ? ' día' : ' días') + (h % 24 ? ' ' + (h % 24) + ' h' : '');
}
function nombreCliente(c) { return c.nombre || (c.numero ? '+' + c.numero : c.clave); }

/* ---------- datos de la semana ---------- */
// deps: { chats (conversaciones.recientes), leads (leads.crudos()), calcular (leads.calcular), ctx, proceso, tareaDe }
function armarDatos(s, deps, ahora) {
  ahora = ahora == null ? reloj() : ahora;
  const vendedores = {};
  const v = n => vendedores[n] || (vendedores[n] = { nombre: n, chats: new Set(), respuestas: [], lentas: [], colgados: [], tareasHechas: 0, tareasVencidas: 0, encuestas: 0, calif: { 3: 0, 2: 0, 1: 0 } });
  // 1.5.9: calificaciones de los clientes de la semana
  for (const e of (deps.encuestas || [])) if (e && en(e.en, s)) { const vd = v(e.vendedor || 'Sin vendedor asignado'); vd.encuestas++; if (e.puntaje) vd.calif[e.puntaje]++; }
  const msVisibles = c => (c.mensajes || []).filter(m => m && ['cliente', 'verde', 'equipo'].includes(m.tipo));
  for (const c of deps.chats) {
    const ms = msVisibles(c);
    // primera respuesta del equipo a cada racha de mensajes del cliente
    let inicioCliente = null;
    for (const m of ms) {
      if (m.tipo === 'cliente') { if (inicioCliente == null) inicioCliente = m.en; continue; }
      if (m.tipo === 'equipo' && m.autor) {
        if (inicioCliente != null && en(m.en, s)) {
          const dem = m.en - inicioCliente;
          const vd = v(m.autor);
          vd.chats.add(c.clave);
          vd.respuestas.push(dem);
          if (dem > UMBRAL_LENTA_MS) vd.lentas.push({ clave: c.clave, cliente: nombreCliente(c), en: m.en, demora: dem, demoraTexto: duracion(dem) });
        } else if (en(m.en, s)) v(m.autor).chats.add(c.clave);
        inicioCliente = null;
      }
      if (m.tipo === 'verde') { /* Verde no cierra la racha: la primera respuesta humana es la que cuenta */ }
    }
    // colgado: el último mensaje es del cliente, dentro de la semana, hubo intervención humana (equipo o derivación) y pasaron más de 2 horas
    const ultimo = ms[ms.length - 1];
    const equipoAntes = ms.some(m => m.tipo === 'equipo');
    const derivado = deps.ctx && deps.ctx.pendientes && deps.ctx.pendientes.has(c.clave);
    const leadC = deps.leads[c.clave];
    // un lead cerrado no es un cliente colgado: el caso ya terminó
    if (ultimo && ultimo.tipo === 'cliente' && en(ultimo.en, s) && (equipoAntes || derivado) && !(leadC && leadC.cierre)) {
      const limite = Math.min(ahora, s.hasta);
      if (limite - ultimo.en > UMBRAL_LENTA_MS) {
        const lead = leadC;
        const ultEq = [...ms].reverse().find(m => m.tipo === 'equipo' && m.autor);
        const quien = (lead && lead.vendedorAsignado && lead.vendedorAsignado.nombre) || (ultEq ? ultEq.autor : 'Sin vendedor asignado');
        v(quien).colgados.push({ clave: c.clave, cliente: nombreCliente(c), en: ultimo.en, espera: duracion(limite - ultimo.en) });
      }
    }
  }
  // tareas hechas y vencidas
  for (const c of deps.chats) {
    const l = deps.leads[c.clave];
    if (!l) continue;
    if (l.seguimiento && en(l.seguimiento.hechaEn, s)) v(l.seguimiento.por || 'Sin vendedor asignado').tareasHechas++;
    if (deps.calcular && deps.tareaDe && !l.cierre) {
      const calc = deps.calcular(c, l, deps.ctx, Math.min(ahora, s.hasta));
      const ta = deps.tareaDe(calc, l, deps.proceso, Math.min(ahora, s.hasta));
      if (ta && ta.estado === 'vencida' && en(ta.vence, s)) v(calc.vendedor || 'Sin vendedor asignado').tareasVencidas++;
    }
  }
  // «Sin vendedor asignado» solo aparece si tiene algo que mostrar (colgados o tareas vencidas)
  const atencion = Object.values(vendedores).filter(x => x.nombre !== 'Sin vendedor asignado' || x.colgados.length || x.tareasVencidas || x.encuestas).map(x => ({
    nombre: x.nombre, sinVendedor: x.nombre === 'Sin vendedor asignado', chats: x.chats.size, respuestas: x.respuestas.length,
    medianaMs: mediana(x.respuestas), mediana: duracion(mediana(x.respuestas)), maximaMs: x.respuestas.length ? Math.max(...x.respuestas) : null, maxima: duracion(x.respuestas.length ? Math.max(...x.respuestas) : null),
    lentas: x.lentas.sort((a, b) => b.demora - a.demora).slice(0, 20), colgados: x.colgados.slice(0, 20), tareasHechas: x.tareasHechas, tareasVencidas: x.tareasVencidas,
    encuestas: x.encuestas, respondidas: x.calif[3] + x.calif[2] + x.calif[1], muyBuena: x.calif[3], buena: x.calif[2], mala: x.calif[1]
  })).sort((a, b) => b.chats - a.chats);
  // lo más pedido y trabas: leads con actividad en la semana
  const productos = {}, tipos = {}, trabas = {};
  const nuevos = [], cerrados = [], abiertos = [];
  const TRABAS = { precio: 'Precio', demora: 'Demora', desconfianza: 'Desconfianza', distancia: 'Distancia', lo_piensa: 'Lo piensa', otra: 'Otra' };
  const TIPOS = { reparacion: 'Reparación', compra: 'Compra', garantia: 'Garantía', consulta: 'Consulta general', otro: 'Otro' };
  const MOTIVOS = { precio: 'Precio', demora: 'Demora', desconfianza: 'Desconfianza', distancia: 'Distancia', lo_piensa: 'Lo piensa', otro_lado: 'Compró en otro lado', otro: 'Otro' };
  for (const c of deps.chats) {
    const ms = msVisibles(c);
    const primero = ms.find(m => m.tipo === 'cliente');
    const activo = ms.some(m => en(m.en, s));
    if (primero && en(primero.en, s)) nuevos.push(c.clave);
    const l = deps.leads[c.clave];
    if (l && l.cierre && en(l.cierre.en, s)) cerrados.push({ clave: c.clave, cliente: nombreCliente(c), resultado: l.cierre.resultado, motivo: l.cierre.motivo || '', motivoNombre: l.cierre.motivo ? MOTIVOS[l.cierre.motivo] || l.cierre.motivo : '' });
    else if (activo && (!l || !l.cierre)) abiertos.push(c.clave);
    if (!l || !activo) continue;
    if (l.producto) { const k = l.producto.trim().toLowerCase(); productos[k] = productos[k] || { nombre: l.producto.trim(), veces: 0, tipo: TIPOS[l.tipo] || '' }; productos[k].veces++; }
    if (l.tipo) tipos[l.tipo] = (tipos[l.tipo] || 0) + 1;
    if (l.traba && l.traba.categoria && l.traba.categoria !== 'ninguna') {
      const k = l.traba.categoria;
      trabas[k] = trabas[k] || { categoria: k, nombre: TRABAS[k] || k, veces: 0, frases: [] };
      trabas[k].veces++;
      if (l.traba.frase && trabas[k].frases.length < 6) {
        const m = ms.find(x => x.tipo === 'cliente' && String(x.texto || '').toLowerCase().includes(l.traba.frase.toLowerCase().slice(0, 40)));
        trabas[k].frases.push({ clave: c.clave, cliente: nombreCliente(c), frase: l.traba.frase, en: m ? m.en : null });
      }
    }
  }
  // 1.5.8: cuánto resolvió Verde solo, cuántas se derivaron y cuántas atendió el equipo
  const derivadasSemana = new Set((deps.derivaciones || []).filter(x => x && en(x.creadoEn, s)).map(x => x.clave));
  let soloVerde = 0, conEquipo = 0;
  for (const c of deps.chats) {
    const ms = msVisibles(c);
    if (!ms.some(m => m.tipo === 'cliente' && en(m.en, s))) continue;
    if (ms.some(m => m.tipo === 'equipo' && en(m.en, s))) conEquipo++;
    else if (!derivadasSemana.has(c.clave)) soloVerde++;
  }
  const ganados = cerrados.filter(x => x.resultado === 'ganado'), perdidos = cerrados.filter(x => x.resultado === 'perdido');
  const motivosPerdida = {};
  for (const p of perdidos) if (p.motivoNombre) motivosPerdida[p.motivoNombre] = (motivosPerdida[p.motivoNombre] || 0) + 1;
  return {
    atencion,
    pedidos: Object.values(productos).sort((a, b) => b.veces - a.veces).slice(0, 10),
    tipos: Object.entries(tipos).map(([k, n]) => ({ tipo: k, nombre: TIPOS[k] || k, veces: n })).sort((a, b) => b.veces - a.veces),
    trabas: Object.values(trabas).sort((a, b) => b.veces - a.veces),
    resultados: { nuevos: nuevos.length, ganados: ganados.length, perdidos: perdidos.length, abiertos: abiertos.length, motivosPerdida: Object.entries(motivosPerdida).map(([n, v]) => ({ motivo: n, veces: v })).sort((a, b) => b.veces - a.veces), cerrados: cerrados.slice(0, 50) },
    verde: { soloVerde, derivadas: derivadasSemana.size, conEquipo },
    totales: { conversaciones: deps.chats.filter(c => msVisibles(c).some(m => en(m.en, s))).length, mensajesCliente: deps.chats.reduce((n, c) => n + msVisibles(c).filter(m => m.tipo === 'cliente' && en(m.en, s)).length, 0) }
  };
}

/* ---------- evaluación cualitativa con la IA ---------- */
function instruccionesEvaluacion(empresa) {
  return [
    'EVALUADOR DE ATENCIÓN AL CLIENTE de ' + (empresa || 'la tienda') + ' (WhatsApp).',
    'Vas a leer las conversaciones de una semana en las que respondió una persona del equipo (marcadas como «Equipo (Nombre)»). Verde es el bot; no lo evalúes a él, evaluá a las personas.',
    'Devolvé SOLO un objeto JSON válido, sin texto antes ni después, con esta forma:',
    '{"vendedores":[{"nombre":"nombre exacto de la persona","puntaje":1 a 5,"fortalezas":"una o dos oraciones","mejorar":"una o dos oraciones concretas","ejemplos":[{"clave":"clave de la conversación","cita":"frase TEXTUAL de la persona del equipo o del cliente, copiada tal cual","comentario":"qué muestra ese ejemplo y qué hacer distinto, en una oración"}]}],"temas":["tema recurrente de la semana, en una frase"],"recomendaciones":["punto concreto para la reunión del equipo"]}',
    'Reglas:',
    '1. Un elemento por cada persona del equipo que aparezca. Hasta 3 ejemplos por persona, con la «clave» exacta de la conversación y una «cita» literal.',
    '2. Puntaje: 5 excelente, 4 bueno, 3 correcto con cosas a mejorar, 2 flojo, 1 malo. Juzgá rapidez, claridad, tono, si resolvió lo que el cliente pedía y si siguió el proceso de venta.',
    '3. Hasta 4 temas (una frase cada uno) y exactamente 3 recomendaciones: cada una empieza con un verbo en infinitivo, es concreta y cabe en dos líneas (hasta 200 caracteres), por ejemplo «Preguntar qué falla tiene el equipo antes de dar un precio».',
    '4. Español rioplatense, directo, sin adulación. No inventes conversaciones ni citas.'
  ].join('\n');
}
function transcripcion(c) {
  const quien = { cliente: 'Cliente', verde: 'Verde', equipo: 'Equipo' };
  return (c.mensajes || []).filter(m => m && quien[m.tipo]).slice(-30).map(m => (m.tipo === 'equipo' && m.autor ? 'Equipo (' + m.autor + ')' : quien[m.tipo]) + ': ' + t(m.texto, 300)).join('\n');
}
function chatsParaEvaluar(s, deps) {
  const con = deps.chats.filter(c => (c.mensajes || []).some(m => m && m.tipo === 'equipo' && en(m.en, s)));
  const fue = new Set(deps.derivadas || []);
  return con.sort((a, b) => (fue.has(b.clave) - fue.has(a.clave)) || (b.ultimoEn - a.ultimoEn)).slice(0, MAX_CHATS_IA);
}
function limpiarJson(crudo) {
  let x = String(crudo == null ? '' : crudo).trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  const i = x.indexOf('{'), j = x.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(x.slice(i, j + 1)); } catch (e) { return null; }
}
function normalizarEvaluacion(j, chats) {
  const o = j && typeof j === 'object' ? j : {};
  const porClave = {}; for (const c of chats) porClave[c.clave] = c;
  const vendedores = (Array.isArray(o.vendedores) ? o.vendedores : []).slice(0, 12).map(x => {
    const ejemplos = (Array.isArray(x.ejemplos) ? x.ejemplos : []).slice(0, 3).map(e => {
      const c = porClave[String(e.clave || '')];
      const cita = t(e.cita, 200);
      let enMs = null;
      if (c && cita) { const m = (c.mensajes || []).find(mm => mm && String(mm.texto || '').toLowerCase().includes(cita.toLowerCase().slice(0, 40))); if (m) enMs = m.en; }
      return { clave: c ? c.clave : '', cliente: c ? nombreCliente(c) : '', cita, comentario: recortar(e.comentario, 300), en: enMs };
    }).filter(e => e.clave);
    const p = Number(x.puntaje);
    return { nombre: t(x.nombre, 80), puntaje: p >= 1 && p <= 5 ? Math.round(p) : null, fortalezas: recortar(x.fortalezas, 400), mejorar: recortar(x.mejorar, 400), ejemplos };
  }).filter(x => x.nombre);
  return { vendedores, temas: (Array.isArray(o.temas) ? o.temas : []).slice(0, 4).map(x => recortar(x, 240)).filter(Boolean), recomendaciones: (Array.isArray(o.recomendaciones) ? o.recomendaciones : []).slice(0, 3).map(x => recortar(x, 320)).filter(Boolean) };
}
async function evaluar(s, deps, bot) {
  const chats = chatsParaEvaluar(s, deps);
  if (!chats.length) return { evaluacion: { vendedores: [], temas: [], recomendaciones: [], sinConversaciones: true }, chats: 0 };
  const v = bot.getVerde();
  const conf = bot.configAsistente(v);
  const cuerpo = chats.map(c => '=== Conversación ' + c.clave + ' (' + nombreCliente(c) + ') ===\n' + transcripcion(c)).join('\n\n');
  const crudo = await bot.callClaude(instruccionesEvaluacion(v.empresa), [{ role: 'user', content: 'CONVERSACIONES DE LA ' + s.titulo.toUpperCase() + ':\n\n' + cuerpo }], v, conf.modelo, 'reporte', { esfuerzo: conf.esfuerzo });
  const j = limpiarJson(crudo);
  if (!j) throw new Error('La IA no devolvió una evaluación válida.');
  return { evaluacion: normalizarEvaluacion(j, chats), chats: chats.length };
}

/* ---------- generar y consultar ---------- */
async function generar(cual, deps, bot, quien) {
  const s = semana(cual);
  const datos = armarDatos(s, deps);
  const r = { id: s.id, desde: s.desde, hasta: s.hasta, titulo: s.titulo, completa: s.completa, generadoEn: reloj(), por: t(quien, 80) || 'Automático', datos, evaluacion: null, evaluacionError: '', chatsEvaluados: 0 };
  try { const ev = await evaluar(s, deps, bot); r.evaluacion = ev.evaluacion; r.chatsEvaluados = ev.chats; }
  catch (e) { r.evaluacionError = t(e.message, 200); console.error('Reporte semanal: la evaluación falló: ' + e.message); }
  const d = cargar();
  d.reportes = d.reportes.filter(x => x.id !== r.id);
  d.reportes.push(r);
  d.reportes.sort((a, b) => b.desde - a.desde);
  while (d.reportes.length > MAX_REPORTES) d.reportes.pop();
  guardar(d);
  return r;
}
async function reevaluar(id, deps, bot) {
  const d = cargar();
  const r = d.reportes.find(x => x.id === id);
  if (!r) return null;
  const s = { id: r.id, desde: r.desde, hasta: r.hasta, titulo: r.titulo, completa: r.completa };
  try { const ev = await evaluar(s, deps, bot); r.evaluacion = ev.evaluacion; r.chatsEvaluados = ev.chats; r.evaluacionError = ''; }
  catch (e) { r.evaluacionError = t(e.message, 200); }
  guardar(d);
  return r;
}
function listar() { return cargar().reportes.map(r => ({ id: r.id, titulo: r.titulo, desde: r.desde, hasta: r.hasta, completa: r.completa, generadoEn: r.generadoEn, por: r.por, conEvaluacion: !!r.evaluacion, avisadoEn: r.avisadoEn || null })); }
function obtener(id) { return cargar().reportes.find(x => x.id === id) || null; }
function marcarAvisado(id) { const d = cargar(); const r = d.reportes.find(x => x.id === id); if (r) { r.avisadoEn = reloj(); guardar(d); } }
// Resumen de una línea para el aviso de WhatsApp
function resumenCorto(r) {
  const a = r.datos.atencion, lentas = a.reduce((n, x) => n + x.lentas.length, 0), colg = a.reduce((n, x) => n + x.colgados.length, 0);
  return r.datos.totales.conversaciones + ' conversaciones, ' + r.datos.resultados.ganados + ' ganados, ' + r.datos.resultados.perdidos + ' perdidos, ' + lentas + ' respuestas de más de 2 h y ' + colg + ' clientes colgados';
}

/* ---------- lunes 07:00: armar; 07:05: avisar ---------- */
let temporizador = null, armando = false;
function horaMvd(ms) { const d = new Date(ms - DESFASE_MVD); return { dia: d.getUTCDay(), hora: d.getUTCHours(), minuto: d.getUTCMinutes() }; }
async function revisar(depsFn, bot, alAvisar) {
  const ahora = reloj(), h = horaMvd(ahora);
  if (h.dia !== 1 || h.hora < HORA_ARMADO) return null;                // solo lunes desde las 07:00
  const s = semana('anterior', ahora);
  let r = obtener(s.id);
  if (!r && !armando) {
    armando = true;
    try { r = await generar('anterior', depsFn(), bot, 'Automático'); } finally { armando = false; }
  }
  if (r && !r.avisadoEn && alAvisar && (h.hora > HORA_ARMADO || h.minuto >= MINUTO_AVISO)) {
    marcarAvisado(r.id);
    try { await alAvisar(r); } catch (e) { console.error('Aviso del reporte semanal:', e.message); }
  }
  return r;
}
function programar(depsFn, bot, alAvisar) {
  if (temporizador || String(process.env.VERDE_REPORTES || '').toLowerCase() === 'no') return;
  temporizador = setInterval(() => { revisar(depsFn, bot, alAvisar).catch(e => console.error('Reporte semanal:', e.message)); }, 60 * 1000);
  if (temporizador.unref) temporizador.unref();
}

module.exports = { UMBRAL_LENTA_MS, MAX_CHATS_IA, semana, lunesDe, armarDatos, recortar, instruccionesEvaluacion, normalizarEvaluacion, evaluar, generar, reevaluar, listar, obtener, marcarAvisado, resumenCorto, revisar, programar, duracion, _usarReloj };
