/*
 * manual-completo.js — Manual completo de uso del panel (1.5.3)
 * -------------------------------------------------------------
 *  Pantalla por pantalla: qué hay, qué hace cada botón y qué ve cada rol. Lo usa el asistente
 *  del Centro de ayuda para explicar cualquier detalle del panel, y se muestra en «Manual y guías»
 *  como «Manual completo». Las secciones con soloAdmin: true no se muestran a los asesores.
 *
 *  Cuando cambie una pantalla, actualizar acá su sección.
 */
'use strict';

const SECCIONES = [
  {
    id: 'menu', modulo: 'ayuda', titulo: 'El menú y la navegación', soloAdmin: false, texto: [
      'El menú de la izquierda tiene cinco grupos, y cada uno se abre o se cierra tocando su nombre (el panel recuerda cómo quedó). «Ventas»: Leads, Tareas y, para administradores, Reportes y Proceso de ventas. «Atención»: Chats por responder (con el número de chats que esperan a una persona), Conversaciones y Chats respondidos. «Verde»: Comportamiento del bot (solo administradores). «Sistema»: Usuarios, Consumo de IA, Registro de accesos y Respaldos (solo administradores). «Ayuda»: Centro de ayuda.',
      'El botón con el ícono de panel, arriba a la derecha del logo, colapsa el menú para dejarlo solo con íconos; en el celular el menú se abre y se cierra con ese mismo botón. Al pie del menú está el estado de WhatsApp («WhatsApp conectado»), el enlace «Ver estado de conexión» (solo administradores) y el interruptor de modo claro u oscuro (ícono de sol o luna), que se recuerda en cada equipo.',
      'Arriba a la derecha de cada pantalla está el estado de WhatsApp («Conectado» o el aviso correspondiente) y las iniciales del usuario: al tocarlas se ven el nombre, el rol y el botón «Cerrar sesión». La contraseña se cambia pidiéndole a un administrador que la restablezca.'
    ]
  },
  {
    id: 'ingreso', modulo: 'ayuda', titulo: 'Ingreso, verificación en 2 pasos y contraseña', soloAdmin: false, texto: [
      'Se ingresa con el usuario y la contraseña que creó el administrador. La primera vez la contraseña es temporal y el panel pide crear una propia. Después de la contraseña, siempre se pide la verificación en 2 pasos: un código de 6 dígitos de la app autenticadora del celular (Google Authenticator o Microsoft Authenticator). La primera vez el panel muestra un código QR para agregar la cuenta en la app, o una clave para escribir a mano, y después entrega 10 códigos de recuperación que hay que guardar: cada uno sirve una sola vez para entrar si no se tiene el celular.',
      'Después de 5 intentos fallidos, el ingreso se bloquea 15 minutos. Si alguien pierde el celular, un administrador le restablece la verificación desde Usuarios › Editar y la configura de nuevo en su próximo ingreso. La sesión dura 8 horas sin uso y como máximo 7 días; al vencer, el panel vuelve a pedir el ingreso donde se estaba.'
    ]
  },
  {
    id: 'leads', modulo: 'ventas', titulo: 'Ventas › Leads', soloAdmin: false, texto: [
      'Muestra todas las conversaciones de los últimos 30 días clasificadas por la IA y ordenadas por prioridad: primero las de prioridad alta y, dentro de cada nivel, la que más espera. Arriba, los filtros: Etapa (Nuevo, Con Verde, Derivado, En atención, Presupuesto enviado, Esperando al cliente, Sin respuesta o Cerrado), Tipo (Reparación, Compra, Garantía, Consulta general, Otro), Vendedor y un buscador por cliente, producto o número. Debajo, el conteo por prioridad y cuántas conversaciones están sin clasificar todavía o cerradas.',
      'Cada fila tiene: prioridad (punto rojo = alta, ámbar = media, gris = normal), cliente con su número, tipo y producto, etapa, espera (desde el último mensaje del cliente, o desde el último mensaje nuestro cuando se espera al cliente), vendedor y la traba con la frase textual del cliente entre comillas. En el celular cada lead es una tarjeta. Al tocar un lead se abre el chat con la franja «Lead» arriba.',
      'La IA clasifica cada conversación 10 minutos después del último mensaje: tipo, producto, intención de compra (alta, media o baja), si ya se dio un presupuesto, la traba (precio, demora, desconfianza, distancia, lo piensa u otra, con la frase textual), un resumen y el próximo paso sugerido. La etapa y la prioridad no las decide la IA: salen de reglas. Prioridad alta: reclamos de garantía, compras con intención alta y chats derivados sin respuesta hace más de 2 horas. Media: intención alta o media, derivados recientes, presupuestos enviados y chats esperando al cliente. Normal: el resto.'
    ]
  },
  {
    id: 'franja-lead', modulo: 'ventas', titulo: 'La franja «Lead» dentro del chat', soloAdmin: false, texto: [
      'Al abrir un chat, arriba de los mensajes aparece la franja «Lead» con tres líneas. Primera: prioridad, tipo y producto, etapa, intención y el enlace «Corregir», que abre un formulario para cambiar el tipo, el producto, la intención y la traba; lo corregido queda fijo aunque la IA vuelva a clasificar. Si todavía no está clasificado, el enlace se llama «Clasificar a mano». Segunda: resumen, próximo paso sugerido y traba con la frase textual.',
      'Tercera: «Vendedor» (quien respondió último; «Asignar» abre una lista de usuarios del panel para elegir a otro o dejarlo sin asignar), la tarea pendiente con su vencimiento y el enlace «Hecho», el enlace «Cerrar lead» y «Pedir calificación», que le manda al cliente la pregunta «¿Cómo fue la atención?» con tres botones (Muy buena, Buena, Mala); cuando el cliente responde, la calificación se ve en esa misma línea. Si la IA detecta que el cliente compró o desistió, debajo aparece su propuesta («La IA propone cerrar este lead como ganado/perdido») con los botones «Confirmar» y «No»: nada se cierra sin la persona. Con «No», la IA no insiste con esos mismos mensajes.',
      '«Cerrar lead» abre un formulario: resultado Ganado o Perdido; si es perdido, el motivo (Precio, Demora, Desconfianza, Distancia, Lo piensa, Compró en otro lado u Otro) y una nota opcional. Al cerrar, queda anotado en el chat como mensaje interno, el lead sale de la lista de Leads (se ve con el filtro «Cerrado»), su tarea desaparece y, si el chat estaba en «Chats por responder», se marca como atendido con el motivo «Lead cerrado». Un lead cerrado muestra el resultado, el motivo, quién lo cerró y cuándo, y el enlace «Reabrir».'
    ]
  },
  {
    id: 'tareas', modulo: 'ventas', titulo: 'Ventas › Tareas', soloAdmin: false, texto: [
      'Lista lo que tiene que hacer cada vendedor, en tres grupos: Vencidas, Para hoy y Próximas. Cada tarea muestra la prioridad y el cliente, la etapa, la acción a hacer, cuándo vence o hace cuánto venció, y el vendedor. «Abrir chat» abre la conversación; «Hecho» marca la tarea como hecha. El asesor ve solo sus tareas; el administrador ve todas y tiene un filtro por vendedor. El número junto a «Tareas» en el menú es la cantidad de tareas vencidas.',
      'Las tareas nacen solas: cada etapa del proceso de ventas tiene una próxima acción y un plazo, y cuando un lead entra en la etapa la tarea empieza a correr. Con los valores iniciales: Derivado y En atención, responder al cliente en 2 horas; Presupuesto enviado, hacer seguimiento a las 24 horas; Esperando al cliente, volver a contactar a las 48 horas; Sin respuesta, último intento o cerrar como perdido a las 72 horas. Nuevo, Con Verde y Cerrado no tienen tarea.',
      '«Hecho» abre un formulario con una nota corta opcional (por ejemplo, «llamé, no atendió») y cuándo volver a ver el lead: mañana a las 10:00, en 2 días, en una semana o sin seguimiento. El seguimiento queda como nueva tarea a las 10:00 del día elegido y la nota se anota en el chat como mensaje interno. Si el cliente vuelve a escribir, la tarea de la etapa nueva reemplaza al seguimiento. Las tareas no mandan mensajes a los clientes: son recordatorios para el equipo. Para contactar a un cliente que no escribió en las últimas 24 horas, hay que llamarlo o escribirle desde el celular de la tienda.'
    ]
  },
  {
    id: 'reportes', modulo: 'reportes', titulo: 'Ventas › Reportes (administradores)', soloAdmin: true, texto: [
      'El reporte semanal de atención y ventas. A la izquierda, la lista de semanas y los botones «Generar ahora (semana en curso)» y, si falta, «Generar la semana anterior»; los lunes a las 07:00 se arma solo con la semana anterior y a las 07:05 avisa por WhatsApp a los números de «Avisos › Reporte semanal». A la derecha, el reporte en cinco secciones: 1) Atención del equipo, una tarjeta por vendedor con chats atendidos, primera respuesta (mediana y máxima), respuestas de más de 2 horas y clientes colgados (cada uno es un botón que abre el chat), tareas hechas o vencidas y la calificación de los clientes (Muy buena, Buena, Mala) con cuántos respondieron; 2) Lo más pedido, con barras; 3) Por qué no compran, cada traba con las frases textuales (cada frase abre la conversación en ese mensaje); 4) Resultados: leads nuevos, ganados, perdidos con motivo y sin cerrar, y cuántas conversaciones resolvió Verde solo, cuántas se derivaron y cuántas atendió el equipo; 5) Evaluación de la atención por la IA: estrellas por vendedor, qué hace bien, qué mejorar y ejemplos citados que abren el chat, más los temas de la semana y tres puntos para la reunión. «Volver a armar» rehace el reporte y «Repetir la evaluación» vuelve a pedir solo la parte de la IA.'
    ]
  },
  {
    id: 'proceso', modulo: 'sistema', titulo: 'Ventas › Proceso de ventas (administradores)', soloAdmin: true, texto: [
      'Una tabla con las cinco etapas que tienen tarea (Derivado, En atención, Presupuesto enviado, Esperando al cliente y Sin respuesta). Para cada una: la próxima acción (texto de hasta 80 caracteres), el plazo en horas (de 1 a 720) y la casilla «Aviso al celular», que manda un aviso al equipo cuando la tarea vence, por el mismo sistema que los avisos de chats por responder. «Guardar cambios» aplica los valores a las tareas desde ese momento; una tarea ya vencida no se reabre por cambiar el plazo. Arriba de la tabla, la casilla «Pedir la calificación al cliente al marcar un chat atendido o cerrar un lead» activa la encuesta automática: Verde manda la pregunta con tres botones, solo dentro de las 24 horas del último mensaje del cliente y como máximo una vez cada 30 días por cliente; la respuesta queda en el chat, en la franja «Lead» y en el reporte semanal.'
    ]
  },
  {
    id: 'chats-por-responder', modulo: 'atencion', titulo: 'Chats por responder', soloAdmin: false, texto: [
      'Lista los chats que Verde derivó a una persona del equipo: porque el cliente pidió un precio exacto, porque hay un reclamo de garantía, porque envió un archivo para revisar, porque alguien del equipo había respondido y el cliente volvió a escribir sin que nadie contestara en 5 minutos, o porque Verde está apagado en ese chat. Van ordenados por la prioridad del lead (alta primero) y, dentro de cada nivel, el más viejo primero. Cada fila muestra el cliente, el último mensaje y el tiempo de espera, en rojo cuando pasa de 5 minutos. El buscador filtra por nombre, número o mensaje; el botón de recargar actualiza la lista y la campana (solo administradores) abre «Avisos a celulares del equipo».',
      'Mientras un chat está por responder, Verde sigue conversando con el cliente sin dar precios, salvo que esté en pausa porque alguien del equipo ya respondió. Al tocar un chat se abre la conversación. «Marcar atendido» lo saca de la lista cuando se resolvió por otro lado: por llamada, en el local, porque ya no necesita atención u otro motivo (con detalle). Los chats con reclamo de garantía o consulta de reparación o compra muestran una etiqueta y una ficha con los datos que juntó Verde («Ver ficha»).'
    ]
  },
  {
    id: 'chat-abierto', modulo: 'atencion', titulo: 'Un chat abierto: encabezado, interruptor y franjas', soloAdmin: false, texto: [
      'El encabezado muestra el cliente con su número y las etiquetas del chat. El interruptor de Verde: encendido («Verde», en verde) significa que Verde atiende este chat; al tocarlo pide confirmar y lo apaga para ese chat (gris: Verde no responde hasta que se lo vuelva a encender tocándolo otra vez). Cuando alguien del equipo respondió, el interruptor muestra «Verde en pausa» (ámbar): Verde no contesta durante 12 horas, y al lado aparece el botón «Devolver a Verde», que termina la pausa; si el cliente dejó una consulta sin responder, Verde la contesta enseguida. Ese botón aparece también cuando el chat está por responder (en la computadora junto al interruptor; en el celular, en la franja roja). «Marcar atendido» saca el chat de la lista, pero no termina la pausa. El botón redondo con el ícono de ayuda es «Ayuda con este chat»: abre el Centro de ayuda con la conversación adjunta, para pedirle al asistente qué responder. «Marcar atendido» aparece cuando el chat está por responder.',
      'Debajo del encabezado puede haber una franja de estado: roja «Por responder» (dice si Verde sigue conversando o si está en pausa y hasta cuándo), azul «Archivo para revisar», «Reclamo de garantía» con el botón «Ver ficha», o gris «Verde apagado en este chat» con quién lo apagó y cuándo. Luego viene la franja «Lead» (ver su sección). Los mensajes del cliente van a la izquierda; los de Verde y del equipo a la derecha, con el nombre de quien escribió. Los mensajes internos (por ejemplo, «Lead cerrado…» o «Tarea hecha…») aparecen centrados en ámbar y el cliente no los ve.'
    ]
  },
  {
    id: 'escribir', modulo: 'atencion', titulo: 'Un chat abierto: escribir, adjuntar y corregir con la IA', soloAdmin: false, texto: [
      'La caja de mensaje de abajo escribe al cliente por WhatsApp. En la computadora, Enter envía y Shift + Enter hace un salto de línea; en el celular se envía con el botón. Cada mensaje sale con la firma del usuario («- Nombre -»), que se ve en el texto de la caja. Al responder desde el panel, Verde hace su pausa de 12 horas en ese chat. WhatsApp solo permite responder desde el panel dentro de las 24 horas del último mensaje del cliente; pasado ese plazo, la caja lo avisa y hay que retomar desde el celular de la tienda. Lo que se escribe y no se envía queda como borrador de ese chat.',
      'El botón del clip adjunta un archivo para el cliente (PDF, JPG o PNG); antes de enviarlo se ve el nombre y se puede quitar. El botón con las líneas y la estrella es «Sugerir respuesta»: la IA arma el mensaje del asesor con la ficha, el lead y los últimos mensajes, siguiendo una estructura fija (saludo con nombre, qué entendimos, pregunta solo si falta un dato, qué va a pasar y cuándo, el próximo paso concreto y un cierre), en español neutro de usted; lo que no sabe lo deja entre corchetes, como [precio], para que el asesor lo complete antes de enviar. El botón con el ícono de estrellas es la corrección con IA: pide el tono (rioplatense, neutro o formal, con las teclas 1, 2 y 3) y reemplaza el mensaje por una versión corregida (ortografía, claridad), sin agregar datos ni tocar la firma; «Deshacer» recupera el original. Hay un límite de 30 correcciones por hora por usuario. Si el cliente envió un archivo, aparece en el chat y se puede abrir.'
    ]
  },
  {
    id: 'conversaciones', modulo: 'atencion', titulo: 'Conversaciones', soloAdmin: false, texto: [
      'Todas las conversaciones de los últimos 3 meses, con la última de cada cliente arriba. El buscador encuentra por nombre, número o texto de un mensaje. Los filtros: Todas, Verde atendiendo, Atiende una persona (Verde en pausa), Verde apagado y Por responder, con la cantidad de cada uno. Al tocar una conversación se abre a la derecha con la lista a la vista (en el celular ocupa la pantalla y el botón «Volver» regresa a la lista). Las conversaciones se guardan 3 meses y después se borran.'
    ]
  },
  {
    id: 'chats-respondidos', modulo: 'atencion', titulo: 'Chats respondidos', soloAdmin: false, texto: [
      'El historial de los chats que ya se atendieron: cuándo se derivaron, cuánto esperaron y cómo se cerraron (respondidos desde el panel o desde el celular de la tienda, marcados como atendidos con su motivo, o cerrados por un lead cerrado). Los filtros muestran todos, los respondidos por WhatsApp, los marcados a mano y los clientes que volvieron a escribir después. Al tocar uno se abre la conversación.'
    ]
  },
  {
    id: 'comportamiento-a-g', modulo: 'verde', titulo: 'Comportamiento del bot: secciones A a G (administradores)', soloAdmin: true, texto: [
      'Es la configuración de Verde. Cada sección se guarda por separado con su botón «Guardar», y arriba se puede ver la vista previa de las instrucciones completas que recibe la IA. A, Identidad del bot: nombre de Verde, rol, empresa y presentación (lo primero que dice, una sola vez por conversación). B, Personalidad y tono: cómo habla. C, Ventajas / diferenciales: lo que destaca de la tienda. D, Pasos del proceso de venta: las etapas que Verde sigue para vender, con ejemplos, activables una por una. E, Manejo de objeciones: cada objeción típica («está caro», «lo pienso») con su respuesta. F, Reglas de oro: lo que Verde nunca hace (dar precios exactos, prometer plazos) y lo que siempre hace. G, Frases clave: frases que debe usar tal cual. En estas secciones se configura también qué hace Verde cuando un cliente envía un archivo.'
    ]
  },
  {
    id: 'comportamiento-h', modulo: 'verde', titulo: 'Comportamiento del bot: sección H, parámetros técnicos (administradores)', soloAdmin: true, texto: [
      'Modelo de IA de Verde (Claude Sonnet 5.5 recomendada; Opus 5.5 y Fable 5.1 son más capaces y más caras), tokens máximos por respuesta, memoria (cuántos mensajes recuerda) y tiempo de espera: los segundos que Verde espera desde el último mensaje del cliente antes de responder, para contestar todo junto si el cliente escribe en varios mensajes (hasta 60; con 0 responde de inmediato; no se aplica en Probar a Verde).',
      'En la misma sección: «Clasificación de leads», el modelo que clasifica las conversaciones (Haiku 5.5 recomendada por económica), y «Asistente IA (Centro de ayuda)», con su modelo y su esfuerzo (cuánto razona antes de responder: bajo, medio, alto o máximo). Los gastos de cada uno se ven por separado en Consumo de IA.'
    ]
  },
  {
    id: 'comportamiento-i-k', modulo: 'verde', titulo: 'Comportamiento del bot: secciones I, J y K (administradores)', soloAdmin: true, texto: [
      'I, Reclamos y garantía: requisitos indispensables (orden de trabajo o boleta, reclamo de quien ingresó el equipo, plazo), qué cubre y qué no, sugerencias por síntoma (por ejemplo, reinicio forzado si falla el touch, preguntar por el cargador si no carga) y los datos que Verde junta para la ficha del reclamo. Verde nunca confirma ni rechaza una garantía: arma la ficha y deriva.',
      'J, Fichas de consulta: los datos que Verde pide antes de derivar una consulta de reparación (hasta 7) o de compra (hasta 6), para que el asesor reciba la ficha completa. K, Biblioteca de recursos: archivos (PDF o imágenes) que Verde puede enviar, con un código, un nombre, «Cuándo usarlo» y la casilla «Puede enviarlo sin que lo pidan». En «Probar a Verde» no se envían archivos: figura entre paréntesis que lo enviaría.'
    ]
  },
  {
    id: 'probar-y-conexion', modulo: 'verde', titulo: 'Probar a Verde y estado de conexión (administradores)', soloAdmin: true, texto: [
      '«Probar a Verde», dentro de Comportamiento del bot, es un simulador: se escribe como un cliente y Verde responde con la configuración actual, sin WhatsApp. «Reiniciar charla» borra la memoria del simulador para empezar un caso nuevo. Las consultas del simulador se cuentan en Consumo de IA como «Pruebas en el panel».',
      '«Ver estado de conexión» (al pie del menú) muestra la conexión con WhatsApp a través de 360dialog: si el número está conectado, la clave configurada y el resultado de la última prueba. «Avisos a celulares del equipo» (se abre con la campana de Chats por responder) tiene los números del equipo que reciben los avisos, el nombre y el idioma de la plantilla aprobada por Meta para avisar fuera de las 24 horas, y qué avisos se mandan: chats derivados, archivos para revisar, clientes que vuelven a escribir y tareas vencidas.'
    ]
  },
  {
    id: 'usuarios', modulo: 'sistema', titulo: 'Sistema › Usuarios (administradores)', soloAdmin: true, texto: [
      'La lista de personas que entran al panel: nombre, usuario, tipo (Administrador: todo el panel, incluida la gestión de usuarios; Integrante del equipo: solo lo que se le marca en «Accesos») con el resumen de accesos debajo (por ejemplo «Atención, Ventas y Centro de ayuda» o «Solo Centro de ayuda»), firma en WhatsApp, estado (Activo o Inactivo, y debajo si tiene la verificación en 2 pasos activa o pendiente) y último ingreso. «Nuevo usuario» crea uno y muestra su contraseña temporal una sola vez. En «Nuevo usuario» y «Editar», para un integrante se marcan los accesos: Atención (chats por responder, conversaciones, chats respondidos y responder desde el panel), Ventas (leads y tareas), Reportes semanales y Verde (comportamiento del bot y biblioteca de conocimiento; permite cambiar cómo responde Verde). El Centro de ayuda siempre está incluido; Sistema (usuarios, consumo, registro de accesos, respaldos, avisos, proceso de ventas) es solo para administradores. Los atajos «Solo formación», «Asesor de ventas» y «Encargado» marcan combinaciones habituales. El menú, la pantalla de inicio, el manual del panel y el Instructor se adaptan a esos accesos, y el servidor rechaza lo que no esté marcado. La casilla «Puede entrenar al cerebro (modo Entrenamiento)» habilita a esa persona para que la IA la entreviste sobre su área y genere el borrador del manual (los administradores siempre pueden). Debajo de cada persona se ve su actividad de formación: consultas al Instructor, entrevistas, borradores generados y última actividad. En cada fila: «Editar» (nombre, rol, firma y, si corresponde, «Restablecer verificación en 2 pasos», que cierra sus sesiones), «Restablecer contraseña» (nueva contraseña temporal) y «Desactivar» (no se elimina: queda el historial de lo que hizo). Un usuario inactivo no puede entrar.'
    ]
  },
  {
    id: 'consumo', modulo: 'sistema', titulo: 'Sistema › Consumo de IA (administradores)', soloAdmin: true, texto: [
      'Cuánto gastó Verde en IA: consultas y costo estimado del mes (o de un período elegido), separados por origen (WhatsApp, Pruebas en el panel, Ayuda, Corrección y Clasificación) y por modelo, con el costo por día y los precios de referencia de cada modelo. El costo es una estimación con los precios publicados por Anthropic; la factura real está en la Consola de Anthropic, donde también se cargan los créditos.'
    ]
  },
  {
    id: 'accesos-respaldos', modulo: 'sistema', titulo: 'Sistema › Registro de accesos y Respaldos (administradores)', soloAdmin: true, texto: [
      'Registro de accesos: cada ingreso correcto, intento fallido, bloqueo, cierre de sesión, activación o restablecimiento de la verificación en 2 pasos y descarga de respaldos, con fecha, usuario, dirección IP y dispositivo. Filtros por usuario, evento y período (7, 30 o 90 días); se conserva 90 días.',
      'Respaldos: todas las noches a las 03:30 Verde guarda una copia cifrada de sus datos (configuración, conversaciones, usuarios, consumo, archivos y biblioteca; las claves del archivo .env no se incluyen). Se guardan los últimos 14 en el servidor. «Hacer respaldo ahora» crea uno manual. «Descargar» baja el archivo cifrado para guardarlo fuera del servidor; cada descarga queda en el registro de accesos. Si pasan 7 días sin descargar uno, el panel avisa. Para abrir o restaurar un respaldo hace falta la clave de cifrado, que está en el servidor y en el gestor de contraseñas del administrador.'
    ]
  },
  {
    id: 'biblioteca', modulo: 'verde', titulo: 'Verde › Biblioteca de conocimiento (administradores)', soloAdmin: true, texto: [
      'La lista de manuales que usa el Instructor del Centro de ayuda. Arriba: cuántos manuales están activos y el tamaño de la base en páginas (hasta 150, «bien»). Los tres manuales del sistema (Manual completo del panel, Configuración de Verde y Guías de Meta) siempre están aprobados y activos: solo se pueden «Ver». Los manuales propios tienen estado Borrador o Aprobado, un interruptor Activo (solo para los aprobados), fecha y quién lo cargó, y las acciones «Ver» (texto con índice y descarga del original), «Editar», «Aprobar» (si es borrador) y «Eliminar».',
      'Un manual generado desde una entrevista muestra «entrevista de [nombre] · fecha» y se revisa, edita y aprueba igual que los demás. Si el área ya tenía un manual aprobado, el borrador aparece como «Actualización de «…»» con la etiqueta «actualización»: «Aprobar» reemplaza el texto del manual vigente (que conserva su nombre, su estado y su interruptor) y la versión anterior queda en la lista como «… · versión anterior (fecha)», aprobada pero inactiva, para volver atrás activándola si hiciera falta. «Nuevo manual» abre el cajón con nombre, área (de la lista de áreas previstas), descripción de una línea y el contenido: subir un PDF, .txt o .md (del PDF se extrae el texto y se muestra para revisarlo; si el PDF es escaneado, avisa y pide el texto pegado) o pegar el texto. «Áreas y responsables» edita las áreas previstas, el responsable de cada una (elegido entre los usuarios del panel o escrito) y la casilla «Solo administradores», que reserva el área: un integrante no puede entrenarla («Reglamento interno» viene reservada); las áreas sin manual aprobado se listan solas para el Instructor, que remite a su responsable. En «Ver», el cuadro «Buscar en este manual» resalta las coincidencias y Enter salta a la siguiente. Debajo de la tabla, «Preguntas que el equipo hizo y no están documentadas»: cada vez que el Instructor responde que un área no tiene manual, la pregunta queda anotada con cuántas veces se repitió y quién la hizo; «Quitar» la saca de la lista.'
    ]
  },
  {
    id: 'centro-de-ayuda', modulo: 'ayuda', titulo: 'Centro de ayuda', soloAdmin: false, texto: [
      'Es el Asistente IA. Quien tiene habilitado el modo Entrenamiento ve debajo del título el selector «Modo: Instructor | Entrenamiento» (el modo activo en verde): en Entrenamiento elige un área y «Empezar la entrevista»; el Entrevistador IA hace una pregunta por vez, resume cada 5 a 8, acepta imágenes de ejemplo (el clip o Ctrl + V; describe qué muestran y esa descripción entra al borrador) y, a partir de 6 respuestas, «Terminar y generar el borrador» crea el «Manual de [área]» en la Biblioteca de conocimiento como borrador (los no administradores ven «Dirección lo va a revisar»). En modo Instructor: responde solo desde los manuales de la biblioteca de conocimiento (los del sistema y los aprobados por el administrador), cita de qué manual y sección sale cada respuesta, y si un área no tiene manual lo dice y remite a su responsable en lugar de inventar. Responde cómo se usa cada parte del panel, qué decirle a un cliente, cómo armar un presupuesto o cómo tratar un reclamo; cuando explica un procedimiento, cierra con un párrafo «Para aprender» con el porqué, para capacitar a las personas nuevas. Mientras la conversación está vacía, los accesos rápidos hacen preguntas frecuentes con un toque. Cada respuesta lleva arriba «Asistente IA» y el botón «Escuchar». Las respuestas que incluyen textos para el cliente los muestran listos para enviar, con «Copiar» y «Usar en el chat». Cuando se pregunta cómo hacer algo, el asistente responde con pasos numerados, los nombres de los botones en negrita y el resultado esperado; cuando hay varias cosas que explicar (por ejemplo, varios botones en una captura), las enumera una por una.',
      'Cada usuario tiene sus propias conversaciones con el asistente, guardadas: al volver al Centro de ayuda sigue la última. «Conversaciones» lista las anteriores por título y fecha para reabrirlas, y «Nueva conversación» empieza otra. El botón del clip adjunta una imagen (JPG o PNG, hasta 5 MB), por ejemplo una captura de pantalla, para preguntar qué es algo o qué hacer con ello; también se puede pegar una captura directamente en la caja de la pregunta con Ctrl + V (en Windows, Shift + Windows + S copia un recorte de la pantalla). Cada respuesta tiene el botón «Escuchar», que la lee en voz alta con la voz del propio equipo o celular, sin costo; vuelve a tocarse para detenerla. «Ayuda con este chat», desde cualquier conversación de WhatsApp, adjunta los últimos 20 mensajes para que el asistente aconseje sobre ese cliente; «Volver al chat» regresa. «Manual y guías» abre el cajón con el manual por temas, este manual completo y las guías de Meta. El asistente responde solo sobre el trabajo de la empresa y el panel; hay un límite de preguntas por hora.'
    ]
  }
];

// 1.6.3: las secciones se filtran por los accesos del usuario (sin accesos informados: lo que veía un asesor)
function seccionesPara(rol, accesos) {
  return SECCIONES.filter(s => {
    if (rol === 'admin') return true;
    const mod = s.modulo || (s.soloAdmin ? 'sistema' : 'ayuda');
    if (mod === 'ayuda') return true;
    if (!accesos) return !s.soloAdmin && ['atencion', 'ventas'].includes(mod);
    return !!accesos[mod];
  });
}
// Texto para las instrucciones del asistente.
function textoPara(rol, accesos) { return seccionesPara(rol, accesos).map(s => '## ' + s.titulo + '\n' + s.texto.join('\n')).join('\n\n'); }
// Bloques para mostrarlo en «Manual y guías».
function bloquesPara(rol, accesos) {
  const out = [];
  for (const s of seccionesPara(rol, accesos)) { out.push({ tipo: 'h', texto: s.titulo }); for (const p of s.texto) out.push({ tipo: 'p', texto: p }); }
  return out;
}

module.exports = { SECCIONES, seccionesPara, textoPara, bloquesPara };
