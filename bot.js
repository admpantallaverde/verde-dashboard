/*
 * bot.js — El "cerebro" de Verde
 * --------------------------------------------------------------
 * Toma la configuración que editás en el dashboard (data/state.json),
 * arma el prompt, le pregunta a la IA (Anthropic) y devuelve la respuesta.
 * Guarda el historial de cada conversación en disco (data/conversations.json)
 * para que NO se pierda al reiniciar, y las pausas de cada cliente
 * (data/pausas.json) cuando una persona del equipo toma la conversación.
 *
 * No hace falta tocar este archivo.
 */

const fs = require('fs');
const consumo = require('./consumo');
const cumplimiento = require('./cumplimiento');
const recursos = require('./recursos');   // 1.4.8: biblioteca de recursos
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONV_FILE = path.join(DATA_DIR, 'conversations.json');
const PAUSAS_FILE = path.join(DATA_DIR, 'pausas.json');

/* ---------- modelo de IA ---------- */
const MODELO_PREDETERMINADO = 'claude-sonnet-5-5';
// Modelos retirados o por retirarse → reemplazo recomendado por Anthropic.
// Así Verde no deja de responder si el panel todavía tiene un modelo viejo.
const MODELOS_REEMPLAZO = {
  'claude-sonnet-4-5': 'claude-sonnet-5-5',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-5-5',
  'claude-sonnet-4-0': 'claude-sonnet-5-5',
  'claude-sonnet-4-20250514': 'claude-sonnet-5-5'
};
const ESFUERZOS_VALIDOS = ['low', 'medium', 'high'];
// 1.4.11: niveles de esfuerzo del asistente del equipo (con razonamiento adaptativo acepta los cinco).
const ESFUERZOS_ASISTENTE = ['low', 'medium', 'high', 'xhigh', 'max'];
// IA que se pueden elegir en el panel, con los ajustes que indica la documentación oficial
// para responder rápido en un chat:
//  - Sonnet 5.5: sin razonamiento previo (between_tools) y esfuerzo medio.
//  - Opus 5.5 y Fable 5.1: su razonamiento no se puede apagar; se usa el esfuerzo más bajo
//    y un margen de tokens para que el razonamiento no corte la respuesta.
const MODELOS = [
  { id: 'claude-sonnet-5-5', nombre: 'Claude Sonnet 5.5', thinking: { type: 'between_tools' }, esfuerzo: 'medium', tokensMinimos: 0 },
  { id: 'claude-opus-5-5', nombre: 'Claude Opus 5.5', thinking: null, esfuerzo: 'low', tokensMinimos: 4000 },
  { id: 'claude-fable-5-1', nombre: 'Claude Fable 5.1', thinking: null, esfuerzo: 'low', tokensMinimos: 4000 },
  // 1.5.1: Haiku 5.5 razona por defecto y ese razonamiento descuenta de max_tokens: esfuerzo bajo y lugar suficiente para razonar y escribir el JSON.
  { id: 'claude-haiku-5-5', nombre: 'Claude Haiku 5.5', thinking: null, esfuerzo: 'low', tokensMinimos: 2000 }
];
function listarModelos() { return MODELOS.map(m => ({ id: m.id, nombre: m.nombre })); }
function modeloPermitido(id) { return MODELOS.some(m => m.id === id); }

/* ---------- leer configuración guardada por el dashboard ---------- */
function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('No se pudo leer state.json:', e.message);
    return {};
  }
}
function getVerde() {
  const s = readState();
  return (s && s.verde) ? s.verde : {};
}

/* ---------- armar el system prompt desde la configuración ---------- */
// 1.4.2: indicaciones para cuando el cliente envía un archivo (se configuran en «Comportamiento del bot › G»).
const ADJUNTO_POR_DEFECTO = 'Agradecer el archivo y avisar que un asesor lo va a revisar. Seguir la conversación con normalidad. Si el cliente consulta por una reparación y faltan fotos, pedir la del frente con la pantalla encendida y la de la parte trasera del equipo.';
const ADJUNTO_VIEJO = '¡Gracias! 🙌 Recibí tu archivo. En un momento un asesor lo revisa y te confirma todo. Si querés, dejame por acá cualquier dato que quieras sumar.';
function instruccionesArchivo(fr) {
  const t = String((fr && fr.adjunto) || '').trim();
  return t && t !== ADJUNTO_VIEJO ? t : ADJUNTO_POR_DEFECTO;
}

// 1.4.3: estado del chat para Verde. Un chat derivado o con un archivo para revisar no calla a Verde:
// sigue conversando hasta que responde una persona del equipo (ahí hace su pausa de 12 horas).
function notaAtencion(estado) {
  if (estado === 'derivado') return '\n\nESTADO DE ESTE CHAT: ya está derivado a una persona del equipo, que va a responder en cuanto pueda. Seguir conversando y ayudando sin dar precios ni confirmar presupuestos. No volver a derivar ni repetir en cada mensaje que se lo pasa a un asesor; si el cliente pregunta por el precio o por la persona, indicar que un asesor le va a escribir.';
  if (estado === 'revision') return '\n\nESTADO DE ESTE CHAT: el cliente envió un archivo que una persona del equipo va a revisar. Seguir conversando con normalidad.';
  return '';
}

