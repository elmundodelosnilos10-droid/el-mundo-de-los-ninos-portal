# Calendario, clases y avisos en Supabase

La aplicación conserva D1 como proveedor predeterminado (`SCHOOL_DATA_PROVIDER=d1`). La migración local `20261015000000_school_calendar_class_rpcs.sql` agrega lecturas y mutaciones opcionales para calendario, clases de Google Meet y notificaciones. Las consultas filtran con la identidad autenticada y el acceso por grupo; las mutaciones registran auditoría y generan avisos dentro de la misma transacción. Las grabaciones siguen desactivadas. Meet se crea manualmente y el portal conserva solo el enlace del organizador.

El calendario incluye eventos autorizados y fechas de entrega de tareas dentro del periodo solicitado. La ruta limita periodos a 93 días y respuestas a 500 elementos. Dirección puede crear eventos generales; docentes solo operan en sus grupos. Las familias solo reciben enlaces Meet y eventos de los grupos vinculados.

## Antes de habilitar

1. Mantener `SCHOOL_DATA_PROVIDER=d1`: la migración no se ha ejecutado en PostgreSQL y ciclos, grupos, eventos, clases y tareas reales siguen en D1.
2. Respaldar D1/Storage e importar perfiles, roles, grupos, asignaciones, matrículas, tareas y clases en un proyecto de ensayo.
3. Aplicar en orden las migraciones anteriores de directorios, asistencia, tareas y biblioteca; después aplicar `20261015000000_school_calendar_class_rpcs.sql`.
4. Verificar calendario mensual, semanal y agenda, eventos generales y por grupo, tareas con fecha de entrega, creación de Meet, visibilidad entre grupos, avisos y marcar un aviso como leído con cuentas sintéticas de Dirección, docente y familias separadas.
5. Confirmar además que cancelar un evento no elimina una clase, que una docente no asignada no puede publicar para otro grupo y que un error de RPC no deja un evento o aviso parcial.

No se ha aplicado esta migración a la base escolar ni se han leído datos personales. Publicar el código no cambia el proveedor activo. Google Meet sigue siendo manual; las políticas de admisión y grabación se controlan en Google.
