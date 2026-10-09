# Hosting real en Vercel

El destino Vercel sirve los componentes del portal y sus Route Handlers en Node.js con Next.js. No hay un proxy al sitio anterior. El proyecto Supabase de la escuela debe proporcionar autenticación, datos y archivos privados.

## Builds independientes

- `npm run build:vercel`: Next.js; la salida es `.next`.
- `npm run start:vercel -- --port 5180`: ejecuta localmente la compilación Next.
- `npm run dev:vercel -- --port 5180`: desarrollo Next.
- `npm run build`: conserva el build Sites/Vinext y sus bindings Cloudflare; la salida es `dist`.

`vercel.json` fija el framework Next.js y el comando `build:vercel`. `tsconfig.next.json` revisa solo las fuentes de la app; la configuración Vite y el Worker pertenecen al otro build.

## Entorno servidor

Todos los imports de entorno deben apuntar a `@/lib/runtime/env`. En Next, el módulo lee las variables privadas de `process.env`. En Sites, un alias Vite exacto lo sustituye por el módulo que exporta los bindings reales de Cloudflare.

Las variables de Vercel deben configurarse como secretos de servidor, sin prefijo `NEXT_PUBLIC_`:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.
- `SCHOOL_AUTH_PROVIDER=supabase`, `SCHOOL_DATA_PROVIDER=supabase`, `SCHOOL_FILE_STORAGE_PROVIDER=supabase`.
- `SUPABASE_STORAGE_BUCKET=school-files`.
- `APP_ORIGIN` y `BETTER_AUTH_URL`: URL HTTPS del hosting elegido, utilizada para validar origen y enlaces.
- `SCHOOL_FILE_SCAN_URL`, `SCHOOL_FILE_SCAN_TOKEN`: servicio privado de análisis de archivos. Las cargas fallan cerradas si falta, sin habilitar el modo ficticio local en producción.
- Supabase Auth envía invitaciones y recuperación en modo Supabase. Configurar un SMTP aprobado en Supabase antes de ampliar destinatarios y volumen; no se ha verificado entrega masiva. Gmail OAuth/Resend corresponden al proveedor legacy.

Node no contiene bindings D1/R2. Una ruta que aún llame a D1 no queda migrada por cambiar el import: requiere una operación Supabase real o una respuesta explícita de indisponibilidad. No se deben inventar registros ni aceptar una operación sin persistirla.

## Estado de comprobación

- `npm run build:vercel`: pasó la compilación Next, el chequeo TypeScript, la generación de páginas y las trazas de servidor. La salida enumera las páginas y las API reales del portal, además del proxy de refresco de sesión.
- `npx tsc --noEmit --project tsconfig.next.json`: cero errores después de corregir tipado previo en operaciones batch, lectura JSON, cursores y bytes de cargas.
- `npm run build`: también pasó el build Sites con el alias Cloudflare. Mantener ambas compilaciones no convierte los bindings D1 en una base de datos Node.

Esto confirma que la infraestructura compila en ambos destinos. El acceso autenticado y la persistencia completa deben comprobarse después de conectar la capa de datos Supabase. El hosting de producción ya está desplegado en https://el-mundo-de-los-ninos-portal.vercel.app con Next.js y servidor propio en Vercel; no se utiliza un proxy al sitio anterior.

## Identidad en páginas con rama Supabase

Las páginas de Asistencia, Biblioteca, Calendario, Clases, Comunicación, Comunicados, Grupos, Tareas, Alumnos y el expediente individual usan `getSchoolPageActor(headers)` en el servidor. En modo Supabase, exige una sesión verificada, que el UUID autenticado coincida con el perfil activo y roles consultados mediante el JWT de esa persona. El actor incluye `supabaseAuth` para consultas sujetas a RLS; el token no se pasa a componentes del navegador.