// 1.4.4: protocolo de reclamos y garantía (se configura en «Comportamiento del bot › I»).
const GARANTIA_DATOS_DEFECTO = [
  'Qué producto, repuesto o servicio se compró o reparó, y cuándo',
  'Número de la boleta de garantía (y una foto si la tiene)',
  'Si el reclamo es por lo mismo que se vendió o reparó, o por otra cosa',
  'Qué falla exactamente, desde cuándo y en qué momento aparece',
  'Si el equipo se golpeó o se mojó',
  'Si ya reinició el equipo',
  'Fotos o videos que muestren la falla'
];
// Política real de Pantalla Verde (términos y condiciones de la orden de trabajo). Se puede editar desde el panel.
const GARANTIA_REQUISITOS_DEFECTO = 'Presentar la orden de trabajo (boleta de garantía) con su número: sin ella no se puede iniciar el reclamo. El reclamo lo gestiona la persona que ingresó el equipo al local, titular de la orden; si no está disponible, no se puede dar una solución hasta que se presente. El reclamo debe hacerse dentro de los 30 días corridos desde la entrega del equipo y referirse a la reparación realizada (lo detallado en la orden), por defectos del repuesto.';
const GARANTIA_COBERTURA_DEFECTO = 'La garantía es de 30 días corridos desde la entrega, solo sobre la reparación realizada y por defectos del repuesto, sin rayas, golpes, apretones ni humedad. No cubre otros componentes, fallas por golpes, humedad, mal uso o daños posteriores, ni equipos abiertos por terceros. Reparar un componente no garantiza el funcionamiento de otros. Los equipos ingresados apagados, mojados, con daños de sistema, pantalla rota o partes expuestas, o sin la clave de desbloqueo, no se prueban por completo: sus funciones y partes internas (micrófono, cámara, pin, etc.) no se verifican ni garantizan, y su falla no es atribuible a la tienda; un golpe o la humedad pueden haber dañado componentes internos aunque el daño visible fuera solo la pantalla o la tapa. El cliente acepta el estado descrito en la orden que firma y debe revisar y probar el equipo al retirarlo; los reclamos se rigen por esta garantía. El respaldo de los datos es responsabilidad del cliente. El equipo debe retirarse dentro de los 30 días corridos; después se considera abandonado y se pierde el derecho sobre él.';
const GARANTIA_SINTOMAS_DEFECTO = [
  { sintoma: 'El touch no responde', preguntar: 'Si el equipo se golpeó o se mojó después del cambio. Desde cuándo y si falla siempre o a veces.', sugerir: 'Reinicio forzado, con las instrucciones según el equipo (iPhone o Android). Si sigue, pedir un video corto.' },
  { sintoma: 'No carga o carga lento', preguntar: 'Si lo carga en el auto. Qué cargador y qué cable usa.', sugerir: 'Pedir una foto del cargador y del cable, o que los traiga para revisarlos junto con el equipo.' }
];
function garantiaDe(v) {
  const g = (v && v.garantia) || {};
  return {
    activo: g.activo !== false,
    requisitos: String(g.requisitos || '').trim() || GARANTIA_REQUISITOS_DEFECTO,
    condiciones: String(g.condiciones || '').trim() || GARANTIA_COBERTURA_DEFECTO,
    datos: Array.isArray(g.datos) && g.datos.length ? g.datos.map(x => String(x || '').trim()).filter(Boolean) : GARANTIA_DATOS_DEFECTO.slice(),
    sintomas: Array.isArray(g.sintomas) && g.sintomas.length ? g.sintomas.filter(s => s && String(s.sintoma || '').trim()) : GARANTIA_SINTOMAS_DEFECTO.map(s => Object.assign({}, s))
  };
}
function bloqueGarantia(v) {
  const g = garantiaDe(v);
  if (!g.activo) return '';
  const datos = g.datos.map((d, i) => '   ' + (i + 1) + '. ' + d).join('\n') || '   —';
  const sintomas = g.sintomas.map(s => '   - ' + s.sintoma + ': preguntar ' + (s.preguntar || '—') + ' Sugerir: ' + (s.sugerir || '—')).join('\n') || '   —';
  return '\n\n== RECLAMOS Y GARANTÍA ==\n'
    + 'Cuando el cliente plantea una falla de algo que compró o reparó en la tienda, o pide garantía, seguir este protocolo:\n'
    + '1. Mostrar empatía y explicar que, para evaluarlo, hace falta juntar algunos datos y que después lo revisa un asesor.\n'
    + '2. Juntar estos datos, de a una o dos preguntas por mensaje:\n' + datos + '\n'
    + '3. Según el síntoma, preguntar y sugerir lo indicado:\n' + sintomas + '\n'
    + '4. REQUISITOS INDISPENSABLES (sin ellos no hay garantía): ' + g.requisitos + ' Si el cliente no cumple alguno, decirlo con claridad: hasta que no se cumpla, el reclamo no puede avanzar. No ofrecer alternativas que no estén escritas en este punto, e igual armar la ficha para el asesor con los datos que haya.\n'
    + '5. Plazos y cobertura que se pueden informar si el cliente pregunta: ' + g.condiciones + '\n'
    + '6. REGLAS FIJAS DEL PROTOCOLO: nunca afirmar ni dar a entender que la garantía corresponde o que se va a dar; decir que se evalúa con la información reunida y que el asesor confirma cómo seguir. No inventar procedimientos ni ofrecer alternativas que no estén escritas en los puntos 4 y 5 (por ejemplo, buscar el trabajo en el sistema o ubicar la venta por nombre y apellido): si algo no está escrito, decir que lo confirma el asesor. No mencionar nada sobre buena o mala fe del cliente. No prometer plazos de resolución.\n'
    + '7. Cuando tengas los datos suficientes (o el cliente no pueda aportar más), cerrar con un resumen breve para el cliente y agregar al final del mensaje, en una línea aparte y sin texto adicional en esa línea, la ficha en este formato exacto:\n'
    + '[RECLAMO]{"boleta":"","producto":"","mismo":"sí|no|no sabe","falla":"","desde":"","momento":"","golpes":"","reinicio":"","sugerencias":"","notas":""}\n'
    + '   junto con [DERIVAR]. Si después el cliente aporta datos nuevos del reclamo, repetir la línea [RECLAMO] actualizada.';
}
// La ficha del reclamo viaja al final de la respuesta como [RECLAMO]{…}: se guarda en la atención y se quita del mensaje.
const CAMPOS_RECLAMO = ['boleta', 'producto', 'mismo', 'falla', 'desde', 'momento', 'golpes', 'reinicio', 'sugerencias', 'notas'];
function separarReclamo(texto) {
  const t = String(texto == null ? '' : texto);
  const m = /\[RECLAMO\]\s*(\{[^{}]*\})/.exec(t);
  if (!m) return { texto: t, ficha: null };
  let ficha = null;
  try {
    const j = JSON.parse(m[1]);
    if (j && typeof j === 'object') {
      ficha = {};
      for (const k of CAMPOS_RECLAMO) { const val = j[k]; if (val != null && String(val).trim()) ficha[k] = String(val).replace(/\s+/g, ' ').trim().slice(0, 300); }
      if (!Object.keys(ficha).length) ficha = null;
    }
  } catch (e) { ficha = null; }
  const limpio = t.replace(/\[RECLAMO\]\s*\{[^{}]*\}/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texto: limpio, ficha };
}

