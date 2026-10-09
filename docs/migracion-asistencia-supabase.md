# Asistencia en Supabase

La aplicación conserva D1 como proveedor predeterminado (`SCHOOL_DATA_PROVIDER=d1`). Al seleccionar Supabase, el registro diario, el historial, las justificaciones, la revisión de justificaciones y los reportes usan funciones RPC con el JWT de la persona autenticada. La página carga grupos, inscripciones y alumnos mediante PostgREST con RLS; no usa una clave `service_role`.

La migración aditiva `supabase/migrations/20261012000000_school_attendance_rpcs.sql` agrega estas operaciones:

- Consultar lista diaria e historial por alumno.
- Consultar, enviar y revisar justificaciones de faltas.
- Guardar hasta 80 registros de asistencia de forma atómica.
- Exportar CSV, XLSX o PDF con hasta 10,000 registros y registrar la exportación en auditoría.

Las RPC validan `auth.uid()`, estado de la cuenta, rol, grupo, vínculo familiar, fechas y límites. Las mutaciones escriben la asistencia, auditoría y avisos en la misma transacción. La migración elimina las políticas antiguas de escritura directa y revoca `INSERT`, `UPDATE` y `DELETE` para el rol `authenticated`; las lecturas continúan protegidas por RLS y limitadas al grupo docente o al alumno vinculado.

## Antes de habilitar

1. Crear y verificar un respaldo cifrado de D1 y Storage; ejecutar el preflight y la importación contra un entorno de ensayo.
2. Revisar en PostgreSQL las migraciones pendientes y probarlas con una copia sintética. Esta migración incluye restricciones `NOT VALID`: hay que revisar fechas ISO, motivos de justificación y estados de revisión existentes antes de importar y validar esos datos.
3. La justificación familiar requiere exactamente una inscripción activa para el alumno. Si hay más de una, la RPC rechaza el envío hasta corregir la inscripción o ajustar el flujo para que la familia elija el grupo.
4. Ejecutar los flujos de lista diaria, historial, justificación, revisión, aislamiento por grupo, exportación y auditoría en un proyecto Supabase de ensayo.
5. Con autorización de la escuela, aplicar las migraciones al proyecto correspondiente. Mantener `SCHOOL_DATA_PROVIDER=d1` hasta terminar la copia de datos y las verificaciones de producción.

La suite automatizada comprueba el contrato SQL y RLS de forma estática, pero no ejecuta PostgreSQL ni demuestra el comportamiento del proyecto Supabase remoto. No se aplicó SQL a Supabase durante esta revisión.
