# Ensayo local de Auth, PostgreSQL y Realtime

El runner `tests/realtime-local/run.mjs` usa los servicios reales de Supabase y el SDK instalado. No reemplaza el proveedor con mocks. La prueba utiliza únicamente un docente, dos familias y alumnos sintéticos, creados para cada ejecución y eliminados al terminar. La prueba se niega a comenzar si cualquiera de las 33 tablas escolares, Auth users/identities o Storage objects contiene registros previos; vuelve a comprobar esos mismos límites tras la limpieza.

## Guardas

No carga `.env`, `.dev.vars`, configuración de la escuela ni credenciales del proyecto remoto. Solo consulta cuatro variables dedicadas:

- `SCHOOL_REALTIME_TEST_API_URL`: origen HTTP con IP literal `127.0.0.1` o `[::1]` y puerto explícito.
- `SCHOOL_REALTIME_TEST_DATABASE_URL`: PostgreSQL local, usuario/base `postgres`, contraseña no vacía del proceso local.
- `SCHOOL_REALTIME_TEST_CREDENTIALS_FILE`: archivo absoluto `school-realtime-local-credentials.<identificador>.json`, propio, regular, sin symlinks y con permisos `0600`.
- `SCHOOL_REALTIME_TEST_ALLOW_LOCAL_WRITES`: debe ser exactamente `I_ACCEPT_SYNTHETIC_LOOPBACK_ONLY`.

El archivo privado contiene solo `anonKey` y `serviceRoleKey`, con JWT legacy local, issuer `supabase-demo` y roles exactos. No se imprimen sus valores. Las sesiones de los usuarios deben provenir del Auth del mismo origen loopback. El transporte real vuelve a comprobar cada HTTP/WebSocket contra los orígenes locales permitidos y bloquea redirecciones. La normalización HTTP→WS equivale a la del WebSocket nativo; no admite otros hosts ni puertos.

El propietario local prepara las migraciones en una base dedicada antes de ejecutar. El runner no aplica migraciones ni reinicia/resetear bases. Requiere publicación exclusiva `supabase_realtime` con las tres tablas escolares, INSERT/UPDATE habilitados y DELETE/TRUNCATE deshabilitados.

## Ejecución

Ejecutar `node --test tests/realtime-local-guards.test.mjs` comprueba las guardas sin proveedor. Estas pruebas no demuestran la entrega de mensajes. `tests/realtime-local-sse-protocol.test.mjs` comprueba además el plumbing HTTP/SSE del harness con identidad/transporte sintéticos explícitos; ese test tampoco prueba al proveedor. Las 11 pruebas de guardas, estado vacío y plumbing pasan.

Un supervisor debe tomar las URL y claves del resultado privado del arranque local y pasarlas únicamente al entorno del proceso hijo. Ejecutar entonces `node tests/realtime-local/run.mjs`. No pasar contraseñas o JWT como argumentos, ni copiarlos en el historial de comandos. El runner devuelve JSON con PASS únicamente tras verificar todos los pasos y comprobar la limpieza. Sin configuración devuelve NOT_RUN y código de salida 2.

## Flujo comprobado por el runner

1. Auth Admin crea los tres usuarios confirmados; acceso por contraseña y GET de usuario validan sesiones reales.
2. Las relaciones escolares se insertan en una transacción local comprometida para que el WAL produzca cambios reales.
3. Dos observadores reales del SDK intentan activar el tenant nativo (timeouts de 10 y 30 segundos) antes de abrir el adapter productivo (timeout de 10 segundos) y observadores independientes con JWT de cada usuario. Sus estados se conservan por separado; un timeout de esos probes no se presenta como suscripción superada. Los seis canales normales deben confirmar SUBSCRIBED. Este ensayo no demuestra disponibilidad inmediata tras un arranque frío.
4. INSERT y UPDATE de avisos llegan solo a su propietario. Una suscripción maliciosa de una familia al filtro de la otra no recibe su aviso.
5. El docente envía mensajes mediante RPC con JWT. El docente y la familia vinculada reciben INSERT y UPDATE; la familia ajena no obtiene filas por REST ni eventos de esa conversación. Los controles positivos confirman que el evento sí fue producido.
6. Una conexión HTTP SSE real usa el código productivo del bridge y recibe solo señales permitidas, sin filas, títulos o cuerpos.
7. Cerrar un adapter suprime eventos posteriores, mientras un observador de control sigue recibiéndolos.
8. Desactivar el perfil familiar bloquea lectura y eventos futuros; el SSE se cierra al revalidar la identidad en su intervalo real de 30 segundos.
9. Se eliminan solo los registros de este fixture y sus usuarios Auth; se vuelve a exigir estado vacío.

