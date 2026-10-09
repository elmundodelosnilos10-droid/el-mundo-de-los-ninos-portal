# Avisos opcionales por correo y al navegador

## Estado de esta entrega

La integración queda preparada y **desactivada**. SQL31 no está instalado en producción; no se enviaron correos ni notificaciones push y no se solicitaron permisos del navegador durante estas pruebas. Los avisos privados del portal siguen usando sus mecanismos actuales.

Se prepararon preferencias propias, suscripciones de dispositivos, una cola persistente, APIs autenticadas, un service worker y un dispatcher real. Los adaptadores hacen solicitudes HTTP cuando un operador configura y habilita los canales; no simulan entrega. El proveedor puede aceptar una solicitud sin que el aviso llegue al buzón o al dispositivo.

La recuperación de contraseña y las invitaciones usan los correos de Supabase Auth. Su configuración y la prueba de recepción son independientes de estos avisos escolares; esta integración no demuestra recepción de aquellos mensajes.

## Para las familias y docentes

Cuando la escuela apruebe y configure un canal, **Mi cuenta → Avisos fuera del portal** permite aceptar expresamente cada canal. El correo debe estar confirmado en Auth y coincidir con el perfil. Push necesita además un navegador compatible y permiso concedido por la persona mediante un clic. Visitar una página no solicita permisos ni registra un dispositivo automáticamente.

Solo adultos con cuenta escolar activa y rol autorizado pueden administrar sus preferencias. La lista de dispositivos muestra únicamente identificadores propios, estado y fecha. No expone direcciones del proveedor ni claves de suscripción. Cada persona puede desactivar un canal y retirar sus propios dispositivos.

En equipos compartidos, una suscripción ya existente no se adopta como si perteneciera a la nueva cuenta. La interfaz permite retirar explícitamente la suscripción local y crear otra. Antes de prestar el equipo, conviene desactivar los avisos propios y cerrar sesión. El aviso externo contiene únicamente:

> Tienes un aviso en tu portal escolar. Inicia sesión para consultarlo.

No contiene nombres de alumnos, texto de tareas, conversaciones, observaciones, enlaces privados ni identificadores infantiles. Al abrirlo se entra al inicio del portal, donde vuelven a aplicarse el inicio de sesión y los permisos actuales.

## Preparación técnica y límites