// 1.4.7: fichas de consulta (reparaciones y compras). Se configuran en «Comportamiento del bot › J».
const CONSULTA_REPARACION_DEFECTO = [
  'Marca y modelo del equipo',
  'Qué le pasa o qué reparación necesita',
  'Cómo empezó (golpe, caída, humedad u otro)',
  'Si el equipo enciende',
  'Si fue reparado o abierto antes',
  'Si prefiere la opción más económica o la de mejor calidad',
  'Cuándo podría traer el equipo al local'
];
const CONSULTA_COMPRA_DEFECTO = [
  'Qué producto busca (modelo, color, capacidad o variante)',
  'Para qué equipo es, si es un accesorio o repuesto',
  'Cantidad',
  'Si retira en el local o necesita envío (y a qué zona)',
  'Para cuándo lo necesita',
  'Forma de pago que prefiere'
];
function listaConsulta(lista, defecto) {
  const l = Array.isArray(lista) ? lista.map(x => String(x || '').trim()).filter(Boolean) : [];
  return l.length ? l : defecto.slice();
}
function consultasDe(v) {
  const c = (v && v.consultas) || {};
  return { activo: c.activo !== false, reparacion: listaConsulta(c.reparacion, CONSULTA_REPARACION_DEFECTO), compra: listaConsulta(c.compra, CONSULTA_COMPRA_DEFECTO) };
}
function bloqueConsultas(v) {
  const c = consultasDe(v);
  if (!c.activo) return '';
  const num = l => l.map((d, i) => '   ' + (i + 1) + '. ' + d).join('\n');
  return '\n\n== FICHAS DE CONSULTA ==\n'
    + 'Cuando derives el chat a un asesor por una consulta de reparación o de compra (por ejemplo, cuando el cliente pide precio), armá la ficha de la consulta para el asesor con los datos que ya tengas, y seguí completándola mientras conversás.\n'
    + 'Datos para una consulta de REPARACIÓN:\n' + num(c.reparacion) + '\n'
    + 'Datos para una consulta de COMPRA:\n' + num(c.compra) + '\n'
    + 'Reglas: preguntar de a uno o dos datos por mensaje, sin insistir si el cliente no sabe o no quiere responder. Nunca dar precios. Si el cliente reclama por algo que ya compró o reparó, usar el protocolo de reclamos y garantía, no esta ficha.\n'
    + 'Formato: al final del mensaje, en una línea aparte y sin texto adicional en esa línea, la ficha en este formato exacto:\n'
    + '[CONSULTA]{"tipo":"reparación|compra","1":"","2":"","notas":""}\n'
    + '   donde cada número es el dato de la lista del tipo elegido; incluir solo los datos conocidos. Agregar la línea en el mensaje en que derivás (junto con [DERIVAR]) y repetirla actualizada cada vez que el cliente aporte un dato nuevo.';
}
// La ficha viaja al final de la respuesta como [CONSULTA]{…}: se quita del mensaje y se arma con los nombres
// de la lista configurada en ese momento (así la ficha conserva sus nombres aunque después se edite la lista).
function separarConsulta(texto, v) {
  const t = String(texto == null ? '' : texto);
  const m = /\[CONSULTA\]\s*(\{[^{}]*\})/.exec(t);
  const limpio = t.replace(/\[CONSULTA\]\s*\{[^{}]*\}/g, '').replace(/\[CONSULTA\][^\n]*/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!m) return { texto: limpio, ficha: null };
  const c = consultasDe(v);
  if (!c.activo) return { texto: limpio, ficha: null };
  let ficha = null;
  try {
    const j = JSON.parse(m[1]);
    const tipoTx = String((j && j.tipo) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tipo = tipoTx.startsWith('repar') ? 'reparación' : (tipoTx.startsWith('compra') ? 'compra' : null);
    if (tipo) {
      const lista = tipo === 'reparación' ? c.reparacion : c.compra;
      const campos = lista.map((dato, i) => { const val = j[String(i + 1)]; return { dato, valor: val != null ? String(val).replace(/\s+/g, ' ').trim().slice(0, 300) : '' }; });
      const notas = j.notas != null ? String(j.notas).replace(/\s+/g, ' ').trim().slice(0, 300) : '';
      if (campos.some(x => x.valor) || notas) ficha = { tipo, campos, notas };
    }
  } catch (e) { ficha = null; }
  return { texto: limpio, ficha };
}

// 1.4.8: biblioteca de recursos que Verde puede enviar (solo con el número real o en «Probar a Verde»).
function bloqueBiblioteca(lista) {
  if (!Array.isArray(lista) || !lista.length) return '';
  return '\n\n== BIBLIOTECA DE RECURSOS ==\n'
    + 'Podés enviarle al cliente estos archivos de la tienda:\n'
    + lista.map((r, i) => '- R' + (i + 1) + ' · «' + r.nombre + '» (' + (r.mime === 'application/pdf' ? 'PDF' : 'imagen') + ')' + (r.directo ? ' [se puede enviar sin que lo pidan]' : '') + ': ' + r.cuando).join('\n') + '\n'
    + 'Reglas: si el cliente pide uno de estos archivos, envialo. Si no lo pidió pero le sirve, primero ofrecelo y envialo solo si acepta'
    + (lista.some(r => r.directo) ? ', salvo los marcados [se puede enviar sin que lo pidan]: esos seguí su indicación al pie de la letra y envialos cuando se cumpla, aunque el cliente no los haya pedido ni haya respondido el ofrecimiento' : '')
    + '. Enviá como máximo un archivo por mensaje y no vuelvas a enviar uno que ya enviaste en esta conversación. No ofrezcas ni prometas archivos que no estén en esta lista.\n'
    + 'Para enviar un archivo, agregá al final del mensaje, en una línea aparte y sin texto adicional en esa línea: [ENVIAR:R1] (con el código del archivo). Tu mensaje viaja junto con el archivo: no digas que lo vas a mandar después.';
}
// 1.4.9: si Verde no puede enviar archivos (modo de prueba o biblioteca vacía), lo sabe y no los promete.
function notaSinArchivos() {
  return '\n\n== ARCHIVOS ==\n'
    + 'En este momento no podés enviar archivos ni imágenes. No digas que vas a enviar, que enviaste ni que dejás un archivo (por ejemplo «te lo dejo acá abajo»), aunque otra instrucción lo indique. Si el cliente necesita un archivo, decile que una persona del equipo se lo envía.';
}
// 1.4.9: si el archivo no salió, la memoria de Verde lo refleja (para que no dé por hecho que el cliente lo tiene).
function corregirEnvioFallido(clave, nombre) {
  const convs = loadConversations();
  const hist = Array.isArray(convs[clave]) ? convs[clave] : null;
  if (!hist) return false;
  const marca = '[Archivo enviado: «' + nombre + '»]';
  for (let i = hist.length - 1; i >= 0; i--) {
    const m = hist[i];
    if (m && m.role === 'assistant' && typeof m.content === 'string' && m.content.includes(marca)) {
      m.content = m.content.replace(marca, '[No se pudo enviar el archivo «' + nombre + '»: una persona del equipo lo va a enviar]');
      saveConversations(convs);
      return true;
    }
  }
  return false;
}
// La marca [ENVIAR:Rn] se quita siempre del mensaje; solo vale si el código está en la lista que recibió Verde.
function separarEnvio(texto, lista) {
  const t = String(texto == null ? '' : texto);
  const m = /\[ENVIAR:\s*R?(\d{1,3})\s*\]/i.exec(t);
  const limpio = t.replace(/\[ENVIAR:[^\]\n]*\]?/gi, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const r = m && Array.isArray(lista) ? lista[parseInt(m[1], 10) - 1] : null;
  return { texto: limpio, recurso: r ? { id: r.id, nombre: r.nombre, mime: r.mime } : null };
}
// Lo que queda en la memoria de Verde: el texto y, si mandó un archivo, cuál (para no repetirlo).
function paraMemoria(reply, recurso) {
  return (reply || '') + (recurso ? (reply ? '\n' : '') + '[Archivo enviado: «' + recurso.nombre + '»]' : '');
}

// 1.4.11: asistente del equipo (Centro de ayuda): modelo y esfuerzo elegidos en la sección H, con valores seguros.
function configAsistente(v) {
  const a = (v && v.asistente) || {};
  return { modelo: modeloPermitido(a.modelo) ? a.modelo : 'claude-sonnet-5-5', esfuerzo: ESFUERZOS_ASISTENTE.includes(a.esfuerzo) ? a.esfuerzo : 'high' };
}
// 1.5.0: modelo de la clasificación de leads (sección H). Por defecto Haiku 5.5, el más económico.
function configClasificacion(v) {
  const c = (v && v.clasificacion) || {};
  return { modelo: modeloPermitido(c.modelo) ? c.modelo : 'claude-haiku-5-5' };
}
// 1.4.11: resumen de la empresa para el asistente del equipo, armado con lo configurado en el panel.
function resumenEmpresa(v, recursosLista) {
  v = v || {};
  const t = x => String(x == null ? '' : x).trim();
  const L = ['Empresa: ' + (t(v.empresa) || 'Pantalla Verde') + (t(v.rubro) ? ' · Rubro: ' + t(v.rubro) : '')];
  if (t(v.nombre)) L.push('Bot de WhatsApp: ' + t(v.nombre) + (t(v.rol) ? ' (' + t(v.rol) + ')' : '') + '. Habla en ' + (t(v.idioma) || 'español rioplatense') + ', con trato de ' + (t(v.trato) || 'vos') + '.');
  const ventajas = (v.ventajas || []).map(x => t(x && x.texto)).filter(Boolean);
  if (ventajas.length) L.push('Ventajas que destaca la tienda: ' + ventajas.join(' · '));
  const pasos = (v.pasos || []).filter(p => p && p.activo !== false && t(p.titulo));
  if (pasos.length) L.push('Pasos de venta configurados:\n' + pasos.map((p, i) => '  ' + (i + 1) + '. ' + t(p.titulo) + (t(p.desc) ? ': ' + t(p.desc) : '') + (t(p.ejemplo) ? ' (ejemplo: «' + t(p.ejemplo) + '»)' : '')).join('\n'));
  const obj = (v.objeciones || []).filter(o => o && t(o.obj));
  if (obj.length) L.push('Objeciones frecuentes y cómo se responden:\n' + obj.map(o => '  - «' + t(o.obj) + '» → ' + t(o.resp)).join('\n'));
  const reglas = (v.reglas || []).map(t).filter(Boolean);
  if (reglas.length) L.push('Reglas de oro de la tienda:\n' + reglas.map(r => '  - ' + r).join('\n'));
  const g = v.garantia || {};
  if (t(g.requisitos) || t(g.condiciones)) L.push('Garantía:' + (t(g.requisitos) ? '\n  Requisitos indispensables: ' + t(g.requisitos) : '') + (t(g.condiciones) ? '\n  Cobertura y condiciones: ' + t(g.condiciones) : '') + '\n  Regla interna: por chat nunca se confirma ni se rechaza una garantía; la decide el equipo con el equipo a la vista.');
  const rec = (recursosLista || []).filter(r => r && t(r.nombre));
  if (rec.length) L.push('Biblioteca de recursos (archivos que el equipo puede enviar desde el panel):\n' + rec.map(r => '  - ' + t(r.nombre) + (t(r.cuando) ? ' — ' + t(r.cuando) : '')).join('\n'));
  return L.join('\n');
}

// 1.4.10: corrección del texto que un asesor escribió para el cliente (ortografía y claridad, sin agregar nada).
const TONOS_CORRECCION = {
  rioplatense: 'español rioplatense con voseo (vos, tenés, probá, traelo), cercano y respetuoso, como le habla la tienda a sus clientes',
  neutro: 'español neutro, sin voseo (tuteo: tú, tienes, prueba, tráelo), claro y cordial',
  formal: 'español formal con trato de usted (usted, tiene, pruebe, tráigalo), cordial y profesional'
};
function instruccionesCorreccion(tono, v) {
  const empresa = (v && String(v.empresa || '').trim()) || 'la tienda';
  return 'Sos el corrector de mensajes de ' + empresa + '. Recibís el texto que una persona del equipo escribió para responderle a un cliente por WhatsApp. Devolvé únicamente el texto corregido, sin comillas, sin títulos y sin explicaciones.\n'
    + 'Reglas:\n'
    + '1. Corregí la ortografía, los acentos y la puntuación.\n'
    + '2. Reescribilo para que el cliente lo entienda fácil: frases cortas y claras, en orden lógico.\n'
    + '3. Mantené todas las ideas, datos y condiciones que escribió la persona. No agregues información, precios, plazos, promesas ni saludos que no estén en el texto. No quites datos.\n'
    + '4. Respetá los emojis que haya y no agregues otros.\n'
    + '5. Mantené un largo parecido; solo acortá lo redundante.\n'
    + '6. Tono: ' + (TONOS_CORRECCION[tono] || TONOS_CORRECCION.rioplatense) + '.\n'
    + '7. Si el texto ya está bien, devolvelo igual, con los cambios mínimos.';
}
function limpiarCorreccion(crudo) {
  let t = String(crudo == null ? '' : crudo).trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  t = t.replace(/^(texto corregido|corrección|versión corregida)\s*:\s*/i, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('«') && t.endsWith('»'))) t = t.slice(1, -1).trim();
  return t;
}

