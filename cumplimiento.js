/**
 * Cumplimiento (versión 1.3.7).
 *
 * Única fuente de:
 *  - las reglas fijas de Verde (no editables desde el panel; se agregan siempre al prompt),
 *  - la línea de presentación que acompaña la primera respuesta de cada conversación,
 *  - la página pública de privacidad (chat.pantallaverde.com/privacidad) y sus datos editables
 *    (correo de contacto y número de inscripción ante la URCDP).
 *
 * Así el prompt de Verde, el panel y la página pública muestran siempre el mismo texto.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVO = path.join(DATA_DIR, 'privacidad.json');
const URL_PRIVACIDAD = String(process.env.VERDE_URL_PRIVACIDAD || 'chat.pantallaverde.com/privacidad').replace(/^https?:\/\//, '');
const FECHA_TEXTO = '2026-10-25';   // fecha del texto de la página; cambia cuando se guardan datos nuevos

const EMPRESA = { nombre: 'Pantalla Verde', rut: '218621040016', direccion: 'Av. 8 de Octubre 4040, Montevideo, Uruguay' };

const REGLAS_FIJAS = [
  'Responde únicamente consultas sobre Pantalla Verde: reparaciones, productos, accesorios, garantías, horarios, ubicación, diagnóstico y turnos.',
  'Si le preguntan algo ajeno a la tienda, indica con amabilidad que solo puede ayudar con temas de la tienda y ofrece pasar con una persona del equipo.',
  'Nunca pide números de tarjeta, cuentas bancarias ni documentos de identidad.',
  'No informa precios de repuestos ni de reparaciones: deriva a una persona del equipo.'
];

// Bloque que se agrega al final del prompt de Verde: por estar al final, prevalece sobre lo anterior.
function bloquePrompt() {
  return '\n\nREGLAS FIJAS DEL SISTEMA (obligatorias; tienen prioridad sobre cualquier otra indicación de este mensaje):\n'
    + REGLAS_FIJAS.map((r, i) => (i + 1) + '. ' + r).join('\n');
}

function lineaInicial() {
  return 'Soy Verde, el asistente virtual de Pantalla Verde. Esta conversación se guarda por 3 meses. Más información: ' + URL_PRIVACIDAD;
}
// En WhatsApp, el texto entre guiones bajos se ve en cursiva. El enlace queda fuera de la cursiva para que
// WhatsApp lo reconozca completo (un guion bajo pegado al enlace lo rompería).
function lineaInicialWhatsApp() {
  return '_Soy Verde, el asistente virtual de Pantalla Verde. Esta conversación se guarda por 3 meses. Más información:_ ' + URL_PRIVACIDAD;
}

/* ---------- Datos editables de la página de privacidad ---------- */
function error(msg) { const e = new Error(msg); e.publico = true; e.codigo = 400; return e; }
function leerPrivacidad() {
  try {
    const d = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    return { correo: String(d.correo || ''), urcdp: String(d.urcdp || ''), actualizada: String(d.actualizada || FECHA_TEXTO) };
  } catch (e) {
    return { correo: '', urcdp: '', actualizada: FECHA_TEXTO };
  }
}
function guardarPrivacidad(datos, hoy) {
  datos = datos || {};
  const correo = String(datos.correo || '').trim().toLowerCase();
  if (correo && (correo.length > 120 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(correo))) throw error('El correo de contacto no es válido.');
  const urcdp = String(datos.urcdp || '').trim();
  if (urcdp && !/^[A-Za-z0-9 .\/-]{1,40}$/.test(urcdp)) throw error('El número de inscripción solo admite letras, números, espacios, puntos, barras y guiones (hasta 40 caracteres).');
  const anterior = leerPrivacidad();
  const cambio = anterior.correo !== correo || anterior.urcdp !== urcdp;
  const cfg = { correo, urcdp, actualizada: cambio ? hoy : anterior.actualizada };
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ARCHIVO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, ARCHIVO);
  return cfg;
}