Sus lecturas D1 y `getDb()` quedan dentro de las ramas D1. Los DTO para los componentes existentes conservan nombres y estructura, incluido el nombre del grupo y los campos escolares transformados de snake_case. Comunicación entrega el actor verificado al lector compartido del horario escolar y muestra un error si no puede comprobarlo, sin habilitar el chat durante ese fallo. Alumnos reutiliza el RPC de directorio existente; el expediente reutiliza los lectores existentes de tutores sujetos a RLS.

Después de estos cambios, ESLint de las páginas migradas y el helper pasó. El chequeo TypeScript de las fuentes también pasó con una configuración temporal que excluye los artefactos `.next` generados por compilaciones anteriores de ambos destinos. La compilación final del conjunto integrado corresponde al despliegue coordinado, una vez que todos los cambios del backend estén cerrados.

## Seguimiento y logros familiares

Seguimiento y Actividades también usan el actor verificado y el listado real de matrículas activas autorizadas. La migración `20261022000000_school_progress_rpcs.sql` agrega el listado compartido sujeto a RLS y dos escrituras transaccionales: observación con auditoría y aviso familiar cuando corresponde, y logro familiar con auditoría.

PostgreSQL vuelve a comprobar relación familiar, etapa, respuesta del catálogo y límites del dibujo; una llamada directa al RPC tampoco puede guardar un logro por otra familia ni por una docente. Los permisos de escritura directa de Observaciones y Logros se revocan. Consultar observaciones conserva la visibilidad privada del equipo escolar mediante RLS. Las respuestas de API conservan los nombres esperados por la interfaz.

El catálogo de validación del RPC debe actualizarse junto con `app/actividades/catalog.ts` y `answers.ts` al agregar actividades reales. No se crean alumnos, logros u observaciones de ejemplo en la migración. El fixture `tests/supabase-progress.integration.sql` contiene únicamente pruebas reversibles para PostgreSQL de ensayo y requiere una transacción del operador terminada en ROLLBACK; su ejecución pasó en PostgreSQL real dentro de una transacción terminada en ROLLBACK.

## Configuración aplicada el 8 de octubre de 2026

- Proyecto Vercel `el-mundo-de-los-ninos-portal`, equipo `pandito`.
- Proveedores Auth, datos y Storage configurados como Supabase escolar (`gzojyxrxamydrqcxljdg`).
- `SUPABASE_SECRET_KEY` existente almacenada como **Sensitive** en Production y Preview mediante CLI autenticada; fuera del código y de respuestas del navegador.
- Site URL de Supabase apunta al dominio Vercel. Lista permitida incluye `/restablecer` exacta; se preservó la URL previa de recuperación.
- Cuenta escolar activa y con rol superadmin, cambio específico autorizado. La contraseña anterior fue rechazada en el único intento actual; se solicitó recuperación y el titular informó que guardó una contraseña nueva. No se considera probado un ingreso exitoso hasta comprobar el portal.
- Migraciones base más 10–26: **22 versiones instaladas** en `supabase_migrations.schema_migrations`, con fuente SQL de cada versión y manifiestos SHA256 en `outputs`. Las dos tandas se confirmaron por separado en transacciones.

La presencia de variables no confirma una carga/descarga de archivos. El scanner privado sigue sin configurar; cargas bloqueadas. Grabaciones deshabilitadas. Los respaldos requieren la configuración y prueba de restauración documentadas.

## Último despliegue comprobado

Producción READY: `dpl_8g4Q2BeNPdgNrLWhrM9DXcBz9xcy` (8 octubre2026 21:42CDMX), framework Next.js, URL canónica https://el-mundo-de-los-ninos-portal.vercel.app. Build remoto y 12 verificaciones HTTP públicas pasaron. 278 pruebas unitarias y258 smoke local aislado pasaron; fixtures PostgreSQL pasaron. Ingreso autenticado después del cambio de contraseña aún requiere comprobarse.

## Actualización final · 22:30 CDMX

Producción READY `dpl_xkMxs8YubpLYXSrSADubeUpUXVXC`, Next.js16.3.4, alias https://el-mundo-de-los-ninos-portal.vercel.app. 363 pruebas unitarias,262 smoke D1 aislados, ESLint, builds Next/Sites/remoto y17 controles HTTP públicos pasaron. 24 versiones SQL instaladas, incluidas biblioteca27/calendario28; no se aplicó el permiso de respaldo29.

