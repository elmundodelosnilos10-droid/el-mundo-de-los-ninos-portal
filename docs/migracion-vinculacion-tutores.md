# Fase 1: vinculación de tutores en Supabase

La migración local `supabase/migrations/20261011000000_guardian_link_rpc.sql` agrega dos operaciones atómicas:

- `school_link_guardian`: vincula un tutor ya existente con un alumno ya existente.
- `school_unlink_guardian`: elimina esa relación existente.

Ambas funciones usan `auth.uid()`, exigen un perfil activo con rol `direccion` o `superadmin` y escriben su evento en `audit_log` dentro de la misma transacción. La vinculación exige tutor, alumno, inscripción, grupo y ciclo escolar activos. La clave primaria de `student_guardians` impide duplicados incluso ante solicitudes simultáneas.

La ruta `app/api/students/[id]/guardians/route.ts` conserva D1 como proveedor predeterminado. Con `SCHOOL_DATA_PROVIDER=supabase`, la lectura obtiene los vínculos, los tutores y los nombres desde PostgREST usando el JWT del usuario y las políticas RLS; `POST` y `DELETE` usan las funciones RPC, que vuelven a validar el JWT dentro de Postgres. Las mutaciones rechazan solicitudes de otro origen. Esta fase no habilita otros módulos ni mueve datos.

## Estado y límites

Esta migración está únicamente en el repositorio local y **está pendiente de autorización para aplicarse**. No se ha conectado al proyecto remoto ni se deben usar datos reales para las pruebas de esta fase. Antes de aplicarla, confirmar la revisión y autorización de la escuela, que las migraciones anteriores estén instaladas y que los tutores, alumnos, inscripciones, grupos/ciclo y roles ya existan en Supabase.

La lectura principal de la ficha del alumno todavía procede de D1. La consulta de tutores disponibles ya admite Supabase en `GET /api/guardians`, pero el alta, baja y edición de cuentas y perfiles relacionados aún no se han migrado por completo. Mantener `SCHOOL_DATA_PROVIDER=d1` hasta migrar y verificar todas las lecturas y escrituras dependientes de esta pantalla.

Prueba local del contrato y del encaminamiento:

```sh
npm run test:supabase-guardian-link
```
