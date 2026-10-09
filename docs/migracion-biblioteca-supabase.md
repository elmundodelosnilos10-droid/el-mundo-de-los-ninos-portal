# Biblioteca escolar en Supabase

La aplicación conserva D1 como proveedor predeterminado (`SCHOOL_DATA_PROVIDER=d1`). La migración local `20261014000000_school_library_rpcs.sql` y las rutas opcionales preparan la biblioteca para listar materiales bajo RLS y publicar, reemplazar o retirar archivos mediante RPC transaccionales. Los cambios registran auditoría y validan el grupo con la identidad de Supabase Auth. El retiro confirma el cambio en Postgres antes de borrar el objeto indicado por la base, para evitar borrar un archivo que se haya reemplazado en paralelo.

Las cargas de materiales siguen pasando por validación de tipo y contenido, saneamiento de metadatos de imagen y escaneo configurado. El archivo se guarda primero en Storage; si falla la RPC de publicación o reemplazo, la ruta intenta limpiar el objeto nuevo. El bucket es privado. Los archivos viejos conservan su backend conforme al prefijo de su clave.

## Antes de habilitar

1. Mantener `SCHOOL_DATA_PROVIDER=d1`: la migración todavía no se ha ejecutado en PostgreSQL y los materiales escolares actuales permanecen en D1.
2. Verificar un respaldo cifrado de D1 y archivos; importar materiales, grupos, perfiles y relaciones a un proyecto Supabase de ensayo.
3. Confirmar `SCHOOL_FILE_STORAGE_PROVIDER=supabase`, el bucket privado `school-files` y acceso al backend antiguo para descargar o retirar objetos heredados.
4. Aplicar las migraciones en ensayo en orden, incluida `20261013000000_school_task_submission_rpcs.sql` antes de `20261014000000_school_library_rpcs.sql`, y comprobar publicar, listar, descargar, reemplazar y retirar con Dirección, docente asignada, docente no asignada y familia de otro grupo.
5. Comprobar también que un fallo de Storage/RPC no deja un material visible sin archivo; después validar importación y restauración antes de habilitar producción.

No se ha aplicado esta migración al proyecto escolar ni se han consultado registros reales. La publicación del código no cambia el proveedor activo.