## Límites

El SSE se sirve desde un servidor Node de ensayo y utiliza un resolver de identidad que comprueba el Auth y los perfiles/roles reales con JWT. No verifica el adaptador de cookies/sesiones de Next, el navegador de una familia, una instancia Vercel ni la configuración de la escuela remota. Las comprobaciones negativas observan una ventana acotada y controles positivos; no equivalen a una prueba exhaustiva de cualquier combinación de políticas. Ningún resultado sintético se presenta como evidencia del proveedor.

## Resultados conservados

Los archivos de `outputs/supabase-native-realtime-20261008*.json` conservan cada ejecución con códigos sanitizados. Los primeros intentos detectaron que `[auth.email] enable_signup=false` deshabilitaba el proveedor local de acceso por correo. Se corrigió solo el config aislado, manteniendo el signup global deshabilitado. Un intento posterior detectó la normalización HTTP→WS omitida por la guardia del harness; el código productivo quedó intacto. Los controles de orden mostraron que las primeras conexiones del tenant nativo agotaban 10 segundos con cualquiera de los roles, mientras las posteriores sí se suscribían. Los intentos 12 y 13 confirmaron SUBSCRIBED en los seis canales normales, pero el bridge SSE cerró con `unavailable` antes de `ready`; todavía no demostraron la entrega de eventos. El runner actual comprueba INSERT/UPDATE e aislamiento antes de SSE y registra los pasos completados aunque falle. El estado final se debe consultar en el último resultado; hasta que exista PASS, la aceptación completa no está verificada.

## Diferencia de transporte del ensayo actual

Los intentos 14–21 conservan todos los FAIL. Desde el 16 se confirmó la entrega real de INSERT/UPDATE de avisos y mensajes y el aislamiento entre familias, pero el socket adicional del bridge SSE no abrió con el dispatcher nativo compartido. El diferencial real `outputs/supabase-native-realtime-http-reuse-differential-20261009.json` reprodujo el fallo tras varias peticiones HTTP: el SDK reutilizó una conexión HTTP y agotó su timeout; el mismo SDK con WebSocket nativo y dispatcher Undici exclusivo sí abrió y se suscribió. La causa precisa dentro de Node/gateway Native requiere investigación separada.

Con autorización del coordinador, el harness actual da a cada WebSocket nativo un Agent Undici exclusivo. Conserva el SDK productivo, JWT, protocolo, guardas de origen, RLS, filtros y timeouts originales. Destruye cada Agent al cerrar su socket. **Es un cambio solo del harness: un PASS demuestra el proveedor local, el adapter y el bridge con este transporte aislado, no el dispatcher usado en producción ni HTTPS de Vercel/Supabase remoto.** El factory productivo no se modificó.

## Aceptación completada en el entorno local

`outputs/supabase-native-realtime-20261009-attempt22.json` obtuvo **PASS** con PostgreSQL 17.11 y Auth/Realtime reales: avisos INSERT/UPDATE, mensajes INSERT/UPDATE para docente y familia vinculada, rechazo de familia ajena, SSE ready/invalidation sin datos privados, cierre voluntario con control positivo y revocación de perfil con lectura/eventos bloqueados y cierre SSE en el intervalo real. Los probes de activación también confirmaron SUBSCRIBED.

`outputs/supabase-native-realtime-20261009-attempt22-postflight.json` comprobó después de la limpieza dirigida: Auth API y users/identities/sessions vacíos, las 33 tablas escolares sin filas y Storage objects vacío. No se escribió en el destino restaurado ni en producción. `productionTransportVerified:false` se conserva en la evidencia: este PASS corresponde al dispatcher exclusivo del harness; los FAIL previos del transporte compartido permanecen disponibles.

## Intento del 12 de octubre de 2026: sin aceptación

