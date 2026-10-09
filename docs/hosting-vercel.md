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
