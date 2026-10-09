# Estado de requisitos — El Mundo de los Niños

**Actualizado: 9 de octubre de 2026.** Hosting real: Vercel/Next.js. Backend: Supabase Auth, PostgreSQL/RLS y Storage privado. Sites/D1 se conserva como destino anterior; no es la base seleccionada del hosting Vercel.

**Decisión vigente:** conservar Vercel en el equipo **pandito**, por petición del usuario; el traslado se canceló y no es un pendiente de lanzamiento. El repositorio GitHub privado de la escuela ya está creado y verificado.

Este registro distingue código, ensayos locales reales y verificaciones del proyecto escolar publicado. Ninguna cuenta `example.test` ni un ensayo local acredita una operación de producción.

## Evidencia disponible

- **Producción:** acceso administrativo real, lecturas de las 18 secciones con escuela vacía y revisión móvil emulada. La versión dpl_44sWbxTREwV9Fu3WRSCCSH2ZBmaU pasó 19 controles HTTP antes de promover y 19 en el dominio habitual, 538 pruebas y compilaciones Next.js/Sites; conserva262 comprobaciones smoke D1 aisladas como evidencia complementaria. Se abrió administración en18 pestañas a 320×740; Realtime/SSE conectó con la administradora, sin demostrar eventos entre familias/docentes. Ver [verificación publicada](verificacion-vercel-supabase-20261008.md).
- **HTTP local real:** `outputs/supabase-school-http-native-20261009-retry3.json` indica PASS: **149 solicitudes, 45 comprobaciones, archivos privados incluidos**. Next.js usa un stack nativo separado de Supabase Auth/PostgreSQL/Storage y un analizador ClamAV real. Comprueba matrícula, vínculos, tarea, archivos, revisión, asistencia, observaciones, comunicado, avisos y aislamiento de dos familias sintéticas. No utiliza datos escolares. Las cookies Secure se transportan manualmente en el runner Node local; no representa un navegador operando sobre HTTP. Ver [el recorrido y sus guardas](pruebas-http-supabase-local.md).
- **Chat HTTP real separado:** dos familias restauradas y una docente nueva, todas sintéticas, completaron **26 comprobaciones funcionales PASS** en el destino local aislado: dos conversaciones, cuatro mensajes, acuses persistidos, cuatro avisos, seis auditorías y denegación a otra familia/anónimo. El primer informe `outputs/supabase-restored-chat-http-20261009.json` conserva **FAIL de cleanup**, porque el guard no admitía el avance legítimo de `profiles.updated_at` producido por Auth al iniciar sesión. La recuperación dirigida pasó en `outputs/supabase-restored-chat-http-cleanup-20261009.json`: solo retiró el nuevo ensayo y restauró el horario previo, conservando public33/69 filas/6 Auth/3 objetos y sus hashes. Es evidencia compuesta; no se repitieron mensajes ni se cambió retroactivamente el FAIL. **No acredita Realtime.**
- **Realtime local real:** `outputs/supabase-native-realtime-20261009-attempt22.json` obtuvo PASS con Auth/PostgreSQL/Realtime reales: avisos y mensajes INSERT/UPDATE para docente y dos familias, aislamiento de la familia ajena, SSE con señales sin filas privadas, cierre voluntario y revocación real de perfil. El harness utiliza WebSocket nativo con un dispatcher Undici exclusivo por conexión; **`productionTransportVerified:false`**. Los FAIL históricos del transporte compartido se conservan. El postflight independiente dejó Auth users/identities/sessions/API en 0, las 33 tablas sin filas y Storage objects en 0 (`outputs/supabase-native-realtime-20261009-attempt22-postflight.json`). El destino restaurado y producción no se modificaron. Ver [alcance y diferencia de transporte](pruebas-realtime-local.md).
- **Analizador local real:** 12 comprobaciones PASS, incluidas firmas vigentes, PDF limpio, EICAR detectado, errores de token/origen/límites y fallo cerrado ante daemon detenido. El servicio temporal no habilita el analizador de producción.
- **PostgreSQL:** fixtures de módulos escolares con transacciones terminadas en ROLLBACK. No dejaron alumnos de ensayo en el proyecto escolar.
- **Suite local más reciente:** 502 pruebas en 73 archivos pasaron antes de la revisión visual final coordinada. Es un resultado de esa instantánea; una nueva modificación o publicación necesita sus comprobaciones correspondientes.
- **Respaldo y restauración locales:** el snapshot cifrado conserva 33 tablas/69 filas, 3 objetos y 6 identidades sintéticas (`outputs/supabase-full-restore-backup-20261009-retry1.json`). La restauración en un destino nativo separado pasó **6 comprobaciones reales**: UUID/hashes/identidades preservados, datos y bytes restaurados, login de dos familias, descarga escolar autorizada y rechazo de otra familia/anónimo y de Storage directo (`outputs/supabase-full-auth-restore-20261009.json`). La fuente se limpió después mediante comparación exacta con el snapshot; el destino restaurado se conservó. No es una restauración del proyecto escolar publicado.
- **Respaldo escolar de producción:** el intento recibió 403 en profiles; el permiso de lectura SQL29 no está autorizado/aplicado. Un `backup-meta.json` parcial no acredita una exportación completa. Sigue pendiente.