Sesión escolar y lectura administrativa verificadas en navegador. Biblioteca con búsqueda/previa privada, filtros del calendario, notificaciones tolerantes a fallos, PDF de asistencia completo y presentación correcta del chat para administración publicados. Cinco pantallas autenticadas revisadas con emulación móvil sin desbordamiento. Las escrituras de escuela/familias, objetos Storage, escáner real y respaldo/restauración siguen pendientes de verificación. Detalle y límites en `docs/verificacion-vercel-supabase-20261008.md`.

## Límite de nuevas cargas publicado

Las cargas nuevas de biblioteca, reemplazos, materiales de tareas, evidencias y chat se limitan a **4 MiB (4,194,304 bytes) por archivo**, mostrado como hasta 4 MB en la interfaz. El cuerpo multipart completo tiene un máximo absoluto de **4,259,840 bytes** (archivo más 64 KiB de formulario), aplicado antes de analizar el formulario y también cuando falta Content-Length. Es inferior al límite de 4.5 MB de Vercel; no se modifica ese límite del proveedor. [Límite oficial](https://vercel.com/docs/functions/limitations). La interfaz comprueba cada archivo antes de enviarlo y traduce un 413 del hosting incluso si la respuesta no es JSON.

Esta corrección se publicó en el despliegue Realtime del 8 de octubre a las 23:09 CDMX; la carga real sigue pendiente de escáner. No cambia los límites de lectura de archivos anteriores: las descargas autorizadas conservan el flujo privado y los máximos Storage de 10 MiB para documentos/imágenes y 25 MiB para audio. No se devuelven URL públicas ni credenciales al navegador.

El scanner continúa bloqueando cargas hasta disponer de servicio, motor y firmas reales comprobados. Su máximo preparado de 20 MiB ya admite todas las cargas nuevas de 4 MiB; no se pretende reanalizar o reemplazar automáticamente archivos antiguos mayores. Biblioteca, tareas y adjuntos del chat muestran la indisponibilidad cuando falta la configuración privada. Una configuración sintáctica no prueba la salud del antivirus: cualquier fallo de revisión permanece bloqueado. Consultar [el estado del servicio](servicio-scanner-privado.md).

## Actualización Realtime · 23:09 CDMX

Producción READY `dpl_3ABfnzZfGT84WHgjZzXzZzfWzZpw`, URL única https://el-mundo-de-los-ninos-portal-daplq52b1-pandito.vercel.app, promovida al dominio canónico. Realtime 30 autorizado/aplicado: 25 versiones SQL; el permiso de respaldo 29 sigue pendiente. Indicador no secreto `SCHOOL_REALTIME_PROVIDER=supabase` configurado solo en Production. Conexión real SSE/Supabase comprobada con la administradora. 446 pruebas unitarias,262 smoke D1 aislados, lint y builds local/remoto pasaron;19 controles HTTP pasaron en stage y producción. La entrega de eventos entre familias aún requiere ensayo aislado.

## Versión visual publicada · 9 de octubre de 2026

Producción **READY `dpl_4sXXo1ay6qqbsTZJbYTmMHjDSqjB`**, URL única https://el-mundo-de-los-ninos-portal-2nurcwi89-pandito.vercel.app, promovida a https://el-mundo-de-los-ninos-portal.vercel.app. El usuario decidió conservar el hosting en el equipo `pandito`; el traslado a otra cuenta quedó cancelado y no requiere continuar la verificación telefónica.

La versión conserva el logo y los colores escolares. Incluye navegación con iconos consistentes, accesos por rol, saludo breve, métricas en dos columnas en celular, estados vacíos con instrucciones y enlaces, foco visible y controles de al menos 44 px. Se verificó el inicio administrativo con sesión real en escritorio y emulación 390 × 844; no desborda horizontalmente y las métricas forman dos columnas. No se crearon alumnos ni registros de prueba en producción.

La fuente pasó **512 pruebas unitarias**, ESLint sin avisos, TypeScript y las compilaciones Next/Sites. La compilación remota pasó; **19 controles HTTP** pasaron en el despliegue antes de promoverlo y otros 19 en el dominio canónico. Los intentos del runner que exigían JSON en un 405 vacío y omitían Origin en un POST se conservaron; se corrigieron esas expectativas manteniendo la protección CSRF.

Evidencia privada: `outputs/vercel-release-presentable-20261009.json`, las dos capturas `portal-production-presentable-{desktop,mobile}-20261009.jpg` y los informes `vercel-presentable-{stage,production}-http-20261009-retry2.json`. Los ensayos locales reales de archivos/antivirus y restauración constan en `docs/verificacion-cierre-local-20261008.md`; no habilitan automáticamente el scanner ni los permisos de respaldo del proyecto escolar. La cuenta administrativa y sus permisos permanecen verificados; correo, configuración escolar, pruebas físicas y aprobación operativa siguen en el registro de requisitos.

## Correcciones publicadas el 9 de octubre de 2026

La versión `dpl_44sWbxTREwV9Fu3WRSCCSH2ZBmaU` quedó READY y se promovió al dominio habitual desde el mismo build previamente comprobado. URL de la versión: https://el-mundo-de-los-ninos-portal-k2kfiwfjw-pandito.vercel.app.

Pasaron 538 pruebas sin fallos, lint sin advertencias, TypeScript y las compilaciones Next.js/Sites. La versión pasó 19 controles HTTP antes de promover y otros 19 en el dominio habitual. El inventario real de subida del CLI excluyó configuraciones, temporales y evidencias; la búsqueda de tres valores privados existentes no encontró coincidencias.

Correcciones: maceta con tres semillas y paleta de 44 px; guardado de actividades sin mezclar hijos ni perder historial ante respuestas tardías; cierre de sesión con error y reintento; foco de Avisos restaurado al cerrar; descarga de grabaciones existentes bloqueada con404 antes de Storage para todos los roles; solicitudes de privacidad rechazadas con403 para roles no permitidos.

La revisión autenticada de administración abrió las 18 pestañas a 320×740 sin error de aplicación ni desbordamiento del documento. El panel principal también se capturó a 390×844 con sus cuatro métricas en dos columnas, y en escritorio se verificó el foco de Avisos. Son vistas móviles emuladas de una escuela vacía: no acreditan un dispositivo físico ni el recorrido familiar completo en producción.

Evidencias locales: `outputs/vercel-release-final-20261009.json`, `outputs/release-validation-final3-20261009.json`, `outputs/portal-production-final-pages-mobile-20261009.json` y capturas `portal-production-final-desktop-20261009.jpg` / `portal-production-final-mobile-20261009.jpg`. Los informes anteriores se conservan.

La conexión HTTPS de avisos se observó con la cuenta administrativa existente. El ensayo Realtime aislado pasó entrega, aislamiento y revocación con un dispatcher exclusivo del harness; no sustituye la aceptación publicada entre docentes/familias. Siguen pendientes el analizador privado publicado, la entrega de correo comprobada, el permiso adicional de respaldo y la revisión operativa/privacidad de la escuela. La transferencia de cuenta Vercel continúa diferida por decisión del usuario.

## Preparación de avisos externos publicada · 9 de octubre de 2026

Versión **READY `dpl_92bcpusyKwDi7nQ2CKhqP6PHcHSe`**, URL única https://el-mundo-de-los-ninos-portal-fn3puof77-pandito.vercel.app, promovida al dominio habitual desde el mismo build comprobado. Fuente del código registrada en GitHub privado escolar: `7ea2ae7c0b4f6c70ecce45fc6b675636f085fc77`, 518 blobs auditados; posteriores commits documentales no alteran esa compilación.

589 pruebas pasaron; lint, TypeScript, Next/Sites y build remoto pasaron. 27 controles HTTP pasaron antes de promover y 27 en el dominio habitual, incluidos acceso anónimo/CSRF de los nuevos handlers y el asset genérico del service worker. El inventario de subida real excluyó configuraciones/evidencias/temporales y no contenía los tres valores privados comprobados.

Los cuatro indicadores exactos de configuración externa no están definidos en Production: proveedores email/push, worker y settings. Mi cuenta con la sesión administrativa no muestra los controles opcionales. No se registró un dispositivo ni se solicitó permiso de notificaciones. SQL31 no está aplicado en producción; esta publicación prepara código y documentación, sin activar envíos, nuevos permisos de base ni un cron.

Evidencia: `outputs/vercel-release-notices-20261009.json`, `outputs/github-publication-remote-notices-20261009.json`, `outputs/vercel-notices-{stage,production}-http-20261009.json` y los dos informes `new-routes`. La captura administrativa es `outputs/portal-production-notices-release-20261009.jpg`. El escaneo de logs del release en esa ventana devolvió cero entradas de nivel error; no se inspeccionaron drains ni se configuró monitoreo externo.

Scanner, recepción de correos Auth, permiso/backup de producción y aceptación escolar siguen pendientes. Ver [avisos externos preparados](notificaciones-externas.md) y [registro de requisitos](estado-requisitos.md).

## Release de estabilidad publicado · 9 de octubre de 2026

Versión **READY `dpl_8YhGFfsnnz5MH1GpMN7v2cVFvJtT`**, URL única https://el-mundo-de-los-ninos-portal-513l6al28-pandito.vercel.app, promovida al dominio habitual desde el mismo build comprobado. Fuente del código: `fadddc3e0b35b4413fa73cf948668d1547144c24`, 538 blobs en GitHub privado escolar. Los commits posteriores de documentación no cambian ese código publicado.

La suite final pasó **656 pruebas**, lint sin avisos, TypeScript y Next/Sites. Se verificaron **32 controles HTTP antes de promover y 32 en el dominio habitual**: páginas públicas, 404/noindex, redirecciones privadas antes del cuerpo, APIs anónimas y protección CSRF. El inventario real excluyó configuraciones, evidencias y temporales; no encontró los tres valores privados comprobados.

Incluye pantallas de error/carga/404 con el logo oficial, hook de errores acotado sin campos de solicitud/error, acceso de API/página con tres verificaciones por invocación e historial paginado de observaciones. Se mantienen verificaciones frescas por petición y autorización RLS/RPC. El destino legacy exige asignación docente real para notas internas; una denegación no se muestra como historial vacío.

La revisión CUA del dominio comprobó Seguimiento y Mi cuenta de administración, sin matrícula, un título/región principal y sin desbordamiento. Los tres campos de contraseña estaban vacíos y los avisos externos permanecían ocultos. La pantalla 404 y su enlace al inicio funcionaron. Captura: `outputs/portal-readiness-release-20261009.jpg`; reporte `outputs/portal-production-readiness-ui-20261009.json`. No se introdujeron alumnos ni se provocaron excepciones en producción. El fixture local separado de error/carga pasó 23 comprobaciones HTTP y CUA 320/1151; se detuvo después.

La inspección acotada de logs del nuevo despliegue, antes de promoverlo, devolvió cero filas de nivel error. No acredita un servicio externo de alertas, drains o retención. No se configuraron Google, analizador privado, SMTP, SQL29, SQL31 ni proveedores de avisos por este release; las cargas publicadas siguen cerradas mientras falte el análisis. Aceptación de docentes/familias, Meet, respaldos escolares y revisión de privacidad continúan en el registro de requisitos.

Evidencias: `outputs/vercel-release-readiness-20261009.json`, `outputs/release-validation-readiness3-20261009.json`, `outputs/vercel-readiness-{stage,production}-http-20261009.json`, informes `new-routes`, inventario `vercel-upload-readiness-audit-20261009.json` y `github-publication-remote-readiness-20261009.json`.