- SQL31 crea `notification_channel_preferences`, `school_push_subscriptions` y `notification_delivery_outbox`. Los datos privados de destino solo se consultan desde el servidor. Las escrituras de usuario pasan por RPCs con sesión y consentimiento; las APIs aplican protección CSRF.
- Al insertar un nuevo aviso privado, el trigger añade trabajos solo para canales aceptados. No convierte avisos históricos en nuevos envíos. La clave única evita repetir el mismo aviso para el mismo canal y dispositivo.
- Antes de reclamar y antes de autorizar un trabajo se comprueban perfil, rol, consentimiento, correo confirmado y relación actual con el recurso. Se comprueban asignaciones docentes, vínculos de tutor, observaciones visibles, pertenencia al chat y destinatario. Las claves de eventos desconocidas o mal formadas se rechazan. Un rol docente adicional no permite ver observaciones internas a través de un vínculo de tutor.
- Los avisos ya leídos o con más de 24 horas se suprimen. También se suprimen los trabajos pendientes o reclamados al revocar el consentimiento. Un cambio concurrente después de la autorización puede coincidir con una solicitud externa ya en curso; una petición enviada no se puede retirar del proveedor.
- El dispatcher procesa como máximo cinco trabajos por ejecución. Reclama uno, autoriza, realiza una solicitud y confirma el estado antes de reclamar el siguiente. Cada operación tiene un límite de 20 segundos; no se reservan cinco trabajos mientras los anteriores se envían.
- Una respuesta incierta detiene esa ejecución. Los trabajos `uncertain` nunca se reclaman otra vez. Una reclamación abandonada pasa a `uncertain` al vencer su plazo de dos minutos. No se reintenta un POST automáticamente, aunque falle la confirmación posterior.
- Correo usa la Web API de Resend con `Idempotency-Key` estable por trabajo. Resend documenta retención de esa clave durante 24 horas; nuestra cola también evita replay de trabajos inciertos, sin depender de una retención indefinida. [Documentación de idempotencia de Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).
- Push usa cifrado Web Push y VAPID mediante `web-push`, con tema opaco y estable obtenido de SHA-256. Se admiten únicamente los destinos HTTPS exactos de Google, Mozilla y Apple definidos en el código. Otros servicios de navegador requieren revisión antes de añadirse. DNS se comprueba contra direcciones privadas y el transporte fija la dirección validada, conserva TLS y no sigue redirecciones. [Repositorio oficial web-push](https://github.com/web-push-libs/web-push).
- `accepted` significa aceptación HTTP del proveedor; no se informa `delivered`. No hay confirmación de lectura del buzón ni garantía de recepción push. Una suscripción caducada 404/410 se desactiva.

## Activación futura por un operador

Esta sección describe un procedimiento pendiente; no es evidencia de activación.

1. Revisar y aprobar SQL31 y sus tres permisos de lectura para el respaldo privado. Mantener los canales y el dispatcher desactivados. Verificar antes un respaldo vigente y su restauración. La autorización de SQL29 para respaldos de las 33 tablas actuales es independiente; no se ha concedido por esta preparación.
2. Instalar SQL31 en el entorno aprobado. Comprobar las 36 tablas y los RPCs con las pruebas de roles correspondientes. Preparar un respaldo cifrado de 36 tablas con el dispatcher realmente detenido antes de habilitar envíos.
3. Configurar un origen público HTTPS raíz en `APP_ORIGIN`. Usar el ejemplo [notificaciones-externas-config.example](./notificaciones-externas-config.example). Guardar secretos solo en el entorno del servidor; no usar prefijos `NEXT_PUBLIC_`.
4. Para correo, configurar proveedor `resend`, clave privada y remitente aprobado y verificado por el proveedor. Tener la cuenta Gmail de administración no verifica un dominio ni habilita automáticamente un remitente de Resend. Para push, configurar proveedor `webpush`, par VAPID válido y contacto `mailto:` o HTTPS público. Una configuración incompleta o un par de claves inválido no ofrece ese canal a los usuarios. No se generaron claves de producción en estas pruebas.
5. `SCHOOL_NOTIFICATION_SETTINGS_ENABLED=schema31-ready` puede mostrar la gestión propia tras aprobar e instalar SQL31 incluso con ambos proveedores apagados, para permitir revocaciones. Su valor predeterminado es `disabled`; no debe marcarse ready antes de instalar el esquema.
6. Cada adulto acepta el canal desde Mi cuenta. Si el navegador bloquea push o el servicio no es compatible, el portal conserva sus avisos internos y muestra la situación sin prometer entrega externa.
7. Un operador autorizado ejecuta manualmente con secretos en un entorno privado:

```sh
node --experimental-strip-types scripts/school-notification-delivery-worker.mjs --dispatch-once
```

El proceso solo reclama si hay un canal válido y `SCHOOL_NOTIFICATION_WORKER_ENABLED=manual-approved`. No lee archivos `.env`, no crea un cron y no dispone de un endpoint público de dispatch. Los resultados de consola son contadores agregados sin destinatarios, claves, endpoints ni mensajes privados. Revisar `unconfirmed` o `uncertain` en la cola privada antes de cualquier nueva operación; no recrear trabajos para ocultar un fallo.

## Respaldo y restauración

El catálogo actual conserva 33 tablas y el histórico conserva 32. Con SQL31 instalado se elige explícitamente el catálogo de 36. El helper rechaza un respaldo de 33 si el esquema remoto verificable ya contiene las tablas o los RPCs de avisos externos.

Antes de respaldar o restaurar 36, el operador debe detener realmente todos los dispatchers y confirmar esa situación. El flag es una declaración explícita del operador; no detecta procesos externos automáticamente.

```sh
node scripts/supabase-school-backup.mjs backup <directorio-nuevo> --external-notices-schema --confirm-delivery-worker-paused
node scripts/supabase-school-backup.mjs verify <directorio> --external-notices-schema
node scripts/supabase-school-backup.mjs restore <directorio> --external-notices-schema --confirm-delivery-worker-paused --confirm-restore
```

El manifiesto cifrado declara el catálogo de 36 y el dispatcher pausado. Preferencias, suscripciones y cola también se cifran, porque incluyen direcciones y claves privadas. Conservar la contraseña del archivo separada de los archivos exportados. No subir respaldos ni claves a GitHub.

La restauración conserva los estados: un trabajo `claimed` no vuelve a `pending`; vencerá a `uncertain` sin ser reenviado. Tampoco se reenvía un trabajo `uncertain`. Los trabajos `pending` conservados vuelven a validar todos los permisos y consentimiento antes de cualquier envío. Las identidades Auth se respaldan/restauran por su procedimiento separado con sus UUID originales; el respaldo de tablas no recrea cuentas.

## Evidencia disponible

- [school-notification-delivery-local-20261009.json](../outputs/school-notification-delivery-local-20261009.json): PostgreSQL native real en la fuente local aislada. SQL31 y cinco cuentas sintéticas sin contraseña se probaron dentro de un único BEGIN/ROLLBACK. Ocho comprobaciones del runner PASS, incluyendo compilación, fixture RLS/consentimiento/revocados/dual-role/replay, vacío antes y después y parada oficial. Se conservaron Auth 0 / 33 tablas con 0 filas / Storage 0; SQL31 quedó ausente al terminar. Ninguna solicitud a proveedores.
- Pruebas de handlers y adaptadores usan solicitudes HTTP sintéticas: prueban cifrado real Web Push, idempotencia, errores, límites de lectura, DTOs privados, rol/CSRF, contenido genérico del service worker y dispatcher finito. No prueban recepción de mensajes reales.
- Respaldo36 tiene pruebas con transporte sintético y un ensayo PostgreSQL/Auth real separado: `outputs/supabase-backup36-auth-local-20261009-attempt2.json`, **14 comprobaciones PASS**, 36 tablas/51 filas, tres identidades Auth y cero objetos Storage. Copia cifrada, verificación offline y restauración exacta; UUID/hashes/identidades preservados, login de dos familias y RLS privados, rechazo de catálogo33 parcial y lease restaurado vencido → `uncertain`, sin reclamar/reautorizar trabajos inciertos. Se conservaron los stacks anteriores byte por byte y los dos nuevos se detuvieron oficialmente. El intento1 FAIL de guarda metadata TCP se conserva; ocurrió antes de arranque/DML. No hubo dispatcher ni solicitudes externas. No acredita restauración de 36 en producción, bytes Storage en este ensayo ni recepción externa.

Archivos principales: `lib/school-notification-delivery.ts`, `scripts/school-notification-delivery-worker.mjs`, SQL31 y las rutas `/api/notification-channels`, `/api/push-subscriptions`, `/school-notices-sw.js`.
