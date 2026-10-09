# Auditoría local de Clases y privacidad — 9 de octubre de 2026

Revisión en lectura de los requisitos 6 y 14 y los flujos 17 y 18. No se consultaron servicios de producción, no se crearon cuentas ni se ejecutaron migraciones o escrituras en bases de datos. No se modificó la aplicación durante esta revisión.

## Evidencia ejecutada

Las nueve suites existentes indicadas abajo pasaron **69/69 comprobaciones**, sin fallos ni omisiones. Se ejecutaron con `env -i`, `NODE_ENV=test` y únicamente `PATH` heredado. Los clientes de red y registros escolares utilizados por estas pruebas son sintéticos.

- `tests/supabase-calendar-contract.test.mjs`: contratos y permisos SQL inspeccionados como texto; no ejecución PostgreSQL en esta revisión.
- `tests/supabase-calendar-filters.test.mjs`: handler de calendario y filtros con dependencias sintéticas, además de contratos estáticos.
- `tests/supabase-family-consents.test.mjs`: helper real, vínculos propios, última decisión, familias ajenas, paginación y errores.
- `tests/supabase-public-privacy-notice.test.mjs`: helper real con respuesta sintética; publicación pública sin token de usuario ni credencial de servicio; ausencia distinta de error.
- `tests/supabase-privacy-administration.test.mjs`: helpers reales de RPC, identidad/roles, aprobación explícita, respuestas inciertas y contratos SQL.
- `tests/privacy-request-policy.test.mjs`: transiciones válidas y rechazo después del cierre.
- `tests/supabase-operations.test.mjs`: estado operativo honesto, incluidas grabaciones desactivadas.
- `tests/supabase-file-routes.test.mjs`: handlers reales en VM, sin D1, archivos privados, errores saneados, límites y cierre sin analizador.
- `tests/school-csrf-route-coverage.test.mjs`: cobertura estática de comprobación de origen en mutaciones.

Registro de ejecución: `/tmp/school-meet-privacy-audit-tests-20261009.log`. Estas comprobaciones no prueban admisión en Google Meet, decisiones legales de la escuela ni operación de proveedores publicados.

## Clases y Meet

`GET /api/classes` exige sesión; en Supabase utiliza JWT escolar y `school_list_class_sessions`. La RPC requiere perfil activo y solo devuelve clases de grupos accesibles, con grupo, docente y perfil activos. La respuesta no contiene archivos de grabación. La creación exige origen válido, rol docente/dirección/administración, grupo autorizado y docente asignado. La RPC comprueba la URL `https://meet.google.com/...`, crea el evento, registra auditoría y avisos en la misma transacción y fija `recording_allowed=false` y `recording_file_id=null`. Las escrituras directas de clases están revocadas para `authenticated`.

La pantalla indica que la maestra crea la reunión en Google y pega el enlace. El formulario explica que las grabaciones están desactivadas. No hay afirmación de admisión, asistencia o grabación automática. El manual explica que la organizadora controla la admisión en Meet. Esa aclaración no aparece junto al enlace en la vista familiar: sería una mejora de comunicación, no una integración ya existente.

**Flujo 17:** el portal protege la visibilidad del enlace mediante permisos de grupo. El acceso a la sala real, la admisión de invitados y el posible reenvío del enlace dependen de Google y siguen pendientes de comprobación con la organizadora.

## Defecto confirmado: descarga de grabaciones existentes

Aunque la carga de propósito `recording` no está habilitada y las clases nuevas no pueden habilitar grabación, `GET /api/files/[id]` no rechaza un archivo existente cuyo `purpose` sea `recording`. La política `files_read_authorized` vigente desde la migración 13 permite esos registros mediante el alcance de grupo/alumno, sin comprobar autorización de grabación. Las posteriores revocaciones de escritura evitan su creación directa por el usuario, pero no cierran la lectura de un registro antiguo o importado.

Se ejecutó el **handler real en VM** reutilizando el harness existente, con tutor y una fila RLS autorizada completamente sintéticos:

| Resultado | Valor |
| --- | --- |
| Propósito de archivo | `recording` |
| HTTP GET | `200` |
| Lecturas de Storage sintético | `1` |
| Bytes entregados | `35` |
| Llamadas D1 | `0` |
| Caché | `private, no-store` |

