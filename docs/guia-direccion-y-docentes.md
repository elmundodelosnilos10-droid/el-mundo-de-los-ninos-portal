# Guía de uso para dirección y docentes

## Antes de empezar

El portal guarda los registros escolares en la base de datos y los archivos en almacenamiento privado. La página de inicio de sesión está disponible públicamente, pero se necesita una cuenta escolar autorizada para acceder a las funciones. No compartas contraseñas por grupos ni registres expedientes reales mientras estén pendientes las revisiones de privacidad y operación indicadas en `auditoria-y-plan.md`.

La cuenta inicial de Dirección se invitó con el correo proporcionado por la escuela. Cuando se acepte la invitación y se verifique el acceso al sitio publicado, Dirección podrá enviar invitaciones a docentes y tutores desde **Cuentas de acceso**. Cada persona crea su propia contraseña desde el enlace que recibe. Si se necesita cambiar el correo de acceso, debe actualizarse de forma coordinada en Supabase Auth y en el perfil escolar; por ahora, solicita ese cambio a la administración técnica. Al desactivar una cuenta, se cierran sus sesiones y se conservan sus registros escolares.

En **Administrar cuenta**, dirección puede cambiar el tipo de acceso entre docente y tutor. Solo superadministración puede asignar o administrar cuentas de dirección. Cambiar el tipo cierra las sesiones existentes; revisa también las asignaciones de grupo o los vínculos familiares antes de hacer el cambio.

## Configuración inicial de dirección

1. En **Ciclos y grupos**, crea el ciclo escolar con sus fechas.
2. Crea un grupo y elige la etapa correcta: lactantes, maternal, prekínder o preescolar.
3. En **Cuentas de acceso**, envía la invitación de cada docente y tutor autorizado. Dirección puede crear estas cuentas; la cuenta superadministradora es la que autoriza nuevas cuentas de dirección.
4. En **Ciclos y grupos**, asigna cada docente a sus grupos.
5. En **Alumnos**, registra al niño y su grupo. Abre su expediente y vincula las cuentas de sus tutores con el parentesco correspondiente. Verifica que el correo sea el de la cuenta que ya creaste.
6. Revisa el panel de inicio: los indicadores se calculan con los registros actuales. Si todavía no hay ciclos, grupos o alumnos, aparecerán vacíos o en cero.

Las bajas son lógicas: desactivan el acceso o cierran la inscripción, pero conservan el historial escolar. Para reactivar a un alumno, dirección debe asignarle un grupo activo.

## Rutina de las docentes

### Clases y calendario

- En **Clases virtuales**, programa el título, grupo, docente y horario de Ciudad de México.
- Hasta que la escuela configure Google Workspace y la integración correspondiente, la docente debe crear la reunión en Google Meet y pegar el enlace. El portal solo lo muestra a integrantes autorizados del grupo; Meet conserva sus propios controles de acceso.
- Las grabaciones están desactivadas. No subas ni compartas grabaciones de menores.
- En **Calendario**, registra reuniones, eventos y fechas importantes. Las tareas publicadas con fecha límite también aparecen en la agenda.
- En la vista **Agenda**, puedes corregir o cancelar eventos de tu grupo. Las familias autorizadas reciben un aviso; las clases y tareas se administran desde sus propias secciones.

### Tareas y entregas

1. En **Tareas y entregas**, publica el título, instrucciones para la familia, grupo y fecha límite. Puedes adjuntar guías PDF, imágenes o audio.
2. La familia verá la tarea y podrá enviar una evidencia PDF o imagen por cada hijo inscrito en ese grupo.
3. Abre **Revisar entregas** para consultar los archivos y la nota enviada. Añade una observación, selecciona **Revisada** o **Completada** y guarda.
4. La familia ve los estados **Pendiente**, **Vencida**, **Entregada**, **Revisada** o **Completada**. El estado vencido aparece cuando pasa la fecha límite sin una entrega.
5. En prekínder y preescolar puedes añadir una evaluación formativa: Logrado, En proceso o Con acompañamiento. Para lactantes y maternal, usa observaciones cualitativas; no hay calificación académica.

### Biblioteca de actividades

En **Biblioteca**, elige el grupo, escribe el nombre del recurso, selecciona una categoría y adjunta el archivo. Las familias solo pueden consultar y descargar materiales de sus grupos. Una docente asignada puede reemplazar un archivo o retirarlo; esas acciones quedan registradas. Las imágenes nuevas se limpian de metadatos EXIF/XMP. La carga de archivos permanece bloqueada hasta configurar el análisis de seguridad requerido; no uses documentos reales mientras siga pendiente.

### Asistencia

