# Señales de actualización de Supabase Realtime

## Contrato del adaptador

`subscribeSchoolDatabaseChanges(options, factory?)` de `lib/supabase/realtime.ts` devuelve inmediatamente `{ stop(): Promise<void> }`. Usa el SDK real `@supabase/realtime-js` 2.117.3. La autorización y suscripción se inicializan de forma asíncrona. Las opciones incluyen `url`, `publishableKey`, `accessToken`, `userId`, `canMessage`, `onReady`, `onInvalidate` y `onFailure`.

Es un módulo solo para servidor: el control de entorno rechaza llamadas desde un navegador. La ruta que lo utilice debe verificar previamente la sesión con Supabase Auth, determinar `canMessage` según los roles reales, mantener JWT/clave pública en el servidor y llamar `stop()` al cancelar la petición, cerrar la sesión o vencer el JWT. Los controles locales del JWT comprueban su forma, rol `authenticated`, sujeto correspondiente y vencimiento; no verifican su firma. La verificación de Auth y la de Supabase Realtime siguen siendo necesarias. No se refresca el token ni se cambia de usuario dentro de una conexión.

Se aceptan claves `sb_publishable_...` y claves JWT antiguas cuyo rol sea `anon`. Se rechazan claves `sb_secret_...`, JWT `service_role`, credenciales malformadas, usuario distinto al sujeto y URLs con credenciales, query, fragmento o ruta adicional. Solo se permite HTTPS, con excepción HTTP para localhost. No existe soporte de clave privilegiada ni método que escriba datos.

Tipos públicos de invalidación:

```ts
{ scope: 'notifications' }
{ scope: 'messages', conversationId: string }
{ scope: 'communication' }
```

Los avisos escuchan únicamente `INSERT` y `UPDATE`, con el filtro `user_id=eq.<usuario>`. Además, cada callback vuelve a exigir que `new.user_id` sea exactamente el usuario suscrito. Los mensajes escuchan `INSERT`/`UPDATE` cuando `canMessage` es verdadero y confían en la política existente de miembro de la conversación. El callback comprueba el UUID de la conversación. La configuración escucha solo `UPDATE` de la fila `id=school`, también para quien puede usar mensajes. No se suscribe a `DELETE`, eventos comodín, Broadcast ni Presence. Un INSERT inicial de la configuración no genera señal; la carga inicial y la lectura periódica deben cubrirlo.

Las señales no contienen títulos, cuerpos, adjuntos, horarios, autores, fechas, IDs de avisos ni filas originales. Recibir una señal no reemplaza la lectura autorizada por API/JWT/RLS. Los cambios realizados mientras la conexión estuvo desconectada requieren una nueva lectura: este adaptador no es un historial persistente.

`SUBSCRIBED` llama una sola vez a `onReady`. `CHANNEL_ERROR`, `TIMED_OUT` y `CLOSED` llaman una sola vez a `onFailure('connection')` y detienen el transporte. La configuración inválida emite solamente `onFailure('configuration')`. No se propagan errores originales del SDK. Las excepciones de callbacks también cierran la conexión de forma segura. `stop()` es idempotente, suprime callbacks desde el primer instante y espera unsubscribe y disconnect, manejando sus rechazos. La salida del canal tiene plazo de un segundo y siempre ejecuta `teardown` del SDK para detener timers. Los diagnósticos del SDK están desactivados; el adaptador no registra tokens ni payloads.

## Migración aplicada con autorización

`20261030000000_school_realtime_publication.sql` se aplicó con autorización específica el 8 de octubre de 2026 en el proyecto escolar. Exige que la publicación existente `supabase_realtime` no sea global, no publique esquemas enteros y contenga únicamente alguna de estas tres tablas: `notifications`, `messages` y `communication_settings`, o esté vacía. Si contiene otras tablas/esquemas, falla antes de cualquier mutación. Después de comprobar todos los prerrequisitos limita la publicación a INSERT/UPDATE mediante SET (publish = 'insert, update'), si hace falta, y añade solo las tres tablas ausentes. No elimina tablas ni cambia otras opciones. DELETE y TRUNCATE quedan prohibidos en la publicación: ignorarlos en nuestro SDK no impediría que otro cliente los solicitara, y DELETE no aplica la misma protección RLS.