Los intentos HTTP fallidos se conservan: normalización local de origen, traducción PostgREST `P0002` y una expectativa incorrecta del harness al filtrar un grupo ajeno. El PASS posterior partió de otro fixture vacío verificado; no hubo replay automático de escrituras inciertas. Las correcciones de fuente posteriores al último release deben publicarse y verificarse antes de atribuirlas al hosting.

## Requisitos 1–20

| # | Requisito | Evidencia actual | Pendiente para operar |
| --- | --- | --- | --- |
| 1 | Proyecto, logo y colores | Identidad escolar verde/amarilla y logo original en el portal. | Aprobación visual final de la escuela; registrar el release de presentación. |
| 2 | Uso claro, accesible y adaptable | Pestañas, foco visible, estados de formulario y revisión móvil emulada sin desbordamiento de 18 secciones. | Teléfono físico, lector de pantalla, teclado y conexión lenta. |
| 3 | Roles y permisos | Actor UUID/perfil activo/roles/RLS; administradora real; dos familias aisladas por HTTP local. | Invitaciones y revisión con cuentas propias de docentes/familias; decidir si se necesita acceso infantil. |
| 4 | Panel por rol | Conteos reales; fixtures SQL por rol y panel administrativo publicado. | Revisión del panel docente y familiar con la escuela. |
| 5 | Comunicación | Chat HTTP real y persistencia:26 comprobaciones funcionales PASS más cleanup recuperado PASS en destino sintético separado. Horarios/comunicados/lecturas en SQL; comunicado y avisos HTTP. Realtime escolar conectó con administración; entrega/aislamiento/cierre/revocación Realtime pasaron en ensayo local real con dispatcher exclusivo del harness. | Entrega Realtime por HTTPS en el hosting con docentes/familias y revisión en navegador; correo por eventos/push no implementados. |
| 6 | Clases virtuales | Publicación y visibilidad del enlace Meet por grupo. | Organizadora crea y prueba la sala/admisión en Google; sin asistencia automática. Grabaciones apagadas. |
| 7 | Materiales y archivos | Biblioteca con búsqueda/filtros/paginación; subida, descarga PDF privada, reemplazo y evidencia real pasaron HTTP local con analizador y Storage. Recuperación de bytes privados pasó en destino restaurado local. | Servicio privado de análisis en producción y carga controlada en el hosting. Recuperación de recursos escolares reales pendiente. |
| 8 | Tareas y actividades | Tarea, guía adjunta, entrega con archivo, revisión y evaluación pasaron HTTP local. Actividades por etapa y logros probados en SQL. | Revisión pedagógica; recorrido de Juegos y retos con docentes/familias. |
| 9 | Calendario | CDMX, vistas mensual/semanal/agenda, filtros, eventos/tareas/Meet y SQL reversible. | Recorrido HTTP/UI de creación y edición de eventos; salas Meet reales. |
| 10 | Asistencia | Registro y consulta pasaron HTTP local; correcciones, justificaciones, baja/reactivación y reportes probados en PostgreSQL. | Recorrido operativo de justificaciones/exportación y aprobación de la fórmula escolar. |
| 11 | Seguimiento | Observaciones visibles/internas y aislamiento familiar pasaron HTTP local; logros por etapa probados en SQL. | Revisión pedagógica y uso acompañado con familias. |
| 12 | Notificaciones | Avisos internos, lectura persistida e aislamiento pasaron HTTP local; conexión escolar Realtime observada. INSERT/UPDATE e aislamiento pasaron en Realtime local real con transporte aislado del harness. | Entrega por Realtime en producción a docentes/familias y correo de recuperación/invitación confirmados. Push/correo por eventos no implementados. |
| 13 | Administración | Ciclo, grupos, asignación docente, alta de alumno y vínculo familiar pasaron HTTP local; permisos de cuentas en SQL. | Probar invitaciones, recuperación, altas y desactivación con cuentas autorizadas en el hosting. |
| 14 | Protección de menores | Acceso por invitación, JWT/roles/RLS, archivos privados, auditoría y cargas cerradas sin analizador. | Aviso y autorizaciones aprobados, operación de correo/análisis/respaldo y revisión de seguridad escolar. No se afirma cumplimiento legal. |
| 15 | Arquitectura | Vercel ejecuta Next y sus APIs; Auth/datos/Storage en Supabase, sin proxy al Site. HTTP local usa esos proveedores reales. Equipo pandito conservado por decisión del usuario. | Registrar publicación y comprobación de las fuentes finales. |
| 16 | Calidad | Unitarias, compilaciones, SQL reversible, smoke D1 aislado y recorrido HTTP local real con archivos. | No todos los 18 flujos tienen aceptación HTTP/navegador de producción; conservar pendientes y fallos. |
| 17 | Rendimiento | Paginación del servidor; cargas 4 MB; pausas/backoff de lecturas y límites temporales. | Medir teléfono/red real, Core Web Vitals y monitoreo sin datos personales. Las escrituras no se reintentan automáticamente. |
| 18 | Implementación por fases | Base escolar, académico, comunicación, privacidad y operaciones implementados. | Cerrar dependencias externas y capacitación antes del lanzamiento escolar. |
| 19 | Entregables | Código, migraciones, guías, hosting real y repositorio GitHub privado escolar creado/verificado, sin credenciales. | Sincronizar las fuentes finales al repositorio y registrar despliegue/evidencia final en el hosting actual. |
| 20 | Reglas críticas | Sin alta pública ni expedientes ficticios de producción; archivos cerrados sin analizador; grabaciones rechazadas. | Verificar operación y responsabilidades antes de incorporar información real. |

