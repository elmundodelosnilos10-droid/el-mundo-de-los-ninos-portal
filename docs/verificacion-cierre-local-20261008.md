# Verificación de cierre — ensayos aislados y vista móvil

Registro del 8 y 9 de octubre de 2026. La escuela operativa conserva su hosting y su base de datos. Los ensayos usan identidades y documentos sintéticos en un Supabase nativo local y una VM sin montajes de documentos del equipo.

## Antivirus real

ClamAV 1.4.6 ejecutado en una VM ARM de 2 GiB: 12 comprobaciones reales pasaron. Incluyen PDF limpio, EICAR oficial detectado, bloqueo de token/origen/tamaño incorrectos y rechazo cuando el daemon se detiene, seguido de recuperación. Firmas cargadas: versión 28147, fecha 8 de octubre de 2026, dentro del máximo de 24 horas.

Evidencia privada del ensayo: `/tmp/school-scanner-20261008/acceptance-2g.json`. Los runners y el hook de integración pasaron 29 pruebas unitarias adicionales. El servicio temporal ya se cerró; la integración de archivos con el portal sigue en preparación. El scanner de producción todavía requiere un servicio privado configurado.

## Respaldo real del fixture HTTP

La herramienta escolar exportó las 33 tablas, 34 filas sintéticas y cero objetos de Storage. El paquete cifrado pasó verificación offline. La migración 29 se aplicó únicamente en la base local para permitir su lectura; el proyecto Supabase escolar conserva pendiente esa autorización.

Un complemento cifrado conservó cuatro UUID y hashes de contraseñas Auth y cuatro identidades mediante el filtrado oficial del CLI. La exportación y la verificación de integridad pasaron; la restauración y el ingreso posterior todavía no se han demostrado. Los paquetes y su frase privada permanecen fuera del repositorio.

Evidencia: `outputs/supabase-native-backup-export-20261008.json`. El primer error de configuración del ensayo se conserva en el archivo de preflight; no llegó a leer ni modificar datos.

## Portal publicado en vista móvil

Se consultaron las 18 secciones con sesión administrativa real en Vercel, viewport de 390 × 844. Todas mostraron su encabezado y ninguna desbordó horizontalmente. La navegación mide 44 píxeles de alto; los controles visibles revisados en las otras 17 pantallas tienen etiqueta. Se restauró el tamaño habitual al finalizar.

Evidencia: `outputs/portal-production-mobile-readonly-20261008.json` y `outputs/portal-production-mobile-admin-20261008.jpg`. Esta revisión utiliza emulación y una escuela sin matrícula cargada. El ensayo de teléfono físico, lector de pantalla, conexión lenta y flujos familiares continúa pendiente.

## Flujos HTTP reales

El primer intento se detuvo antes de escribir datos escolares porque Next normalizaba la dirección local a `localhost`, mientras el Origin conservaba `127.0.0.1`. La configuración aislada ya conserva la URL original mediante el guard local; la comprobación CSRF permanece estricta en producción.

El segundo intento pasó 14 comprobaciones y se detuvo al bloquear una entrega ajena: PostgREST respondió HTTP 500 con SQLSTATE `P0002`, que el portal trataba como una indisponibilidad. La corrección en fuente convierte exclusivamente esa combinación RPC/HTTP 500/código exacto en 404 y conserva los demás errores sanitizados. La nueva aceptación integrada con archivos aún debe ejecutarse antes de publicar esa corrección.

Los FAIL y sus datos se preservaron mediante respaldo cifrado antes de limpiar exclusivamente el fixture local.

### Aceptación integrada del 9 de octubre

El ensayo `retry2` cargó un PDF mediante ClamAV y Storage reales. Se detuvo porque el runner esperaba una biblioteca vacía con HTTP 200 al filtrar un grupo ajeno; el servidor respondía correctamente 404. Se corrigió la expectativa del runner, conservando el bloqueo y verificando además que la biblioteca propia de la segunda familia estuviera vacía. Antes de limpiar sus datos se exportaron y verificaron 33 tablas, 37 filas y un objeto, además del complemento cifrado de cuatro identidades Auth.

El nuevo `retry3` pasó **149 solicitudes y 45 comprobaciones** con Next.js, Supabase nativo y ClamAV reales. Incluye ingreso y directorio escolar, dos familias aisladas, biblioteca privada con búsqueda y paginación, subida/descarga/previsualización/reemplazo de PDF, adjunto de tarea, entrega y revisión, asistencia, seguimiento visible e interno, comunicados, avisos y persistencia PostgreSQL. Los intentos de acceso ajeno y anónimo fueron rechazados. La aceptación antivirus conservó sus 12 comprobaciones reales aprobadas.

Ese JSON no contiene envío/lectura de mensajes privados ni conversaciones persistidas: el preflight de esas tablas vacías no prueba el chat HTTP. Ese recorrido y la entrega Realtime se verifican por separado; un PASS de almacenamiento de mensajes tampoco acredita entrega de eventos.

### Chat HTTP posterior en destino restaurado

Una docente sintética nueva y las dos familias sintéticas restauradas completaron **26 comprobaciones funcionales PASS** mediante Next.js y Supabase reales del destino aislado. Se abrieron dos conversaciones, cada familia y la docente enviaron/leyeron sus mensajes, se persistieron cuatro mensajes con acuses, cuatro avisos privados y seis acciones de auditoría. Otra familia no pudo leer, enviar ni crear conversación por el alumno ajeno; un anónimo recibió401. No se cargaron archivos y no se usó la fuente asignada a Realtime ni el proyecto escolar.

