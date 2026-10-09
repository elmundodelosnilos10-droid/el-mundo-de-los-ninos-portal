# Recorrido HTTP escolar con Supabase local

`node scripts/run-supabase-school-http-local.mjs` usa un stack **vacío, local y desechable**. No lee `.env`, `.dev.vars`, configuración de Vercel ni las claves de la escuela. No instala migraciones, inicia servicios o modifica producción.

## Servicios necesarios

- Supabase local real: PostgreSQL, Auth y PostgREST, con las migraciones escolares actuales instaladas. Puede ser un runtime nativo oficial de Supabase o una instalación local aislada; Docker no es necesario si se dispone del runtime nativo.
- Una instancia de la app en otro puerto loopback. Debe usar `SCHOOL_AUTH_PROVIDER=supabase` y `SCHOOL_DATA_PROVIDER=supabase`, URL/claves del stack local y `APP_ORIGIN` igual al origen de esa app. Arrancarla con `NODE_ENV=development` (por ejemplo `next dev`), `SCHOOL_LOCAL_SUPABASE_HTTP=isolated-test`, `VERCEL` ausente y un entorno dedicado; este runner no arranca Next.js ni carga sus archivos de entorno. En este entorno exclusivamente, `next.config.ts` activa `skipMiddlewareUrlNormalize` para evitar que Next.js convierta la URL literal a `localhost` y conserve una comprobaciónCSRF estricta entre URL y Origin. La excepciónHTTP está rechazada en `NODE_ENV=production`, por lo que `next start` necesita un transporteHTTPS local con certificado confiable, fuera del alcance de este runner.
- Claves **solo locales** en un archivo JSON regular con nombre `school-http-local-credentials.json`, permisos `0600`, contenido `{ "anonKey": "…", "serviceRoleKey": "…" }`. No escribirlas en comandos compartidos, evidencia o documentación.

La URL de app y Supabase debe ser `http://127.0.0.1:puerto` o `http://[::1]:puerto`, con puertos explícitos diferentes. Rechaza DNS, `localhost`, IP abreviada, TLS, rutas, credenciales en URL y redirecciones. Esta restricción evita resolver un nombre que apunte a otro servidor.

## Ejecución

Inyectar estas variables dedicadas al proceso, sin añadir claves al comando:

```sh
LOCAL_SCHOOL_HTTP_ISOLATED=empty-disposable-stack \
LOCAL_SCHOOL_HTTP_APP_URL=http://127.0.0.1:5199 \
LOCAL_SCHOOL_HTTP_SUPABASE_URL=http://127.0.0.1:54321 \
LOCAL_SCHOOL_HTTP_CREDENTIALS_FILE=/ruta/aislada/school-http-local-credentials.json \
LOCAL_SCHOOL_HTTP_EVIDENCE_FILE=/ruta/aislada/http-school-run-1.json \
node scripts/run-supabase-school-http-local.mjs
```

Los puertos son ejemplos; usar los puertos del runtime local. El archivo de evidencia debe no existir. Se reserva con `0600` antes de cualquier solicitud y nunca se sobrescribe. El preflight exige Auth, perfiles, roles, alumnos, ciclos, grupos, docentes y tutores vacíos antes de crear fixtures. Los servicios locales no deben actuar como proxy hacia otro servicio externo.

## Recorrido

1. Provisiona cuatro identidades Auth sintéticas (`@example.test`), perfiles y roles: dirección, docente y dos tutores. Genera contraseñas aleatorias en memoria; no envía invitaciones ni correo. Este paso es preparación del fixture, no una prueba del flujo de invitación de cuentas.
2. Inicia sesión por la **API de la app** y cookies privadas. Compara el UUID de sesión con el creado en Auth local y el directorio con el fixture local antes de escribir datos escolares.
3. Dirección crea ciclo y dos grupos, asigna docente, registra dos alumnos sintéticos y vincula un tutor diferente a cada alumno.
4. Docente publica una tarea, tutor A entrega evidencia textual, docente revisa y tutor A confirma la retroalimentación.
5. Docente registra asistencia y dos observaciones, una visible para familia y otra interna.
6. Dirección publica comunicado exclusivo del grupo A; tutor A confirma lectura del comunicado y un aviso.
7. Comprueba aislamiento de alumnos, tareas, entregas, asistencia, seguimiento, comunicados y avisos entre A y B; bloquea escrituras de tutor fuera de su rol. Comprueba registros de entrega y auditoría directamente en PostgreSQL mediante PostgREST local.
8. Cierra las sesiones y verifica que las cookies se retiraron y las APIs vuelven a exigir autenticación.