## Pruebas obligatorias 1–18

| # | Flujo | Evidencia y límite |
| --- | --- | --- |
| 1 | Dirección registra alumno | PASS HTTP local real con Supabase; no se registró un alumno real en producción. |
| 2 | Dirección vincula tutor | PASS HTTP local real y fixture PostgreSQL. |
| 3 | Tutor entra y solo ve a sus hijos | PASS HTTP local real para dos familias, con cookies en RAM e identidad Auth verificada. Falta navegador/dispositivo familiar. |
| 4 | Docente publica material | PASS HTTP local: FormData, análisis real, PostgreSQL y Storage. Producción mantiene cargas bloqueadas sin analizador. |
| 5 | Familia descarga material autorizado | PASS HTTP local: MIME/cabeceras privadas/SHA256, 404 a familia ajena y 401 anónimo. |
| 6 | Docente crea tarea | PASS HTTP local, guía PDF adjunta incluida. |
| 7 | Tutor entrega actividad | PASS HTTP local: nota y PDF propio; entrega por alumno ajeno rechazada. Juegos y retos solo tienen fixture SQL y pruebas de componentes. |
| 8 | Docente revisa y comenta | PASS HTTP local: revisión, observación y evaluación persistidas; familia confirma la respuesta. |
| 9 | Docente registra asistencia | PASS HTTP local; historial, justificación y reportes tienen fixtures SQL/contratos, no recorrido HTTP completo. |
| 10 | Familia consulta seguimiento | PASS HTTP local: ve observación visible y no la interna; otra familia queda bloqueada. |
| 11 | Docente publica comunicado | PASS fixture SQL/smoke legacy para docente. El recorrido HTTP Supabase local probó publicación por **dirección**, entrega a A y aislamiento de B. |
| 12 | Tutor recibe notificación | PASS HTTP local de avisos internos y confirmación de lectura, más PASS Realtime local real de INSERT/UPDATE y aislamiento. Dispatcher exclusivo solo del harness: no verifica el transporte publicado ni push/correo por actividades. |
| 13 | Usuarios autorizados intercambian mensajes | Chat HTTP Supabase real separado:26 comprobaciones funcionales PASS para dos familias y una docente sintéticas, persistencia/avisos/acuses/aislamiento. Cleanup recuperado PASS y primer FAIL conservado. No forma parte de las45 comprobaciones. Realtime pasó por separado en el ensayo local 22, con dispatcher exclusivo del harness; falta comprobar transporte/entrega publicados por HTTPS. |
| 14 | Acceso a otro alumno bloqueado | PASS HTTP local para alumnos, materiales, tareas, entregas, asistencia, observaciones, comunicados y avisos, más fixtures RLS. |
| 15 | Respaldo y restauración | PASS local real: public33/69 filas/3 objetos/Auth6, preservación UUID/hashes, login de dos familias y descarga privada tras restaurar. El intento de respaldo de producción recibió 403 y sigue pendiente. |
| 16 | Móvil y red lenta | 18 secciones administrativas revisadas en emulación móvil. Teléfono físico, lector de pantalla, red lenta y flujos familiares pendientes. |
| 17 | Meet solo autorizado | El portal limita el enlace por grupo. Sala/admisión de Google y reenvío del enlace no verificados. |
| 18 | Grabaciones sin autorización no disponibles | Grabaciones apagadas y nuevas cargas rechazadas en contratos/smoke. La descarga de archivos existentes `recording` también devuelve404 antes de Storage: handler VM comprobado para los cinco roles escolares, con cero accesos. Corrección publicada en dpl_44sWbxTREwV9Fu3WRSCCSH2ZBmaU; no se verificó Google ni se aprobó política de grabaciones. |