Antes de hacerlo verifica que la publicación exista y sea exclusiva; que existan los roles; que las tres tablas tengan RLS habilitado y forzado; que `authenticated` conserve SELECT y `anon` no tenga SELECT de columnas; y que las políticas de lectura esperadas existan para `authenticated` con sus helpers actuales. Rechaza políticas permisivas de lectura para PUBLIC/anon y cualquier otra política SELECT/ALL de authenticated, salvo la política existente communication_settings_manage_leadership con expresión exacta school_is_leader(). Las expresiones de las tres políticas principales se comparan con las conocidas del baseline, para no aceptar una variante como helper OR true. Los helpers y las políticas existentes siguen siendo la autoridad; estas comprobaciones de catálogo no sustituyen una revisión completa de sus expresiones y relaciones escolares.

No crea tablas, publicaciones, políticas, roles ni permisos; no cambia `REPLICA IDENTITY` y no pide `FULL`. El operador debe revisar la expansión de publicación y autorizarla antes de ejecutarla. Si Supabase no dispone de la publicación o falta un permiso/política, la migración falla; no intenta reparar permisos automáticamente. Ejecutarla nuevamente conserva las tablas ya presentes.

## Comprobaciones y límites

```sh
node --test tests/supabase-realtime.test.mjs
npx eslint lib/supabase/realtime.ts tests/supabase-realtime.test.mjs
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck lib/supabase/realtime.ts
```

Las pruebas usan exclusivamente una fábrica y un transporte SDK sintéticos: verifican filtros, JWT antes de la suscripción, señales sin contenido, claves privilegiadas rechazadas, estados terminales, callbacks, cancelación durante inicialización y cierre asíncrono. No prueban una conexión WebSocket real, publicación remota ni entrega RLS en Supabase. `tests/supabase-realtime-publication.integration.sql` contiene aserciones de catálogo. El generador `tests/supabase-realtime-publication.rollback.mjs` exporta buildRealtimePublicationRollbackSql() y puede imprimirse con node. Ese SQL tiene un único BEGIN, aplica el cuerpo de la migración dos veces, comprueba que solo se añadieron las tres tablas esperadas y que las únicas opciones de publicación cambiadas sean las flags seguras de INSERT/UPDATE sin DELETE/TRUNCATE y que no cambiaron RLS, policies, grants o replica identity, y termina en ROLLBACK sin COMMIT. Solo consulta y altera catálogos dentro de esa transacción; no crea usuarios ni datos escolares. Se ejecutó en PostgreSQL escolar con ROLLBACK, sin errores; después se aplicó la migración 30 en una transacción separada y se registró su fuente.

## Fuentes oficiales consultadas

