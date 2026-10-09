# Puesta en marcha para dirección y docentes

**Actualizada: 9 de octubre de 2026.** La [guía rápida](manual-uso.md) explica cada sección a dirección, maestras y familias. Esta guía organiza la preparación y la rutina escolar.

Se conserva el hosting Vercel actual en el equipo **pandito**, por petición del usuario. El repositorio GitHub privado escolar ya está creado y verificado. No se necesita trasladar el hosting para presentar el portal.

## Preparar las cuentas y grupos

1. Superadministración comprueba el acceso administrativo al portal publicado y autoriza a las personas que administrarán dirección.
2. Dirección crea ciclo y grupos en **Grupos**, con etapa y fechas correctas.
3. Dirección invita a docentes y tutores desde **Cuentas**. Primero prueba una invitación y recuperación con un destinatario autorizado: que el correo llegue, que el enlace abra el portal y que la persona pueda crear su contraseña privada.
4. Dirección asigna las docentes a sus grupos; registra alumnos y vincula tutores desde el expediente. Revisa cuenta, relación familiar e inscripción activa antes de compartir información.
5. Cada docente y tutor entra con su cuenta propia y verifica que aparezcan únicamente los grupos o hijos autorizados.

La escuela administra nombre, rol y estado de la cuenta. Desactivar el perfil bloquea las solicitudes escolares posteriores y conserva el historial; no revoca por sí solo todos los tokens Auth. Cambiar el correo requiere coordinación técnica entre Auth y el perfil, como explica [Cuentas Supabase](cuentas-supabase.md).

## Preparar la clase

- Programa el calendario en hora de Ciudad de México. Las tareas con fecha límite también aparecen en agenda.
- Crea Google Meet fuera del portal; publica el enlace en **Clases virtuales** y comprueba la admisión con el organizador. Las grabaciones están apagadas.
- Publica instrucciones breves y recursos adecuados a la etapa. Biblioteca organiza guías, canciones, vocabulario y audios por grupo/categoría; permite buscar, previsualizar y descargar.
- Las cargas nuevas admiten hasta **4 MB por archivo**. Cuando la recepción segura no esté preparada, los controles aparecen desactivados; el servicio debe configurarse y probarse en el hosting publicado. El ensayo local real ya pasó y no sustituye esa operación.

En **Tareas y entregas**, consulta hasta 25 tareas por página; **Anterior** y **Siguiente** permiten recorrer las demás. Cada panel de entregas corresponde a la tarea indicada en su título. Si una consulta falla después de un guardado confirmado, conserva la confirmación y usa **Actualizar tareas** antes de volver a enviar.

## Durante y después

1. Registra asistencia por grupo/fecha y guarda. El portal no obtiene la asistencia automáticamente de Meet.
2. En **Revisar entregas**, consulta la nota y archivos autorizados; guarda observación y estado. Prekínder/preescolar admiten evaluación formativa; lactantes/maternal usan observaciones cualitativas.
3. En **Seguimiento**, registra hechos y avances, indicando qué puede ver la familia. No registres diagnósticos médicos o psicológicos.
4. En **Comunicados**, publica avisos y confirma lectura cuando corresponda. El chat privado de **Comunicación** está disponible para docentes y tutores vinculados; la administración sin esos roles conserva el formulario de horario y no accede automáticamente a conversaciones privadas.
5. Consulta **Avisos**. La conexión activa puede adelantar una actualización; las consultas periódicas siguen como respaldo. No se envía push ni correo por cada actividad.

## Asistencia y reportes

Las familias pueden enviar una justificación pendiente. Una docente asignada o dirección la acepta o rechaza con respuesta; aceptar actualiza la asistencia a falta justificada y conserva el motivo. El historial individual muestra los registros y el porcentaje. La fórmula actual suma presentes y retardos entre todos los registros; la falta justificada cuenta como ausencia. Dirección debe confirmar esa regla con su política.

Los reportes se descargan en Excel, PDF o CSV para periodos de hasta 366 días. Docentes consultan sus grupos; dirección puede seleccionar todos. Las correcciones y exportaciones dejan registro de auditoría.

## Privacidad, bajas y continuidad

Dirección debe revisar y aprobar aviso, representación familiar, autorizaciones, conservación de información y proceso de solicitudes. Superadministración publica una versión del aviso ya aprobada en **Estado del sistema**. **Autorizaciones** registra decisiones; **Solicitudes de privacidad** registra revisión y respuesta. El portal no sustituye esas decisiones escolares.

Las bajas conservan el historial. Reactivar un alumno requiere grupo activo. Planifica respaldo cifrado de datos y archivos, recuperación de identidades Auth y un ensayo de restauración en un destino separado. Define quién realiza ese trabajo y dónde conserva la frase de recuperación; nunca en esta guía ni en el repositorio.

El ingreso muestra **Preparando acceso…** unos instantes antes de habilitar los campos; después usa el correo y la contraseña propios.

## Si algo falla

- Sin hijo/grupo visible: dirección revisa vínculo, matrícula y asignación docente.
- Acceso rechazado: usa recuperación; si sigue fallando, dirección revisa perfil y rol. No envíes contraseñas por chat.
- Guardado o carga inciertos: vuelve a consultar lista/estado antes de repetir; conserva el mensaje de error y contacta a dirección.
- En Alumnos y Cuentas, un guardado confirmado conserva su mensaje aunque falle la actualización de la lista. Usa **Actualizar lista** en Cuentas o **Actualizar listado** en Alumnos para repetir la consulta; no vuelvas a dar de alta a la misma persona.
- Si la sesión o los permisos dejan de autorizar el directorio, sus registros se retiran de pantalla y los controles quedan bloqueados. Vuelve a entrar con la cuenta autorizada o contacta a dirección.
- Puedes cerrar el panel **Avisos** con **Escape**; el foco vuelve al botón Avisos.
- Archivo bloqueado: verifica tipo y límite; si el servicio está indisponible, no uses documentos del alumno en un servicio externo como alternativa.

## Evidencia y pendientes

El portal usa Vercel/Next.js y Supabase Auth/PostgreSQL/Storage; la rama D1/R2 se conserva para el destino anterior. El recorrido escolar local real pasó **149 solicitudes/45 comprobaciones**, incluyendo archivos privados, análisis real, revisión de tareas, asistencia, seguimiento, comunicados y aislamiento de dos familias. Un ensayo separado de restauración local pasó seis comprobaciones de cuentas, datos, archivos privados y acceso de dos familias. Estos resultados no acreditan correo, invitaciones, Google Meet ni operación/recuperación de producción. Las pruebas y pendientes vigentes están en [Estado de requisitos](estado-requisitos.md).

En el destino restaurado, **dos familias y una docente sintéticas** completaron otro ensayo de chat HTTP:26 comprobaciones funcionales PASS de mensajes, lecturas, avisos, persistencia e aislamiento. El primer informe conserva FAIL por un guard de limpieza que no admitía el avance de la fecha del perfil al iniciar sesión; la limpieza dirigida posterior pasó y conservó el destino original. No se repitieron envíos. Este resultado no acredita transporte Realtime ni chat de producción.