// 1.4.7: en la primera respuesta, el sistema agrega la línea de presentación; Verde no debe presentarse por su cuenta.
function notaPresentacion(linea) {
  const l = String(linea || '').trim();
  if (!l) return '';
  return '\n\n== PRIMERA RESPUESTA DE ESTA CONVERSACIÓN ==\n'
    + 'Al final de este mensaje el sistema agrega automáticamente esta presentación: «' + l + '». '
    + 'No te presentes con tu nombre ni digas que sos un asistente virtual en este mensaje, aunque la frase de bienvenida o los pasos de venta lo indiquen: saludá brevemente y respondé la consulta. Si el cliente pregunta quién sos, la presentación ya lo responde.';
}

// Prompt completo: la configuración del panel, el protocolo de garantía, las fichas de consulta y las reglas fijas
// del sistema (1.3.7), siempre al final.
function buildSystemPrompt(v) { return buildSystemPromptBase(v) + bloqueGarantia(v) + bloqueConsultas(v) + cumplimiento.bloquePrompt(); }
function buildSystemPromptBase(v) {
  v = v || {};
  const trato = { vos: 'Tratá al cliente de "vos" (rioplatense)', 'tú': 'Tratá al cliente de "tú"', usted: 'Tratá al cliente de "usted" (formal)' }[v.trato || 'vos'];
  const emojis = { nada: 'No uses emojis.', moderado: 'Usá emojis con moderación.', abundante: 'Usá emojis de forma abundante.' }[v.emojis || 'moderado'];
  const lineas = v.lineas || 3;
  const rasgos = (v.rasgos || []).join(', ') || '—';
  const ventajas = (v.ventajas || []).filter(x => (x.texto || '').trim())
    .map(x => `• ${x.emoji ? x.emoji + ' ' : ''}${x.texto}`).join('\n') || '—';
  const pasos = (v.pasos || []).filter(s => s.activo !== false && (s.titulo || '').trim())
    .map((s, i) => `${i + 1}. ${s.titulo}${s.desc ? ': ' + s.desc : ''}${s.ejemplo ? `\n   Ej: "${s.ejemplo}"` : ''}`).join('\n') || '—';
  const objeciones = (v.objeciones || []).filter(o => (o.obj || '').trim())
    .map(o => `- Si dice "${o.obj}" → ${o.resp}`).join('\n') || '—';
  const reglas = (v.reglas || []).filter(r => (r || '').trim())
    .map((r, i) => `${i + 1}. ${r}`).join('\n') || '—';
  const fr = v.frases || {};

  return `Sos ${v.nombre || 'el asesor'}, ${v.rol || 'asesor de ventas'} de ${v.empresa || 'la empresa'}. Rubro: ${v.rubro || ''}.
Hablás en ${v.idioma || 'Español rioplatense'}.

== PERSONALIDAD ==
Rasgos: ${rasgos}.
${trato}. Mensajes cortos, máximo ${lineas} líneas por mensaje. ${emojis}

== VENTAJAS / DIFERENCIALES ==
${ventajas}

== PROCESO DE VENTA ==
${pasos}

== MANEJO DE OBJECIONES ==
${objeciones}

== REGLAS DE ORO ==
${reglas}

== FRASES CLAVE ==
Bienvenida: "${fr.bienvenida || ''}"
Al derivar a un humano: "${fr.derivacion || ''}"
Si hay un error técnico: "${fr.error || ''}"
Cuando el cliente envía un archivo (llega como «[El cliente envió …]»): ${instruccionesArchivo(fr)}
No es posible ver el contenido de los archivos: nunca describir ni opinar sobre lo que muestran.`;
}

