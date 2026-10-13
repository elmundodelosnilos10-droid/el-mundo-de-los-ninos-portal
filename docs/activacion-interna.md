# Primer acceso con código privado

Estado: activación y reemisión de invitaciones sin verificar publicadas en el release READY `dpl_FrMbaUM11yzj2g6XsKVxrwzG7xaL`, con SQL32/SQL33 y configuración exclusiva del servidor instaladas y comprobadas. Pasaron 42 controles HTTP anónimos en el dominio habitual. Se observó la página pública de activación con campos y botón disponibles; no se completó el primer acceso de una cuenta escolar real ni la aceptación autenticada de sus RPC o del recorrido visual.

## Evidencia de trabajo del 12 de octubre

La regresión final `outputs/release-validation-internal-reissue-final-20261012.json` pasó **1.067 pruebas**, lint, TypeScript y ambas compilaciones, con inventario de fuente estable. Incluye las guardas de reemisión, el bloqueo compartido de Cuentas, el cifrado y la caducidad durante la reclamación. Corresponde al código del release publicado y precede a esta actualización documental posterior a la promoción; esta edición de guías no añade pruebas. La regresión anterior `outputs/release-validation-internal-activation-retry2-20261012.json` pasó **1.037 pruebas**; sus resultados y los de 1.035 casos se conservan como historial.

El ensayo actual `outputs/supabase-internal-reissue-native-20261012.private.json` pasó **14 comprobaciones y 44 solicitudes reales** al Supabase aislado. Comprobó las fixtures SQL32/SQL33, dos reservas concurrentes con una única generación y estampa Auth sobre el mismo UUID pendiente, sustitución de nonce/código sin cambiar contraseña ni rol, rechazo del código anterior, cookie provisional cifrada, reclamación concurrente con un único cambio de contraseña, persistencia e ingreso docente posterior con contraseña y RLS. Una cuenta ya confirmada y gestionada rechazó la reemisión antes de generar credenciales. La limpieza pasó: 33 tablas/69 filas/6 identidades/3 objetos originales exactos, con hashes, metadatos y bytes privados conservados. Se retiraron las cuatro funciones propias y se restauraron el catálogo de 84 funciones, el CHECK anterior y los permisos originales de la tabla. El destino Native quedó detenido. No hubo conexiones a producción ni cambios de contraseñas existentes. Es integración real mediante `Request`, no aceptación visual ni HTTPS de Vercel.

El ensayo anterior `outputs/supabase-internal-activation-native-retry4-20261012.private.json` pasó **9 comprobaciones y 36 solicitudes reales** de SQL32 y activación inicial. Conserva su alcance histórico y no constituye evidencia de SQL33.

Los ensayos iniciales en FAIL se conservan. El primer supervisor envió `BEGIN` desde un pool sin reservar conexión, uso que el cliente rechaza con `UNSAFE_TRANSACTION` después de enviar el lote. El segundo detectó las funciones presentes y se detuvo antes de reemplazarlas. La recuperación verificó ausencia previa y cuerpo/firma/propietario exactos y retiró solo esas dos funciones, preservando catálogo y datos. Los intentos posteriores corrigieron la fixture para respetar el guard del último superadministrador y añadieron el global estándar `URLSearchParams` que faltaba en el VM del ensayo. No se debilitaron controles de producción para hacer pasar estas pruebas.

Después de las aprobaciones explícitas, SQL32 y SQL33 se ejecutaron en el proyecto escolar. Se cotejaron los cuerpos de las cuatro funciones contra la fuente, las firmas, el contexto de seguridad y sus ACL; la tabla privada conserva SELECT cerrado y el CHECK admite los cuatro estados previstos. La clave exclusiva `SCHOOL_ACCOUNT_ACTIVATION_SECRET` y `SCHOOL_ACCOUNT_ACTIVATION_MODE=internal` quedaron configuradas únicamente en el servidor de producción de Vercel, con nombres/tipos/destino comprobados en `outputs/vercel-internal-reissue-activation-config-approved-20261012.json`. Ese paso de configuración no desplegó ni promovió una versión. Después se publicó y promovió el build READY indicado arriba; los informes `outputs/vercel-internal-reissue-final-release-20261012-production-http.json` y `outputs/vercel-internal-reissue-final-release-20261012-production-activation-http.json` registran **42 controles anónimos PASS (32+10)**. La fuente coincide con los 583 archivos SHA-256 del GitHub escolar, commit `6a91a8025fa81e84c1109c7a57ca253f17a4c65e`. Estos controles y la presentación pública no acreditan el primer acceso escolar autenticado, la reemisión autorizada ni el panel posterior. La cuenta maestra no se cambió.

## Uso previsto

1. Dirección registra el nombre, el correo existente y el rol en **Cuentas**. Solo administración general puede crear otra cuenta de dirección.
2. El servidor crea una invitación Auth sin enviar correo, habilita el perfil mediante la RPC escolar y muestra un código cifrado. No crea accesos de alumnos ni superadministradores.
3. Dirección entrega el código en privado a la persona cuyo correo registró. El código dura 30 minutos y solo se muestra en esa respuesta; copiarlo requiere una acción explícita.
4. La persona abre `/activar-cuenta`, escribe su correo y pega el código. Una sesión provisional cifrada permite elegir la contraseña durante un máximo de 10 minutos. Esta cookie no autoriza páginas escolares.
5. La base de datos consume la activación antes del único cambio de contraseña. Después la persona inicia sesión normalmente con su correo y la contraseña que eligió.

