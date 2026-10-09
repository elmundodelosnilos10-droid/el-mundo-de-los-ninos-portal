# Guía rápida del portal escolar

Esta guía corresponde a las funciones implementadas en la versión actual. Dirección entrega las cuentas; no hay registro público. Cada persona entra con correo y contraseña desde **Iniciar sesión**.

**Aviso de operación:** Supabase Auth está activo para el inicio de sesión y los archivos nuevos se guardan en Supabase Storage. Las cuentas escolares, roles y registros académicos siguen en D1, y los archivos previos permanecen en R2; la migración de datos todavía no está completa. El acceso de Dirección y las invitaciones deben probarse en el sitio publicado antes de incorporar expedientes reales.

## Dirección

1. En **Grupos**, crea primero el ciclo escolar y después los grupos de lactantes, maternal, prekínder o preescolar.
2. En **Cuentas**, escribe el correo de cada docente y tutor y envía la invitación. La persona abre el correo y crea su contraseña privada desde el enlace de la escuela.
3. Cada persona entra con su correo y contraseña. En **Mi cuenta** puede cambiarla; el cambio pide la contraseña actual y cierra las demás sesiones.
4. En **Alumnos**, inscribe al niño en su grupo. Usa **Editar datos básicos** para corregir nombre, apellidos o fecha de nacimiento; los cambios quedan registrados en auditoría. Para dar de baja a un alumno, usa **Dar de baja**; se conserva su expediente, pero la familia y las maestras pierden el acceso operativo. Para reactivarlo, selecciona el grupo actual y el sistema crea una nueva inscripción sin borrar el historial.
5. Publica fechas generales en **Calendario** y comunicados escolares en **Comunicados**.
6. Revisa los registros reales del panel principal. Los grupos, alumnos y asistencias comienzan vacíos.
7. En **Cuentas**, dirección puede corregir el nombre o correo de una persona, o suspender/reactivar su acceso. Suspender cierra sus sesiones y conserva sus registros escolares. No se puede administrar la cuenta propia ni la de superadministración.

## Superadministración

- **Estado del sistema** muestra si hay configuración de recuperación de cuentas, el modo actual de Meet, el estado de grabaciones y los pendientes de respaldos y privacidad. Superadministración también puede publicar una nueva versión del aviso escolar después de que la escuela la apruebe. La publicación es pública, conserva la versión anterior y deja una entrada de auditoría; no se puede editar ni retirar desde el formulario. Una configuración presente no equivale a un envío de correo o a una restauración probados.
- **Aviso de privacidad** en el inicio de sesión abre la página pública. Antes de publicar, muestra el estado pendiente. No ingresar datos escolares reales hasta que la escuela complete los campos con el texto aprobado.
- **Auditoría** permite consultar las 100 acciones más recientes, sin contenido de mensajes ni nombres de alumnos.

## Docentes

- Dirección debe crear la cuenta y asignar al menos un grupo.
- **Clases virtuales**: crear la reunión en Google Meet y publicar aquí su enlace, grupo, hora y maestra. El portal no crea la reunión por sí solo. Las grabaciones están desactivadas.
- **Tareas y entregas**: publica instrucciones y fecha, y adjunta uno o varios PDF, imágenes o audios (hasta 10 MB por archivo). También puedes agregar materiales a una tarea publicada. Después abre las entregas para leer evidencias, registrar una observación y marcar su estado. En prekínder y preescolar puedes agregar una evaluación formativa (“Logrado”, “En proceso” o “Con acompañamiento”), sin calificación numérica. Para lactantes y maternal se usan solo observaciones cualitativas.
- **Biblioteca**: comparte por grupo PDF, imágenes y audios MP3, OGG o WAV. El sistema rechaza tipos no permitidos y archivos grandes.
- **Asistencia**: selecciona grupo y fecha, marca un estado por alumno y guarda. Para descargar el historial, elige un periodo de hasta 366 días y selecciona Excel (.xlsx), PDF o CSV.
- **Seguimiento**: registra observaciones por área y decide si cada una puede verla la familia.
- **Comunicación**: inicia un chat únicamente con las familias vinculadas a tus grupos.
- En **Comunicación**, adjunta un PDF o una imagen JPG, PNG o WebP de hasta 10 MB. Solo los participantes autorizados de la conversación pueden descargar el archivo.
- **Auditoría**: dirección y superadministración pueden consultar las 100 acciones más recientes, sin contenido de mensajes ni nombres de alumnos.

## Familias

- Dirección vincula a los niños con la cuenta. La familia ve solo los niños relacionados con su usuario.
- En **Tareas y entregas**, selecciona al niño y adjunta PDF o imagen como evidencia.
- Abre los PDF, imágenes y audios que la maestra adjunte a cada tarea desde el enlace **Descargar material**.
- En **Comunicación**, las familias pueden adjuntar un PDF o una imagen JPG, PNG o WebP de hasta 10 MB en el chat con la maestra de su hijo.
- Cuando el docente revise una entrega, la familia recibe un aviso dentro del portal y puede consultar la evaluación formativa u observación.
- Descarga guías y escucha audios desde **Biblioteca**.
- Consulta clases de Meet, calendario, asistencia, observaciones visibles y comunicados.
- En **Privacidad**, envía a Dirección una solicitud de acceso, corrección o eliminación de información de un hijo vinculado; consulta el estado y la nota de respuesta. Evita adjuntar documentos o contraseñas. Dirección revisará la petición conforme al proceso de la escuela.
- La bandeja **Avisos** muestra notificaciones del usuario actual por nuevos mensajes, comunicados, tareas, clases, eventos del calendario, observaciones visibles y actividades revisadas. Se actualiza periódicamente mientras el portal está abierto.

## Límites actuales

- No hay registro de alumno para iniciar sesión; el acceso infantil supervisado se implementará si la escuela lo necesita.
- Los mensajes muestran acuses de lectura y pendientes por conversación. Admiten un PDF o imagen por mensaje (hasta 10 MB); se actualizan por consulta periódica, no por WebSocket o notificación push. Si falla la conexión, el chat muestra que está reintentando, aumenta la pausa entre intentos hasta un minuto y sincroniza al volver la conexión o al regresar a la pestaña.
- Las videollamadas se crean fuera del portal; el enlace queda visible solo para las cuentas autorizadas del grupo.
- Las invitaciones y la recuperación de contraseña dependen de la configuración de correo y de las URL permitidas en Supabase. Hay que probar la recepción antes de invitar a toda la comunidad.
- No usar datos reales en pruebas. Activar grabaciones, recopilar fotos o abrir el acceso a familias requiere aprobación de dirección y controles de privacidad.