/* ---------- lectura y escritura segura de archivos JSON ---------- */
function leerJson(archivo) {
  try {
    if (!fs.existsSync(archivo)) return {};
    const raw = fs.readFileSync(archivo, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('No se pudo leer ' + path.basename(archivo) + ':', e.message);
    return {};
  }
}
function guardarJson(archivo, obj) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = archivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
    fs.renameSync(tmp, archivo);
  } catch (e) {
    console.error('No se pudo guardar ' + path.basename(archivo) + ':', e.message);
  }
}

/* ---------- historial de conversaciones (persistente) ---------- */
function loadConversations() { return leerJson(CONV_FILE); }
function saveConversations(obj) { guardarJson(CONV_FILE, obj); }
function resetConversation(from) {
  const convs = loadConversations();
  if (convs[from]) { delete convs[from]; saveConversations(convs); }
  return true;
}
function memoriaDe(v) {
  const n = parseInt(v && v.tecnico && v.tecnico.memoria, 10);
  return n >= 2 ? n : 20;
}
// Une mensajes seguidos del mismo rol (por ejemplo, dos mensajes del cliente sin respuesta).
function unirSeguidos(hist) {
  const out = [];
  for (const m of (Array.isArray(hist) ? hist : [])) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
    const ult = out[out.length - 1];
    if (ult && ult.role === m.role) ult.content += '\n\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}
// Lo que se le envía a la IA: los últimos mensajes, empezando siempre por un mensaje del cliente.
function paraLaIA(hist, n) {
  const t = unirSeguidos(hist).slice(-Math.max(2, n || 20));
  while (t.length && t[0].role !== 'user') t.shift();
  return t;
}
// Agrega un mensaje al historial de un cliente sin consultar a la IA.
function registrarMensaje(clave, rol, texto) {
  const v = getVerde();
  const convs = loadConversations();
  const hist = Array.isArray(convs[clave]) ? convs[clave] : [];
  hist.push({ role: rol, content: String(texto == null ? '' : texto) });
  convs[clave] = unirSeguidos(hist).slice(-memoriaDe(v));
  saveConversations(convs);
}

/* ---------- pausas: cuando una persona del equipo toma la conversación ---------- */
function pausar(clave, horas) {
  const h = Number(horas) > 0 ? Number(horas) : 12;
  const ahora = Date.now();
  const p = leerJson(PAUSAS_FILE);
  for (const k of Object.keys(p)) if (!(p[k] > ahora)) delete p[k]; // limpia pausas vencidas
  p[clave] = ahora + h * 3600 * 1000;
  guardarJson(PAUSAS_FILE, p);
  return p[clave];
}
function estaPausado(clave) {
  const p = leerJson(PAUSAS_FILE);
  return !!(p[clave] && p[clave] > Date.now());
}
// «Reanudar ahora» desde el panel: termina la pausa automática de ese chat.
function quitarPausa(clave) {
  const p = leerJson(PAUSAS_FILE);
  if (!Object.prototype.hasOwnProperty.call(p, clave)) return false;
  delete p[clave];
  guardarJson(PAUSAS_FILE, p);
  return true;
}
// Pausas vigentes { clave: hasta } (para la pantalla «Conversaciones»).
function pausasVigentes() {
  const ahora = Date.now();
  const p = leerJson(PAUSAS_FILE);
  const r = {};
  for (const k of Object.keys(p)) if (p[k] > ahora) r[k] = p[k];
  return r;
}
// Antes de enviar se vuelve a revisar: mientras la IA preparaba la respuesta, una persona del
// equipo pudo tomar la conversación o alguien pudo apagar a Verde en este chat.
function noDebeResponder(from, opciones) {
  if (estaPausado(from)) return true;
  return !!(opciones && typeof opciones.puedeResponder === 'function' && !opciones.puedeResponder());
}

/* ---------- una conversación a la vez por cliente ---------- */
// Si un cliente manda varios mensajes seguidos, se responden en orden y sin pisar el historial.
const colas = new Map();
function enCola(clave, tarea) {
  const previa = colas.get(clave) || Promise.resolve();
  const actual = previa.then(tarea, tarea);
  const fin = actual.catch(() => {});
  colas.set(clave, fin);
  fin.then(() => { if (colas.get(clave) === fin) colas.delete(clave); });
  return actual;
}

/* ---------- llamada a la IA (Anthropic) ---------- */
const modelosAvisados = new Set();
function resolverModelo(v) {
  const elegido = String((v && v.tecnico && v.tecnico.modelo) || '').trim() || MODELO_PREDETERMINADO;
  const reemplazo = MODELOS_REEMPLAZO[elegido];
  if (reemplazo) {
    if (!modelosAvisados.has(elegido)) {
      modelosAvisados.add(elegido);
      console.warn('Aviso: el modelo "' + elegido + '" está retirado o por retirarse; se usa "' + reemplazo + '". Actualizalo en el panel (Parámetros técnicos).');
    }
    return reemplazo;
  }
  return elegido;
}
// Arma el pedido a la IA. En Claude Sonnet 5.5 se desactiva el razonamiento previo
// (thinking "between_tools") y se fija el esfuerzo, como indica la documentación oficial
// para conversaciones que deben responder rápido.
function armarPedido(model, system, messages, max_tokens, opciones) {
  const pedido = { model, max_tokens, system, messages };
  // 1.4.11: el asistente del equipo razona de forma adaptativa con el esfuerzo elegido en el panel
  // (sin herramientas, el ajuste «between_tools» de Verde no razonaría, y no acepta «xhigh» ni «max»).
  if (opciones && ESFUERZOS_ASISTENTE.includes(opciones.esfuerzo)) {
    pedido.thinking = { type: 'adaptive' };
    pedido.output_config = { effort: opciones.esfuerzo };
    pedido.max_tokens = Math.max(max_tokens, opciones.esfuerzo === 'xhigh' || opciones.esfuerzo === 'max' ? 16000 : 6000);
    return pedido;
  }
  const conf = MODELOS.find(m => m.id === model);
  if (!conf) return pedido;   // otro modelo: pedido básico de siempre
  if (conf.thinking) pedido.thinking = conf.thinking;
  let esfuerzo = conf.esfuerzo;
  if (model === 'claude-sonnet-5-5') {
    const e = String(process.env.VERDE_ESFUERZO || '').trim().toLowerCase();
    if (ESFUERZOS_VALIDOS.includes(e)) esfuerzo = e;
  }
  if (esfuerzo) pedido.output_config = { effort: esfuerzo };
  pedido.max_tokens = Math.max(max_tokens, conf.tokensMinimos);
  return pedido;
}
// «origen»: 'whatsapp' (clientes) o 'pruebas' (simulador del panel), para el consumo de IA.
async function callClaude(system, messages, v, modeloPuntual, origen, opciones) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Falta la clave ANTHROPIC_API_KEY (configurala en el archivo .env).');
  const model = modeloPuntual && modeloPermitido(modeloPuntual) ? modeloPuntual : resolverModelo(v);
  const max_tokens = (v.tecnico && v.tecnico.maxTokens) || 1000;
  const pedido = armarPedido(model, system, messages, max_tokens, opciones);

  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 60000);
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01'
      },
      body: JSON.stringify(pedido),
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(limite);
  }

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error('La IA respondió con error ' + resp.status + ': ' + detail.slice(0, 300));
  }
  const data = await resp.json();
  // Anthropic cobra la consulta aunque la respuesta venga vacía: se registra antes de validar el texto.
  try { consumo.registrar({ modelo: model, origen: origen || 'whatsapp', usage: data.usage }); }
  catch (e) { console.error('No se pudo registrar el consumo de la IA:', e.message); }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if (!text) throw new Error('La IA no devolvió texto (motivo: ' + (data.stop_reason || 'desconocido') + ').');
  return text;
}