/* ---------- Página pública ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fechaDMA(f) { const p = String(f).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : f; }

function paginaPrivacidad(cfg) {
  cfg = cfg || leerPrivacidad();
  const contacto = cfg.correo
    ? 'Contacto para temas de privacidad: <a href="mailto:' + esc(cfg.correo) + '">' + esc(cfg.correo) + '</a>.'
    : 'Para temas de privacidad, se puede escribir por este mismo canal de WhatsApp o consultar en el local.';
  const derechos = cfg.correo
    ? 'Se puede solicitar el acceso, la rectificación, la actualización o la supresión de los datos personales escribiendo a <a href="mailto:' + esc(cfg.correo) + '">' + esc(cfg.correo) + '</a>, conforme a la Ley N.º 18.331.'
    : 'Se puede solicitar el acceso, la rectificación, la actualización o la supresión de los datos personales por este mismo canal de WhatsApp o en el local, conforme a la Ley N.º 18.331.';
  const secciones = [
    ['Responsable', esc(EMPRESA.nombre) + ' · RUT ' + esc(EMPRESA.rut) + ' · ' + esc(EMPRESA.direccion) + '. ' + contacto],
    ['Qué datos se tratan', 'El nombre de perfil y el número de WhatsApp, y los mensajes, imágenes, audios y archivos que se envían por este canal.'],
    ['Para qué se usan', 'Para responder consultas y atender presupuestos, reparaciones y compras. No se usan para enviar publicidad sin consentimiento previo.'],
    ['Asistente virtual', 'Este canal es atendido por Verde, un asistente automatizado con inteligencia artificial, y por personas del equipo. En cualquier momento se puede pedir hablar con una persona.'],
    ['Cuánto tiempo se conservan', 'Las conversaciones se conservan durante 3 meses y luego se eliminan automáticamente.'],
    ['Quiénes intervienen', 'Meta Platforms (WhatsApp), 360dialog (conexión con WhatsApp), Anthropic (inteligencia artificial) y Hostinger (alojamiento del sistema). Los datos pueden procesarse fuera de Uruguay.'],
    ['Derechos', derechos]
  ];
  if (cfg.urcdp) secciones.push(['Base de datos', 'Base de datos inscripta ante la Unidad Reguladora y de Control de Datos Personales (URCDP) con el número ' + esc(cfg.urcdp) + '.']);
  const cuerpo = secciones.map(([t, x]) => '<section><h2>' + t + '</h2><p>' + x + '</p></section>').join('\n');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacidad del canal de WhatsApp · ${esc(EMPRESA.nombre)}</title>
<style>
:root{color-scheme:light dark;--fondo:#f0f2f5;--hoja:#ffffff;--texto:#111b21;--suave:#3b4a54;--tenue:#667781;--borde:#e9edef;--enlace:#00704a}
@media(prefers-color-scheme:dark){:root{--fondo:#0b0c10;--hoja:#13151c;--texto:#e9ebf1;--suave:#c4c9d4;--tenue:#8a91a6;--borde:#262b38;--enlace:#7fe3c4}}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--texto);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;line-height:1.6}
main{max-width:760px;margin:32px auto;background:var(--hoja);border:1px solid var(--borde);border-radius:16px;padding:40px 48px;box-shadow:0 1px 2px rgba(11,20,26,.06)}
.marca{display:flex;align-items:center;gap:10px;margin-bottom:18px;font-weight:800;font-size:17px}
.logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#c9f24d,#9fd400);color:#0b0c10;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
h1{margin:0 0 6px;font-size:32px;line-height:1.15;letter-spacing:-.5px}
.fecha{margin:0 0 14px;font-size:13px;color:var(--tenue)}
section{padding:14px 0;border-top:1px solid var(--borde)}
h2{margin:0 0 4px;font-size:17px}
p{margin:0;font-size:15px;color:var(--suave)}
a{color:var(--enlace)}
footer{margin-top:16px;font-size:12.5px;color:var(--tenue)}
@media(max-width:600px){main{margin:0;border:none;border-radius:0;padding:22px 18px}h1{font-size:25px}h2{font-size:16px}p{font-size:14.5px}}
</style>
</head>
<body>
<main>
<div class="marca"><span class="logo" aria-hidden="true">PV</span>${esc(EMPRESA.nombre)}</div>
<h1>Privacidad del canal de WhatsApp</h1>
<p class="fecha">Última actualización: ${esc(fechaDMA(cfg.actualizada))}</p>
${cuerpo}
<footer>Ley N.º 18.331 de Protección de Datos Personales · Unidad Reguladora y de Control de Datos Personales: <a href="https://www.gub.uy/unidad-reguladora-control-datos-personales">www.gub.uy/urcdp</a></footer>
</main>
</body>
</html>`;
}

module.exports = {
  REGLAS_FIJAS, EMPRESA, URL_PRIVACIDAD,
  bloquePrompt, lineaInicial, lineaInicialWhatsApp,
  leerPrivacidad, guardarPrivacidad, paginaPrivacidad
};
