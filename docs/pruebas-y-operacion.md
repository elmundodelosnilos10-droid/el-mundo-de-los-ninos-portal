# Pruebas y operación

## Operación vigente · 9 de octubre de 2026

El portal publicado ejecuta Next.js y sus API en [Vercel](https://el-mundo-de-los-ninos-portal.vercel.app), equipo **pandito**, conservado por decisión del usuario. El release READY vigente es `dpl_92bcpusyKwDi7nQ2CKhqP6PHcHSe`. Auth, datos escolares y Storage privado usan el Supabase de la escuela; D1/R2 pertenecen al destino Sites anterior. El servidor verifica UUID/JWT, perfil activo, roles y relaciones mediante RLS/RPC. No hay un proxy al Site ni un corte a D1 pendiente para esta operación.

Los indicadores de proveedor del entorno servidor Vercel son `SCHOOL_AUTH_PROVIDER=supabase`, `SCHOOL_DATA_PROVIDER=supabase` y `SCHOOL_FILE_STORAGE_PROVIDER=supabase`; el bucket es `school-files`. Las claves permanecen privadas, sin `NEXT_PUBLIC_`. `APP_ORIGIN` y `BETTER_AUTH_URL` corresponden al dominio HTTPS de Vercel. `npm run build:vercel` construye Next; `npm run build` construye exclusivamente el destino Sites legacy y no publica el portal Vercel.

Las migraciones 27/28 quedaron instaladas: el registro de esa tanda confirmó **24 versiones**, fixtures terminados en ROLLBACK y cero alumnos/cuentas sintéticas (`outputs/supabase-library-calendar-release-20261008.json`). El registro posterior de Realtime confirmó **25 versiones**, SQL30 aplicada, publicación exclusiva de avisos/mensajes/horario con INSERT/UPDATE y sin DELETE/TRUNCATE (`outputs/supabase-realtime-release-20261008.json`). Son observaciones fechadas, no una consulta nueva del catálogo. **SQL29 de respaldo continúa sin aplicar; la nueva SQL31 tampoco está aplicada.** No aplicar pendientes por implicación de esta guía ni reactivar proyectos legacy.

Para configuración vigente y responsabilidades, consultar [Hosting Vercel](hosting-vercel.md), [Estado de requisitos](estado-requisitos.md) y [Verificación publicada](verificacion-vercel-supabase-20261008.md). El archivo histórico desplegable más abajo conserva el contexto Sites, pero no es la guía de operación del portal actual.

## Evidencia vigente y sus límites

- **Release publicado:** 589 pruebas, lint, TypeScript y compilaciones Next/Sites PASS en `outputs/release-validation-external-notices-20261009.json`. El release pasó 27 controles HTTP en stage y 27 en el dominio habitual; Mi cuenta administrativa confirmó la configuración opcional oculta, campos de contraseña vacíos y ausencia de desbordamiento. SQL31/proveedores/worker siguen sin activar. La revisión móvil de 18 secciones pertenece al release previo y se conserva como evidencia fechada; no se repitió completa. No se acreditan todos los flujos con docentes/familias reales.
- **HTTP Supabase local integrado:** PASS de 149 solicitudes y 45 comprobaciones, con Auth/PostgreSQL/Storage y ClamAV reales, dos familias sintéticas y archivos privados (`outputs/supabase-school-http-native-20261009-retry3.json`). Los FAIL anteriores se conservan. No acredita el analizador de producción.
- **HTTP académico adicional:** PASS de **30 comprobaciones, 43 solicitudes a la app y 213 totales contando inventarios**, en el destino nativo restaurado aislado. Calendario creado/editado por docente, filtros de grupo/tipo y acceso del hijo, historial, justificación familiar, revisión docente, reportes CSV/XLSX/PDF y comunicado publicado por docente con acuse/aislamiento (`outputs/supabase-school-academic-restored-local-20261009-attempt2.json`). PostgREST confirmó persistencia y autoría. El primer FAIL de expectativa 403 frente al 404 correcto permanece en `attempt1`; no se reintentó aquella escritura. La limpieza dirigida preservó las 33 tablas/69 filas, Auth6 y Storage3, hashes de contraseña, campos de identidad y bytes originales; solo se admitió el avance legítimo de `profiles.updated_at` durante el login familiar. Cinco pruebas focalizadas del harness y su lint pasaron. Esta aceptación HTTP real es independiente del conteo de pruebas unitarias del release.
- **Chat y Realtime locales:** el chat restaurado pasó 26 comprobaciones funcionales y recuperó su limpieza tras conservar el primer FAIL. Realtime pasó en el intento22 con proveedor real y dispatcher Undici exclusivo del harness; `productionTransportVerified:false`. La conexión administrativa publicada no acredita aún entrega/aislamiento entre familias y docentes. Ver [HTTP local](pruebas-http-supabase-local.md) y [Realtime local](pruebas-realtime-local.md).
- **Restauración completa local:** PASS de Auth6, 33 tablas/69 filas y tres objetos, UUID/hashes conservados, login de dos familias, RLS y descarga privada después de restaurar (`outputs/supabase-full-auth-restore-20261009.json`). El CLI escolar de tablas públicas/Storage no incluye Auth: el ensayo usó un complemento separado. No representa respaldo o restauración de datos escolares de producción.

- **Restauración opcional36 real:** 14 comprobaciones PASS, 36 tablas/51 filas y tres usuarios/identidades Auth; copia cifrada/verificación offline/restauración exacta, login/RLS de dos familias, rechazo de catálogo33 parcial y lease vencido→uncertain sin reclamar/reautorizar inciertos (`outputs/supabase-backup36-auth-local-20261009-attempt2.json`). Cero objetos Storage en este ensayo; no prueba descarga de bytes. No hubo dispatcher ni proveedor externo. Los dos proyectos nuevos se detuvieron; los anteriores quedaron detenidos y con huella exacta de todos sus archivos de datos. La raíz verificó por separado atribución nativa y seis puertos únicos cerrados de cada uno de los cuatro stacks (`outputs/supabase-backup36-auth-local-independent-stop-20261009.json`). Primer FAIL de metadataTCP conservado antes de arranque/DML. No es respaldo de producción.

Los servicios de ensayo están detenidos. Después de la aceptación académica se cerraron los nueve endpoints del **destino restaurado** mediante la CLI oficial, conservando datos y configuración (`outputs/supabase-school-academic-restored-local-20261009-stopped.json`). No arrancar el runner contra ese destino ocupado usando el modo que exige una base vacía; la fuente escolar y el hosting no se modificaron. CSV/XLSX/PDF se comprobaron mediante bytes, estructura y texto, sin afirmar revisión visual en Excel/PDF ni un navegador HTTPS. Las cookies Secure del runner Node local no representan un navegador sobre HTTP.

## Dependencias operativas pendientes

El intento de respaldo escolar publicado recibió **403 en `GET profiles`**; SQL29 de lectura todavía requiere su autorización y aplicación. Una exportación parcial no es un respaldo completo. El CLI cifra las 33 tablas públicas y los objetos de `school-files`, **no exporta `auth.users`, hashes, identidades ni sesiones**. La recuperación escolar debe incorporar un mecanismo separado del proveedor que preserve Auth y probarlo con el destino correspondiente. Ver [Respaldo Supabase](respaldo-supabase.md).

El analizador real ClamAV pasó ensayos locales, pero no hay un servicio privado conectado al hosting de producción: las cargas continúan bloqueadas hasta configurarlo y comprobarlo. `SCHOOL_FILE_SCAN_LOCAL_MOCK` y la excepción `SCHOOL_LOCAL_SUPABASE_HTTP` pertenecen solo a pruebas loopback; no habilitarlos en Vercel. SMTP/invitación/recuperación con destinatarios autorizados, respaldo/restauración escolar, uso acompañado con familias y revisión de privacidad siguen pendientes. Meet requiere sala y admisión probadas por la organizadora en Google; sus grabaciones continúan deshabilitadas. Esta guía no declara esos servicios de producción probados.

## Historial legacy conservado

<details>
<summary>Archivo Sites/D1/R2 de 7–8 de octubre de 2026 — instrucciones superadas para Vercel</summary>

**Solo referencia histórica.** Los comandos, valores predeterminados, tokens Cloudflare, migraciones entonces pendientes y demostraciones de este bloque corresponden a Sites/D1/R2. No son pasos para operar, publicar o recuperar el portal Vercel/Supabase actual. Consultarlos únicamente para un recurso legacy o ensayo desechable identificado; no cambiar el proveedor del portal actual ni activar proyectos anteriores siguiendo este archivo.

## Archivo histórico Sites/D1/R2 (7–8 de octubre de 2026)

El contenido siguiente conserva la evolución y procedimientos de **Sites/D1/R2**, incluida su demostración sintética. Las frases sobre backend “actual”, vínculos por correo, RPC sin aplicar o mantener D1 describen aquel momento. No configuran ni restauran el portal Vercel vigente. Las rutinas Cloudflare se usan solo para recursos legacy identificados y autorizados; para el respaldo escolar Supabase, seguir la guía enlazada arriba. Las cifras y resultados de pruebas de estos bloques son históricos, no el último resultado integrado.

## Backend histórico de Sites/D1 (8 de octubre de 2026; superado)

En esa versión histórica, la aplicación usaba D1 para registros escolares y Supabase Auth para iniciar sesión; D1 era la fuente de cuentas y roles de Sites. Tras una contraseña válida, el servidor copia de forma idempotente los roles escolares de esa cuenta a `public.user_roles`, sincroniza el nombre y activa su perfil Supabase antes de crear la sesión del portal. Si el perfil no se actualiza correctamente, el inicio de sesión devuelve un error temporal y no crea la sesión. Las cargas nuevas usan el bucket privado Supabase `school-files`; los objetos anteriores continúan en R2. El proyecto Supabase recibió las migraciones de esquema, Storage privado, RLS y la protección de cuentas por invitación. La cuenta de Dirección aparece confirmada en Auth, pero este flujo aún no se ha verificado con una sesión real de la escuela. La migración de datos no se ha ejecutado; no cargar información real de alumnos hasta completar y comprobarla.

La ruta de ciclos y grupos había incorporado un backend opcional para Supabase. `SCHOOL_DATA_PROVIDER` acepta `d1` o `supabase` y su valor de ejemplo es `d1`. Las mutaciones en Supabase usan RPCs que comprueban el usuario autenticado, exigen un rol de dirección y registran auditoría dentro de la misma transacción. La migración `20261010000000_school_year_group_rpcs.sql` debe aplicarse al proyecto escolar antes de activar esa opción; la función aún requiere comprobación en el Postgres remoto y la transferencia de los datos existentes. El resto de los módulos sigue leyendo y escribiendo en D1.

Cuando Supabase se habilite de forma controlada, las consultas para elegir docentes y tutores leen los enlaces activos y después sus perfiles mediante el JWT escolar; RLS limita los perfiles a Dirección. En esa instantánea, las rutas seguían usando D1 con el valor predeterminado.

Los comunicados tienen una ruta Supabase opcional con RPC para leer solo mensajes visibles por grupo, publicar con auditoría y notificaciones internas en una transacción, y marcar recibos personales de lectura. La migración local `20261016000000_school_announcement_rpcs.sql` todavía no se había aplicado a PostgreSQL. La instrucción de entonces era mantener D1 hasta verificar identidades, grupos, matrículas, comunicados y políticas en un proyecto de ensayo; consulta `docs/migracion-comunicados-supabase.md`.

El listado paginado de alumnos para Dirección y el alta conjunta de alumno/inscripción también tienen rutas Supabase opcionales. El alta es transaccional y registra auditoría; las listas de docente y tutor consultan filas autorizadas por RLS y omiten la fecha de nacimiento. Requieren aplicar `20261010000001_school_student_rpcs.sql` antes de habilitarse. Las pruebas actuales son sintéticas y aún no verifican estas RPC contra Postgres remoto.

La asistencia tiene una migración Supabase aditiva con siete RPC transaccionales. Cuando `SCHOOL_DATA_PROVIDER=supabase`, el API usa esas funciones para registro, historial, justificaciones, revisión y reportes; la pantalla carga grupos y alumnos con el JWT escolar y RLS. D1 era el valor predeterminado de esa versión Sites. Ejecutar `node --test tests/supabase-attendance-contract.test.mjs tests/supabase-rls.test.mjs` para las comprobaciones estáticas. Antes de aplicar `20261012000000_school_attendance_rpcs.sql`, revisar la compatibilidad de los datos existentes con las restricciones `NOT VALID`, resolver alumnos con más de una inscripción activa y probar en un proyecto Supabase de ensayo. No se ha ejecutado contra PostgreSQL remoto.

Tareas y entregas también tienen rutas Supabase opcionales y la migración local `20261013000000_school_task_submission_rpcs.sql`: publica tareas, registra entregas/reentregas y retroalimentación, asocia archivos privados, envía avisos y restringe lecturas por grupo y matrícula activa. La biblioteca tiene la migración local `20261014000000_school_library_rpcs.sql` y rutas opcionales bajo RLS y RPC. Calendario, clases de Meet y notificaciones tienen la migración local `20261015000000_school_calendar_class_rpcs.sql` y sus rutas opcionales. En esa fecha, `SCHOOL_DATA_PROVIDER` permanecía en `d1` y el procedimiento histórico exigía respaldo/importación y comprobación en PostgreSQL antes del corte. Consulta `docs/migracion-tareas-supabase.md`, `docs/migracion-biblioteca-supabase.md` y `docs/migracion-calendario-supabase.md`.

Desde **Cuentas**, una persona autorizada puede enviar una invitación para que la familia o docente cree su contraseña desde el enlace. La prueba `npm run test:invitation-recovery` cubre la reconciliación de identidades después de un fallo ambiguo. El origen del Site queda configurado en `APP_ORIGIN`; el enlace de invitación se valida para volver a `/restablecer`. La suite de `tests/supabase-auth.test.mjs` cubre invitación, validación de redirección, borrado administrativo compensatorio y el formato de credenciales `sb_secret_`. Estas pruebas usan respuestas sintéticas: falta verificar en producción el envío y recepción de invitaciones y completar el acceso de Dirección.

## Pruebas sintéticas locales históricas (8 de octubre de 2026)

`tests/smoke.mjs` cubre alta única, cierre del registro público, ciclo y grupos, cuentas de prueba, relación tutor-alumno y aislamiento entre familias, edición de expediente por dirección y bloqueo para familias, baja/reactivación de alumnos con historial conservado y comprobación de accesos a expediente, chat y archivos, tareas con materiales privados adjuntos y descarga autorizada, los cinco estados de tarea (pendiente, entregada, revisada, completada y vencida), evaluación formativa, avisos por tarea, clase, evento y observación visible, restricción de evaluación académica para maternal, edición de cuenta, cambio de tipo de acceso con revocación de sesiones, restricción para asignar dirección y validación de correo duplicado, suspensión/reactivación, revocación de sesiones y bloqueo de inicio de sesión, filtros y paginación en servidor para cuentas, alumnos y grupos, imágenes sin metadatos EXIF/XMP verificadas por la API del chat y la biblioteca, archivos privados y audio, asistencia con motivo obligatorio, solicitudes familiares de justificación, aprobación/rechazo del personal, actualización del registro y aislamiento entre familias, historial individual con cálculo de porcentaje, exportación CSV/XLSX/PDF, sustitución y retiro autorizado de materiales, calendario mensual/semanal/de agenda con edición, cancelación y avisos de eventos, clases, tareas con fecha de entrega y aislamiento por grupo, Meet, comunicados, notificaciones, chat con adjuntos privados y aislamiento de descarga, paginación cronológica de mensajes sin huecos ni duplicados, validación de cursores, configuración y aplicación del horario de comunicación, recibos de lectura, seguimiento, carga de pantallas por rol, cambio de contraseña, historial de auditoría, registro de autorizaciones documentadas con roles y alumno-tutor verificados, solicitudes familiares de acceso/corrección/eliminación con aislamiento, deduplicación, transiciones válidas, notas de respuesta y avisos internos, limitación de intentos por visitante y rechazo de mutaciones API desde orígenes externos. En la versión publicada 104, la suite tenía 255 verificaciones. La revisión local actual añadió cobertura de origen a las mutaciones y comprobó que consultar el historial del chat no marque mensajes como leídos; pasaron 255 verificaciones sintéticas en un Worker con una base D1 local desechable y 181 pruebas automatizadas en entornos locales aislados. Las pruebas locales usan cuentas `example.test` y archivos sintéticos. La prueba del enlace Meet confirma que el portal lo muestra solo al grupo autorizado; la admisión en Google Meet depende de la configuración de Google.

`npm run test:images` verifica en Node el retiro de datos EXIF/XMP/comentarios de JPEG, PNG y WebP, y que los contenedores truncados se rechacen. La suite también confirma por la API del chat que una imagen JPEG se guarda y descarga sin su segmento EXIF. Esta limpieza aplica a las nuevas cargas y reemplazos; archivos que existieran antes de esta versión deben volver a subirse para retirar sus metadatos.

`npm run test:supabase-database-rpc` verifica que las RPC usen el JWT del usuario y la clave publicable, rechacen nombres y argumentos inválidos y no filtren mensajes de error del servidor. Estas pruebas usan respuestas sintéticas; no validan las funciones contra el proyecto Supabase remoto.

`npm run test:communication-hours` verifica el comportamiento sin restricción por defecto, la zona de Ciudad de México y los límites del horario configurado.

`npm run test:privacy-policy` verifica que las solicitudes solo avancen por estados permitidos y no puedan reabrirse tras la respuesta o el cierre.

`npm run test:upload-request-guard` comprueba el límite temprano de `Content-Length`, encabezados inválidos, solicitudes que exceden el máximo y clientes que omiten el tamaño. Las rutas de biblioteca, reemplazo de materiales y adjuntos del chat rechazan solicitudes declaradas por encima del tamaño máximo más 64 KiB de margen multipart antes de analizar el formulario. Si falta `Content-Length`, leen el formulario desde un flujo acotado y cancelan la carga al superar ese mismo límite. Después mantienen la validación del tamaño individual, tipo y firma del archivo.

`npm run test:polling-policy` verifica el intervalo inicial del chat, el aumento gradual de pausas de reintento, el máximo de un minuto y valores inválidos. El panel pausa las consultas con la pestaña oculta, evita solicitudes simultáneas, reanuda al volver a la pestaña o a la red y muestra el estado de reconexión; este mecanismo sigue siendo consulta periódica, no WebSocket.

`npm run test:file-storage` cubre la selección por archivo entre Supabase y R2, las cargas/descargas/borrados privados de Supabase, la compensación de retiro y la lectura de objetos antiguos en R2. `npm run test:supabase-storage` verifica el cliente HTTP privado; `npm run test:supabase-rls` comprueba de forma estática las políticas de acceso de la migración; `npm run test:auth-link` cubre invitaciones, recuperación y rechazo de enlaces inválidos. Estas pruebas usan datos y respuestas sintéticas: no reemplazan una carga/descarga real autorizada en el Site ni el acceso de una cuenta escolar.

`npm run test:recovery-email` verifica las configuraciones completas e incompletas, el formato UTF-8 de Gmail, la renovación OAuth, el rechazo de permisos insuficientes y la alternativa de Resend usando únicamente cuentas `example.test`.

`npm run test:supabase-admin-database` verifica el espejo idempotente de roles, la activación del perfil, las claves de servidor nuevas y heredadas, la validación de UUID/roles y los errores cerrados. No sustituye la comprobación del primer inicio de sesión real con una cuenta escolar.

`tests/smoke.mjs` también confirma que la pantalla de acceso y el estado pendiente del aviso de privacidad se muestran sin sesión, el panel redirige al login y las API principales de cuentas, alumnos, grupos, tareas, materiales, asistencia, clases, chat, notificaciones, consentimientos, auditoría y privacidad devuelven 401 cuando no hay sesión.

`npm run test:file-scan` verifica que la revisión de archivos falle cerrada con configuración incompleta, conexiones fallidas, respuestas desconocidas o tiempo agotado; también valida HTTPS, token y que no se envíen nombres ni datos de alumnos. El producto no incluye un motor antivirus propio. La escuela debe aprobar y operar un escáner HTTP privado que reciba `POST` con bytes saneados y el tipo MIME, y responda `{"status":"clean"}` o `{"status":"infected"}`. Configura `SCHOOL_FILE_SCAN_URL` y `SCHOOL_FILE_SCAN_TOKEN` como variables/secretos del Site. En pruebas sintéticas locales se permite `SCHOOL_FILE_SCAN_LOCAL_MOCK=true` solo si `BETTER_AUTH_URL` apunta a loopback; el veredicto sintético nunca puede activarse desde un dominio publicado y no detecta virus reales.

## Demostración local legacy aislada (8 de octubre de 2026)

Para revisar las pantallas con contenido sin tocar la base del portal publicado, se preparó un servidor local en `http://localhost:5174`. Usa una base D1 local independiente en `.wrangler/demo-review-v2-20261008`; contiene únicamente datos sintéticos `example.test` (cuentas, alumnos, grupos, tareas, mensajes y avisos). El inicio de sesión de dirección de demostración es `admin@example.test` con la contraseña `Synthetic-platform-check-2026!`. Las cuentas y contraseñas son de prueba, no representan a la escuela y nunca deben reutilizarse en producción.

La demostración se generó con una versión anterior de la suite que tenía 233 verificaciones. Para crear otra base de demostración, sigue las instrucciones de almacén local nuevo y ejecuta la suite apuntando al puerto del servidor local correspondiente. No ejecutes esas pruebas contra el portal publicado.

`npm run test:backup` verifica AES-256-GCM, autenticación de archivos y etiquetas, rutas locales, rechazo de un paquete alterado y el recorrido completo con D1/R2 simulados localmente. No reemplaza el ensayo de exportación/restauración con credenciales reales de Cloudflare. La versión Sites 86 incluye verificación del origen del navegador en la administración de cuentas y reconciliación segura ante una respuesta ambigua al invitar. Las pruebas focalizadas de esta entrega (3 de utilidades de autenticación y 5 de esquema/configuración), lint y compilación pasaron.

### Procedimiento histórico de ensayo aislado Sites/D1

```sh
npm run build
node --experimental-strip-types --test tests/*.test.mjs
npm run test:smoke:isolated
```

La última ejecución pasó 181 pruebas automatizadas y 255 verificaciones de integración D1. El comando aislado genera un puerto libre y secretos sintéticos, aplica las migraciones a D1 desechable, inicia su propio Worker, ejecuta el smoke y elimina el entorno. No lee `.dev.vars` ni usa credenciales de la escuela. Un fallo imprime solo el diagnóstico con los secretos sintéticos ocultos.

Las funciones del chat también pasaron `tests/supabase-conversation.integration.sql` en PostgreSQL mediante una transacción terminada en `ROLLBACK`; consulta `docs/migracion-chat-supabase.md` para límites y alcance. No equivale a verificar el recorrido HTTP/Storage completo.

### Ejecución manual alternativa para Sites/D1 legacy

Las pruebas usan solamente correos `example.test` y nombres sintéticos. No deben apuntarse a producción. El modo manual necesita un archivo `.dev.vars` local con `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SCHOOL_SETUP_TOKEN` y `SCHOOL_FILE_SCAN_LOCAL_MOCK=true`; para esta modalidad, `BETTER_AUTH_URL` debe usar `localhost` o `127.0.0.1`. No se agrega ningún secreto al repositorio.

### Preparar un almacén local D1 nuevo para pruebas legacy

```sh
npm ci
npm run build
for migration in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB \
    --local --config dist/server/wrangler.json --persist-to .wrangler/smoke-state --file "$migration"
done
```

En una terminal, arranca un servidor local usando ese almacén:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --persist-to .wrangler/smoke-state \
  --env-file .dev.vars --ip 127.0.0.1 --port 5173
```

En otra terminal:

```sh
npm run test:smoke
```

Usa un directorio `--persist-to` nuevo para cada ejecución. Si se repite sobre la misma base, la preparación de dirección y las cuentas ya existirán. Wrangler carga las variables locales desde `.dev.vars` mediante `--env-file`; no copies secretos dentro de `dist/server` ni uses credenciales de producción para esta modalidad.

## Base de datos y archivos — registro histórico Sites/D1/R2 (8 de octubre de 2026)

Los estados remotos, migraciones pendientes y mecanismos de sincronización descritos en esta sección corresponden al historial. Para Supabase vigente, consultar [Respaldo Supabase](respaldo-supabase.md) y el estado al inicio. Las credenciales/órdenes Cloudflare siguientes no son pasos de operación Vercel.

- D1 aloja las cuentas, los roles autorizados y los registros escolares. El proveedor de acceso Supabase Auth está activo; después de cada inicio de sesión válido, se espejean los roles actuales y el nombre del perfil a Postgres. Las demás tablas de la aplicación todavía se leen y escriben en D1.
- En el Site productivo, las cargas nuevas usan Supabase Storage privado (`SCHOOL_FILE_STORAGE_PROVIDER=supabase`, bucket `school-files`). Los registros con prefijo `supabase:` se leen de Supabase; los objetos anteriores sin prefijo siguen en R2. Descargas, reemplazos y retiros eligen el backend por ese prefijo y conservan los controles de sesión, permisos, escaneo y sanitización. El ejemplo local conserva R2 como valor predeterminado.
- **Migración de datos a Supabase pendiente:** el esquema, las políticas RLS, el bucket privado `school-files` y la protección de cuentas por invitación ya están aplicados. `SCHOOL_AUTH_PROVIDER=supabase` está activo y la sesión todavía se autoriza contra las cuentas y roles de D1. El código ya sincroniza roles y activa el perfil al iniciar sesión; el primer acceso real de Dirección sigue sin probarse, así que la sincronización remota aún no está verificada. Las demás cuentas, roles y datos escolares siguen en D1 y los objetos anteriores continúan en R2; el esquema activo de la aplicación sigue siendo SQLite/Drizzle. Antes de mover esos datos, generar y verificar respaldo, importar registros y relaciones, validar el aislamiento por alumno/grupo y comprobar descargas y restauración. No eliminar D1 ni R2 hasta completar esa verificación.
- La autenticación Supabase usa el adaptador HTTP de `lib/supabase/auth.ts` y las rutas `/api/auth/*`; las claves del proyecto están guardadas como variables privadas del Site. La clave `SUPABASE_SECRET_KEY` nunca debe exponerse en el navegador, el repositorio ni el chat. Las claves nuevas `sb_secret_` se envían solo como `apikey`; las claves heredadas `service_role` conservan `Authorization: Bearer`. La URL base y la ruta `/restablecer` ya están autorizadas en Supabase. La persona invitada debe aceptar el correo y crear su contraseña privada; después se debe comprobar el inicio de sesión y la recuperación.
- `scripts/supabase-identity-migration.mjs` prepara una correspondencia por correo entre los IDs de Better Auth y los UUID de usuarios que ya existan en Supabase Auth; traduce únicamente las columnas que referencian usuarios y se detiene si falta una identidad. No crea cuentas, importa registros ni está conectado a las rutas del portal. `npm run test:supabase-identity-migration` cubre coincidencias, ambigüedad, referencias faltantes y conservación de los IDs de alumnos.
- `scripts/supabase-d1-row-transform.mjs` convierte marcas de tiempo SQLite a `timestamptz`, enteros de SQLite a booleanos Postgres y referencias de usuario a sus UUID Auth, validando UUID y columnas destino; omite deliberadamente sesiones, hashes Better Auth y verificaciones. `npm run test:supabase-d1-row-transform` cubre esos cambios con registros sintéticos.
- `npm run supabase:d1-preflight -- <carpeta-del-respaldo-d1>` verifica un respaldo D1 cifrado, su origen de Site, el hash SQL, conteos, esquema, relaciones y archivos R2 sin subir nada. `npm run supabase:d1-import -- import <carpeta-del-respaldo-d1>` hace preflight sin escritura: verifica el respaldo, correos/UUID de Auth, esquema remoto y destino vacío. El modo de escritura exige `--apply` y `--confirm-project-ref <ref>`; verifica el esquema, el destino vacío, los UUID Auth y cada fila/archivo después de copiar, y trata de retirar los datos que alcanzó a copiar si algo falla. La herramienta solo se probó localmente con datos sintéticos; `npm run test:supabase-d1-import` cubre 7 casos, incluidos identidad faltante, destino ocupado, transferencia y verificación de archivos, y compensación ante un fallo. No se ha usado con D1 o Supabase reales.
- No generes un token personal de Supabase para este trabajo. Ese token solo se requiere para ciertas operaciones del CLI. La integración del Site usa las claves privadas ya guardadas en Sites; el corte de datos sigue pendiente hasta generar un respaldo real verificable, preparar todas las identidades escolares y completar el backend de consultas y la estrategia de corte/reversión.
- `npm run backup:supabase -- backup <carpeta-nueva>` y `verify <carpeta>` usan `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SCHOOL_BACKUP_PASSPHRASE` desde el entorno seguro del operador para exportar y verificar un respaldo cifrado de Postgres/Storage. La restauración exige `restore <carpeta> --confirm-restore`, un esquema idéntico, tablas destino vacías y las identidades Supabase Auth ya creadas con sus UUID originales. La herramienta está probada con servicios simulados; no se ha ejecutado contra el proyecto escolar ni ensayado una restauración real.
- `supabase/migrations/20261009000000_harden_invite_only_auth.sql` se aplicó y registró en el proyecto remoto el 8 de octubre de 2026. Desactiva perfiles sin rol escolar y cambia el trigger para no activar automáticamente perfiles de Auth; la verificación encontró un perfil, cero roles y cero perfiles activos sin rol. El cambio de `supabase/config.toml` rige cuando se administra un proyecto mediante CLI; en los ajustes remotos también quedó deshabilitado el registro público.
- `npm run backup:school -- backup <carpeta-nueva>` crea una exportación SQL de D1, copia todos los objetos de R2 y cifra manifiesto, SQL y archivos con AES-256-GCM. La frase se deriva con scrypt; el script guarda el salt no secreto, no la contraseña. `verify <carpeta>` descifra en memoria y comprueba autenticidad, tamaño y SHA-256. Usa un disco de operación cifrado: el SQL exportado existe temporalmente en esa carpeta antes de cifrarse y eliminarse. Mantén la carpeta del respaldo cifrado en una ubicación separada del equipo.
- El respaldo lee D1 dos veces y compara conteos de tablas; en R2 compara listado, ETags y tamaños al inicio y al final. No es una transacción atómica entre D1 y R2; ejecútalo cuando nadie esté cargando o cambiando datos y verifica el resultado. D1 también ofrece Time Travel según el periodo de retención de la cuenta; consulta [la guía oficial de exportación y Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) y [exportación/importación D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
- `restore-r2 <carpeta> --confirm-bucket <nombre-exacto>` verifica Site e integridad y restaura objetos al bucket cuyo nombre escribas de nuevo para confirmarlo. Puedes usar un bucket de prueba separado para ensayar. No borra objetos que no estén en el respaldo. `restore-d1 <carpeta> --new-database school-recovery-... --confirm-new-database school-recovery-...` crea una base D1 nueva, importa el SQL y compara los conteos por tabla; **no cambia la base que usa el Site**. Esta recuperación de ensayo evita sobrescribir datos operativos. Para pérdida de datos en producción, la dirección debe aprobar el punto de restauración y quien tenga permisos de Cloudflare puede restaurar D1 con Time Travel; después se verifica la correspondencia con R2. Nunca uses el flujo de ensayo con el nombre de la base productiva.

### Procedimiento histórico de credenciales Cloudflare legacy

1. En Cloudflare, identifica el **nombre real** de la base D1 y del bucket R2 del Site. El binding de la aplicación (`DB`/`BUCKET`) no es necesariamente el nombre del recurso.
2. Inicia sesión con Wrangler en una cuenta Cloudflare autorizada para consultar/exportar D1 y crear una base de recuperación de prueba: `npx wrangler login`.
3. Crea una credencial R2 **Object Read Only** para respaldar. Para la restauración R2, usa una credencial **Object Read & Write**, limitada al bucket específico. Cloudflare explica el alcance de estos permisos en la [documentación de tokens R2](https://developers.cloudflare.com/r2/api/tokens/) y el endpoint S3 en la [guía de R2 S3](https://developers.cloudflare.com/r2/get-started/s3/).
4. Carga `SCHOOL_CF_ACCOUNT_ID`, `SCHOOL_R2_BUCKET`, `SCHOOL_D1_DATABASE`, credenciales R2 del modo correspondiente y `SCHOOL_BACKUP_PASSPHRASE` en el entorno local seguro de la persona responsable. No guardes las claves en Git, en variables del Site ni en `.dev.vars`. La frase debe tener al menos 20 caracteres y guardarse aparte del respaldo.

Ejemplo histórico para recursos Sites/D1/R2 identificados; no corresponde al hosting Vercel ni debe ejecutarse para recuperar su Supabase:

```sh
export SCHOOL_CF_ACCOUNT_ID="<cuenta-cloudflare>"
export SCHOOL_R2_BUCKET="<bucket-real-del-site>"
export SCHOOL_D1_DATABASE="<base-real-del-site>"
export SCHOOL_R2_READ_ACCESS_KEY_ID="<clave-de-lectura>"
export SCHOOL_R2_READ_SECRET_ACCESS_KEY="<secreto-de-lectura>"
export SCHOOL_BACKUP_PASSPHRASE="<frase-privada-de-20-caracteres-o-mas>"
npm run backup:school -- backup "/Volumes/RespaldoCifrado/escuela-2026-10-07"
npm run backup:school -- verify "/Volumes/RespaldoCifrado/escuela-2026-10-07"
```

Para restaurar R2, configura las dos variables `SCHOOL_R2_WRITE_*` con la credencial R2 de lectura y escritura y ejecuta:

```sh
npm run backup:school -- restore-r2 "/Volumes/RespaldoCifrado/escuela-2026-10-07" --confirm-bucket "$SCHOOL_R2_BUCKET"
```

Para probar una restauración D1 aislada, autoriza explícitamente un nombre nuevo:

```sh
npm run backup:school -- restore-d1 "/Volumes/RespaldoCifrado/escuela-2026-10-07" --new-database school-recovery-prueba --confirm-new-database school-recovery-prueba
```

La cuenta Cloudflare, el bucket, las claves R2 y la frase aún no han sido proporcionados para el Site; por eso esta rutina cuenta con pruebas unitarias de cifrado, pero falta correr un respaldo remoto y ensayar la restauración con una cuenta y un bucket de prueba antes de declarar esa operación verificada.

## Lanzamiento y privacidad — pendientes históricos (8 de octubre de 2026)

### Cambios locales históricos en Supabase (8 de octubre de 2026)

- Los cambios de rol y estado de cuentas mantienen el perfil de Supabase inactivo durante la sincronización y activan el perfil solo después de confirmar el estado escolar en D1. Si alguna llamada remota falla, el endpoint devuelve un error y no afirma que el acceso quedó sincronizado.
- Los vínculos tutor-alumno tienen lectura PostgREST bajo RLS y mutaciones RPC con auditoría transaccional. Ejecutar `npm run test:supabase-student-guardians`, `npm run test:supabase-guardian-link` y `npm run test:supabase-admin-database` para las pruebas locales. La migración `20261011000000_guardian_link_rpc.sql` aún no se ha aplicado al proyecto escolar.
- Sites confirmó la binding D1 `DB` y el esquema de tablas de producción sin leer filas. El comando `npx wrangler d1 list --json` no muestra bases en la sesión local actual, por lo que todavía no se puede generar el respaldo real con esa sesión. No se leyeron ni copiaron datos personales.

Antes de uso con menores, este registro histórico proponía completar los pasos siguientes. Consultar [Estado de requisitos](estado-requisitos.md) para los pendientes actuales; la restauración D1/R2 de esta lista corresponde solo al destino legacy.

1. El esquema, Storage privado y RLS ya están aplicados. El importador D1 → Supabase se implementó y pasó pruebas sintéticas, pero no se ha ejecutado con información real. Antes de usarlo hay que generar y verificar un respaldo cifrado de D1/R2, tener las identidades Auth de todas las cuentas y completar el backend de consultas/corte para que el portal no escriba de nuevo en D1.
2. La recuperación productiva usa Supabase Auth. Supabase limitó temporalmente el envío de correo durante la prueba; falta completar un restablecimiento real cuando vuelva a aceptarlo y configurar SMTP propio para operación diaria. Consulta `docs/configurar-correo.md`.
3. El inicio de sesión productivo usa Supabase Auth y enlaza provisionalmente por correo el rol existente en D1. La cuenta de Dirección ya está confirmada, pero se debe probar el acceso y verificar el rol de superadministración. La importación requiere que cada cuenta presente en el respaldo tenga previamente una identidad Auth; no migra contraseñas ni sesiones.
4. Definir aviso de privacidad, responsable, retención, solicitudes de acceso/corrección/eliminación y consentimiento aplicable. La aplicación no declara cumplimiento legal.
5. La página de inicio de sesión ya es pública; el alta pública está cerrada y las operaciones escolares requieren una cuenta autorizada. Dirección debe crear las cuentas de cada docente y familia. No incorporar datos reales de alumnos hasta completar las demás verificaciones de privacidad, recuperación y respaldo.
6. Proporcionar credenciales de operación, ejecutar una copia cifrada y verificarla; ensayar D1 en una base nueva y R2 en un bucket de prueba. Comprobar por separado los accesos reales a Meet.
7. Ejecutar pruebas desde teléfonos y conexiones móviles de la escuela. El diseño adapta la navegación, pero todavía falta esa comprobación manual.

Las grabaciones de Meet se mantienen desactivadas. No habilitar ni compartir grabaciones hasta que dirección defina consentimiento, retención y acceso.

</details>

## Release de estabilidad publicado · 9 de octubre de 2026

Versión **READY `dpl_8YhGFfsnnz5MH1GpMN7v2cVFvJtT`**, URL única https://el-mundo-de-los-ninos-portal-513l6al28-pandito.vercel.app, promovida al dominio habitual desde el mismo build comprobado. Fuente del código: `fadddc3e0b35b4413fa73cf948668d1547144c24`, 538 blobs en GitHub privado escolar. Los commits posteriores de documentación no cambian ese código publicado.

La suite final pasó **656 pruebas**, lint sin avisos, TypeScript y Next/Sites. Se verificaron **32 controles HTTP antes de promover y 32 en el dominio habitual**: páginas públicas, 404/noindex, redirecciones privadas antes del cuerpo, APIs anónimas y protección CSRF. El inventario real excluyó configuraciones, evidencias y temporales; no encontró los tres valores privados comprobados.

Incluye pantallas de error/carga/404 con el logo oficial, hook de errores acotado sin campos de solicitud/error, acceso de API/página con tres verificaciones por invocación e historial paginado de observaciones. Se mantienen verificaciones frescas por petición y autorización RLS/RPC. El destino legacy exige asignación docente real para notas internas; una denegación no se muestra como historial vacío.

La revisión CUA del dominio comprobó Seguimiento y Mi cuenta de administración, sin matrícula, un título/región principal y sin desbordamiento. Los tres campos de contraseña estaban vacíos y los avisos externos permanecían ocultos. La pantalla 404 y su enlace al inicio funcionaron. Captura: `outputs/portal-readiness-release-20261009.jpg`; reporte `outputs/portal-production-readiness-ui-20261009.json`. No se introdujeron alumnos ni se provocaron excepciones en producción. El fixture local separado de error/carga pasó 23 comprobaciones HTTP y CUA 320/1151; se detuvo después.

La inspección acotada de logs del nuevo despliegue, antes de promoverlo, devolvió cero filas de nivel error. No acredita un servicio externo de alertas, drains o retención. No se configuraron Google, analizador privado, SMTP, SQL29, SQL31 ni proveedores de avisos por este release; las cargas publicadas siguen cerradas mientras falte el análisis. Aceptación de docentes/familias, Meet, respaldos escolares y revisión de privacidad continúan en el registro de requisitos.

Evidencias: `outputs/vercel-release-readiness-20261009.json`, `outputs/release-validation-readiness3-20261009.json`, `outputs/vercel-readiness-{stage,production}-http-20261009.json`, informes `new-routes`, inventario `vercel-upload-readiness-audit-20261009.json` y `github-publication-remote-readiness-20261009.json`.
