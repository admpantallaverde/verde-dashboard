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
    id: 'leads', grupo: 'manual', soloAdmin: false, titulo: 'Leads',
    resumen: 'Cada conversación clasificada por la IA: tipo, producto, etapa, prioridad y traba, ordenadas para atender primero lo que más importa.',
    bloques: [
      { tipo: 'p', texto: 'En «Ventas › Leads» están todas las conversaciones de los últimos 30 días, ordenadas por prioridad. La IA clasifica cada una cuando pasan 10 minutos sin mensajes nuevos: tipo (reparación, compra, garantía, consulta general u otro), producto o servicio, intención de compra, un resumen, el próximo paso sugerido y la traba, con la frase textual del cliente.' },
      { tipo: 'h', texto: 'Etapas' },
      { tipo: 'l', items: ['Nuevo: empezó hace menos de 24 horas y lo atiende Verde.', 'Con Verde: Verde sigue conversando.', 'Derivado: está en «Chats por responder» y nadie del equipo contestó todavía.', 'En atención: el cliente escribió después de que alguien del equipo le respondió.', 'Presupuesto enviado: el equipo ya le dio un precio y se espera su respuesta.', 'Esperando al cliente: el equipo respondió y el cliente todavía no contestó.', 'Sin respuesta: pasaron más de 48 horas sin respuesta del cliente.'] },
      { tipo: 'h', texto: 'Prioridad' },
      { tipo: 'p', texto: 'Alta: reclamos de garantía, compras con intención alta y derivados sin respuesta hace más de 2 horas. Media: intención alta o media, derivados recientes, presupuestos enviados y chats esperando al cliente. Normal: el resto. Dentro de cada nivel, el que más espera va primero. La etapa y la prioridad no las decide la IA: salen de reglas fijas.' },
      { tipo: 'h', texto: 'Corregir una clasificación' },
      { tipo: 'p', texto: 'Al abrir un chat, arriba aparece la franja «Lead» con la clasificación. Si la IA se equivocó, «Corregir» permite cambiar el tipo, el producto, la intención y la traba; lo corregido queda fijo aunque la IA vuelva a clasificar. El modelo que clasifica se elige en «Comportamiento del bot», sección H, y su gasto se ve en «Consumo de IA» como «Clasificación».' },
      { tipo: 'h', texto: 'Vendedor y cierre del lead' },
      { tipo: 'p', texto: 'El vendedor de un lead es quien respondió último; desde la franja «Lead», «Asignar» permite elegir a otro usuario del panel. «Cerrar lead» lo marca como ganado o perdido, con el motivo (precio, demora, desconfianza, distancia, lo piensa, compró en otro lado u otro) y una nota; queda anotado en el chat y el lead sale de la lista, salvo con el filtro «Cerrado». Cuando la IA detecta que el cliente compró o desistió, la franja muestra su propuesta con «Confirmar» y «No»: nada se cierra sin el vendedor.' }
    ]
  },
  {
    id: 'tareas', grupo: 'manual', soloAdmin: false, titulo: 'Tareas',
    resumen: 'Qué tiene que hacer cada vendedor y cuándo, según la etapa de cada lead.',
    bloques: [
      { tipo: 'p', texto: 'En «Ventas › Tareas» están las tareas pendientes, agrupadas en vencidas, para hoy y próximas. Cada etapa del proceso de ventas tiene una próxima acción y un plazo (por ejemplo, un presupuesto enviado se sigue a las 24 horas); la tarea nace sola cuando el lead entra en la etapa. El asesor ve sus tareas; el administrador ve todas y puede filtrar por vendedor. El número en el menú es la cantidad de tareas vencidas.' },
      { tipo: 'h', texto: 'Marcar una tarea como hecha' },
      { tipo: 'p', texto: '«Hecho» pide una nota corta opcional (por ejemplo, «llamé, no atendió») y cuándo volver a ver el lead: mañana, en 2 días, en una semana o sin seguimiento. El seguimiento queda como nueva tarea a las 10:00 del día elegido, y la nota se anota en el chat como mensaje interno. Si el cliente vuelve a escribir, la tarea de la etapa nueva reemplaza al seguimiento.' },
      { tipo: 'p', texto: 'Las tareas no mandan mensajes a los clientes: son recordatorios para el equipo. Para contactar a un cliente que no escribió en las últimas 24 horas, llamar por teléfono o escribirle desde el celular de la tienda.' }
    ]
  },
  {
    id: 'reportes', grupo: 'manual', soloAdmin: true, titulo: 'Reportes semanales',
    resumen: 'Cada lunes: atención por vendedor, lo más pedido, por qué no compran, resultados y evaluación de la IA.',
    bloques: [
      { tipo: 'p', texto: 'En «Ventas › Reportes» está el reporte de cada semana (lunes a domingo). Se arma solo los lunes a las 07:00 con la semana anterior; «Generar ahora» arma el de la semana en curso y «Volver a armar» rehace uno. A las 07:05 llega un aviso por WhatsApp a los números cargados en «Avisos a celulares del equipo › Reporte semanal» (fuera de las 24 horas hace falta la plantilla «reporte_semanal» aprobada por Meta).' },
      { tipo: 'h', texto: 'Qué trae' },
      { tipo: 'l', items: ['Atención del equipo, por vendedor: chats atendidos, primera respuesta (mediana y máxima), respuestas de más de 2 horas, clientes que quedaron colgados y tareas hechas o vencidas.', 'Lo más pedido: productos y servicios según la clasificación de los leads.', 'Por qué no compran: las trabas con la frase textual de cada cliente.', 'Resultados: leads nuevos, ganados, perdidos con motivo y sin cerrar; y cuántas conversaciones resolvió Verde solo, cuántas se derivaron y cuántas atendió el equipo.', 'Evaluación de la atención hecha por la IA: puntaje de 1 a 5 por vendedor, qué hace bien, qué mejorar y ejemplos citados; temas de la semana y tres puntos para la reunión.'] },
      { tipo: 'p', texto: 'Todo lo que cita se toca y abre la conversación parada en ese mensaje. La evaluación lee hasta 40 conversaciones atendidas por el equipo (primero las derivadas) con el modelo y esfuerzo del Asistente IA; su gasto se ve en Consumo de IA como «Reporte». Si falla, «Repetir la evaluación» la vuelve a pedir.' }
    ]
  },
  {
    id: 'proceso-de-ventas', grupo: 'manual', soloAdmin: true, titulo: 'Proceso de ventas',
    resumen: 'Configurar la próxima acción, el plazo y el aviso de cada etapa.',
    bloques: [
      { tipo: 'p', texto: 'En «Ventas › Proceso de ventas» se define, para cada etapa con tarea (Derivado, En atención, Presupuesto enviado, Esperando al cliente y Sin respuesta), qué tiene que hacer el vendedor, en cuántas horas y si se avisa al celular del equipo cuando la tarea vence. Los avisos usan el mismo sistema que los de «Chats por responder». Las etapas Nuevo, Con Verde y Cerrado no tienen tarea.' },
      { tipo: 'p', texto: 'Los cambios valen para las tareas desde ese momento: una tarea ya vencida no se reabre por cambiar el plazo.' }
    ]
  },
  {
    id: 'chats-por-responder', grupo: 'manual', soloAdmin: false, titulo: 'Chats por responder',
    resumen: 'Clientes que esperan a una persona del equipo: cómo responderlos y cómo marcarlos como atendidos.',
    bloques: [
      { tipo: 'p', texto: 'Cuando Verde deriva un chat a una persona del equipo (por ejemplo, porque el cliente pide un precio exacto), el chat aparece en «Chats por responder» y se avisa al equipo. Verde sigue conversando con el cliente, sin dar precios, hasta que una persona del equipo responda; ahí hace su pausa de 12 horas.' },
      { tipo: 'p', texto: 'Cuando el cliente envía un archivo, el chat aparece con la etiqueta «Archivo para revisar». Si después el cliente pide un precio, pasa a «Por responder» y se avisa al equipo por ese motivo. En los dos casos, Verde sigue conversando.' },
      { tipo: 'p', texto: 'Los tiempos de espera de más de 5 minutos se muestran en rojo. El número junto a «Chats por responder» en el menú indica cuántos chats esperan. Desde la 1.5.0 la lista va ordenada por la prioridad del lead (alta primero) y, dentro de cada nivel, el más viejo primero.' },
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
        { titulo: 'Primer ingreso', texto: 'La persona ingresa con la contraseña temporal, configura la verificación en 2 pasos con una app autenticadora y después el panel le pide cambiar la contraseña por una propia, de al menos 8 caracteres.' }
      ] },
      { tipo: 'p', texto: 'Si alguien olvida su contraseña, un administrador usa «Restablecer contraseña» en «Sistema › Usuarios». Si perdió o cambió el celular de la app autenticadora, usa «Restablecer verificación en 2 pasos» dentro de «Editar»: se cierran sus sesiones y en el próximo ingreso la configura de nuevo. Debajo de «Activo» se ve si cada persona ya la configuró. Los usuarios no se eliminan: se desactivan, para conservar el historial de quién atendió cada chat.' },
      { tipo: 'nota', texto: 'La firma se agrega al final de los mensajes enviados desde el panel, para que el cliente sepa quién le respondió.' }
    ]
  },
  {
    id: 'registro-accesos', grupo: 'manual', soloAdmin: true, titulo: 'Registro de accesos',
    resumen: 'Quién entró al panel, desde dónde, los intentos fallidos y las descargas de respaldos.',
    bloques: [
      { tipo: 'p', texto: 'En «Sistema › Registro de accesos» se ven los ingresos correctos, las contraseñas y los códigos incorrectos, los bloqueos por intentos, los cierres de sesión, los cambios en la verificación en 2 pasos y las descargas de respaldos. Cada evento muestra la fecha y hora, el usuario, la dirección IP y el dispositivo (navegador y sistema).' },
      { tipo: 'p', texto: 'Se puede filtrar por usuario, por tipo de evento y por período (últimos 7, 30 o 90 días). Arriba hay un resumen del período. Los intentos con un usuario que no existe aparecen marcados como «(no existe)».' },
      { tipo: 'nota', texto: 'El registro se conserva 90 días. Si aparecen intentos fallidos o bloqueos que nadie del equipo reconoce, conviene cambiar las contraseñas y revisar quién tiene acceso.' }
    ]
  },
  {
    id: 'respaldos', grupo: 'manual', soloAdmin: true, titulo: 'Respaldos',
    resumen: 'El respaldo diario de los datos, cómo descargarlo y cómo se restaura.',
    bloques: [
      { tipo: 'p', texto: 'Todas las noches a las 03:30 Verde guarda un respaldo de sus datos: configuración, conversaciones, usuarios, consumo, archivos guardados y biblioteca. Si a esa hora el servidor estaba apagado, lo hace apenas vuelve a funcionar. Se conservan los últimos 14, cifrados porque contienen datos de clientes.' },
      { tipo: 'pasos', items: [
        { titulo: 'Descargar una copia cada semana', texto: 'En «Sistema › Respaldos», tocar «Descargar» en el más reciente. Es la única copia fuera del servidor: guardarla fuera de la computadora de la tienda (disco externo o nube personal).' },
        { titulo: 'Atender el aviso', texto: 'Si pasan más de 7 días sin descargar un respaldo, la sección muestra un aviso con el botón «Descargar el último».' },
        { titulo: 'Guardar la clave de cifrado', texto: 'Sin la clave, un respaldo no se puede abrir. Tiene que estar guardada también fuera del servidor, por ejemplo en el gestor de contraseñas.' }
      ] },
      { tipo: 'p', texto: '«Hacer respaldo ahora» crea uno en el momento, por ejemplo antes de un cambio grande. Cada descarga queda en el registro de accesos.' },
      { tipo: 'nota', texto: 'Restaurar un respaldo reemplaza los datos actuales: se hace con un comando en el servidor, con Verde detenido y con guía. Los datos que había quedan guardados aparte.' }
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
      { tipo: 'p', texto: 'Verde puede enviar los recursos de la biblioteca marcados con «Verde lo ofrece»: si el cliente pide uno, se lo envía; si no lo pidió, primero se lo ofrece y lo envía solo si acepta. Los recursos con «Puede enviarlo sin que lo pidan» (etiqueta «Sin preguntar») los envía cuando se cumple su indicación, aunque el cliente no los haya pedido. Verde nunca promete un archivo que no puede enviar: si un archivo no sale, se lo aclara al cliente y el chat pasa a «Chats por responder» para que una persona lo envíe.' },
      { tipo: 'nota', texto: 'En el modo de prueba de 360dialog no se pueden enviar archivos: se habilita al conectar el número definitivo. La biblioteca la administran los administradores en «Comportamiento del bot › K · Biblioteca de recursos».' }
    ]
  },
  {
    id: 'corregir', grupo: 'manual', soloAdmin: false, titulo: 'Corregir el texto con la IA',
    resumen: 'El botón de IA de la caja de mensaje corrige la ortografía y escribe el texto más claro, en el tono que se elija.',
    bloques: [
      { tipo: 'p', texto: 'En la caja de mensaje de cada chat, el botón con el ícono de IA (o el atajo Shift + la tecla a la izquierda del 1, en la computadora) abre un menú con tres tonos: rioplatense, neutro y formal. Al elegir uno, la IA corrige la ortografía y reescribe el texto para que el cliente lo entienda mejor, manteniendo todas las ideas de quien lo escribió. El texto corregido reemplaza al original en la caja, con el botón «Deshacer» para recuperarlo. Nada se envía solo: se puede editar antes de enviar.' },
      { tipo: 'p', texto: 'La IA no agrega información, precios ni promesas que no estén en el texto, respeta los emojis y no toca la firma, que se agrega al enviar. Cada corrección queda registrada en «Consumo de IA» como «Corrección», con un límite de 30 por hora por usuario.' }
    ]
  },
  {
    id: 'asistente', grupo: 'manual', soloAdmin: false, titulo: 'Asistente del equipo',
    resumen: 'El asistente del Centro de ayuda apoya al equipo con los clientes: qué responder, cómo cerrar una venta, cómo tratar un reclamo, y escribe textos listos para enviar.',
    bloques: [
      { tipo: 'p', texto: 'En «Centro de ayuda › Asistente» se le puede preguntar qué responderle a un cliente, cómo cerrar una venta, cómo salir bien de una conversación difícil, cómo armar un presupuesto o cómo explicar la garantía. Conoce la configuración de Verde (identidad, pasos de venta, objeciones, reglas de oro, condiciones de garantía y biblioteca de recursos) y este manual. Solo responde sobre el trabajo de la empresa y sus clientes; ante otros temas, lo dice y no contesta.' },
      { tipo: 'p', texto: 'Desde un chat, el botón «Ayuda con este chat» abre el asistente con esa conversación adjunta (los últimos 20 mensajes del cliente, Verde y el equipo; nunca los archivos). Cuando el asistente propone un texto para el cliente, aparece como «Texto listo para enviar» con los botones «Copiar» y «Usar en el chat», que lo lleva a la caja de mensaje de esa conversación sin enviarlo. El asistente no inventa precios, plazos ni promesas, y nunca confirma ni rechaza una garantía.' },
      { tipo: 'p', texto: 'El administrador elige el modelo y el esfuerzo del asistente en «Comportamiento del bot › H», aparte de los de Verde. Límite de 30 preguntas por hora por usuario; el gasto se ve en «Consumo de IA» como «Ayuda».' }
    ]
  },
  {
    id: 'ingreso-dos-pasos', grupo: 'manual', soloAdmin: false, titulo: 'Verificación en 2 pasos para entrar al panel',
    resumen: 'Cómo configurar la app autenticadora, entrar con el código y qué hacer si se pierde el celular.',
    bloques: [
      { tipo: 'p', texto: 'Para entrar al panel, además de la contraseña, hace falta el código de 6 dígitos que muestra una app autenticadora en el celular (Google Authenticator o Microsoft Authenticator). El código cambia cada 30 segundos. Es obligatoria para todos los usuarios.' },
      { tipo: 'h', texto: 'Configurarla (la primera vez)' },
      { tipo: 'pasos', items: [
        { titulo: 'Instalar la app', texto: 'Instalar Google Authenticator o Microsoft Authenticator en el celular.' },
        { titulo: 'Escanear el código QR', texto: 'En la app, agregar una cuenta y escanear el código que muestra el panel. Si no se puede escanear, escribir a mano la clave que aparece debajo.' },
        { titulo: 'Confirmar con un código', texto: 'Escribir el código de 6 dígitos que muestra la app y tocar «Activar la verificación».' },
        { titulo: 'Guardar los códigos de recuperación', texto: 'El panel muestra 10 códigos de un solo uso. Copiarlos o descargarlos y guardarlos en un lugar seguro: no se vuelven a mostrar.' }
      ] },
      { tipo: 'p', texto: 'Después, en cada ingreso el panel pide el código. La sesión se cierra tras 8 horas sin uso y, siempre, a los 7 días.' },
      { tipo: 'p', texto: 'Si se pierde o se cambia el celular: entrar con uno de los códigos de recuperación («Usar un código de recuperación») y pedir a un administrador que restablezca la verificación en «Sistema › Usuarios › Editar». En el próximo ingreso se configura de nuevo.' },
      { tipo: 'nota', texto: 'Después de 5 intentos fallidos, entre contraseñas y códigos, el ingreso se bloquea 15 minutos.' }
    ]
  },
  {
    id: 'apariencia', grupo: 'manual', soloAdmin: false, titulo: 'Modo claro, oscuro y menú',
    resumen: 'Cómo cambiar entre modo claro y oscuro, achicar el menú y cerrar la sesión.',
    bloques: [
      { tipo: 'p', texto: 'Abajo a la izquierda, en la tarjeta «Conexión», junto a «Ver estado de conexión», está el interruptor de modo, con un sol (modo claro) o una luna (modo oscuro). Con el menú achicado, queda como un ícono de sol o luna al pie del menú. La primera vez, el panel usa el modo configurado en la computadora o el celular; después recuerda la elección en cada equipo.' },
      { tipo: 'p', texto: 'Arriba a la derecha están las iniciales del usuario. Al tocarlas se ven el nombre y el rol, y la opción «Cerrar sesión».' },
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
function articulosPara(rol) { return ARTICULOS.filter(a => visible(a, rol)).concat([articuloManualCompleto(rol)]); }
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
// 1.4.11: texto de una conversación para adjuntar al asistente (últimos 20 mensajes del cliente, Verde y el equipo; nunca los archivos).
function textoConversacion(d) {
  if (!d) return '';
  const quien = { cliente: 'Cliente', verde: 'Verde (bot)', equipo: 'Equipo' };
  const ms = (d.mensajes || []).filter(m => m && quien[m.tipo]).slice(-20);
  if (!ms.length) return '';
  const cab = 'Cliente: ' + (String(d.nombre || '').trim() || 'sin nombre') + (d.numero ? ' · +' + d.numero : '');
  return cab + '\n' + ms.map(m => (m.tipo === 'equipo' && m.autor ? 'Equipo (' + m.autor + ')' : quien[m.tipo]) + ': ' + (m.archivo ? '[envió un archivo] ' : '') + String(m.texto || '').replace(/\s+/g, ' ').trim().slice(0, 600)).join('\n');
}
// 1.4.11: el asistente del equipo. «extra»: { empresa: resumen configurado, conversacion: texto adjunto, nombreEmpresa }.
function instrucciones(rol, config, extra) {
  const esAdmin = rol === 'admin';
  const ex = extra || {};
  const empresa = String(ex.nombreEmpresa || '').trim() || 'Pantalla Verde';
  const base = articulosPara(rol).map(a => '### [' + a.id + '] ' + a.titulo + '\n' + textoArticulo(a)).join('\n\n');
  const conf = Object.entries(config || {}).map(([k, v]) => '- ' + k + ': ' + v).join('\n');
  return [
    'ASISTENTE DEL EQUIPO DE ' + empresa.toUpperCase() + ' (panel de Verde)',
    'Función: ser el apoyo de las personas del equipo que atienden a los clientes por WhatsApp: qué responder, cómo cerrar una venta, cómo salir bien de un cliente difícil o conflictivo, cómo armar un presupuesto atractivo, cómo explicar la garantía, y también cómo usar el panel y las reglas de WhatsApp y Meta.',
    '',
    'Reglas obligatorias:',
    '1. Responder solo sobre el trabajo de ' + empresa + ' y sus clientes: ventas, reparaciones, productos, atención, el panel, Verde, WhatsApp y Meta. Ante cualquier otro tema (salud, política, vida personal, tareas ajenas al trabajo, etc.), responder exactamente: «Eso ya no es algo con lo que pueda ayudarte: solo doy apoyo con el trabajo de ' + empresa + ' y sus clientes.» y nada más.',
    '2. Usar la INFORMACIÓN DE LA EMPRESA, la CONFIGURACIÓN ACTUAL y la BASE DE CONOCIMIENTO. No inventar precios, plazos, promesas, políticas ni funciones del panel: si falta un dato, pedírselo a la persona o indicar que lo decide un administrador.',
    '3. Cuando pidan un texto para un cliente, entregarlo listo para enviar en «textos» (hasta 3 variantes): completo, sin corchetes de relleno salvo que falte un dato imprescindible, en español rioplatense con voseo, cordial y respetuoso, salvo que pidan otro tono. En esos textos nunca confirmar ni rechazar una garantía, ni prometer precios o plazos que no estén en la conversación o en la información de la empresa.',
    '4. Si hay una CONVERSACIÓN ADJUNTA, basarse en ella: qué dijo el cliente, qué ya respondió Verde o el equipo y qué falta resolver. Si la persona adjunta una IMAGEN (por ejemplo, una captura del panel), describir qué muestra, decir qué es cada cosa y cómo se usa, con el MANUAL COMPLETO; si no es del panel ni del trabajo de la empresa, decirlo.',
    '5. En «respuesta», hablarle a la persona del equipo de forma cercana (español rioplatense), concreta y clara. Cuando explique CÓMO HACER algo en el panel o un procedimiento, usar este formato: una primera línea con el título (por ejemplo «Paso a paso: marcar una tarea como hecha»), después pasos numerados «1.», «2.»… de UNA acción cada uno, con los nombres de pantallas, botones y campos en negrita con dobles asteriscos (**Tareas**, **Hecho**), y una última línea «Resultado esperado: …». Hasta 10 pasos. Cuando haya VARIAS cosas que explicar (varios botones o partes en una imagen, varias preguntas, varias opciones), responder con una lista numerada: un elemento por punto, que empieza con su nombre en negrita y dos puntos (por ejemplo «1. **Interruptor «Verde en pausa»:** …», «2. **Botón de ayuda:** …»); nunca explicar varias cosas de corrido en un mismo párrafo. Para una sola duda simple, responder en 2 a 6 oraciones. Nunca inventar un botón o una pantalla que no esté en el MANUAL COMPLETO.',
    '6. Rol de la persona que pregunta: ' + (esAdmin ? 'Administrador.' : 'Asesor. No dar instrucciones de pantallas de administración (configuración de Verde, avisos, usuarios, consumo, Meta); si pregunta por ellas, indicar que esas tareas las realiza un administrador.'),
    '7. Responder SOLO con un objeto JSON válido, sin texto antes ni después: {"respuesta": "texto para la persona del equipo", "fuentes": ["id-del-tema"], "textos": ["texto listo para enviar al cliente"]}. En «fuentes» van los id (entre corchetes en la base) de los temas del manual usados, como máximo 3 (lista vacía si no se usó ninguno). «textos» va vacío cuando no corresponde un texto para el cliente.',
    '',
    'INFORMACIÓN DE LA EMPRESA (configurada por el administrador en el panel):',
    String(ex.empresa || '').trim() || '(sin configurar)',
    '',
    'CONFIGURACIÓN ACTUAL DEL PANEL (en el momento de la pregunta):',
    conf,
    '',
    'MANUAL COMPLETO DEL PANEL (pantalla por pantalla, para explicar cualquier botón o detalle; citar la fuente «manual-completo»):',
    manualCompleto.textoPara(rol),
    '',
    'BASE DE CONOCIMIENTO (reglas de Meta revisadas el ' + REVISION_META.split('-').reverse().join('/') + '):',
    base,
    '',
    'OTRAS PANTALLAS: «Fuentes de datos», «Rastreador Web», «Multimedia» y «Recursos enviables» están en revisión; algunas de sus funciones todavía son de demostración.',
    String(ex.conversacion || '').trim() ? '\nCONVERSACIÓN ADJUNTA (últimos mensajes del chat abierto, del más viejo al más nuevo):\n' + String(ex.conversacion).trim() : ''
  ].join('\n');
}

// 1.5.3: las instrucciones en dos bloques: el fijo (reglas, manual completo y base de conocimiento) se guarda en la
// caché de Anthropic y se cobra una fracción al reutilizarse; el variable (empresa, configuración, conversación) va aparte.
function instruccionesEnBloques(rol, config, extra) {
  const todo = instrucciones(rol, config, extra);
  const corte = todo.indexOf('\nINFORMACIÓN DE LA EMPRESA (configurada por el administrador en el panel):');
  const fijoFin = todo.indexOf('\nOTRAS PANTALLAS:');
  if (corte < 0 || fijoFin < 0) return todo;
  const reglas = todo.slice(0, corte);
  const variable = todo.slice(corte, todo.indexOf('\nMANUAL COMPLETO DEL PANEL'));
  const conocimiento = todo.slice(todo.indexOf('\nMANUAL COMPLETO DEL PANEL'), fijoFin);
  const cola = todo.slice(fijoFin);
  return [
    { type: 'text', text: reglas + '\n' + conocimiento, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: variable + cola }
  ];
}
// Interpreta la respuesta de la IA: objeto JSON con «respuesta» y «fuentes». Solo acepta fuentes visibles para el rol.
function interpretar(texto, rol) {
  const limpio = String(texto || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let respuesta = limpio, fuentes = [], textos = [];
  try {
    const j = JSON.parse(limpio.slice(limpio.indexOf('{'), limpio.lastIndexOf('}') + 1));
    if (j && typeof j.respuesta === 'string') { respuesta = j.respuesta; fuentes = Array.isArray(j.fuentes) ? j.fuentes : []; textos = Array.isArray(j.textos) ? j.textos : []; }
  } catch (e) { /* sin JSON: se usa el texto tal cual */ }
  const vistos = new Set();
  const validas = fuentes.map(String).filter(id => !vistos.has(id) && vistos.add(id))
    .map(id => ARTICULOS.find(a => a.id === id)).filter(a => a && visible(a, rol)).slice(0, 3)
    .map(a => ({ id: a.id, titulo: a.titulo, grupo: a.grupo }));
  respuesta = respuesta.replace(/\*\*/g, '').trim().slice(0, 2500);
  textos = textos.filter(t => typeof t === 'string').map(t => t.replace(/\*\*/g, '').trim().slice(0, 1500)).filter(Boolean).slice(0, 3);   // 1.4.11
  return { respuesta: respuesta || 'No se pudo obtener una respuesta. Intentar de nuevo.', fuentes: validas, textos };
}

// 1.5.3: el manual completo (pantalla por pantalla) como tema de «Manual y guías», según el rol.
const manualCompleto = require('./manual-completo.js');
function articuloManualCompleto(rol) {
  return { id: 'manual-completo', grupo: 'manual', soloAdmin: false, titulo: 'Manual completo del panel', resumen: 'Pantalla por pantalla: qué hay, qué hace cada botón y qué ve cada rol.', bloques: manualCompleto.bloquesPara(rol) };
}
module.exports = { ARTICULOS, REVISION_META, articulosPara, articulo, instrucciones, instruccionesEnBloques, interpretar, textoConversacion, articuloManualCompleto };