/* ---------- obtener la respuesta del bot para un mensaje ---------- */
/* ---------- buscador de productos en el Excel cargado ---------- */
function norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function cleanNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  if (isNaN(n)) return String(v);
  if (n <= 0) return null; // precio en 0 = sin cargar; lo confirma un asesor
  return Math.round(n);
}
function getSource() {
  const s = readState();
  return (s.sources || []).find(x => x.preview && x.preview.length > 1) || null;
}
// Columnas confirmadas (base 0): Nombre=2, Stock=5, Precio venta=6, Precio con descuento=8
const COL = { NAME: 2, STOCK: 5, PV: 6, PD: 8 };
const STOP = new Set(['el','la','los','las','un','una','unos','unas','de','del','para','por','con','y','o','a','en','me','te','le','lo','al','su','mi','se','es','que','cuanto','cuanta','cuantos','cuantas','cuesta','cuestan','sale','salen','precio','precios','vale','valen','tiene','tienen','tenes','hay','quiero','dame','decime','busco','necesito','tienes','cual','sobre','este','esta','ese','esa','hola','buenas','dia','dias','tardes','noches',
  // preguntas generales que NO son de productos: no deben disparar el catálogo
  'direccion','direcciones','ubicados','ubicado','ubicacion','ubicado','queda','quedan','quedas','estan','estas','donde','local','locales','sucursal','sucursales','horario','horarios','hora','horas','abren','abre','cierran','cierra','abierto','abiertos','cerrado','atienden','atencion',
  'pago','pagos','pagar','tarjeta','tarjetas','efectivo','transferencia','debito','credito','cuotas','financiacion',
  'envio','envios','envian','envia','delivery','mandan','manda','reparto','llega','llegan',
  'telefono','telefonos','celular','contacto','contactar','llamar','whatsapp','correo','mail','email','web','pagina','instagram','facebook',
  'garantia','garantias','factura','iva','cambio','devolucion','reparan','reparacion','arreglan','arreglo','service','tecnico','demoran','demora','tarda','tardan']);