El correo puede ser Gmail u otro proveedor. No se solicita la contraseña de Gmail ni iniciar sesión con Google.

## Configuración instalada y controles pendientes

- Supabase Auth y datos escolares deben estar configurados.
- SQL32 `supabase/migrations/20261101000000_school_internal_activation.sql` está instalado después de SQL24. Añade dos funciones; no concede acceso a tablas. La reclamación usa `auth.uid()` y el nonce propio, bajo el mismo bloqueo de administración de cuentas.
- SQL33 `supabase/migrations/20261102000000_school_internal_activation_reissue.sql` está instalado: dos RPC de dirección/superadministración y el estado privado `reissuing`, sin nuevas tablas ni permisos directos de lectura.
- La clave exclusiva de activación ya está guardada como `SCHOOL_ACCOUNT_ACTIVATION_SECRET` solo en el servidor. No se reutilizan ni publican claves Supabase.
- `SCHOOL_ACCOUNT_ACTIVATION_MODE=internal` está configurado en el servidor del release publicado. El valor predeterminado del código sigue siendo `email` para instalaciones sin esa selección explícita.
- El servidor comprueba la disponibilidad de SQL32 con el JWT de dirección antes de crear una identidad. La configuración incompleta no crea cuentas nuevas.
- Conservar HTTPS y el origen autorizado. No distribuir códigos en direcciones URL, registros, capturas públicas ni almacenamiento persistente del navegador.

## Uso único y resultados inciertos

SQL32 cambia la provisión privada de `provisioned` a `managed` con una actualización condicional y auditoría en la misma transacción. Dos solicitudes concurrentes deben obtener exactamente una reclamación. El marcador de finalización Auth bloquea también la repetición posterior.

Una reclamación aceptada no demuestra por sí sola que Auth haya guardado la contraseña. Si se pierde la respuesta de la base de datos o de Auth, la reclamación permanece consumida; el servidor no la reabre ni repite automáticamente el cambio. La interfaz borra las credenciales provisionales y orienta a probar el ingreso o contactar a la escuela. La recuperación de una cuenta existente necesita su canal verificado; este flujo no sustituye el correo de recuperación.

La verificación del código consume el token de invitación y confirma la cuenta en Auth **antes** de guardar la contraseña. Cancelar después de ese paso o dejar vencer la cookie provisional no devuelve la identidad al estado previo. Deben distinguirse tres casos:

1. **Código perdido o vencido sin haberse verificado:** identidad todavía no confirmada, sin primer ingreso ni contraseña y provisión pendiente. La reemisión está publicada y pasó el ensayo Native SQL33; falta aceptarla con una cuenta escolar autorizada en el hosting.
2. **Código ya verificado, pero sin completar contraseña:** cuenta confirmada en Auth, incluso si se cancela o vencen los diez minutos de sesión provisional. Necesita un canal verificado de recuperación y revisión de la escuela; no es elegible para la reemisión de una invitación pendiente.
3. **Cuenta activada:** entra con su correo y contraseña; si perdió la contraseña, usa recuperación normal. No se vuelve a emitir una invitación inicial ni se restablecen permisos por coincidencia de correo.

## Límites que deben cerrarse antes de uso diario

- Aceptación autenticada y visual del primer acceso y del ingreso posterior. La integración aislada y las carreras de consumo pasaron; los 42 controles HTTPS anónimos y el formulario público observado no sustituyen ese recorrido escolar.
- Comprobación de las RPC con una cuenta escolar autorizada y aceptación de su rol después de elegir contraseña en el hosting publicado.
- Aceptación visual/escolar de la reemisión autorizada de códigos sin verificación previa, ya comprobada con Auth/PostgreSQL reales aislados. No cubre cancelación o caducidad de la cookie después de verificar ni cuentas activadas. No intentar resolver esos casos creando de nuevo el mismo correo; el alta rechaza identidades existentes para proteger cuentas y permisos.
- Recuperación de cuentas existentes: SMTP y recepción aún requieren aceptación. No restablecer contraseñas ni permisos por una coincidencia de correo.
- Primera aceptación escolar con una cuenta nueva autorizada. La cuenta maestra y su contraseña permanecen fuera de las pruebas sintéticas.

Las pruebas de UI, cifrado y callbacks no sustituyen esa aceptación ni la preparación completa de archivos, Meet, respaldos y privacidad.

## Reserva de reemisión y custodia

SQL33 reserva la invitación exacta con un nonce nuevo y estado `reissuing` antes de llamar a Auth. Bloquea solicitudes paralelas, el nonce anterior y cualquier cuenta confirmada, con contraseña, primer ingreso, finalización, rol protegido o recibo diferente. El código se cifra antes de finalizar; solo se entrega tras confirmar la RPC final. Un cambio escolar de rol, nombre o estado que marca la provisión como `managed` impide finalizar la reserva.

No se restaura el nonce anterior ni se repite una operación incierta. Si Auth o la reserva fallan, puede quedar `reissuing`; si se pierde la respuesta final después de un COMMIT, puede quedar `provisioned` con el nonce nuevo y sin un código confirmado para entregar. Esos casos exigen revisión privada por UUID, nonce y auditoría. Los respaldos conservan `reissuing`; el destino debe tener SQL33 antes de restaurar ese estado. Nunca convertirlo automáticamente en `provisioned` durante una recuperación.
