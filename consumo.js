/**
 * Consumo de la IA (versión 1.3.6).
 *
 * Registra los tokens que informa Anthropic en cada consulta y calcula su costo estimado con el
 * precio vigente en ese momento (el costo de cada día queda guardado, como en una factura: si los
 * precios cambian después, el historial no se recalcula).
 *
 * Los datos se guardan agrupados por día (hora de Montevideo), modelo y origen en data/consumo-ia.json.
 * Los montos se acumulan en millonésimas de dólar (µUSD) para evitar errores de redondeo.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'consumo-ia.json');
const MESES_GUARDADOS = 36;
const RANGO_MAXIMO_DIAS = 400;

// Precios oficiales de Anthropic, en dólares estadounidenses por millón de tokens, verificados el 24/10/2026
// en la documentación de Anthropic. La lectura y la escritura de caché siguen la regla general de Anthropic
// (lectura = 0,1 × entrada; escritura de 5 minutos = 1,25 × entrada); hoy Verde no usa caché, así que no inciden.
const PRECIOS = {
  'claude-sonnet-5-5': { nombre: 'Claude Sonnet 5.5', entrada: 2, salida: 10 },
  'claude-opus-5-5': { nombre: 'Claude Opus 5.5', entrada: 4, salida: 20 },
  'claude-fable-5-1': { nombre: 'Claude Fable 5.1', entrada: 10, salida: 50 },
  'claude-haiku-5-5': { nombre: 'Claude Haiku 5.5', entrada: 0.1, salida: 0.5 }   // pedidos de hasta 100.000 tokens (los de Verde son mucho más cortos)
};
const PRECIOS_VERIFICADOS = '2026-10-29';
const ORIGENES = ['whatsapp', 'pruebas', 'ayuda', 'correccion', 'clasificacion', 'reporte', 'sugerencia', 'entrenamiento', 'resumen'];   // 1.4.10: corrección · 1.5.0: clasificación · 1.5.7: reporte · 1.5.9: respuesta sugerida

let relojPrueba = null;                       // solo para las pruebas automáticas
function ahora() { return relojPrueba ? relojPrueba() : Date.now(); }
function _usarReloj(fn) { relojPrueba = fn || null; }

const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' });
function diaDe(ms) { return fmtDia.format(new Date(ms)); }   // «AAAA-MM-DD» en hora de Montevideo

function vacio() { return { inicio: null, dias: {} }; }
function cargar() {
  try {
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    if (!d || typeof d !== 'object' || !d.dias || typeof d.dias !== 'object') return vacio();
    return d;
  } catch (e) { return vacio(); }
}
function guardar(d) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
}
function entero(n) { const v = Math.round(Number(n)); return Number.isFinite(v) && v > 0 ? v : 0; }

// Costo de una consulta en µUSD (el precio por millón de tokens en USD equivale a µUSD por token).
function costoMicro(modelo, uso) {
  const p = PRECIOS[modelo];
  if (!p) return null;
  return Math.round(uso.entrada * p.entrada + uso.salida * p.salida
    + uso.cacheLectura * p.entrada * 0.1 + uso.cacheEscritura * p.entrada * 1.25);
}

// Registra una consulta a la IA. «usage» es el objeto que devuelve Anthropic.
function registrar({ modelo, origen, usage }) {
  const uso = {
    entrada: entero(usage && usage.input_tokens),
    salida: entero(usage && usage.output_tokens),
    cacheLectura: entero(usage && usage.cache_read_input_tokens),
    cacheEscritura: entero(usage && usage.cache_creation_input_tokens)
  };
  const mod = String(modelo || 'desconocido');
  const org = ORIGENES.includes(origen) ? origen : 'whatsapp';
  const costo = costoMicro(mod, uso);
  const d = cargar();
  const dia = diaDe(ahora());
  if (!d.inicio || dia < d.inicio) d.inicio = dia;
  const delDia = d.dias[dia] || (d.dias[dia] = {});
  const clave = mod + '|' + org;
  const a = delDia[clave] || (delDia[clave] = { consultas: 0, entrada: 0, salida: 0, cacheLectura: 0, cacheEscritura: 0, costo: 0, sinPrecio: 0 });
  a.consultas += 1;
  a.entrada += uso.entrada; a.salida += uso.salida;
  a.cacheLectura += uso.cacheLectura; a.cacheEscritura += uso.cacheEscritura;
  if (costo === null) a.sinPrecio += 1; else a.costo += costo;
  podar(d, dia);
  guardar(d);
  return costo;
}

// Conserva los últimos MESES_GUARDADOS meses.
function podar(d, hoy) {
  const [y, m] = hoy.split('-').map(Number);
  const corte = new Date(Date.UTC(y, m - 1 - MESES_GUARDADOS, 1)).toISOString().slice(0, 10);
  for (const dia of Object.keys(d.dias)) if (dia < corte) delete d.dias[dia];
}

function validarFecha(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const t = Date.parse(s + 'T12:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function primeroDelMes(dia) { return dia.slice(0, 8) + '01'; }
function ultimoDelMes(mes) {          // mes «AAAA-MM»
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Período pedido: «mes» (AAAA-MM) o «desde»/«hasta» (AAAA-MM-DD). Sin datos: el mes en curso hasta hoy.
function periodo({ mes, desde, hasta } = {}) {
  const hoy = diaDe(ahora());
  if (mes) {
    if (!/^\d{4}-\d{2}$/.test(mes) || !validarFecha(mes + '-01')) return { error: 'El mes indicado no es válido.' };
    const desde = mes + '-01', fin = ultimoDelMes(mes);
    // mes ya cerrado: completo; mes en curso: hasta hoy; mes futuro: completo (sin datos)
    return { desde, hasta: fin < hoy ? fin : (hoy >= desde ? hoy : fin), tipo: 'mes' };
  }
  if (desde || hasta) {
    if (!validarFecha(desde) || !validarFecha(hasta)) return { error: 'Las fechas deben tener el formato AAAA-MM-DD.' };
    if (desde > hasta) return { error: 'La fecha de inicio no puede ser posterior a la fecha de fin.' };
    const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1;
    if (dias > RANGO_MAXIMO_DIAS) return { error: 'El rango no puede superar los ' + RANGO_MAXIMO_DIAS + ' días.' };
    return { desde, hasta, tipo: 'rango' };
  }
  return { desde: primeroDelMes(hoy), hasta: hoy, tipo: 'mes' };
}

// Resumen del período para el panel. Los montos se devuelven en USD (con 6 decimales de precisión).
function resumen(filtro) {
  const p = periodo(filtro);
  if (p.error) return { error: p.error };
  const d = cargar();
  const total = { consultas: 0, entrada: 0, salida: 0, costo: 0, sinPrecio: 0 };
  const porOrigen = { whatsapp: { consultas: 0, costo: 0 }, pruebas: { consultas: 0, costo: 0 }, ayuda: { consultas: 0, costo: 0 }, correccion: { consultas: 0, costo: 0 }, clasificacion: { consultas: 0, costo: 0 }, reporte: { consultas: 0, costo: 0 }, sugerencia: { consultas: 0, costo: 0 }, entrenamiento: { consultas: 0, costo: 0 }, resumen: { consultas: 0, costo: 0 } };
  const porModelo = {};
  const dias = [];
  for (const dia of Object.keys(d.dias).sort().reverse()) {
    if (dia < p.desde || dia > p.hasta) continue;
    const fila = { fecha: dia, consultas: 0, costo: 0 };
    for (const [clave, a] of Object.entries(d.dias[dia])) {
      const [mod, org] = clave.split('|');
      fila.consultas += a.consultas; fila.costo += a.costo;
      total.consultas += a.consultas; total.entrada += a.entrada; total.salida += a.salida;
      total.costo += a.costo; total.sinPrecio += a.sinPrecio || 0;
      const o = porOrigen[org] || (porOrigen[org] = { consultas: 0, costo: 0 });
      o.consultas += a.consultas; o.costo += a.costo;
      const m = porModelo[mod] || (porModelo[mod] = { id: mod, nombre: (PRECIOS[mod] || {}).nombre || mod, consultas: 0, costo: 0 });
      m.consultas += a.consultas; m.costo += a.costo;
    }
    dias.push(fila);
  }
  const usd = micro => Math.round(micro) / 1e6;
  const meses = new Set([diaDe(ahora()).slice(0, 7)]);
  for (const dia of Object.keys(d.dias)) meses.add(dia.slice(0, 7));
  return {
    desde: p.desde, hasta: p.hasta, tipo: p.tipo, inicio: d.inicio || null, hoy: diaDe(ahora()),
    total: { consultas: total.consultas, tokensEntrada: total.entrada, tokensSalida: total.salida, costo: usd(total.costo), sinPrecio: total.sinPrecio },
    promedio: total.consultas ? usd(total.costo / total.consultas) : 0,
    porOrigen: Object.fromEntries(Object.entries(porOrigen).map(([k, v]) => [k, { consultas: v.consultas, costo: usd(v.costo) }])),
    modelos: Object.values(porModelo).map(m => ({ id: m.id, nombre: m.nombre, consultas: m.consultas, costo: usd(m.costo) })),
    dias: dias.map(f => ({ fecha: f.fecha, consultas: f.consultas, costo: usd(f.costo) })),
    meses: [...meses].sort().reverse(),
    precios: Object.entries(PRECIOS).map(([id, v]) => ({ id, nombre: v.nombre, entrada: v.entrada, salida: v.salida })),
    preciosVerificados: PRECIOS_VERIFICADOS
  };
}

module.exports = { registrar, resumen, periodo, PRECIOS, PRECIOS_VERIFICADOS, _usarReloj };