Sin `LOCAL_SCHOOL_HTTP_FILES=required`, las entregas usan nota textual y la evidencia indica archivos no solicitados. Con esa opción (o `runSchoolHttpLocal(..., { includeFiles: true })`), la app debe estar configurada con Storage privado y un analizador real activo: no hay simulación ni fallback que permita pasar la prueba sin ellos.

La extensión crea PDF sintéticos válidos en memoria, sube material de biblioteca, busca con grupo/categoría/paginación, compara bytes de previsualización/descarga conSHA256, adjunta una guía a la tarea, reemplaza el material conservando su identidad y sube evidencia del alumno antes de la revisión docente. Comprueba `private, no-store`, tipoPDF, `nosniff`, restricciones de rol y404/401 para otra familia y anónimos. FormData usa boundary automático y límite4MiB+64KiB; no devuelve enlaces públicos ni guarda contenido de archivos en la evidencia.

El runner no inicia ni sustituye el analizador. El supervisor local puede usar el hook del analizador real para mantener URL/token solo en memoria mientras arranca Next con un entorno aislado, ejecuta este recorrido y detiene ambos servicios. No habilitar `SCHOOL_FILE_SCAN_LOCAL_MOCK` en esa aceptación.

Este recorrido no certifica correos/invitaciones, videollamadas, grabaciones, push, transporte Realtime ni la configuración de producción.

## Evidencia y fallos

El JSON contiene nombres de comprobaciones, método, ruta con UUID omitidos, estado HTTP, duración y resultado. Excluye cuerpos de respuesta/solicitud, parámetros de consulta, nombres de menores, correos, contraseñas, claves, tokens y cookies. El UUID de ejecución identifica únicamente un fixture sintético.

Cada solicitud tiene un límite de30segundos, incluyendo lectura del cuerpo. No hay reintentos automáticos, ni siquiera de GET. Un POST/PATCH fallido o con tiempo agotado puede haber aplicado cambios: conserva la primera evidencia y detiene el recorrido. Nunca volver a ejecutar sobre ese mismo stack. Se requiere destruirlo/recrearlo antes del siguiente recorrido; el runner no borra datos ni manipula contadores o auditorías para limpiar.

Pruebas del propio runner:

```sh
node --test tests/supabase-school-http-local.test.mjs
node --test tests/supabase-school-http-local-files.test.mjs
node --experimental-strip-types --test tests/supabase-local-http-policy.test.mjs
```

Estas pruebas verifican guardas, transporte loopback, cookies, límites, evidencia y fallo sin reintento. No sustituyen una ejecución del recorrido contra Auth/PostgREST/PostgreSQL reales. Registrar por separado el resultado real y la ubicación del JSON al completar el stack.


## Hallazgos conservados durante la aceptación nativa

El primer intento quedó registrado comoFAIL por la normalización de loopback de Next.js (403 de origen, antes de datos escolares). El siguiente quedó comoFAIL tras14comprobaciones correctas, cuando una entrega por un alumno de otra familia recibió503 en vez de404. Ambos JSON se conservan; no hubo replay automático.

PostgREST traduce los errores de claseP0 aHTTP500; las RPC escolares usan explícitamenteP0002 para recursos no disponibles. Se verificó el código mediante una llamadaGET local sinDML y se corrigió el adaptador para interpretar soloJSON acotado con `code=P0002` enRPC500 como404. Los demás códigos/estados permanecen intactos y no se exponen message/details/hint. [Documentación oficial de errores de PostgREST](https://docs.postgrest.org/en/stable/references/errors.html).

Antes de retirar cada fixture se guardó evidencia. El segundo se respaldó cifrado (datos públicos y Auth) antes de la limpieza dirigida porUUID/relación exacta, sin reset global. No considerar la aceptación completa hasta que el nuevo JSON indiquePASS de todo el recorrido solicitado.

El intento con analizador real y Storage confirmó la subida privada del primer material, pero se detuvo después de 16 comprobaciones: el harness esperaba una lista vacía al solicitar explícitamente un grupo ajeno. La RPC devuelve correctamente 404 en ese caso. Se corrigió únicamente el harness: exige 404 para ese filtro y después consulta sin grupo para comprobar que la biblioteca autorizada de la familia B está vacía. La prueba ejecutada del helper cubre ambas respuestas, reemplazos y archivos de tareas/entregas; también exige detenerse si cambia ese contrato o una subida queda incierta. El JSON fallido se conserva y el fixture se respalda antes de su limpieza dirigida.
