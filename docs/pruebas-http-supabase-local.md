# Recorrido HTTP escolar con Supabase local

`node scripts/run-supabase-school-http-local.mjs` usa un stack **vacío, local y desechable**. No lee `.env`, `.dev.vars`, configuración de Vercel ni las claves de la escuela. No instala migraciones ni inicia servicios ni modifica producción.

## Estado comprobado · 9 de octubre de 2026

La operación publicada usa [Vercel/Next.js](https://el-mundo-de-los-ninos-portal.vercel.app), equipo pandito, y el Supabase escolar para Auth, datos y Storage. Esta guía es únicamente de **ensayos locales sintéticos**: sus claves, scripts de preparación y datos no configuran el proyecto escolar ni requieren reactivar Sites/D1. La operación vigente y pendientes de producción están en [Pruebas y operación](pruebas-y-operacion.md).

| Ensayo independiente | Resultado y evidencia | Alcance |
| --- | --- | --- |
| HTTP integrado con archivos | PASS: 149 solicitudes, 45 comprobaciones. `outputs/supabase-school-http-native-20261009-retry3.json`. | Next, Auth/PostgreSQL/Storage y ClamAV reales; dos familias, biblioteca, tarea/entrega/revisión, asistencia, seguimiento y comunicado por dirección. |
| HTTP académico en destino restaurado | PASS: **30 comprobaciones, 43 solicitudes a la app, 213 totales contando inventarios**. `outputs/supabase-school-academic-restored-local-20261009-attempt2.json`. | Calendario crear/editar/filtros, asistencia/historial/justificación/revisión, CSV/XLSX/PDF y comunicado publicado por docente; acuse y aislamiento. |
| Chat HTTP restaurado | 26 comprobaciones funcionales PASS; cleanup recuperado PASS, primer FAIL conservado. `outputs/supabase-restored-chat-http-20261009.json` y `outputs/supabase-restored-chat-http-cleanup-20261009.json`. | Docente y dos familias, cuatro mensajes/acuses/avisos, auditoría y rechazo de acceso ajeno; sin carga de adjuntos. |

Los ensayos no se suman a una única ejecución: el académico y el chat no están incluidos en las 45 comprobaciones del integrado. Las pruebas del harness usan datos sintéticos y comprueban sus guardas; los resultados de la tabla se obtuvieron contra servicios reales.

El destino restaurado quedó con su baseline **33 tablas/69 filas, Auth6 y Storage3** tras la limpieza exacta. La CLI oficial detuvo sus nueve endpoints, sin borrar datos/configuración (`outputs/supabase-school-academic-restored-local-20261009-stopped.json`). La fuente de ensayo también había quedado vacía y detenida; producción permaneció intacta. No ejecutar el modo de base vacía contra el destino restaurado, ni asumir que los puertos históricos tienen servicios activos.

Estos resultados no verifican SMTP, antivirus conectado a Vercel, respaldo/restauración de datos escolares, Google Meet, push ni entrega Realtime de producción. Las cookies Secure se transportan manualmente en Node para HTTP local; no sustituyen aceptación de navegador HTTPS. [Realtime local](pruebas-realtime-local.md) registra su ensayo por separado y la diferencia de dispatcher frente al transporte productivo.

## Servicios necesarios

- Supabase local real: PostgreSQL, Auth y PostgREST, con las migraciones escolares actuales instaladas. Puede ser un runtime nativo oficial de Supabase o una instalación local aislada; Docker no es necesario si se dispone del runtime nativo.
- Una instancia de la app en otro puerto loopback. Debe usar `SCHOOL_AUTH_PROVIDER=supabase` y `SCHOOL_DATA_PROVIDER=supabase`, URL/claves del stack local y `APP_ORIGIN` igual al origen de esa app. Arrancarla con `NODE_ENV=development` (por ejemplo `next dev`), `SCHOOL_LOCAL_SUPABASE_HTTP=isolated-test`, `VERCEL` ausente y un entorno dedicado; este runner no arranca Next.js ni carga sus archivos de entorno. En este entorno exclusivamente, `next.config.ts` activa `skipMiddlewareUrlNormalize` para evitar que Next.js convierta la URL literal a `localhost` y conserve una comprobaciónCSRF estricta entre URL y Origin. La excepciónHTTP está rechazada en `NODE_ENV=production`, por lo que `next start` necesita un transporteHTTPS local con certificado confiable, fuera del alcance de este runner.
- Claves **solo locales** en un archivo JSON regular con nombre `school-http-local-credentials.json`, permisos `0600`, contenido `{ "anonKey": "…", "serviceRoleKey": "…" }`. No escribirlas en comandos compartidos, evidencia o documentación.

La URL de app y Supabase debe ser `http://127.0.0.1:puerto` o `http://[::1]:puerto`, con puertos explícitos diferentes. Rechaza DNS, `localhost`, IP abreviada, TLS, rutas, credenciales en URL y redirecciones. Esta restricción evita resolver un nombre que apunte a otro servidor.

## Ejecución del runner principal sobre un stack vacío

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

Cada solicitud tiene un límite de30segundos, incluyendo lectura del cuerpo. No hay reintentos automáticos, ni siquiera de GET. Un POST/PATCH fallido o con tiempo agotado puede haber aplicado cambios: conserva la primera evidencia y detiene el recorrido. No volver a ejecutar ni reproducir esa escritura sobre el fixture existente. El runner principal no borra sus datos. Para otro intento, usar una base de ensayo nueva y vacía, o una limpieza dirigida coordinada después de preservar evidencia/respaldo y verificar cada UUID/relación y el estado final vacío. Ante cualquier delta inesperada, conservar el fixture para inspección; no hacer reset ni borrar datos para forzar PASS. El runner académico descrito abajo tiene un baseline ocupado y reglas de limpieza distintas.

Pruebas del propio runner:

```sh
node --test tests/supabase-school-http-local.test.mjs
node --test tests/supabase-school-http-local-files.test.mjs
node --experimental-strip-types --test tests/supabase-local-http-policy.test.mjs
```

Estas pruebas verifican guardas, transporte loopback, cookies, límites, evidencia y fallo sin reintento. No sustituyen una ejecución del recorrido contra Auth/PostgREST/PostgreSQL reales. Registrar por separado el resultado real y la ubicación del JSON al completar el stack.


## Historial de fallos conservado durante la aceptación nativa

El primer intento quedó registrado comoFAIL por la normalización de loopback de Next.js (403 de origen, antes de datos escolares). El siguiente quedó comoFAIL tras14comprobaciones correctas, cuando una entrega por un alumno de otra familia recibió503 en vez de404. Ambos JSON se conservan; no hubo replay automático.

PostgREST traduce los errores de claseP0 aHTTP500; las RPC escolares usan explícitamenteP0002 para recursos no disponibles. Se verificó el código mediante una llamadaGET local sinDML y se corrigió el adaptador para interpretar soloJSON acotado con `code=P0002` enRPC500 como404. Los demás códigos/estados permanecen intactos y no se exponen message/details/hint. [Documentación oficial de errores de PostgREST](https://docs.postgrest.org/en/stable/references/errors.html).

Antes de retirar cada fixture se guardó evidencia. El segundo se respaldó cifrado (datos públicos y Auth) antes de la limpieza dirigida porUUID/relación exacta, sin reset global. Ese intento fallido no acreditaba el recorrido completo. El posterior `retry3` registró PASS de 149 solicitudes/45 comprobaciones; los informes fallidos siguen conservados.

El intento con analizador real y Storage confirmó la subida privada del primer material, pero se detuvo después de 16 comprobaciones: el harness esperaba una lista vacía al solicitar explícitamente un grupo ajeno. La RPC devuelve correctamente 404 en ese caso. Se corrigió únicamente el harness: exige 404 para ese filtro y después consulta sin grupo para comprobar que la biblioteca autorizada de la familia B está vacía. La prueba ejecutada del helper cubre ambas respuestas, reemplazos y archivos de tareas/entregas; también exige detenerse si cambia ese contrato o una subida queda incierta. El JSON fallido se conserva y el fixture se respalda antes de su limpieza dirigida.

## Aceptación académica sobre el destino restaurado

`scripts/accept-school-academic-restored-local.mjs` y su helper `scripts/supabase-school-academic-restored-local-flow.mjs` operan exclusivamente en el destino nativo sintético restaurado, con opt-in `restored-disposable-target`. No son herramientas de producción ni sustituyen al runner principal que exige una base vacía. La reanudación del servicio se coordinó fuera del runner usando `supabase stack start --runtime native --eager --output-format json`, el directorio/hogar de ensayo correctos y un recibo nuevo privado; se comprobó antes que el servicio estuviera detenido y que su identidad coincidiera. No se usaron reset, purge, `--all` ni `--no-backup`.

Antes de cualquier escritura, el ensayo valida loopback literal, identidad del target, separación del origen fuente, recibos y archivos de claves/probes regulares `0600`, JWT locales de issuer `supabase-demo`, columnas/RPC y el baseline completo 33/69/Auth6/Storage3. Preserva un snapshot privado para recuperación. Las contraseñas familiares sintéticas ya conocidas se leen del archivo privado en memoria y no se cambian; una docente temporal nueva se asigna solo al grupo A. No crea alumnos, grupos, archivos ni identidades de prueba en el proyecto escolar.

El recorrido real confirma:

1. Docente crea y edita un evento de su grupo. Familia A consulta grupo/tipo de su hijo; familia B no recibe ese evento. El tipo distinto lo excluye; anónimo y edición familiar son rechazados. El filtro es por grupo autorizado: la API no tiene parámetro de calendario `studentId`.
2. Docente registra una falta en una fecha libre del baseline. Familia A ve su historial y presenta una justificación con comillas, acentos y saltos de línea. Docente consulta la petición y la acepta; historial familiar/docente y lista de peticiones reflejan el motivo completo. Familia ajena/anónimo o revisión familiar quedan bloqueados.
3. Docente exporta mediante **POST `/api/attendance/report`** CSV, XLSX y PDF. CSV se decodifica con comillas/saltos; XLSX se descomprime y comprueba como paquete OOXML con todas las celdas; PDF valida cabecera, offsets xref, EOF y texto WinAnsi de las cinco columnas. Se comparan fecha, grupo, nombre, estado y observación completos; MIME por sí solo no acredita el reporte. No se afirma apertura visual en Excel ni render de PDF. Texto fuera del repertorio WinAnsi mantiene el límite documentado del generador.
4. Docente publica un comunicado de su grupo, familia A lo recibe y acusa; familia B no lo recibe ni puede acusarlo. Publicación en grupo ajeno es rechazada. PostgREST verifica filas, autor docente, revisión, acuse y tres auditorías de exportación persistidas.

El `attempt1` se conserva como FAIL: el harness esperaba403 para publicar calendario en grupo ajeno, pero SQL15 devolvió correctamenteP0002/API404. Se corrigió solo la expectativa a404, también para comunicado SQL16. Su cleanup PASS comprobó que no había cambios ajenos; el `attempt2` creó un fixture nuevo, sin repetir una escritura incierta.

La limpieza inspecciona primero todas las tablas, Auth e inventario/bytes Storage. Solo retira PK de filas nuevas vinculadas al ensayo, en transacción y con reglas explícitas, y la docente Auth temporal; ante una fila original alterada o delta inesperada se detiene y conserva el estado. El postflight comprobó baseline exacto, hashes de contraseñas, campos de identidad y bytes originales. `profiles.updated_at` puede avanzar legítimamente para las dos familias que iniciaron sesión; sus demás campos deben coincidir. Las sesiones del intento exitoso se cerraron antes de detener Next. El target nativo se detuvo después con CLI oficial, conservando el baseline.

Pruebas focalizadas de guardas y parsers, sin una simulación que sustituya al proveedor:

```sh
node --test tests/supabase-school-academic-restored-local.test.mjs
```

Las cinco pruebas y ESLint pasaron. La evidencia PASS real está en `outputs/supabase-school-academic-restored-local-20261009-attempt2.json`; el FAIL1 y los registros de cierre permanecen separados. No se modificaron fuentes productivas, SQL ni configuración de proveedores en este ensayo. No ejercita rechazo/concurrencia de revisiones ni UI de navegador de producción.
