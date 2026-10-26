/**
 * Centro de ayuda (versión 1.3.8).
 *
 * Contiene el manual del panel y las guías de Meta, y arma las instrucciones del asistente de ayuda.
 * Es la única fuente del asistente: responde con este contenido y con la configuración real del panel,
 * así no puede contradecir al manual. El contenido se actualiza con cada versión del sistema.
 *
 * Las guías de Meta y los temas de administración solo los ven los administradores.
 */
const REVISION_META = '2026-10-24';   // fecha de la última revisión de las reglas de Meta

const ARTICULOS = [
  // ===================== MANUAL DEL PANEL =====================
  {
    id: 'chats-por-responder', grupo: 'manual', soloAdmin: false, titulo: 'Chats por responder',
    resumen: 'Clientes que esperan a una persona del equipo: cómo responderlos y cómo marcarlos como atendidos.',
    bloques: [
      { tipo: 'p', texto: 'Cuando Verde deriva un chat a una persona del equipo (por ejemplo, porque el cliente pide un precio exacto), el chat aparece en «Chats por responder» y se avisa al equipo. Verde sigue conversando con el cliente, sin dar precios, hasta que una persona del equipo responda; ahí hace su pausa de 12 horas.' },
      { tipo: 'p', texto: 'Cuando el cliente envía un archivo, el chat aparece con la etiqueta «Archivo para revisar». Si después el cliente pide un precio, pasa a «Por responder» y se avisa al equipo por ese motivo. En los dos casos, Verde sigue conversando.' },
      { tipo: 'p', texto: 'Los tiempos de espera de más de 5 minutos se muestran en rojo. El número junto a «Chats por responder» en el menú indica cuántos chats esperan.' },
      { tipo: 'h', texto: 'Cómo atender un chat' },
      { tipo: 'pasos', items: [
        { titulo: 'Abrir el chat', texto: 'Tocar el chat en la lista. La conversación se abre a la derecha (en el celular, a pantalla completa).' },
        { titulo: 'Responder', texto: 'Escribir en el campo de abajo y enviar. El mensaje sale desde el WhatsApp de la tienda con la firma del usuario. Al responder, el chat pasa solo a «Chats respondidos».' },
        { titulo: 'O marcarlo como atendido', texto: 'Si se atendió por otra vía, tocar «Marcar atendido» y elegir el motivo: por llamada, en el local, ya no necesita atención u otro motivo (con detalle obligatorio).' }
      ] },
      { tipo: 'nota', texto: 'Si el cliente vuelve a escribir después de un «Marcar atendido», el chat regresa solo a «Chats por responder» y se avisa de nuevo al equipo.' }
    ]
  },
  {
    id: 'conversaciones', grupo: 'manual', soloAdmin: false, titulo: 'Conversaciones y «Devolver a Verde»',
    resumen: 'Todos los chats, el interruptor de Verde por chat, la pausa de 12 horas, cómo devolverle un chat a Verde y los archivos del cliente.',
    bloques: [
      { tipo: 'p', texto: '«Conversaciones» muestra todos los chats que atiende Verde. Se pueden buscar por nombre, número o mensaje, y filtrar por estado: Verde atendiendo, atiende una persona, Verde apagado o por responder.' },
      { tipo: 'h', texto: 'La pausa de 12 horas' },
      { tipo: 'p', texto: 'Cuando una persona del equipo responde (desde el panel o desde el celular de la tienda), Verde queda en pausa en ese chat durante 12 horas, para no interrumpir. El interruptor del encabezado muestra «Verde en pausa» en ámbar.' },
      { tipo: 'h', texto: 'Devolverle el chat a Verde' },
      { tipo: 'pasos', items: [
        { titulo: 'Terminar de atender', texto: 'Por ejemplo, después de pasar el precio.' },
        { titulo: 'Tocar «Devolver a Verde»', texto: 'Está en el encabezado de la conversación (en el celular, en la franja de estado). Si el cliente dejó una consulta sin responder, Verde la responde enseguida; si no, responde cuando el cliente vuelva a escribir.' }
      ] },
      { tipo: 'p', texto: 'Si el cliente escribe durante la pausa y nadie le responde en 5 minutos, el chat vuelve a «Chats por responder» y se avisa al equipo.' },
      { tipo: 'h', texto: 'Apagar a Verde en un chat' },
      { tipo: 'p', texto: 'El interruptor «Verde» apaga a Verde en ese chat sin límite de tiempo, hasta que se vuelva a encender. Con Verde apagado rige el mismo resguardo de 5 minutos.' },
      { tipo: 'h', texto: 'Fotos, audios y documentos del cliente' },
      { tipo: 'p', texto: 'Cuando llega un archivo, Verde sigue conversando: agradece, avisa que un asesor lo va a revisar y, si hace falta, pide más fotos o datos, según las indicaciones de «Comportamiento del bot › G». Verde no puede ver el contenido del archivo. El chat queda en «Chats por responder» con la etiqueta «Archivo para revisar».' },
      { tipo: 'p', texto: 'Los archivos que manda el cliente aparecen en el chat como una tarjeta con el botón «Descargar». Nada se guarda automáticamente: el archivo se baja de WhatsApp recién al tocar «Descargar», y desde ese momento se ve en el panel durante 3 meses. Las fotos se abren en grande al tocarlas; los audios y los videos se reproducen en el chat; los PDF se abren con «Abrir». Cualquier archivo se puede guardar en la computadora.' },
      { tipo: 'p', texto: 'WhatsApp conserva los archivos alrededor de 7 días: conviene descargarlos antes. Pasado ese plazo puede que ya no estén disponibles, y habría que pedirle al cliente que los reenvíe. Los archivos que llegaron antes de esta función se ven solo en el WhatsApp de la tienda.' },
      { tipo: 'nota', texto: 'Desde el panel solo se puede responder dentro de las 24 horas desde el último mensaje del cliente: es una regla de WhatsApp.' }
    ]
  },
  {
    id: 'chats-respondidos', grupo: 'manual', soloAdmin: false, titulo: 'Chats respondidos',
    resumen: 'Historial de los chats derivados y cómo se atendió cada uno.',
    bloques: [
      { tipo: 'p', texto: '«Chats respondidos» guarda el historial de los chats que Verde derivó y cómo se atendieron: respondidos por WhatsApp, marcados a mano o que volvieron a escribir. Se puede buscar y filtrar por período.' },
      { tipo: 'p', texto: 'Al tocar un chat se abre su detalle: el recorrido de la atención, quién respondió y cuánto esperó el cliente. Desde el detalle también se puede devolver el chat a Verde si sigue en pausa.' },
      { tipo: 'nota', texto: 'El historial se conserva 3 meses y después se elimina automáticamente.' }
    ]
  },
  {
    id: 'avisos', grupo: 'manual', soloAdmin: true, titulo: 'Avisos a celulares del equipo',
    resumen: 'Qué celulares reciben aviso cuando entra un chat por responder, y por qué a veces se necesita una plantilla.',
    bloques: [
      { tipo: 'p', texto: 'En «Chats por responder» › campana se cargan hasta 10 números que reciben un aviso por WhatsApp cada vez que entra un chat por responder. El aviso lleva el nombre del cliente y el motivo, nunca el contenido de su mensaje.' },
      { tipo: 'h', texto: 'La ventana de 24 horas de cada celular' },
      { tipo: 'p', texto: 'Si el celular le escribió al número de la tienda en las últimas 24 horas, el aviso sale como mensaje común. Si no, WhatsApp solo acepta una plantilla aprobada por Meta. La tabla «Estado de cada número» muestra cómo saldrá el próximo aviso a cada celular.' },
      { tipo: 'pasos', items: [
        { titulo: 'Sin plantilla todavía', texto: 'Cada asesor puede escribir «inicio de turno» al número de la tienda al empezar el día: así recibe avisos durante 24 horas.' },
        { titulo: 'Con plantilla aprobada', texto: 'Cargar su nombre e idioma en «Avisos» y guardar. Los celulares sin ventana abierta recibirán la plantilla.' }
      ] },
      { tipo: 'nota', texto: 'La plantilla se crea en WhatsApp Manager al conectar el número real. El texto sugerido está en la misma pantalla, con un botón para copiarlo.' }
    ]
  },
  {
    id: 'comportamiento', grupo: 'manual', soloAdmin: true, titulo: 'Comportamiento del bot',
    resumen: 'Cómo se configura lo que dice y hace Verde, las reglas fijas y la página de privacidad.',
    bloques: [
      { tipo: 'p', texto: 'En «Agentes IA › Comportamiento del bot» se configura a Verde sin tocar código: identidad (A), personalidad y tono (B), ventajas (C), pasos de venta (D), objeciones (E), reglas de oro (F), frases clave (G), que incluye las indicaciones para cuando el cliente envía un archivo, parámetros técnicos, como el modelo de inteligencia artificial y el tiempo de espera antes de responder (H), reclamos y garantía (I): las condiciones que Verde puede informar, los datos que debe juntar y las sugerencias por síntoma, fichas de consulta (J): los datos que Verde junta en las consultas de reparación y de compra, y la biblioteca de recursos (K): los archivos que Verde puede ofrecer y enviar, y que el equipo puede elegir al adjuntar. Cada sección se guarda con su botón «Guardar».' },
      { tipo: 'h', texto: 'Reglas fijas del sistema' },
      { tipo: 'p', texto: 'Se aplican siempre, antes que las reglas de oro, y protegen el cumplimiento de las políticas de WhatsApp y de la Ley N.º 18.331. Se pueden editar con cuidado: queda registrado quién las cambió, y el botón «Restaurar las reglas recomendadas» vuelve al texto original. Se recomienda que la línea de presentación de la primera respuesta incluya el enlace a la página de privacidad; si falta, el panel lo avisa. En esa línea, {nombre} y {empresa} se reemplazan por lo configurado en «A · Identidad del bot», y el panel muestra debajo cómo la verá el cliente. En ese mensaje Verde no se presenta por su cuenta: la presentación es esa línea.' },
      { tipo: 'h', texto: 'Tiempo de espera antes de responder' },
      { tipo: 'p', texto: 'En «H · Parámetros técnicos» se define cuántos segundos espera Verde desde el último mensaje del cliente antes de responder. Si el cliente sigue escribiendo, vuelve a contar y responde a todo junto en un solo mensaje. Con 0 responde de inmediato. No se aplica en «Probar a Verde».' },
      { tipo: 'h', texto: 'Otras funciones' },
      { tipo: 'p', texto: '«Probar a Verde» permite conversar con Verde como si fuera un cliente, sin WhatsApp. «Ver cerebro de Verde» muestra las instrucciones completas que recibe la inteligencia artificial. «Apagar bot» apaga a Verde para todos los chats. En «Página de privacidad» se cargan el correo de contacto y el número de inscripción ante la URCDP.' }
    ]
  },
  {
    id: 'consumo', grupo: 'manual', soloAdmin: true, titulo: 'Consumo de IA',
    resumen: 'Cuánto se gasta en inteligencia artificial y cómo se calcula.',
    bloques: [
      { tipo: 'p', texto: 'En «Sistema › Consumo de IA» se ve el costo estimado de las consultas a la inteligencia artificial: total del período, cantidad de consultas (WhatsApp, pruebas en el panel y Centro de ayuda), costo promedio y detalle por día. Se puede elegir el mes en curso, un mes anterior o un rango de fechas.' },
      { tipo: 'p', texto: 'Cada consulta informa cuánto texto procesó la IA (tokens) y el sistema lo multiplica por el precio publicado por Anthropic para ese modelo, vigente en ese momento. Es un valor estimado en dólares y sin impuestos; el monto facturado se consulta en platform.claude.com.' }
    ]
  },
  {
    id: 'usuarios', grupo: 'manual', soloAdmin: true, titulo: 'Usuarios y contraseñas',
    resumen: 'Roles, alta de usuarios, contraseñas temporales y firma.',
    bloques: [
      { tipo: 'p', texto: 'Hay dos roles. Administrador: acceso a todo el panel. Asesor: atiende los chats y consulta el historial, pero no cambia la configuración ni los usuarios.' },
      { tipo: 'h', texto: 'Alta de un usuario (lo hace un administrador)' },
      { tipo: 'pasos', items: [
        { titulo: 'Crear el usuario', texto: 'En «Sistema › Usuarios», tocar «Nuevo usuario» y completar nombre, usuario, rol y firma (por ejemplo, «— Ana»).' },
        { titulo: 'Entregar la contraseña temporal', texto: 'El panel la muestra una sola vez. Entregarla en privado, nunca en un grupo.' },
        { titulo: 'Primer ingreso', texto: 'La persona ingresa con la contraseña temporal y el panel le pide cambiarla por una propia, de al menos 8 caracteres.' }
      ] },
      { tipo: 'p', texto: 'Si alguien olvida su contraseña, un administrador usa «Restablecer contraseña» en «Sistema › Usuarios». Los usuarios no se eliminan: se desactivan, para conservar el historial de quién atendió cada chat.' },
      { tipo: 'nota', texto: 'La firma se agrega al final de los mensajes enviados desde el panel, para que el cliente sepa quién le respondió.' }
    ]
  },
  {
    id: 'garantia', grupo: 'manual', soloAdmin: false, titulo: 'Reclamos de garantía',
    resumen: 'Qué hace Verde cuando un cliente reclama por algo que compró o reparó, y qué le llega al asesor.',
    bloques: [
      { tipo: 'p', texto: 'Cuando un cliente plantea una falla de algo que compró o reparó en la tienda, Verde sigue el protocolo de garantía: junta los datos necesarios (boleta, qué se vendió o reparó, qué falla y desde cuándo, si reinició el equipo, fotos o videos) y da sugerencias según el síntoma, como el reinicio forzado. Nunca afirma que la garantía corresponde: explica que se evalúa con la información reunida y que un asesor confirma cómo seguir.' },
      { tipo: 'h', texto: 'Qué ve el equipo' },
      { tipo: 'p', texto: 'El chat aparece en «Chats por responder» con la etiqueta «Reclamo de garantía». Dentro del chat, el botón «Ver ficha» abre la ficha del reclamo con todos los datos ordenados, y se puede copiar. La ficha es un resumen de lo que el cliente declaró: la decisión sobre la garantía es del asesor, que revisa las fotos o videos en el chat y cierra el caso.' },
      { tipo: 'p', texto: 'Verde aplica los requisitos indispensables de la tienda: la orden de trabajo (boleta de garantía) con su número, que el reclamo lo gestione quien ingresó el equipo y que esté dentro de los 30 días corridos desde la entrega. Si falta alguno, se lo dice al cliente con claridad y no ofrece alternativas que no estén en las condiciones: igual deja la ficha para el asesor.' },
      { tipo: 'nota', texto: 'Los requisitos indispensables, los plazos y la cobertura que Verde puede informar, los datos que junta y las sugerencias por síntoma se configuran en «Comportamiento del bot › I · Reclamos y garantía» (solo administradores). Vienen precargados con la política de la tienda.' }
    ]
  },
  {
    id: 'consultas', grupo: 'manual', soloAdmin: false, titulo: 'Fichas de consulta',
    resumen: 'Qué datos junta Verde en las consultas de reparación y de compra, y qué le llega al asesor.',
    bloques: [
      { tipo: 'p', texto: 'Cuando Verde deriva un chat a una persona del equipo por una consulta de reparación o de compra (por ejemplo, porque el cliente pidió un precio), arma la ficha de la consulta con los datos que ya tiene y la va completando mientras sigue conversando. Pregunta de a uno o dos datos por mensaje, no insiste si el cliente no sabe o no quiere responder y nunca da precios.' },
      { tipo: 'h', texto: 'Qué ve el equipo' },
      { tipo: 'p', texto: 'El chat aparece en «Chats por responder» con la etiqueta «Consulta de reparación» o «Consulta de compra». Dentro del chat, el botón «Ver ficha» de la franja abre la ficha: cada dato configurado con lo que respondió el cliente, «Sin dato todavía» en lo que falta y la cantidad de archivos recibidos. La ficha se puede copiar. El precio y la decisión son del asesor.' },
      { tipo: 'nota', texto: 'Los datos que Verde junta para cada tipo de consulta se configuran en «Comportamiento del bot › J · Fichas de consulta» (solo administradores). Si se edita la lista, las fichas ya creadas conservan los nombres con que se armaron.' }
    ]
  },
  {
    id: 'archivos-enviados', grupo: 'manual', soloAdmin: false, titulo: 'Enviar archivos',
    resumen: 'Cómo enviar un PDF o una imagen desde un chat, y cuándo los envía Verde.',
    bloques: [
      { tipo: 'p', texto: 'En la caja de mensaje de cada chat, el botón del clip permite adjuntar un archivo «Desde la computadora» o «Desde la biblioteca». Se pueden enviar PDF de hasta 25 MB e imágenes JPG o PNG de hasta 5 MB. El archivo queda listo encima de la caja de mensaje: se puede sumar un texto, que sale con la firma, o quitarlo antes de enviar.' },
      { tipo: 'p', texto: 'Rigen las mismas reglas que para los mensajes de texto: solo dentro de las 24 horas desde el último mensaje del cliente, y al enviar, Verde hace su pausa de 12 horas en ese chat. El archivo enviado queda en la conversación para abrirlo o guardarlo.' },
      { tipo: 'h', texto: 'Cuándo envía archivos Verde' },
      { tipo: 'p', texto: 'Verde puede enviar los recursos de la biblioteca marcados con «Verde lo ofrece»: si el cliente pide uno, se lo envía; si no lo pidió, primero se lo ofrece y lo envía solo si acepta. Si un archivo no se puede enviar, el chat pasa a «Chats por responder» para que una persona lo envíe.' },
      { tipo: 'nota', texto: 'En el modo de prueba de 360dialog no se pueden enviar archivos: se habilita al conectar el número definitivo. La biblioteca la administran los administradores en «Comportamiento del bot › K · Biblioteca de recursos».' }
    ]
  },
  {
    id: 'apariencia', grupo: 'manual', soloAdmin: false, titulo: 'Modo claro, oscuro y menú',
    resumen: 'Cómo cambiar entre modo claro y oscuro, achicar el menú y cerrar la sesión.',
    bloques: [
      { tipo: 'p', texto: 'Arriba a la derecha está el interruptor de modo, con un sol (modo claro) o una luna (modo oscuro). La primera vez, el panel usa el modo configurado en la computadora o el celular; después recuerda la elección en cada equipo.' },
      { tipo: 'p', texto: 'Al lado están las iniciales del usuario. Al tocarlas se ven el nombre y el rol, y la opción «Cerrar sesión».' },
      { tipo: 'p', texto: 'En la computadora, el botón junto al logo achica el menú para dejar solo los íconos y ganar espacio. Al pasar el mouse sobre un ícono aparece su nombre. El mismo botón vuelve a abrir el menú completo. La rama «Agentes IA» aparece cerrada al abrir el panel y se despliega al tocarla.' }
    ]
  },

  // ===================== GUÍAS DE META (solo administradores) =====================
  {
    id: 'portafolio', grupo: 'meta', soloAdmin: true, titulo: 'Portafolio comercial de Meta',
    resumen: 'Qué es el portafolio comercial y cómo dejarlo seguro.',
    bloques: [
      { tipo: 'p', texto: 'El portafolio comercial (antes «Business Manager») es la cuenta de empresa de Meta donde están la página de Facebook, el Instagram y el número de WhatsApp de la tienda. Quien lo administra controla esos canales, y ahí llegan las advertencias de Meta.' },
      { tipo: 'h', texto: 'Pasos para dejarlo seguro' },
      { tipo: 'pasos', items: [
        { titulo: 'Entrar al portafolio', texto: 'Abrir business.facebook.com con la cuenta del administrador y elegir el portafolio de Pantalla Verde.' },
        { titulo: 'Revisar las personas con acceso', texto: 'En Configuración › Personas, dejar solo a las personas de confianza, con el rol mínimo necesario.' },
        { titulo: 'Exigir la verificación en dos pasos', texto: 'En Configuración › Centro de seguridad, exigirla para todas las personas del portafolio.' },
        { titulo: 'Ubicar las advertencias', texto: 'En Business Support Home se ven las advertencias y se puede pedir una revisión. La calidad del número se ve en WhatsApp Manager.' }
      ] },
      { tipo: 'nota', texto: 'Las advertencias también llegan por correo a cada administrador: conviene que esos correos estén al día. Los nombres de los menús pueden variar levemente según la versión de Meta.' }
    ]
  },
  {
    id: 'dos-pasos', grupo: 'meta', soloAdmin: true, titulo: 'Verificación en dos pasos',
    resumen: 'Por qué activarla y cómo hacerlo en las cuentas de Meta.',
    bloques: [
      { tipo: 'p', texto: 'La verificación en dos pasos pide un código además de la contraseña. Si alguien obtiene la contraseña, igual no puede entrar sin el código. Es la protección más importante del portafolio comercial.' },
      { tipo: 'pasos', items: [
        { titulo: 'En la cuenta personal de cada administrador', texto: 'En Facebook: Centro de cuentas › Contraseña y seguridad › Autenticación en dos pasos. Elegir una app autenticadora (más segura que los mensajes de texto).' },
        { titulo: 'En el portafolio', texto: 'En Configuración › Centro de seguridad, exigir la verificación en dos pasos para todas las personas.' },
        { titulo: 'Guardar los códigos de recuperación', texto: 'Anotarlos en un lugar seguro, fuera del celular, por si se pierde el teléfono.' }
      ] },
      { tipo: 'nota', texto: 'La verificación en dos pasos para entrar a este panel está prevista en una versión próxima.' }
    ]
  },
  {
    id: 'calidad', grupo: 'meta', soloAdmin: true, titulo: 'Calidad de la cuenta (Account Quality)',
    resumen: 'Cómo mide Meta la calidad del número, qué la baja y qué sanciones existen.',
    bloques: [
      { tipo: 'p', texto: 'Meta califica la calidad del número según cómo reaccionan los clientes en los últimos 7 días: bloqueos, denuncias, silenciamientos y archivados. Se ve en WhatsApp Manager › Herramientas de la cuenta › Números de teléfono.' },
      { tipo: 'p', texto: 'Los límites de mensajería solo cuentan los mensajes que inicia la tienda fuera de la ventana de 24 horas. Un portafolio nuevo arranca en 250 clientes por día y sube al verificar el negocio o con buena calidad. Las respuestas de Verde a clientes que escribieron primero no cuentan para ese límite.' },
      { tipo: 'h', texto: 'Sanciones, de menor a mayor' },
      { tipo: 'p', texto: 'Advertencia; bloqueo de 1 o 3 días para enviar plantillas; bloqueo de 5, 7 o 30 días para enviar mensajes; bloqueo de la cuenta (se levanta solo con apelación); baja permanente.' },
      { tipo: 'h', texto: 'Uso de inteligencia artificial' },
      { tipo: 'p', texto: 'Desde el 15/01/2026, Meta prohíbe usar WhatsApp para ofrecer asistentes de inteligencia artificial de uso general. Un comercio que usa IA para atender a sus propios clientes está permitido. Por eso las reglas fijas mantienen a Verde dentro de los temas de la tienda.' }
    ]
  },
  {
    id: 'apelaciones', grupo: 'meta', soloAdmin: true, titulo: 'Business Support Home y apelaciones',
    resumen: 'Dónde se ven las advertencias de Meta y cómo pedir una revisión.',
    bloques: [
      { tipo: 'pasos', items: [
        { titulo: 'Entrar a Business Support Home', texto: 'En Meta Business Suite › Todas las herramientas › Business Support Home.' },
        { titulo: 'Elegir la advertencia', texto: 'Se listan las infracciones y restricciones, con su motivo.' },
        { titulo: 'Pedir una revisión', texto: 'Tocar «Request Review» (solicitar revisión) y explicar los motivos. La respuesta suele tardar entre 24 y 48 horas.' }
      ] },
      { tipo: 'nota', texto: 'No todas las infracciones por spam se pueden apelar. El monitor de advertencias dentro de este panel está previsto en una versión próxima.' }
    ]
  },
  {
    id: 'plantillas', grupo: 'meta', soloAdmin: true, titulo: 'Plantillas de mensajes',
    resumen: 'Qué son las plantillas, sus categorías y cómo crear la de avisos al equipo.',
    bloques: [
      { tipo: 'p', texto: 'Una plantilla es un mensaje aprobado por Meta que se puede enviar fuera de la ventana de 24 horas. Hay tres categorías: marketing (promociones), utilidad (avisos y confirmaciones) y autenticación (códigos de verificación).' },
      { tipo: 'h', texto: 'Plantilla para los avisos al equipo' },
      { tipo: 'pasos', items: [
        { titulo: 'Crearla', texto: 'En WhatsApp Manager › Plantillas de mensajes › Crear. Categoría: Utilidad. Idioma: Español. Nombre: chat_por_responder.' },
        { titulo: 'Cargar el texto', texto: 'Copiarlo desde la pantalla «Avisos» del panel. Lleva dos variables: {{1}} el cliente y {{2}} el motivo.' },
        { titulo: 'Esperar la aprobación', texto: 'Meta la revisa; el tiempo varía. Después, cargar el nombre en «Avisos» y guardar.' }
      ] },
      { tipo: 'nota', texto: 'Según las copias públicas del tarifario de Meta, un mensaje de utilidad en la región que incluye a Uruguay cuesta alrededor de USD 0,0113 (confirmar en el tarifario oficial). La plantilla se crea al conectar el número real.' }
    ]
  },
  {
    id: 'ventana-24', grupo: 'meta', soloAdmin: true, titulo: 'Ventana de 24 horas',
    resumen: 'La regla de WhatsApp que define qué mensajes se pueden enviar y cuándo.',
    bloques: [
      { tipo: 'p', texto: 'Cada mensaje del cliente abre (o renueva) una ventana de 24 horas. Dentro de la ventana se puede responder con mensajes comunes; fuera de ella, solo con plantillas aprobadas.' },
      { tipo: 'p', texto: 'Por eso Verde solo responde a clientes que escribieron primero, y el panel no permite responder pasadas las 24 horas del último mensaje del cliente. Lo mismo rige para los avisos a los celulares del equipo: cada celular tiene su propia ventana.' },
      { tipo: 'nota', texto: 'Desde el 01/10/2026, Meta cobra los mensajes de servicio después de los primeros 1.000 de cada mes por número. Los mensajes enviados desde la app de WhatsApp Business del celular siguen siendo gratuitos.' }
    ]
  }
];