## Qué hace falta para presentar

1. Publicar la fuente final y registrar ID/URL de Vercel, revisión HTTP pública y acceso administrativo. Mantener la versión anterior recuperable.
2. Revisar diseño y recorrido de las secciones con la escuela. Para mostrar contenido, usar el entorno sintético separado; la escuela publicada sin matrícula mostrará estados vacíos reales.
3. Explicar cuatro límites en la presentación: Meet manual, grabaciones apagadas, cargas publicadas pendientes de analizador y avisos internos sin push/correo de eventos.
4. Usar el GitHub privado escolar ya verificado y el hosting Vercel actual del equipo pandito; conservar esta decisión en la entrega, sin solicitar nuevamente el traslado cancelado.

## Qué hace falta para operar con familias

| Trabajo | Responsable y comprobación necesaria |
| --- | --- |
| Invitaciones y recuperación | Administración técnica configura SMTP aprobado de Supabase; escuela confirma recepción, enlace, contraseña y acceso con un destinatario autorizado. |
| Archivos de producción | Administración técnica instala y configura un analizador privado real; prueba archivo sintético limpio, bloqueo de prueba de seguridad y descarga autorizada en el hosting. Sin desactivar el control. |
| Recuperación de información | El ensayo local completo ya pasó. Operador autorizado define respaldo escolar cifrado de public33/Storage más recuperación Auth; autoriza el permiso necesario y prueba el proyecto real en un destino separado. Define frecuencia, retención, custodio y recuperación de la frase privada. |
| Organización escolar | Dirección crea ciclos/grupos, asignaciones y vínculos correctos; aprueba horario, regla de asistencia, contenidos y procedimiento de bajas. |
| Privacidad y Meet | Escuela aprueba aviso, representación familiar, autorizaciones, conservación y proceso de solicitudes; organizadora configura admisión de Meet. Grabaciones siguen apagadas. |
| Uso y soporte | Docente y familia autorizadas completan el recorrido con sus dispositivos; dirección registra responsable de soporte/incidentes y revisión de auditoría. |

Las pruebas técnicas y los comandos aislados se documentan en [Pruebas y operación](pruebas-y-operacion.md), [HTTP local](pruebas-http-supabase-local.md), [Realtime local](pruebas-realtime-local.md) y [Respaldo](respaldo-supabase.md). No ejecutar esos fixtures contra el proyecto escolar publicado.
