# Guía rápida del portal escolar

**Actualizada: 12 de octubre de 2026.** Portal: [El Mundo de los Niños](https://el-mundo-de-los-ninos-portal.vercel.app).

Dirección entrega las cuentas autorizadas. No hay registro público. Cada persona entra desde **Iniciar sesión** con su propio correo y contraseña; después verá las secciones de su tipo de acceso. El portal usa Vercel como hosting y Supabase para cuentas, registros escolares y archivos privados.

El hosting se conserva en el equipo Vercel **pandito**, por decisión del usuario. El código tiene un repositorio GitHub privado escolar creado y verificado; trasladar el hosting a otra cuenta no es un paso pendiente.

## Dirección: preparar la escuela

1. En **Grupos**, crea primero el ciclo escolar con fechas y después cada grupo con su etapa: lactantes, maternal, prekínder o preescolar.
2. En **Cuentas**, registra el nombre, correo existente y tipo de acceso de cada docente y tutor. Con la activación interna habilitada, entrega en privado el código de primer acceso a su destinatario; cada persona elige su propia contraseña. Sigue los pasos de **Primer acceso con código privado** y confirma el recorrido con una cuenta nueva autorizada antes de incorporar a todas las familias.
3. En **Grupos**, asigna las docentes a sus grupos.
4. En **Alumnos**, registra al niño, selecciona su grupo y abre el expediente para vincular a sus tutores. Tener una cuenta de tutor no vincula automáticamente a ningún niño.
5. Publica fechas en **Calendario**, avisos en **Comunicados** y define el horario de mensajes en **Comunicación**, si la escuela lo necesita. Las horas se muestran en horario de Ciudad de México.
6. Revisa el panel de **Inicio**: los indicadores provienen de registros actuales; una escuela sin matrícula aparece vacía o en cero.

En **Alumnos**, puedes corregir datos básicos. **Dar de baja** conserva el expediente y cierra el acceso operativo a ese alumno. Al reactivarlo debes elegir un grupo activo; se crea una nueva inscripción y se conserva el historial.

En **Cuentas**, puedes editar el nombre, tipo de acceso o estado de docentes y tutores. Solo superadministración administra cuentas de dirección. Cambiar permisos o desactivar el acceso se aplica a las siguientes solicitudes escolares y conserva los registros; no supone revocar todos los tokens de acceso. Para cambiar un correo, solicita la actualización coordinada a administración técnica. No se puede administrar desde esa pantalla la propia cuenta ni una cuenta superadministradora.

## Primer acceso con código privado

Este procedimiento corresponde al modo de activación interna. Consulta [Activación interna](activacion-interna.md) y [Estado de requisitos](estado-requisitos.md) para comprobar su publicación y aceptación vigentes.

1. Dirección registra tu correo existente y entrega un código privado, válido durante **30 minutos desde su emisión**. La invitación interna no envía un correo automático. Dirección debe comprobar el destinatario y compartir el código por un canal privado acordado con la escuela; no lo publiques ni lo incluyas en capturas o enlaces.
2. Abre **Activar cuenta** (`/activar-cuenta`) e introduce tu correo y el código. La verificación es de un solo uso.
3. Elige una contraseña propia del portal, de **al menos 12 caracteres**. Después de verificar el código tienes una sesión provisional de hasta **10 minutos** para completar este paso; esa sesión todavía no permite entrar a las secciones escolares.
4. Una vez completada la activación, abre **Iniciar sesión** con tu correo y la contraseña que elegiste. Puede ser un correo de Gmail u otro proveedor: no necesitas iniciar sesión con Google ni proporcionar tu contraseña de Gmail a la escuela.

Si el código se perdió o venció **antes de verificarlo**, dirección puede renovar una invitación pendiente que siga sin confirmar. La renovación conserva la misma cuenta y sus vínculos; el código anterior deja de servir. Dirección no elige ni entrega la contraseña de la persona.

Si ya verificaste el código y después cancelaste o dejaste vencer los diez minutos sin completar la contraseña, la cuenta ya está confirmada y **no admite renovar la invitación inicial**. Contacta a dirección para revisar una recuperación por un canal verificado. El correo de recuperación (SMTP), su recepción y el regreso al portal siguen pendientes de aceptación; no se garantiza que ese recorrido esté disponible. No crees de nuevo el mismo correo para intentar resolverlo.

## Docentes: trabajo cotidiano

| Sección | Qué hacer |
| --- | --- |
| **Clases virtuales** | Crea la reunión en Google Meet y publica enlace, grupo y horario. El portal muestra el enlace al grupo autorizado; la organizadora controla la admisión dentro de Meet. Las grabaciones están apagadas. |
| **Tareas y entregas** | Publica título, instrucciones, grupo y fecha. Adjunta guías cuando la recepción de archivos esté habilitada. En **Revisar entregas**, lee la evidencia, añade retroalimentación y guarda el estado. |
| **Biblioteca** | Comparte guías, imágenes, canciones o audios por grupo. Busca por título o nombre del archivo y filtra por grupo/categoría. Abre la vista previa de PDF, imágenes o audio, o descarga el recurso. Puedes reemplazarlo o retirarlo; la acción queda registrada. |
| **Juegos y retos** | Consulta actividades por etapa para acompañar el trabajo en casa. Las respuestas y logros corresponden al alumno seleccionado. La escuela debe revisar el contenido pedagógico antes de incorporarlo a su programa. |
| **Asistencia** | Elige grupo y fecha, marca presente, retardo, ausente o falta justificada y guarda. Una falta justificada requiere motivo. Revisa solicitudes familiares y acepta o rechaza con una respuesta. |
| **Seguimiento** | Registra hechos y avances observables por área; decide si cada observación es visible para la familia. Las internas permanecen reservadas al equipo autorizado. |
| **Comunicados** | Publica avisos para tus grupos; los importantes permiten confirmar lectura. Dirección puede publicar avisos generales. |
| **Comunicación** | Conversa en privado con tutores vinculados a tus grupos. Respeta el horario escolar de mensajes cuando esté activo. |

Para prekínder y preescolar, las entregas admiten evaluación formativa: **Logrado**, **En proceso** o **Con acompañamiento**. En lactantes y maternal se usan observaciones cualitativas, sin calificación numérica ni diagnóstico automático.

En **Asistencia**, el historial muestra registros y porcentaje individual. La regla actual suma presentes y retardos entre todos los registros; una falta justificada cuenta como ausencia. Dirección debe revisar esa regla con su política escolar. Los reportes permiten Excel, PDF o CSV y periodos de hasta 366 días; docentes consultan sus grupos y dirección puede consultar todos.

## Familias: cinco pasos

1. Completa el primer acceso indicado por dirección y entra con tu correo y la contraseña propia del portal. Si no aparece tu hijo, pide que revisen el vínculo familiar y la inscripción activa.
2. En **Tareas y entregas**, elige al niño, lee las instrucciones y envía una nota o evidencia. Después comprueba el estado **Entregada**. La revisión de la maestra aparece ahí y genera un aviso interno.
3. En **Biblioteca**, busca y abre los recursos de su grupo. En cada tarea también puedes descargar los materiales adjuntos.
4. Consulta **Calendario**, **Clases virtuales**, **Asistencia**, **Seguimiento** y **Comunicados**. Usa **Juegos y retos** junto al niño y marca sus respuestas cuando corresponda.
5. Abre **Comunicación** para escribir a la docente. Abre **Avisos** para novedades y confirma la lectura de comunicados importantes.

En **Privacidad**, puedes solicitar acceso, corrección o eliminación de información de un hijo vinculado y consultar la respuesta de dirección. El portal registra el seguimiento; la escuela resuelve la solicitud conforme a su proceso aprobado. Evita escribir contraseñas o adjuntar documentos personales en las notas.

## Archivos y avisos

- Las nuevas cargas admiten hasta **4 MB por archivo**. Biblioteca y materiales de tareas aceptan PDF, imágenes y audios permitidos; las evidencias y el chat aceptan PDF o imágenes. El chat admite un archivo por mensaje.
- Los archivos son privados: se abren desde el portal con la sesión y permisos vigentes. Compartir su enlace no otorga acceso a otra persona.
- Si la carga aparece desactivada, la escuela todavía debe habilitar la recepción segura de archivos. Puedes seguir enviando mensajes de texto. El ensayo local con analizador real no habilita automáticamente el servicio publicado.
- **Avisos** y el chat indican si la conexión de cambios está activa o si usan actualización periódica. Al reconectar vuelven a consultar la información autorizada. No hay notificaciones push ni correo automático por cada actividad; los avisos se consultan con el portal abierto.

## Cuenta y ayuda

En **Mi cuenta**, cambia tu contraseña usando la actual; la nueva debe tener al menos 12 caracteres. Si la olvidaste, **Recuperar contraseña** necesita un canal de correo verificado. La configuración SMTP, la recepción y el regreso al portal siguen pendientes de aceptación; contacta a dirección si el enlace no llega o no permite completar el cambio. Una solicitud aceptada por la pantalla no demuestra que se haya entregado el correo. Cuando el servicio esté confirmado, revisa bandeja y spam; si informa un límite temporal, espera antes de solicitar otro enlace. No compartas contraseña ni enlace de recuperación.

Si falla una operación, consulta primero la lista o el estado para comprobar si quedó guardada. Si el problema sigue, comunica a dirección la sección, hora y mensaje de error, sin enviar contraseñas ni información privada del alumno. Un error de conexión no es una confirmación de guardado.

## Preparación para operar

El portal publicado ya tiene acceso administrativo y secciones revisadas con la escuela vacía. El recorrido académico con cuentas y documentos sintéticos pasó **45 comprobaciones/149 solicitudes en un entorno local real**; no se ejecutó sobre expedientes escolares.

El chat tuvo un ensayo HTTP separado con **dos familias y una docente sintéticas** en el destino local restaurado:26 comprobaciones funcionales correctas de mensajes, acuses, avisos e aislamiento. La limpieza posterior también quedó confirmada tras corregir un guard de fecha del perfil; el primer informe fallido se conserva. Esto comprueba el chat guardado, pero no la entrega de eventos Realtime ni una conversación escolar de producción.

La activación interna y la renovación de códigos sin verificar pasaron **14 comprobaciones/44 solicitudes reales en Supabase aislado**, con limpieza del entorno confirmada. Es evidencia de integración local: no acredita aceptación visual, ingreso por HTTPS del portal publicado ni el primer acceso de una cuenta escolar real. El estado de publicación y aceptación se mantiene en [Activación interna](activacion-interna.md).

Antes de abrirlo a familias, dirección debe confirmar el primer acceso con código y el ingreso posterior, la recuperación por correo, el servicio seguro de archivos publicado, respaldos restaurables, el aviso y autorizaciones aprobados y una revisión con docentes/familias en sus propios dispositivos. Google Meet se organiza manualmente y las grabaciones permanecen desactivadas. Consultar [el estado de requisitos](estado-requisitos.md) para evidencia y pendientes.