function findProducts(query, limit) {
  limit = limit || 8;
  const src = getSource();
  if (!src) return { hasSource: false, found: [], tokens: [] };
  const body = src.preview.slice(1);
  const tokens = norm(query).split(/\s+/).filter(w => w && !STOP.has(w));
  if (!tokens.length) return { hasSource: true, found: [], tokens: [] };
  // números: palabra exacta ("16" no matchea "2016" ni "1630"). Texto/modelos: prefijo ("a21" matchea "a21s")
  const rxs = tokens.map(t => {
    const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /^\d+$/.test(t) ? new RegExp('\\b' + e + '\\b') : new RegExp('\\b' + e);
  });
  const found = [];
  for (const r of body) {
    const name = norm(r[COL.NAME]);
    if (!name) continue;
    if (rxs.every(rx => rx.test(name))) {
      let precio = cleanNum(r[COL.PV]);
      let precioDesc = cleanNum(r[COL.PD]);
      if (precio === 0) precio = null;        // $0 = sin precio cargado
      if (precioDesc === 0) precioDesc = null;
      found.push({
        nombre: String(r[COL.NAME] == null ? '' : r[COL.NAME]).trim(),
        precio: precio,
        precioDesc: precioDesc,
        stock: (r[COL.STOCK] == null || r[COL.STOCK] === '') ? null : r[COL.STOCK]
      });
      if (found.length >= limit) break;
    }
  }
  return { hasSource: true, found, tokens };
}
function productBlock(query) {
  const { hasSource, found, tokens } = findProducts(query);
  if (!hasSource || !tokens.length) return '';
  if (!found.length) return ''; // no es una consulta de producto reconocible: Verde responde normal
  let b = '\n\n=== CATÁLOGO (INSTRUCCIÓN OBLIGATORIA) ===\n' +
    'Estos productos SÍ existen en el catálogo (es info real). REGLAS:\n' +
    '1) Confirmá con naturalidad y tu propio tono que sí tenés el/los producto(s).\n' +
    '2) PROHIBIDO decir un precio, estimar, dar rangos o "precios de mercado". El precio SIEMPRE lo confirma un asesor humano.\n' +
    '3) Para el precio, derivá al asesor con tu estilo (sin inventar números).\n' +
    '4) Usá esta info solo para reconocer el producto; no menciones stock ni códigos salvo que el cliente pregunte.\n' +
    'Productos que coinciden:';
  found.forEach(p => { b += '\n• ' + p.nombre; });
  return b;
}