- [Supabase: Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes): filtros, publicación y autorización de cada evento con SELECT/RLS; explica por qué DELETE no ofrece la misma protección RLS.
- [Supabase: setAuth](https://supabase.com/docs/reference/javascript/setauth): JWT utilizado por Realtime.
- El código y tipos de `@supabase/realtime-js` 2.117.3 instalados en el repositorio: setAuth, disconnect asíncrono, unsubscribe y teardown.

## Puente Vercel y navegador

`/api/realtime/config` requiere sesión activa y devuelve exclusivamente `{enabled:boolean}`. Solo habilita el transporte cuando `SCHOOL_REALTIME_PROVIDER=supabase`, `SCHOOL_AUTH_PROVIDER=supabase` y `SCHOOL_DATA_PROVIDER=supabase`. El valor de ejemplo es `disabled`; desplegar este código por sí solo no activa la publicación escolar. La URL y clave publicable existentes permanecen en el servidor. No se usa la clave secreta de Supabase.

`/api/realtime/events` verifica la misma sesión y transmite SSE privado, sin caché, transformaciones ni CORS. Acepta GET de EventSource sin Origin y rechaza Origin externo o Sec-Fetch-Site cross-site. El canal termina al abortar, perder autorización, superar la cola de 4 KiB o el total de 64 KiB, o cumplir 240 segundos; la función declara maxDuration=300. Envía un heartbeat cada 15 segundos, verifica nuevamente cuenta y roles cada 30 segundos sin consultas superpuestas y limita esa verificación a 20 segundos. El SDK debe confirmar SUBSCRIBED dentro de 15 segundos.

Durante una revalidación solo se guarda un booleano de resincronización, sin contenido ni identificadores privados. Si la cuenta sigue autorizada se emite una única señal `{scope:'all'}`; las pantallas vuelven a consultar sus APIs. Si falla o vence la verificación, el canal cierra sin enviar señales pendientes. Así se recuperan cambios ocurridos durante la comprobación sin ampliar los permisos de lectura.

El cliente comparte una conexión por pestaña y espera `ready {}` antes de indicar que está conectada. Valida señales pequeñas con exclusivamente scope y, para mensajes, el UUID de conversación. Las lecturas de configuración tienen plazo de 20 segundos; los fallos cierran el EventSource nativo y se reintentan GET con pausas de 2 a 30 segundos. Ocultar la pestaña, perder conexión o quitar el último consumidor cancela las lecturas, conexión y temporizadores. No persiste filas, tokens ni avisos en localStorage. La rotación vuelve a consultar configuración y sesión. Los intervalos privados de 10/30 segundos permanecen como respaldo.

### Procedimiento y comprobaciones de activación

1. Revisar la migración 30 en el proyecto escolar `gzojyxrxamydrqcxljdg`, incluyendo la exclusividad de la publicación y las flags INSERT/UPDATE.
2. Autorizar la publicación antes de aplicar cambios remotos. Ejecutar primero el fixture de catálogo BEGIN/ROLLBACK y revisar su resultado; el generador no prueba una base por sí mismo.
3. Aplicar la migración revisada y registrar su versión/checksum; la migración 29 de respaldos es independiente y no debe aplicarse por implicación.
4. Configurar el indicador no secreto `SCHOOL_REALTIME_PROVIDER=supabase` en el proyecto Vercel escolar y publicar la configuración.
5. Comprobar conexión real y entrega entre identidades autorizadas en recursos de ensayo aislados, incluyendo rechazo de otra familia y revocación. No crear usuarios/alumnos/mensajes ficticios persistentes en producción.

Las pruebas de controladores y componentes son sintéticas. Un resultado `connected` acredita una suscripción establecida, no la prueba completa de entrega o aislamiento de datos mediante el proveedor. Web Push, notificaciones del teléfono bloqueado y correo de eventos siguen fuera de esta activación.

## Resultado real · 8 octubre 2026, 23:09 CDMX

Se confirmó la publicación exclusiva de `communication_settings`, `messages` y `notifications`, INSERT/UPDATE activados y DELETE/TRUNCATE desactivados. Hay 25 versiones SQL registradas, cero alumnos, cero cuentas sintéticas y una administradora escolar activa. La migración 29 de respaldo sigue sin aplicar. Evidencia: `outputs/supabase-realtime-release-20261008.json` y captura correspondiente.

`SCHOOL_REALTIME_PROVIDER=supabase` se guardó únicamente en Production de Vercel. Despliegue READY `dpl_3ABfnzZfGT84WHgjZzXzZzfWzZpw`, promovido al dominio escolar. Diecinueve controles HTTP pasaron en stage y en el dominio canónico; los dos GET Realtime requieren sesión. Con la sesión escolar real, el centro de avisos mostró “Conexión de avisos en vivo activa”, después de recibir `ready` del puente SSE y `SUBSCRIBED` del SDK. Captura: `outputs/portal-vercel-realtime-active-20261008.jpg`.

Esta comprobación acredita conexión real. No acredita aún entrega entre docentes/familias, aislamiento de eventos entre familias, revocación real o desconexiones de larga duración. Esos recorridos necesitan recursos de ensayo aislados; no se crearon datos ficticios persistentes en producción.
