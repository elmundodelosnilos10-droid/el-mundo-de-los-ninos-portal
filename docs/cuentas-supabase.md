# Administración de cuentas escolares en Supabase

## Contrato de la aplicación

Con `SCHOOL_DATA_PROVIDER=supabase`, crear o editar cuentas usa Supabase Auth y las RPC de `20261024000000_school_accounts_rpcs.sql`. El actor se obtiene de la sesión escolar actual; los permisos se comprueban de nuevo dentro de PostgreSQL. Estas ramas no consultan D1.

Dirección administra docentes y tutores. Solo un superadministrador puede crear o administrar cuentas de dirección. Ninguna de estas operaciones crea superadministradores, modifica la propia cuenta administrativa o altera una cuenta con el rol superadministrador.

La creación sigue este orden:

1. Comprobar que el correo no existe en el listado completo de Auth. Una cuenta existente requiere revisión; no se le asignan roles automáticamente.
2. Invitar al correo mediante Auth, obtener su UUID nuevo y comprobar correo, UUID y marca de invitación.
3. Guardar en `app_metadata` un recibo de invitación con un nonce nuevo, actor y correo. Los metadatos editables del usuario no sirven como prueba de autorización.
4. Con el JWT del actor, ejecutar `school_provision_invited_account`. La RPC bloquea las filas Auth y perfil, valida el recibo, limita la antigüedad de la invitación y asigna perfil, rol, registro docente/tutor y auditoría en una sola transacción.

El servicio administrativo de Auth solo invita y guarda el recibo. No concede roles escolares ni activa perfiles mediante una conexión administrativa a la base de datos.

## Edición y desactivación

`school_update_account` admite una sola operación por llamada: nombre, rol o estado activo. La edición de nombre comprueba que el correo continúe coincidiendo con Auth; no cambia el correo Auth. Cambiar el rol de una cuenta desactivada mantiene su estado desactivado. Los perfiles anteriores docente/tutor se conservan para mantener las referencias históricas.

El trigger de sincronización Auth actualiza correo, verificación e imagen, pero conserva el nombre editado por la escuela y el estado activo de perfiles existentes. Cambiar contraseña o metadatos Auth no reactiva una cuenta ni pisa su nombre escolar.

La desactivación bloquea las solicitudes escolares posteriores mediante el perfil y RLS. No implica que todos los tokens de Supabase Auth hayan sido revocados. Los permisos de una sesión se leen nuevamente desde la base de datos.

## Resultado incierto y recuperación

Si falla la invitación o la validación del recibo, esta solicitud no ejecuta la RPC de permisos. Un resultado incierto nunca se resuelve buscando una cuenta por correo y concediendo roles.

Si falla o se pierde la respuesta de provisión, la aplicación intenta `school_quarantine_invited_account` con el mismo UUID y nonce. La cuarentena puede desactivar la invitación propia y retirar sus roles, pero no puede modificar una cuenta preexistente, un superadministrador, roles asignados por otra persona o una cuenta ya administrada después de la invitación. Si tampoco se confirma la cuarentena, la interfaz informa que hace falta revisión; no afirma que el perfil haya quedado sin permisos.

Para revisar un caso incierto, un operador autorizado debe comprobar el UUID devuelto por Auth, el recibo de `app_metadata`, los roles, estado del perfil, auditoría y la fila privada de provisión. No debe borrar identidades ni conceder permisos automáticamente por coincidencia de correo. El recibo solo se acepta durante diez minutos para las RPC de invitación y cuarentena.

## Tabla privada de recuperación

`school_account_invitation_provisions` contiene:

| Columna | Función |
| --- | --- |
| `auth_user_id` | UUID de Auth y clave primaria |
| `invitation_nonce` | Recibo único para relacionar la invitación |
| `inviter_id` | Perfil que autorizó la invitación |
| `provisioned_at` | Fecha de provisión |
| `state` | `provisioned`, `quarantined` o `managed` |

RLS está activo y no hay permisos de lectura o escritura para `anon` o `authenticated`. Las RPC autorizadas operan sobre esta tabla. El estado `managed` impide que una cuarentena tardía deshaga una edición administrativa posterior.

## Respaldo y catálogo PostgreSQL

El script `scripts/supabase-school-backup.mjs` incluye las 32 tablas iniciales y la tabla privada de SQL24 mediante `loadSchoolBackupTables`. El catálogo de **respaldo** queda separado del catálogo de **importación D1**:

- La definición de SQL24 aparece después de las tablas originales. Sus identidades Auth y perfiles referenciados deben existir antes de restaurarla.
- UUID, nonce, actor, fecha y estado completos se conservan dentro del archivo cifrado. No se reinician los estados a `provisioned` ni se descartan `managed`/`quarantined` durante la recuperación.
- Se incluye en la firma de esquema, manifiesto, validación de integridad, comprobación de destino vacío y compensación de restauraciones incompletas.
- Los respaldos anteriores conservan su firma original. `verify <directorio> --legacy-school-schema` permite verificarlos explícitamente y muestra que no contienen el estado nuevo de provisión. La opción histórica se rechaza en `backup` y `restore`: no hay restauración silenciosa de un respaldo incompleto para SQL24.
- El transformador D1 mantiene el catálogo inicial de 32 tablas. La nueva tabla no tiene un origen D1 y su estado no se inventa durante la importación.
- `db/schema-postgres.ts` incluye el tipo UUID, referencias Auth/perfil, nonce único, fecha y estado validado de la nueva tabla. La aplicación actual no la consulta directamente; las RPC mantienen su acceso privado.

Auth no se recrea con el respaldo escolar actual: el destino necesita las identidades con sus UUID originales. La recuperación también debe preservar el recibo administrativo Auth cuando se quiera investigar una invitación pendiente; el archivo escolar no contiene por sí solo todos los metadatos Auth.

## Evidencia de revisión

Las nueve pruebas unitarias de `tests/supabase-account-administration.test.mjs` comprueban el orden Auth/RPC, rechazo de cuentas existentes, identidad y recibo, errores ambiguos, cuarentena y límites de dirección. La comprobación del contrato SQL exige que las tres RPC vuelvan a verificar los permisos del actor después de esperar por el bloqueo compartido. ESLint pasó para los archivos de esta implementación.

Las pruebas de respaldo validan el catálogo nuevo de 33 tablas separado del catálogo histórico de 32, rechazo de restauración histórica, preservación cifrada de los tres estados privados y restauración después de perfiles. Se ejecutaron las pruebas unitarias de cuentas y respaldo juntas: 24 pasaron, cero fallaron. Estos escenarios usan servicios simulados y archivos temporales; no comprueban permisos de un proyecto remoto.

`tests/supabase-accounts.integration.sql` prepara identidades sintéticas dentro de `BEGIN`/`ROLLBACK` y comprueba permisos, bloqueo de cuentas propias/superadministrador, cambio de rol sin reactivación, persistencia del nombre frente a sincronización Auth, cuarentena, estado de recuperación y auditoría. Su ejecución PostgreSQL la coordina el agente principal; este documento no acredita una ejecución remota.
