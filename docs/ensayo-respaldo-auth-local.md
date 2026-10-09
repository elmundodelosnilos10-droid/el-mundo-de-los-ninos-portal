# Respaldo Auth completo y ensayo de restauración local

## Alcance y fuentes

La guía oficial recomienda exportar roles, esquema y datos mediante el CLI, que filtra objetos internos. Auth y sus datos relacionados forman parte del dump; las claves JWT y configuración de proveedores se gestionan aparte, y Storage necesita transferencia independiente. Esta cuenta de ensayo usa la contraseña original conocida para comprobar el acceso después de restaurar. [Guía oficial de restauración](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

Las personalizaciones de los esquemas administrados se deben reponer con las migraciones propias. La restauración de datos usa una transacción y `session_replication_role=replica` para evitar que los triggers dupliquen efectos. [Guía CLI oficial](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Artefactos preparados

- `scripts/supabase-auth-backup-local.mjs`: complemento Auth, solo lectura de una fuente sintética local. Ejecuta CLI oficial `db dump --data-only --use-copy --schema auth`; utiliza las exclusiones oficiales del CLI, incluida `auth.schema_migrations`. Cifra dump y manifiesto con AES256GCM y verifica la integridad offline.
- `scripts/supabase-auth-restore-local.mjs`: runner de aceptación preparado para una segunda instancia nativa vacía. Importa solo datos Auth en un esquema administrado idéntico, previamente instalado por el servicio oficial. No sustituye esquemas internos, roles o migraciones del servicio con un dump crudo.
- El respaldo escolar existente conserva las 33 tablas públicas y los bytes de Storage; el complemento no altera su formato.

`db dump --local` del CLI 2.120 apuntó al puerto legacy, distinto del native stack. La captura usa una URI loopback **sin contraseña** en argumentos y `SUPABASE_DB_PASSWORD` solo en el entorno del hijo. Antes del dump, su dry-run debe coincidir con host, puerto, usuario/base y filtros esperados. El CLI recibe el binario PostgreSQL oficial en PATH.

SQL y logs transitorios se guardan con permisos `0600` en un directorio `0700` y se eliminan. UUID, hashes de contraseña e identidades aparecen únicamente en el manifiesto cifrado. Ningún script carga `.env`/`.dev.vars` ni admite destinos remotos.

## Secuencia de aceptación pendiente

1. Root libera la fuente de otros ensayos. Conservar los respaldos actuales antes de cualquier limpieza. El runner no resetea la fuente.
2. Preparar dos familias sintéticas con contraseña conocida en memoria y comprobar login en origen **antes** de respaldar. Las contraseñas del fixture HTTP anterior fueron descartadas: su archivo capturado acredita preservación de Auth, pero no una prueba de acceso restaurado. Una opción para un nuevo ensayo es fijar una contraseña sintética en esas cuentas locales, conservando sus UUID, y después tomar otro respaldo. Esa preparación necesita autorización y exclusividad; estos runners no la ejecutan.
3. Incluir un archivo sintético real en Storage y su registro escolar/relaciones de acceso. Confirmar lectura de la familia autorizada y rechazo de otra en origen. El respaldo actual tiene cero objetos, por lo que el runner de aceptación completa lo rechaza.
4. Crear otra instancia native con los mismos binarios/versions Auth/PostgreSQL/Storage y migraciones escolares. Requiere Auth y las 33 tablas públicas vacíos; el fingerprint de columnas Auth debe coincidir exactamente. Configurar bucket privado y permisos de mantenimiento escolares propios del entorno de ensayo. No aplicar concesiones de ensayo a producción.
5. Proporcionar configuración mediante un supervisor en memoria: URL PostgreSQL fuente/destino diferentes, API destino y `targetAppUrl` escolares loopback, con orígenes distintos, rutas privadas de claves/frase/archivo de probes y scratch. Opt-in exacto: `RESTORE_SYNTHETIC_AUTH_TO_EMPTY_LOCAL_TARGET`. El archivo `school-auth-restore-probes.local.json` debe ser propio y `0600`, nunca publicarse.
6. Ejecutar `runLocalFullAuthRestore(config)`. Descifra/verifica ambos respaldos antes de importar. `psql -X --single-transaction ON_ERROR_STOP=1` recibe host/puerto/contraseña solo por variables libpq del hijo. Deshabilita triggers solo durante esa transacción, sin cambios permanentes de configuración.
7. Compara UUID+hashes e identidades antes del primer login, restaura public33/Storage y verifica igualdad del respaldo. Realiza login por contraseña y GET de usuario Auth con JWT nuevos del destino; ambas familias deben ver su alumno y no el alumno de la otra (con controles positivos cruzados).
8. El login Auth por contraseña/JWT se conserva como prueba directa del proveedor. Además, cada usuario inicia sesión en `/api/auth/sign-in/email` de la app destino, con Origin de esa misma app y cookieJar de Node restringido a ese origen. Este transporte HTTP loopback de ensayo envía manualmente las cookies Secure; no representa el comportamiento de un navegador en HTTP. El acceso a bytes usa `/api/files/<id>` de la escuela: familia autorizada 200 y SHA exacto, ajena 404, anónimo 401. Los JWT de todas las familias y el anónimo deben seguir rechazados en Storage directo, y el bucket debe mantener `public=false`. No se crean políticas Storage para hacer pasar el ensayo. También se comprueban metadatos de archivo mediante PostgREST/JWT y su denegación a la familia ajena. Solo entonces devuelve PASS. Un fallo conserva el destino sintético para inspección y avisa que puede contener datos restaurados; no borra la fuente ni reinicia servicios.

`object.key` es estrictamente la ruta Storage `private/(material|submission|message)/UUID`, sin prefijo; su UUID final y `fileId` son identificadores válidos e independientes. El registro `files.object_key` debe ser exactamente `supabase:${object.key}`. La API Storage recibe únicamente la ruta sin `supabase:`.

El archivo de probes contiene `users` (UUID/email/password/role; para cada tutor, ownStudentId/foreignStudentId) y `object` (fileId/key/sha256/ownerUserId/foreignUserId). Los alumnos ajenos deben ser los alumnos propios de otro probe para evitar una comprobación negativa contra un UUID inexistente.

## Estado real a 2026-10-09

Captura nativa real completada: 4 usuarios y 4 identidades, UUID/hashes/identidades conservados en complemento cifrado. Verificación de integridad y estabilidad antes/después: PASS. SQL temporal eliminado. El respaldo público separado pasó 33 tablas, 34 filas y cero objetos.

La restauración, login restaurado y recuperación de bytes **no se ejecutaron**. El runner está preparado para ese ensayo y no se presenta como evidencia de recuperación completa. Las pruebas unitarias cubren guardas y contratos; no simulan una restauración del proveedor ni la acreditan.

## Destino preparado, todavía sin datos restaurados

Instancia native independiente `school-restore-isolated-20261009`, workdir `/tmp/school-isolated-runtime-20261008/restore-target`, compartiendo únicamente cache oficial de binarios. Arranque privado: `restore-target-start-result.json`; claves locales privadas: `school-realtime-local-credentials.restore-target.json`. 26 migraciones instaladas automáticamente, PG170011, 33 tablas vacías, Auth0, Storage0, bucket privado presente y publicación Realtime INSERT/UPDATE solamente. El rol de mantenimiento local ya tiene SELECT/INSERT/UPDATE necesarios; no se agregó ningún grant ni policy para descargar archivos. La tabla privada de provisión tiene RLS habilitado sin FORCE y carece de SELECT authenticated, conforme a SQL24. RSS observado de todos los procesos native fuente+destino juntos:384MiB (una cota superior para el destino, no un límite permanente bajo carga).