El informe `outputs/supabase-restored-chat-http-20261009.json` conserva **FAIL** por el guard de limpieza, después de las26 comprobaciones correctas: Auth avanza `profiles.updated_at` al iniciar sesión y el harness exigía una fila completamente idéntica. La inspección confirmó que únicamente cambió ese campo en los dos perfiles participantes. El guard corregido admite solo una fecha válida que avance en esos UUID; rechaza cambios de nombre, estado, otras cuentas y fechas inválidas o anteriores.

La recuperación dirigida `outputs/supabase-restored-chat-http-cleanup-20261009.json` pasó: comparó el respaldo cifrado, retiró únicamente la docente nueva, conversaciones/mensajes/avisos/auditorías y asignaciones de este ensayo, y restauró el horario anterior. Se conservaron **33 tablas/69 filas/6 Auth/3 objetos**, todos los campos escolares originales y los hashes de bytes. Las fechas administradas por Auth de esos dos perfiles permanecen actualizadas. Next se detuvo. No hubo reset, cambios de contraseñas, replay de mensajes ni modificación del primer FAIL. La evidencia funcional y la recuperación se interpretan juntas; no acreditan entrega Realtime.

Evidencia: `outputs/supabase-school-http-native-20261009-retry3.json`; informe antivirus privado `/tmp/school-scanner-20261008/scanner-integrated-20261009-retry3.json`. Los archivos `retry2` y sus respaldos se conservan. El uso manual de cookies Secure en el runner HTTP local no sustituye una prueba de navegador por HTTPS.

## Restauración completa real en destino aislado

Después del recorrido HTTP se añadieron dos familias sintéticas con contraseñas aleatorias conocidas únicamente en un archivo privado fuera del repositorio. Se exportaron y verificaron **33 tablas, 69 filas, tres documentos de Storage y seis identidades Auth**. Los UUID, hashes e identidades Auth se conservaron mediante el complemento oficial del CLI.

La restauración en un segundo Supabase nativo vacío pasó seis comprobaciones: esquema Auth idéntico y destino vacío; UUID, hashes e identidades conservados; tablas y bytes de Storage recuperados; ingreso real de las dos familias con sus contraseñas; RLS que permite únicamente su alumno; descarga real del documento por `/api/files` para la familia autorizada y rechazo 404/401 de familia ajena/anónima. El bucket sigue privado y el acceso directo a Storage mediante JWT de usuarios continúa bloqueado para todos.

Evidencia: `outputs/supabase-full-restore-backup-20261009-retry1.json` y `outputs/supabase-full-auth-restore-20261009.json`. La primera preparación del runner falló antes de escribir datos porque suponía que el UUID del objeto Storage coincidía con el UUID del registro del archivo; se corrigió comprobando su relación mediante `object_key`. Se conserva su informe fallido. Esta prueba es local y sintética; no equivale a habilitar respaldos de producción ni a restaurar datos de la escuela.

## Realtime real local: entrega, aislamiento y revocación

El intento 22 pasó nueve comprobaciones con Auth, PostgreSQL 17.11, Realtime y el SDK reales: creación/ingreso de un docente y dos familias sintéticas; suscripciones confirmadas; INSERT/UPDATE de avisos propios y de mensajes para los participantes; rechazo de avisos y conversaciones ajenos; SSE ready e invalidaciones sin cuerpos, títulos ni filas privadas; cierre voluntario sin eventos posteriores con observador de control; y revocación de perfil con lectura/eventos bloqueados y cierre SSE en el intervalo real de 30 segundos.

Evidencia: `outputs/supabase-native-realtime-20261009-attempt22.json`. **El dispatcher Undici exclusivo de cada WebSocket pertenece únicamente al harness, y `productionTransportVerified:false` permanece en el resultado.** El factory productivo, sus permisos, filtros y timeouts no cambiaron. Este PASS acredita el proveedor local y el adapter/bridge con el transporte aislado; falta verificar el transporte publicado por HTTPS y el recorrido en navegador familiar.

Los FAIL históricos permanecen. Los intentos 16–21 comprobaron entrega e aislamiento, pero SSE falló antes de abrir su socket con el dispatcher compartido. El diferencial local `outputs/supabase-native-realtime-http-reuse-differential-20261009.json` reprodujo timeout al reutilizar un socket HTTP para el upgrade y SUBSCRIBED al usar un dispatcher exclusivo. No demuestra si la causa interna corresponde a Node o al gateway Native. Se conservan también los diferenciales previos que no reprodujeron el fallo; no se ampliaron permisos ni se relajó RLS para obtener PASS.

El postflight independiente `outputs/supabase-native-realtime-20261009-attempt22-postflight.json` verificó después de la limpieza dirigida: Auth API/users/identities/sessions 0, las 33 tablas escolares sin filas y Storage objects 0. Producción y el destino restaurado permanecieron intactos. Las 17 pruebas dedicadas de guardas/restauración/plumbing y ESLint pasaron; las pruebas sintéticas de guardas no se presentan como entrega del proveedor. Ver [contrato y límites](pruebas-realtime-local.md).

## Pruebas unitarias

La ejecución del 9 de octubre sobre los 73 archivos de pruebas pasó **502 tests, cero fallos, cancelaciones o saltos**, con concurrencia limitada a dos. Evidencia privada: `outputs/unit-full-20261009.log`. Los cambios posteriores deben volver a validarse antes de publicar.
