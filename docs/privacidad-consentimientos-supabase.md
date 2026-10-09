# Privacidad y consentimientos con Supabase

## Alcance

En `SCHOOL_DATA_PROVIDER=supabase`, las páginas `/consentimientos` y `/privacidad` obtienen el actor desde la sesión verificada en el servidor. Las cuatro APIs siguientes resuelven su rama Supabase antes de instanciar D1:

| API | Lectura | Escritura |
| --- | --- | --- |
| `/api/consents` | Dirección/superadmin, directorio con RLS | Comprobante nuevo + auditoría |
| `/api/privacy-requests` | Familia propia o dirección | Familia activa vinculada al menor |
| `/api/privacy-requests/[id]` | — | Dirección, transición + auditoría + notificación |
| `/api/privacy-notice` | Aviso público aprobado/vigente de SQL21 | Superadmin, versión nueva aprobada + auditoría |

SQL26 define las RPC; no se modifican las migraciones anteriores. D1 conserva su comportamiento previo mediante las ramas legacy. Los JWT se envían desde el servidor mediante la clave publicable; esta implementación no usa credenciales administrativas de base de datos, ni crea cuentas.

## Límites sobre los datos de menores

Los comprobantes requieren alumno, tutor, perfil y vínculo activos y rol tutor. La versión citada debe existir, estar aprobada y publicada y haber llegado a su fecha de vigencia en Ciudad de México. Una fecha de vencimiento debe ser futura. Se conservan las decisiones negativas y los retiros de autorización; no se convierten en autorizaciones. La pantalla exige seleccionar la decisión explícitamente.

Los registros de comprobantes y avisos son históricos: las cuentas escolares no pueden actualizarlos ni borrarlos directamente. Cada operación agrega un registro nuevo con su actor y fecha de base de datos, junto con auditoría, dentro de una transacción.

La política de lectura permite a cada familia consultar sus propios comprobantes de alumnos actualmente vinculados. Dos tutores del mismo menor no pueden inspeccionar la evidencia del otro tutor. Dirección conserva acceso al registro administrativo.

Solo un tutor activo puede enviar una solicitud sobre un alumno activo con vínculo vigente. Su UUID de cuenta se deriva de la sesión, sin aceptar un `requesterId` del cliente. La clave única de solicitudes abiertas evita duplicados del mismo tipo, alumno y solicitante. Las familias ven sus solicitudes; docentes no acceden al módulo de solicitudes familiares. Cuando dejan de tener acceso al alumno, el listado mediante joins/RLS deja de mostrar esa solicitud y su nombre; dirección conserva el historial.

## Seguimiento y publicación

Las solicitudes pasan de `recibida` a revisión, respuesta o cierre; de revisión a respuesta/cierre; y de respuesta a cierre. Una solicitud cerrada no vuelve a modificarse. Responder o cerrar requiere una nota. La RPC bloquea la solicitud antes de comprobar la transición y guarda cambio, auditoría y notificación juntos. La respuesta visible indica un resultado incierto si no se confirma la escritura; invita a recargar antes de repetirla.

Una solicitud de eliminación registra la petición y su seguimiento. Cambiar su estado no elimina alumnos, archivos ni identidades automáticamente. Las grabaciones siguen deshabilitadas en el flujo existente: registrar un comprobante no activa Google Meet ni su grabación. El sistema documenta decisiones de la escuela; no valida jurídicamente sus textos.

La publicación necesita rol superadmin y confirmación expresa de que la escuela aprobó el contenido. PostgreSQL valida cada campo, correo y fecha, y exige una versión nueva. La API pública utiliza la RPC limitada de SQL21, que omite actor, ID interno y fecha de aprobación. El formulario de publicación mantiene los campos de contenido de su contrato existente.

## Pruebas y trabajo pendiente

Se ejecutaron 20 pruebas unitarias de administración de privacidad, transiciones, comprobantes familiares y aviso público: todas pasaron. ESLint pasó para las fuentes de APIs, helper y páginas. La comprobación TypeScript completa solo reportó los cuatro errores existentes de exports generados en `.next/types/validator.ts`; no reportó errores de las fuentes de esta adaptación.

`tests/supabase-privacy.integration.sql` prepara datos sintéticos para una transacción con `ROLLBACK`: roles, dos menores, tutores compartidos/ajenos, publicación, negativas de consentimiento, aislamiento de evidencia, vínculo retirado, duplicados, transiciones, auditoría y notificaciones. Este agente no ejecutó SQL remoto. El agente principal coordina su ejecución antes de aplicar SQL26 y desplegar.

No se agregan tablas, por lo que el catálogo de respaldo de 33 tablas conserva la cobertura de estos datos. Las migraciones SQL26 y su fixture todavía requieren confirmación de ejecución PostgreSQL e instalación por el agente principal.