function visible(a, rol) { return !a.soloAdmin || rol === 'admin'; }
function articulosPara(rol) { return ARTICULOS.filter(a => visible(a, rol)); }
function articulo(id, rol) {
  const a = ARTICULOS.find(x => x.id === id);
  if (!a) return { error: 'El tema no existe.', codigo: 404 };
  if (!visible(a, rol)) return { error: 'Este tema es solo para administradores.', codigo: 403 };
  return { articulo: a };
}

// Texto plano de un artículo (para las instrucciones del asistente).
function textoArticulo(a) {
  const partes = [];
  for (const b of a.bloques) {
    if (b.tipo === 'pasos') b.items.forEach((p, i) => partes.push((i + 1) + '. ' + p.titulo + ': ' + p.texto));
    else partes.push((b.tipo === 'h' ? '## ' : '') + b.texto);
  }
  return partes.join('\n');
}

// Instrucciones del asistente para un rol y una configuración del panel.
function instrucciones(rol, config) {
  const esAdmin = rol === 'admin';
  const base = articulosPara(rol).map(a => '### [' + a.id + '] ' + a.titulo + '\n' + textoArticulo(a)).join('\n\n');
  const conf = Object.entries(config || {}).map(([k, v]) => '- ' + k + ': ' + v).join('\n');
  return [
    'ASISTENTE DE AYUDA DEL PANEL DE VERDE (Pantalla Verde)',
    'Función: responder preguntas de las personas que usan el panel sobre cómo funciona el panel, el chatbot Verde y las reglas de WhatsApp y Meta.',
    '',
    'Reglas obligatorias:',
    '1. Responder solo con la información de la BASE DE CONOCIMIENTO y de la CONFIGURACIÓN ACTUAL. No inventar funciones, menús, precios ni datos.',
    '2. Si la respuesta no está en esa información, decirlo con claridad y sugerir consultar a un administrador.',
    '3. Si la pregunta no tiene relación con el panel, Verde, WhatsApp o Meta, indicar con amabilidad que solo se puede ayudar con esos temas.',
    '4. Escribir en español neutro y profesional, sin voseo. Respuestas breves (hasta 6 oraciones); usar pasos numerados cuando se explique un procedimiento. No usar formato Markdown (ni asteriscos ni almohadillas).',
    '5. Rol de la persona que pregunta: ' + (esAdmin ? 'Administrador.' : 'Asesor. No dar instrucciones de pantallas de administración (configuración de Verde, avisos, usuarios, consumo, Meta); si pregunta por ellas, indicar que esas tareas las realiza un administrador.'),
    '6. Responder SOLO con un objeto JSON válido, sin texto antes ni después: {"respuesta": "texto de la respuesta", "fuentes": ["id-del-tema"]}. En «fuentes» van los id (entre corchetes en la base) de los temas usados, como máximo 3.',
    '',
    'CONFIGURACIÓN ACTUAL DEL PANEL (en el momento de la pregunta):',
    conf,
    '',
    'BASE DE CONOCIMIENTO (reglas de Meta revisadas el ' + REVISION_META.split('-').reverse().join('/') + '):',
    base,
    '',
    'OTRAS PANTALLAS: «Fuentes de datos», «Rastreador Web», «Multimedia» y «Recursos enviables» están en revisión; algunas de sus funciones todavía son de demostración.'
  ].join('\n');
}

