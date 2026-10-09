-- Bucket privado para biblioteca, tareas, entregas y adjuntos de comunicación.
-- La subida y descarga seguirán pasando por endpoints autenticados del servidor.
insert into storage.buckets (id, name, public, file_size_limit)
values ('school-files', 'school-files', false, 26214400)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

-- No se agregan políticas de acceso directo al navegador. Sin políticas, los
-- visitantes no pueden leer ni cambiar objetos; el servidor verifica rol y
-- pertenencia antes de operar con la clave de servicio, que es secreta.