/* ---------- contexto del momento: fecha y hora de Montevideo ---------- */
function bloqueContexto() {
  const ahora = new Date();
  const zona = 'America/Montevideo';
  const fecha = new Intl.DateTimeFormat('es-UY', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(ahora);
  const hora = new Intl.DateTimeFormat('es-UY', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ahora);
  return '\n\n== CONTEXTO ACTUAL ==\n' +
    'Hoy es ' + fecha + ' y son las ' + hora + ' en Montevideo. Usá este dato si el cliente pregunta por horarios o si el local está abierto ahora.\n' +
    'Si en la conversación aparece un texto marcado con "[Asesor humano]", lo escribió una persona del equipo de la tienda: tenelo en cuenta, no lo contradigas y no repitas esa marca.\n' +
    'Cuando derives la conversación a una persona del equipo (por ejemplo, porque el cliente pide un precio, quiere hablar con una persona o consulta por una reparación en curso), escribí al final de tu mensaje, en una línea aparte, la marca [DERIVAR]. El sistema la quita antes de enviar: el cliente no la ve. No la uses en ningún otro caso.';
}

/* ---------- obtener la respuesta del bot para un mensaje ---------- */
const MARCA_DERIVAR = /\[\s*DERIVAR\s*\]/i;
const MARCA_DERIVAR_TODAS = /\[\s*DERIVAR\s*\]/gi;
// Quita la marca [DERIVAR] del texto e indica si estaba.
function separarDerivacion(texto) {
  const derivar = MARCA_DERIVAR.test(texto);
  const limpio = String(texto).replace(MARCA_DERIVAR_TODAS, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { texto: limpio, derivar };
}

// Devuelve { texto, derivar, error } o null si Verde no debe responder (apagado o conversación en pausa).
// opciones.modelo: probar otra IA puntualmente (solo desde el simulador).
function responderCliente(from, body, opciones) {
  return enCola(String(from), () => responder(String(from), String(body == null ? '' : body), opciones || {}));
}
// Compatibilidad: solo el texto.
async function getReply(from, body) {
  const r = await responderCliente(from, body);
  return r ? r.texto : null;
}
async function responder(from, body, opciones) {
  const v = getVerde();
  const fr = v.frases || {};

  // Apagado: silencio total (no se envía nada al cliente).
  if (v.encendido === false) return null;

  // 1) se guarda el mensaje del cliente antes de consultar a la IA
  registrarMensaje(from, 'user', body);

  // 2) se arma el pedido con el historial guardado
  const convs = loadConversations();
  const hist = Array.isArray(convs[from]) ? convs[from] : [];
  const lista = opciones.biblioteca ? recursos.paraVerde() : [];
  const system = buildSystemPrompt(v) + bloqueContexto() + productBlock(body) + notaAtencion(opciones.atencion) + notaPresentacion(opciones.presentacion) + (lista.length ? bloqueBiblioteca(lista) : notaSinArchivos());
  let crudo;
  try {
    crudo = await callClaude(system, paraLaIA(hist, memoriaDe(v)), v, opciones.modelo, String(from).startsWith('sim:') ? 'pruebas' : 'whatsapp');
  } catch (e) {
    console.error('Error al consultar la IA:', e.message);
    // La frase de error deriva a un asesor: el chat pasa a «Chats por responder».
    if (noDebeResponder(from, opciones)) return null;
    return { texto: fr.error || 'Disculpá, tuve un problema técnico. Ahora mismo te conecto con uno de nuestros asesores 🙌', derivar: true, error: true };
  }
  const rec = separarReclamo(crudo);
  const con = separarConsulta(rec.texto, v);
  const env = separarEnvio(con.texto, lista);
  const sep = separarDerivacion(env.texto);
  // Si Verde solo envía un archivo, el mensaje puede ir sin texto (no se usa la frase de derivación).
  const reply = sep.texto || (env.recurso ? '' : (fr.derivacion || 'Te paso con un asesor para que te ayude. 🙌'));

  // 3) si mientras pensaba una persona del equipo tomó la conversación, o alguien apagó a Verde
  //    en este chat, no se responde
  if (noDebeResponder(from, opciones)) return null;

  // 4) se guarda la respuesta de Verde (sin las marcas)
  registrarMensaje(from, 'assistant', paraMemoria(reply, env.recurso));
  return { texto: reply, derivar: sep.derivar, error: false, reclamo: rec.ficha, consulta: con.ficha, recurso: env.recurso };
}

// «Devolver a Verde» desde el panel: Verde responde la última consulta del cliente que quedó sin
// respuesta durante la pausa, sin agregar un mensaje nuevo al historial.
// Devuelve { texto, derivar, error } o null si no hay nada pendiente o Verde no debe responder.
function responderPendiente(from, opciones) {
  return enCola(String(from), () => responderUltima(String(from), opciones || {}));
}
async function responderUltima(from, opciones) {
  const v = getVerde();
  const fr = v.frases || {};
  if (v.encendido === false) return null;
  const convs = loadConversations();
  const hist = Array.isArray(convs[from]) ? convs[from] : [];
  const ultimo = hist[hist.length - 1];
  if (!ultimo || ultimo.role !== 'user') return null;   // la última palabra fue del equipo o de Verde
  if (noDebeResponder(from, opciones)) return null;
  const lista = opciones.biblioteca ? recursos.paraVerde() : [];
  const system = buildSystemPrompt(v) + bloqueContexto() + productBlock(String(ultimo.content || '')) + notaAtencion(opciones.atencion) + notaPresentacion(opciones.presentacion) + (lista.length ? bloqueBiblioteca(lista) : notaSinArchivos());
  let crudo;
  try {
    crudo = await callClaude(system, paraLaIA(hist, memoriaDe(v)), v, undefined, 'whatsapp');
  } catch (e) {
    console.error('Error al consultar la IA:', e.message);
    if (noDebeResponder(from, opciones)) return null;
    return { texto: fr.error || 'Disculpá, tuve un problema técnico. Ahora mismo te conecto con uno de nuestros asesores 🙌', derivar: true, error: true };
  }
  const rec = separarReclamo(crudo);
  const con = separarConsulta(rec.texto, v);
  const env = separarEnvio(con.texto, lista);
  const sep = separarDerivacion(env.texto);
  // Si Verde solo envía un archivo, el mensaje puede ir sin texto (no se usa la frase de derivación).
  const reply = sep.texto || (env.recurso ? '' : (fr.derivacion || 'Te paso con un asesor para que te ayude. 🙌'));
  if (noDebeResponder(from, opciones)) return null;
  registrarMensaje(from, 'assistant', paraMemoria(reply, env.recurso));
  return { texto: reply, derivar: sep.derivar, error: false, reclamo: rec.ficha, consulta: con.ficha, recurso: env.recurso };
}

// ¿Verde ya le respondió algo a este cliente? (se usa para la presentación en el simulador)
function tieneRespuestas(from) {
  const h = loadConversations()[String(from)];
  return Array.isArray(h) && h.some(m => m.role === 'assistant');
}

// Modelo que usa Verde hoy (con los reemplazos de modelos retirados ya aplicados).
function modeloEnUso() { return resolverModelo(getVerde()); }

module.exports = {
  ADJUNTO_POR_DEFECTO, instruccionesArchivo, notaAtencion,
  GARANTIA_DATOS_DEFECTO, GARANTIA_SINTOMAS_DEFECTO, GARANTIA_REQUISITOS_DEFECTO, GARANTIA_COBERTURA_DEFECTO, garantiaDe, bloqueGarantia, separarReclamo,
  CONSULTA_REPARACION_DEFECTO, CONSULTA_COMPRA_DEFECTO, consultasDe, bloqueConsultas, separarConsulta, notaPresentacion,
  bloqueBiblioteca, separarEnvio, notaSinArchivos, corregirEnvioFallido, TONOS_CORRECCION, instruccionesCorreccion, limpiarCorreccion, ESFUERZOS_ASISTENTE, configAsistente, configClasificacion, resumenEmpresa,
  tieneRespuestas,
  modeloEnUso,
  responderPendiente,
  buildSystemPrompt, getReply, getVerde, callClaude, findProducts, productBlock, resetConversation,
  registrarMensaje, pausar, estaPausado, quitarPausa, pausasVigentes, resolverModelo, armarPedido, paraLaIA, MODELO_PREDETERMINADO,
  responderCliente, separarDerivacion, listarModelos, modeloPermitido
};