En **Asistencia**, selecciona grupo y fecha. Marca presente, retardo, ausente o falta justificada. Si eliges **Falta justificada**, escribe el motivo; el sistema no guarda ese estado sin una explicación. Guarda la lista. Dirección y docentes autorizadas pueden corregir el registro después; la acción queda en auditoría.

Las familias también pueden enviar una justificación desde esa pantalla. La solicitud aparece como pendiente; una docente asignada o dirección puede aceptarla o rechazarla. Aceptarla actualiza el registro de asistencia a **Falta justificada** y conserva el motivo. La familia recibe un aviso interno y puede consultar la respuesta. Una solicitud pendiente o aceptada no se duplica para el mismo alumno y fecha; si se rechaza, la familia puede volver a enviarla.

En **Historial individual**, elige al alumno y el periodo para consultar sus registros, motivos y porcentaje. El porcentaje se calcula como presentes más retardos entre todos los registros del periodo; una falta justificada cuenta como ausencia. Esta regla queda visible en pantalla para que dirección la revise con la política escolar. En **Reporte de asistencia**, docentes descargan el historial de sus grupos asignados; dirección puede elegir un grupo o todos los grupos de la escuela. Selecciona el periodo y formato Excel, PDF o CSV. Los reportes aceptan periodos de hasta 366 días y la descarga queda auditada.

### Seguimiento del desarrollo

En **Seguimiento**, elige al alumno y registra una observación en el área correspondiente. Marca si puede verla la familia. Escribe hechos y avances observables; no agregues diagnósticos médicos o psicológicos. Las observaciones visibles generan un aviso interno a la familia.

### Comunicación con las familias

- Usa **Comunicados** para avisos generales o de grupo. Dirección puede publicar comunicados generales; las docentes publican en grupos que tienen asignados. Los avisos importantes pueden mostrar confirmación de lectura.
- Usa **Comunicación** para conversar en privado con familias vinculadas a tus grupos. El historial y los adjuntos autorizados quedan guardados. No compartas información de un alumno en el chat de otra familia.
- Dirección puede activar en **Comunicación** el horario permitido para enviar mensajes y seleccionar días y horas. El ajuste se aplica en hora de Ciudad de México; por defecto permanece desactivado hasta que la escuela defina su horario.
- El portal muestra notificaciones internas; por ahora no envía correo ni notificaciones push. Chat y avisos se actualizan periódicamente mientras el portal está abierto.

## Familias y acceso

En **Solicitudes de privacidad**, Dirección recibe solicitudes familiares de acceso, corrección o eliminación. Marca **En revisión** y luego responde o cierra con una nota visible para la familia. Los estados avanzan en ese orden y una solicitud respondida solo puede cerrarse. Cada cambio genera auditoría y un aviso interno. La plataforma registra y comunica el seguimiento; Dirección debe resolver la petición conforme al aviso y proceso aprobado por la escuela. Evita añadir documentos personales en la nota.

Una cuenta de tutor solo muestra alumnos vinculados por dirección. Antes de una entrega, comprueba que el alumno y el grupo sean los correctos. Si un niño no aparece, solicita a dirección que verifique la cuenta, el vínculo familiar y la inscripción activa.

La página de acceso ya está disponible en la URL del portal. Dirección debe invitar las cuentas autorizadas de docentes y familias antes de que puedan entrar. Antes de registrar información real de menores, completa la validación de seguridad y privacidad, prueba la recepción de invitaciones y recuperación de cuentas por correo, y verifica respaldos restaurables. Las cuentas, roles y registros escolares todavía no se han migrado de D1 a Supabase Postgres.

## Si algo falla

- Si no aparece un grupo, pide a dirección revisar la asignación docente o la inscripción activa.
- Si no puedes entrar, usa **Recuperar contraseña** y revisa la bandeja de entrada. Si el portal indica que el correo alcanzó un límite temporal, espera antes de volver a solicitar el enlace. Abre el enlace nuevo pronto y cambia la contraseña directamente en el portal; no la compartas por mensajes.
- Si una carga falla, conserva el archivo original y vuelve a intentarlo cuando la conexión sea estable. No envíes datos del alumno por un servicio externo como alternativa.
- Si una actividad aparece vencida, revisa la fecha límite y la entrega registrada antes de cambiar el estado.

Para preparar las políticas de privacidad y revisar los controles para menores, consulta `privacidad-y-proteccion-de-menores.md` junto con el plan de auditoría. Para las pruebas técnicas, el respaldo y la preparación de operación consulta `pruebas-y-operacion.md`. La plataforma no debe usarse con expedientes reales hasta cerrar los pendientes del plan de auditoría.