`outputs/supabase-chat-browser-acceptance-20261012.json` registra **NOT_ACCEPTED**. El navegador se detuvo antes de introducir credenciales o enviar el ingreso; no se realizó el intercambio de mensajes. Las pruebas HTTP locales del código original confirmaron ingreso/sesión con 200, configuración habilitada y eventos con 200. El SDK predeterminado terminó con `unavailable` antes de `ready`; hubo cero conversaciones y cero mensajes. Node 24 dispone de WebSocket, pero la causa exacta de este resultado permanece sin establecer.

La limpieza/custodia sí pasó: 33 tablas/69 filas/6 cuentas Auth/3 objetos quedaron conservados, con campos originales, hashes, identidades y bytes privados. Se restauró el horario de comunicación y el catálogo original de 84 funciones; se comprobaron cerrados los seis puertos Native y los seis puertos ayudantes. El recibo anterior del supervisor se conserva byte por byte fuera del repositorio y su estado se corrigió para separar limpieza de aceptación.

Este intento no probó producción ni HTTPS de Vercel. El PASS del dispatcher exclusivo del 9 de octubre conserva su alcance; el chat de navegador y la entrega con transporte predeterminado requieren diagnóstico y aceptación posteriores. Un HTTP200 del endpoint de eventos no acredita que el stream haya llegado a `ready` ni que entregue mensajes.

### Diagnóstico pasivo posterior: primera frontera observada

`outputs/supabase-default-sdk-passive-diagnostic-20261013.json` conserva **NOT_ACCEPTED** para una ejecución del código publicado en Next local. Se usó una familia ficticia ya custodiada, sin crear cuentas, cambiar contraseñas, insertar conversaciones o enviar mensajes. Ingreso, sesión, configuración, apertura SSE y cierre de sesión devolvieron 200; el único evento fue `end` con motivo `unavailable`, sin `ready`.

Un observador pasivo de `diagnostics_channel`, cargado antes de Next, no sustituyó `fetch`, WebSocket, dispatcher ni callbacks del SDK. En el mismo proceso observó que la petición WebSocket utilizó el socket número 2, previamente empleado para REST, y recibió `AbortError` unos diez segundos después. No observó una respuesta HTTP101. Solo guardó categorías, identificadores locales de sockets y tiempos; no guardó cabeceras, consultas, cuerpos ni credenciales. Los identificadores de sockets no se comparan entre procesos.

Esto ubica el fallo local antes de una suscripción confirmada; no demuestra la causa interna del gateway o de Undici, ni el comportamiento HTTPS de Vercel. Cualquier solución debe aplicarse al transporte de la aplicación y ensayarse desde esa misma fuente, conservando separada esta evidencia anterior. Cambiar solo el transporte de un harness no acredita la aplicación.

La custodia volvió a pasar: 33 tablas, 69 filas, seis cuentas Auth, tres objetos y 84 funciones se conservaron. Únicamente se permitieron avances válidos de fechas de ingreso de la familia participante. Next y los seis servicios Native quedaron detenidos y sus puertos cerrados.

## Evidencia de accesos separada del chat

La regresión final `outputs/release-validation-internal-reissue-final-20261012.json` pasó **1.067 pruebas**, lint, TypeScript y ambas compilaciones antes de esta actualización documental posterior a la promoción. El ensayo `outputs/supabase-internal-reissue-native-20261012.private.json` pasó **14 comprobaciones/44 solicitudes reales** de SQL32/SQL33, activación y reemisión sin verificar, con limpieza y conservación de datos/catálogo/CHECK/ACL. Los resultados anteriores de 1.037 pruebas y 9 comprobaciones/36 solicitudes de activación son históricos y separados.

Las cuatro RPC y la configuración exclusiva del servidor están instaladas y comprobadas en la escuela. El flujo se publicó en el release READY `dpl_FrMbaUM11yzj2g6XsKVxrwzG7xaL`; pasaron **42 controles HTTP anónimos de producción (32+10)** y se observó el formulario público disponible. No se completó primer acceso escolar real ni aceptación de RPC autenticadas o del recorrido visual completo por HTTPS. La recuperación de cuentas confirmadas o activadas y SMTP siguen pendientes. Estos avances de acceso no cambian el resultado del chat: **NOT_ACCEPTED, cero conversaciones y cero mensajes**, con el SDK predeterminado terminando en `unavailable`. No demuestran entrega, reconexión ni revocación de mensajes con el transporte publicado.
