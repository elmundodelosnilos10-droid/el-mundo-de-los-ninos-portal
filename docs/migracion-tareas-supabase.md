# Tareas y entregas en Supabase

La aplicación mantiene D1 como fuente predeterminada (`SCHOOL_DATA_PROVIDER=d1`). La migración local `20261013000000_school_task_submission_rpcs.sql` prepara una ruta opcional de Supabase para consultar tareas y entregas, publicar, entregar o reentregar actividades, revisar evidencias y adjuntar archivos privados. Las rutas usan el JWT de la persona autenticada; las mutaciones se realizan mediante RPC con `auth.uid()`, validación de grupo/relación, auditoría y notificaciones transaccionales.

Las lecturas de familias requieren vínculo tutor-alumno y matrícula vigente en el grupo. Las docentes solo pueden operar en sus grupos; Dirección y superadministración conservan los permisos de liderazgo. La revisión bloquea evaluaciones académicas para lactantes y maternal. Las reentregas se serializan por tarea y alumno. La subida del objeto ocurre antes de la RPC; metadata, asociaciones, auditoría y avisos se guardan juntos, y la API intenta borrar el objeto si esa transacción falla.

## Antes de habilitar

1. No activar `SCHOOL_DATA_PROVIDER=supabase` todavía: la migración no se ha aplicado ni validado en PostgreSQL, y los datos escolares siguen en D1.
2. Crear y verificar un respaldo cifrado de D1 y Storage; preparar una instancia Supabase de ensayo, importar identidades y relaciones, y correr el preflight.
3. Confirmar que `SCHOOL_FILE_STORAGE_PROVIDER=supabase` y el bucket privado `school-files` están configurados para que las claves aceptadas por las RPC correspondan al almacenamiento real. Los archivos anteriores continúan en su backend según su prefijo.
4. En el proyecto de ensayo, verificar publicación, adjuntos, primera entrega, reentrega, revisión, notificaciones y aislamiento entre dos familias y dos grupos. Confirmar que un tutor con matrícula terminada ya no puede leer entregas/evidencias de ese grupo.
5. Con autorización de la escuela, aplicar la migración. Mantener el proveedor D1 hasta concluir respaldo, importación y comprobaciones de producción.

La biblioteca de materiales generales también tiene rutas opcionales y una migración local. Consulta `docs/migracion-biblioteca-supabase.md`. No se ejecutaron pruebas PostgreSQL ni se aplicaron estas migraciones al proyecto Supabase; D1 permanece como fuente activa.