Esto demuestra una ruta de lectura no bloqueada; **no demuestra que exista ninguna grabación de la escuela**. Se recomienda rechazar ese propósito antes de leer Storage, conservando las grabaciones apagadas y añadiendo una prueba del handler para todos los roles. No se editó el endpoint durante la auditoría.

**Flujo 18:** no debe declararse completamente cerrado hasta corregir esta descarga. El rechazo de nuevas cargas y el valor `false/null` de las clases nuevas sí están comprobados por los contratos existentes.

## Privacidad y consentimientos

- El aviso público usa una RPC específica con campos publicados y aprobados, sin exponer registros administrativos. Publicar una nueva versión exige superadministración, origen válido y confirmación explícita de aprobación; SQL valida contenido, fecha y auditoría. No hay aviso legal generado como sustituto de aprobación escolar.
- El directorio y registro de consentimientos se limita a dirección/administración. La RPC exige alumno, tutor, perfil y vínculo activos; tutor con rol familiar; versión del aviso aprobada, publicada y vigente; referencia del comprobante y vencimiento futuro si se indica. Consentimiento y auditoría se registran juntos. Las filas son acumulativas y no tienen edición directa por `authenticated`.
- Una familia consulta únicamente decisiones de su propio tutor para hijos activos vinculados. Se conserva la decisión más reciente; un error no se transforma en autorización ni en éxito. Registrar una decisión sobre grabaciones no habilita la función de grabación.
- Las solicitudes de privacidad requieren una familia vinculada para el alta. Dirección/administración responde mediante estados validados y auditoría/aviso en la misma transacción. Las consultas familiares se limitan al solicitante; el registro no promete borrado automático ni resuelve obligaciones de la escuela.

Observación menor de diagnóstico: `GET /api/privacy-requests` en modo Supabase rechaza un rol docente en el helper, pero el `catch` presenta `503` en lugar de `403`. No expone datos ni amplía permisos; puede confundir un rechazo de rol con indisponibilidad. No se modificó esta respuesta.

Para operar con información real siguen pendientes el aviso aprobado, representación familiar, autorizaciones documentadas, retención y procedimiento escolar, además de correo, analizador y respaldo de producción según el estado general del proyecto. Esta auditoría no declara cumplimiento legal ni valida proveedores externos.

## Corrección posterior a la auditoría

Se conservó el informe inicial y se corrigieron únicamente los dos endpoints señalados, sin SQL ni cambios de servicios o cuentas:

- `GET /api/files/[id]` devuelve `404` para `purpose=recording` antes de comprobar o leer Storage. La nueva prueba ejecuta el handler real en VM para superadministración, dirección, docente, tutor y alumno: todos reciben `404` y hacen **cero accesos a Storage**. Las pruebas existentes conservan descarga autorizada de materiales, adjuntos privados y archivos antiguos mayores que el límite de nuevas cargas.
- `GET /api/privacy-requests` rechaza roles no autorizados con `403` antes de consultar cualquier proveedor. Una denegación `403` de la RPC mantiene `403`; errores de disponibilidad mantienen `503` sin detalles privados. Cuatro pruebas nuevas ejecutan el handler real con JWT/RPC sintéticos, incluyendo anónimo, docente/alumno, roles permitidos e identidad ausente o distinta.

La ejecución dirigida posterior pasó **40/40 comprobaciones**, sin omisiones: rutas de archivos, nueva suite de ruta de privacidad, administración de privacidad y cobertura CSRF. Registro: `/tmp/school-recording-privacy-fix-tests-20261009.log`. Esto comprueba la corrección en la fuente local; no afirma que haya sido publicada ni que Google Meet haya sido probado.

## Publicación comprobada

Las correcciones de descarga de grabaciones y respuesta403 de privacidad se publicaron en `dpl_44sWbxTREwV9Fu3WRSCCSH2ZBmaU`, con 538 pruebas y 19 controles HTTP en cada etapa de publicación. La prueba del archivo `recording` sigue siendo un handler VM con filas sintéticas autorizadas por el proveedor, para cinco roles, sin lecturas Storage; no se crearon grabaciones ni datos de alumnos en producción. No se habilitaron permisos, consentimiento ni grabación de Google Meet.
