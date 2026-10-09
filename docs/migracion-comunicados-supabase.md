# Comunicados en Supabase

La migración local `20261016000000_school_announcement_rpcs.sql` agrega una consulta autorizada de comunicados, publicación transaccional y recibos personales de lectura. El publicador valida su identidad y rol con el JWT actual, limita docentes a sus grupos, limita avisos generales a Dirección y registra auditoría y notificaciones para las familias con matrículas y vínculos activos.

La ruta `/api/announcements` usa estas RPC únicamente cuando `SCHOOL_DATA_PROVIDER=supabase`. El valor actual permanece en `d1`; el módulo D1 sigue disponible como alternativa. La bandeja de avisos mezcla notificaciones Supabase y D1 mientras otros módulos continúen en D1.

## Requisitos antes de habilitar

1. Mantener D1 como proveedor hasta crear y verificar un respaldo de registros y archivos.
2. Importar los perfiles, roles, grupos, matrículas, tutores, vínculos y comunicados en un proyecto Supabase de ensayo, conservando UUIDs.
3. Aplicar primero las migraciones escolares previas y después `20261016000000_school_announcement_rpcs.sql`.
4. Probar con cuentas sintéticas de Dirección, docente asignada, docente no asignada y dos familias: comunicado general, aviso por grupo, recibo de lectura, aislamiento de otra familia, deduplicación de notificaciones y ausencia de actividad parcial ante un error.
5. Verificar las funciones en PostgreSQL y las políticas RLS en el proyecto de ensayo antes de cambiar el proveedor del Site.

La migración solo prepara el esquema y las funciones; no copia comunicados ni notificaciones y no habilita el proveedor en producción. Los avisos permanecen dentro de la plataforma; el correo y las notificaciones push requieren una integración configurada por la escuela.