// Interpreta la respuesta de la IA: objeto JSON con «respuesta» y «fuentes». Solo acepta fuentes visibles para el rol.
function interpretar(texto, rol) {
  const limpio = String(texto || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let respuesta = limpio, fuentes = [];
  try {
    const j = JSON.parse(limpio.slice(limpio.indexOf('{'), limpio.lastIndexOf('}') + 1));
    if (j && typeof j.respuesta === 'string') { respuesta = j.respuesta; fuentes = Array.isArray(j.fuentes) ? j.fuentes : []; }
  } catch (e) { /* sin JSON: se usa el texto tal cual */ }
  const vistos = new Set();
  const validas = fuentes.map(String).filter(id => !vistos.has(id) && vistos.add(id))
    .map(id => ARTICULOS.find(a => a.id === id)).filter(a => a && visible(a, rol)).slice(0, 3)
    .map(a => ({ id: a.id, titulo: a.titulo, grupo: a.grupo }));
  respuesta = respuesta.replace(/\*\*/g, '').trim().slice(0, 2500);
  return { respuesta: respuesta || 'No se pudo obtener una respuesta. Intentar de nuevo.', fuentes: validas };
}

module.exports = { ARTICULOS, REVISION_META, articulosPara, articulo, instrucciones, interpretar };
