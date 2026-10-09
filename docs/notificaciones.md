# Notificaciones escolares

El centro consulta `/api/notifications` con la sesión del navegador y muestra hasta los 100 avisos recientes que devuelve la API privada. Los permisos y el destinatario siguen verificándose en el servidor. No se almacenan avisos en almacenamiento local ni se utilizan enlaces públicos o claves del backend.

La actualización es por consultas periódicas: cada 30 segundos mientras la pestaña está visible y el navegador indica conexión, además de al abrir el panel o recuperar visibilidad/conexión. Las solicitudes se serializan y tienen un máximo de 20 segundos; los fallos de lectura espacian los siguientes intentos a 60 y luego 120 segundos. Estas consultas permanecen como respaldo aunque esté activa la conexión de cambios. No hay Web Push ni entrega inmediata garantizada.

Se distinguen carga, lista vacía confirmada y error. Los fallos de red, de servidor o de formato conservan la última lista válida. Una respuesta 401/403 limpia los avisos privados y pide volver a iniciar sesión. El botón **Actualizar avisos** permite consultar de nuevo.

Marcar como leído requiere una respuesta HTTP correcta y `{ "read": true }`. Solo esa confirmación cambia el indicador y permite navegar al destino interno del aviso; después se vuelve a consultar la lista. Un fallo o una cancelación no confirma la lectura. Las escrituras no se reintentan automáticamente: actualizar la lista permite comprobar si el servidor llegó a guardar la lectura antes de intentar de nuevo. Al ocultar la pestaña, perder conexión o desmontar el componente se cancelan las solicitudes y los temporizadores.

## Señales de actualización opcionales

`subscribeSchoolRealtime` comparte una suscripción por pestaña al flujo SSE autenticado del servidor. El navegador no recibe claves ni tokens de Supabase. Las señales solo invalidan la vista: al conectar o recibir un cambio relevante, la interfaz vuelve a consultar las APIs privadas existentes con sus permisos habituales. No utiliza datos de mensajes o avisos enviados dentro de una señal para construir contenido.

El centro de avisos responde a cambios de notificaciones. El chat se suscribe únicamente para cuentas con permiso docente o tutor; consulta la conversación activa si su identificador coincide y, para cambios de otras conversaciones, actualiza solo la lista autorizada. Las ráfagas se agrupan y se comparten las solicitudes de lista ya en curso. Los cambios de horario actualizan la página de forma agrupada, y reconectar recupera la información que pudo cambiar durante una desconexión.

La interfaz distingue conexión activa, conexión en curso, reconexión, acceso perdido y actualización periódica. Con Realtime desactivado o indisponible sigue usando los intervalos de respaldo: 30 segundos para avisos y 10 segundos para el chat abierto, con las pausas y el retroceso de reintentos correspondientes. Habilitar Realtime en producción requiere configuración del servidor; este cambio de interfaz no lo habilita.

Las lecturas de conversaciones, mensajes e historial y las confirmaciones de lectura tienen un límite de 20 segundos. Una señal de acceso perdido o un HTTP 401/403 cancela consultas, limpia la lista y los mensajes privados, y muestra opciones para volver a cargar la página o iniciar sesión. El historial anterior se vincula al identificador de la conversación que lo solicitó y se cancela al cambiar de chat; una respuesta tardía no puede mezclarse con otra conversación. Tras renovar la comprobación de permisos, una señal `all` vuelve a consultar avisos/chat y el horario mediante las mismas APIs autorizadas.
