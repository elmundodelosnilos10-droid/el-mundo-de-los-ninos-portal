# Portabilidad a Vercel y PostgreSQL de Supabase

## Estado vigente comprobado (8 de octubre de 2026)

El portal publicado usa Next.js y sus API en [Vercel](https://el-mundo-de-los-ninos-portal.vercel.app), despliegue **READY** `dpl_8g4Q2BeNPdgNrLWhrM9DXcBz9xcy`. Auth, datos y Storage seleccionados son Supabase escolar. El servidor exige JWT y UUID Auth verificados, perfil activo y roles/relaciones sujetos a RLS/RPC. D1 se conserva en las ramas legacy; el enlace de identidad por correo descrito en la propuesta histórica fue superado.

Hay **22 migraciones instaladas, desde las versiones base 08 hasta la 26**. El secreto de servidor fue configurado con autorización y no se incluye en este documento ni se envía al navegador. Biblioteca 27, calendario 28, mejoras de PDF y correcciones de asistencia son fuentes preparadas pendientes del despliegue integrado; este registro no las atribuye al despliegue READY ni afirma aquí instalación de 27/28.

Los servicios todavía tienen pendientes operativos: el `GET profiles` del respaldo devolvió **403** y falta lectura `service_role` en las 33 tablas escolares; respaldo/restauración de producción no está verificado. Hay código de scanner preparado, pero sin motor ni hosting real conectado. Las cargas deben continuar bloqueadas hasta disponer de un servicio aprobado que devuelva un resultado limpio.

Detalle y evidencia vigente: [Hosting Vercel](hosting-vercel.md), [Verificación Vercel/Supabase](verificacion-vercel-supabase-20261008.md) y [Estado de requisitos](estado-requisitos.md).

## Propuesta histórica de portabilidad (8 de octubre de 2026; anterior a Vercel)

Los bloques siguientes conservan el diagnóstico y el código preparado durante la transición. Las frases sobre identidad por correo, D1, rutas sin Supabase y migraciones todavía locales corresponden a ese momento, **no al portal vigente**. No deben usarse para reactivar D1 ni reemplazar los RPC actuales. El inventario de líneas y las cifras de pruebas son históricos.

Fecha del diagnóstico original: 8 de octubre de 2026. Esa propuesta añadía código aislado; todavía no cambiaba el runtime de Sites/D1 ni desplegaba recursos externos.

## Código preparado en el diagnóstico histórico (8 de octubre de 2026)

- `db/schema-postgres.ts`: las 32 tablas escolares de Supabase y sus 218 columnas, comparadas una a una en nombres SQL y tipos con `20261008000000_school_schema.sql`.
- Conserva los nombres TypeScript usados por páginas y APIs. `user` apunta a `public.profiles`; también se exporta `profiles`. Identidades y referencias son UUID, marcas temporales `timestamptz` devuelven `Date`, los flags son booleanos y las fechas escolares sin hora continúan como texto, tal como están en la migración.
- El perfil tiene `active=false` por defecto según la migración posterior de invitaciones. Los defaults de tiempo de perfiles, alumnos y roles se reflejan con `defaultNow()`.
- `lib/supabase/pg-connection.ts`: conexión real con `postgres` y Drizzle para Node.js en Vercel. Usa un máximo de tres conexiones por instancia, desactiva prepared statements para el transaction pooler, verifica el certificado TLS y no lee ni imprime secretos.
- La conexión es perezosa. Debe reutilizarse por instancia del servidor y cerrarse al terminar herramientas independientes; nunca cerrarse al final de cada request ordinario.
- `runAsVerifiedUser` abre una transacción, instala claims y `SET LOCAL ROLE authenticated`, y ejecuta las consultas del callback bajo las políticas RLS. Se pasa exclusivamente el UUID devuelto por la verificación de usuario de Supabase en el servidor.
- El mapeo no es una fuente para regenerar o sobrescribir migraciones. Las constraints, funciones y políticas existentes del proyecto siguen siendo la autoridad de la base.

## Cambios previstos entonces para integrar el runtime (8 de octubre de 2026; históricos)

1. Sustituir el import de `cloudflare:workers` por configuración Node.js en Vercel y separar secretos del navegador. Vercel debe ejecutar Next.js, sin depender de un Worker/D1 ni reenviar consultas a Sites.
2. Hacer que `db/index.ts` devuelva una base PostgreSQL real y exportar el esquema PostgreSQL en el runtime Vercel. No hacer un cast del esquema PG a tablas SQLite: esos tipos producen consultas de otro dialecto.
3. Mantener una sola identidad: `auth.users.id = profiles.id`. La sesión actual vincula por email a una identidad D1 distinta; en PG debe resolver por el UUID Auth verificado. Durante una importación, mapear por email verificado de forma explícita y remapear todas las referencias a actores escolares.
4. La creación de cuentas actual reserva un UUID D1 antes de invitar a Auth. Eso falla en `profiles` por la FK a `auth.users`: debe crear/invitar la identidad Auth primero, tomar su UUID y luego activar el perfil y asignar rol/perfil docente o tutor dentro de una transacción autorizada. Si la invitación puede haberse aceptado pese a un timeout, reconciliar por la identidad real antes de reintentar.
5. Supabase no tiene las tablas Better Auth `session`, `account`, `verification`, `rateLimit` ni `setup_state`. Se omiten deliberadamente del nuevo esquema. Retirar los imports y operaciones legacy: no apuntar las sesiones al esquema `auth` ni crear una segunda contraseña escolar en PostgreSQL.
6. `app/api/setup`, `app/api/school-password-setup` y el preflight de importación tienen `env.DB.prepare`/SQLite. Las dos primeras rutas deben quedar cerradas en el runtime Supabase; el preflight pertenece a una herramienta de migración con acceso explícito al origen D1, no al flujo escolar diario.
7. Chat tiene dos consultas con `messages.rowid`, que PostgreSQL no posee. Para Vercel debe usar los RPC de conversación y su cursor compuesto exacto `(sent_at, id)`; conservar los microsegundos de PostgreSQL en el token de paginación.
8. Los RPC escolares existentes deben aplicarse y validarse en el proyecto destino. Sus revocaciones de escritura directa son deliberadas; una conexión con rol authenticated no puede reemplazar esas RPC mediante INSERT arbitrarios.
9. Las variantes opcionales aún mezclan consultas o notificaciones D1 con Supabase. Al usar la misma base PG, eliminar fusiones de resultados y duplicación de escrituras, y validar que cada evento produce una sola notificación/auditoría.
10. Los accesos directos con credenciales propietarias pueden eludir RLS. Limitar ese acceso a aprovisionamiento/admin autorizado; las rutas escolares deben validar actor, rol y pertenencia y preferir JWT/RPC. No aceptar un UUID enviado por el navegador como prueba de identidad.

## Transacciones y batch — explicación e inventario históricos (8 de octubre de 2026)

Drizzle PostgreSQL no implementa el `batch` de D1. El nuevo factory no simula ese método.

Una migración correcta construye y ejecuta cada consulta desde el objeto `tx`:

```ts
await database.transaction(async tx => {
  await tx.update(students).set({ active: false, updatedAt: now }).where(eq(students.id, id));
  await tx.insert(auditLog).values({ /* auditoría de la misma operación */ });
});
```

No sirve `database.transaction(async () => Promise.all(jobs))` cuando `jobs` se construyeron con `database` fuera de la transacción: los thenables conservan la sesión del builder. Una alternativa para mutaciones sin resultados sería ejecutar su SQL parametrizado con `tx.execute(builder.getSQL())`; requiere un wrapper separado, validado y limitado a esa clase de operaciones. No se incluye aquí un proxy general que prometa compatibilidad de resultados ni un traductor heurístico de SQL SQLite.

Inventario localizado: 41 llamadas en 27 archivos, que deben migrarse explícitamente (líneas al momento de revisión; otros agentes pueden editar los archivos).

| Archivo | Líneas batch |
|---|---|
| `app/api/announcements/route.ts` | 60 |
| `app/api/attendance/justifications/[id]/route.ts` | 53 |
| `app/api/attendance/justifications/route.ts` | 120 |
| `app/api/calendar/[id]/route.ts` | 67, 104 |
| `app/api/calendar/route.ts` | 88 |
| `app/api/classes/route.ts` | 83 |
| `app/api/communication-settings/route.ts` | 44 |
| `app/api/consents/route.ts` | 49 |
| `app/api/conversations/[id]/messages/route.ts` | 172, 173 |
| `app/api/files/route.ts` | 135, 148, 166, 172 |
| `app/api/groups/[id]/teachers/route.ts` | 41 |
| `app/api/groups/route.ts` | 103 |
| `app/api/materials/[id]/replace/route.ts` | 107 |
| `app/api/materials/[id]/route.ts` | 68 |
| `app/api/privacy-notice/route.ts` | 82 |
| `app/api/privacy-requests/[id]/route.ts` | 27 |
| `app/api/privacy-requests/route.ts` | 46 |
| `app/api/setup/route.ts` | 40 |
| `app/api/students/[id]/guardians/route.ts` | 75, 110 |
| `app/api/students/[id]/observations/route.ts` | 37 |
| `app/api/students/[id]/route.ts` | 38, 47, 60 |
| `app/api/students/route.ts` | 111 |
| `app/api/submissions/[id]/route.ts` | 46 |
| `app/api/tasks/route.ts` | 87 |
| `app/api/users/[id]/route.ts` | 70, 106, 145 |
| `app/api/users/route.ts` | 82, 98, 122, 123, 124 |
| `app/api/years/route.ts` | 55 |

## Verificación histórica y pendientes de aquella subtarea (8 de octubre de 2026)

- TypeScript de los dos archivos nuevos: compilación aislada estricta correcta (`tsc --noEmit --skipLibCheck --strict --esModuleInterop --target ES2022 --module ESNext --moduleResolution bundler db/schema-postgres.ts lib/supabase/pg-connection.ts`).
- Correspondencia de columnas y tipos con el SQL inicial: 32 tablas y 218 columnas exactas. Eso comprueba el mapeo local, no el estado de una base remota.
- No se conectó a un servidor PostgreSQL ni se ejecutaron migraciones remotas en esta subtarea.
- Falta validar conexión TLS/pooler en el proyecto de la escuela, consultas/joins PG reales, importación de datos/UUID, rollback de transacciones, RLS entre familias y docentes, e integración completa de login/archivos/chat en un despliegue de Vercel.


## Actualización histórica: aislamiento del runtime y acceso a recursos (8 de octubre de 2026)

- `db/postgres.ts` es un entrypoint separado para Next/Vercel. Reutiliza solamente el pool y requiere `DATABASE_URL`; su ausencia genera un error explícito. No se activaron aliases Next globales: el runtime Sites/D1 sigue intacto.
- Se confirmó que crear ciclos, crear grupos y asignar docentes ya tienen ramas RPC Supabase. No se duplicaron ni reemplazaron esas implementaciones.
- `lib/access.ts` ahora desvía `maySeeStudent`, `maySeeGroup`, `mayTeachGroup` y `accessibleGroupIds` al helper `lib/supabase/access.ts` cuando el proveedor de datos es Supabase. Estas ramas no alcanzan `getDb` D1.
- Cada comprobación envía el JWT del actor verificado y exige que su UUID Auth coincida con su identidad escolar. Students/groups se consultan bajo RLS; para enseñar se comprueba explícitamente el perfil docente propio activo y su asignación, ya que leer un vínculo de otra maestra no otorga permiso para enseñar.
- Dirección y administración general también requieren un recurso visible existente en las comprobaciones Supabase. Los alumnos inactivos solo son visibles para liderazgo.
- La lista de grupos pagina todas las filas visibles activas hasta el límite soportado; si falla una página, devuelve una lista vacía y no concede acceso con resultados incompletos. Todos los errores de estas comprobaciones deniegan el acceso.
- Ocho pruebas con fetch simulado pasan: JWT, recursos ajenos ocultos, alumnos inactivos, identidad inconsistente, perfil docente y asignación propios, vínculo de otra maestra, paginación y fallos del proveedor. Son pruebas de solicitudes y decisiones del servidor; no sustituyen una prueba remota de RLS.

## Accesos D1 detectados en el diagnóstico histórico (8 de octubre de 2026; lista superada)

Esta lista explica los fallos detectados antes de portar los módulos y no constituye un inventario actual. Para cambios de fuente posteriores aún pendientes de publicar, consultar el estado vigente al inicio y la auditoría de producto.

La presencia de una rama Supabase no garantiza que un módulo sea portable. Inspección de flujo pendiente detecta:

- **Páginas mixtas:** asistencia, biblioteca, calendario, clases, comunicación, comunicados, grupos y tareas consultan roles mediante `getDb()` antes de entrar a su rama Supabase. Primero deben obtener la identidad y roles del perfil Supabase verificado; no pueden inicializar D1 al entrar a la página.
- **Actores construidos en páginas:** varios omiten `supabaseAuth`. Las funciones de acceso ahora deniegan explícitamente estas identidades incompletas en modo Supabase. Las páginas deben usar el actor completo verificado; no rellenar UUID o JWT desde datos del navegador.
- **Notificaciones:** GET mezcla Supabase con consultas D1 y PATCH intenta D1 si no encuentra la notificación. En Vercel debe quedar un único origen, sin fallback que oculte errores o duplique avisos.
- **Páginas sin rama Supabase:** inicio/dashboard, alumnos/listado/expediente, actividades, auditoría, consentimientos, cuentas, mi cuenta, privacidad, aviso de privacidad y sistema.
- **APIs sin rama Supabase:** progreso de actividades, auditoría, configuración de comunicación, consentimientos, aviso de privacidad, solicitudes de privacidad, observaciones del alumno, modificaciones del alumno y cuentas. Setup y configuración inicial de contraseña además usan SQL SQLite directo.
- **Helpers:** comunicación/horarios, acceso a conversaciones, feed de calendario y notificaciones familiares todavía dependen de consultas o escrituras D1; requieren una rama de datos Supabase o una integración PostgreSQL explícita.

No se activaron aliases globales porque convertir la referencia de tablas sin migrar estos flujos y sus transacciones dejaría una compilación o aplicación incompleta. El adapter PostgreSQL está listo para integración gradual, sin traducción heurística de SQL ni una fachada de hosting que reenvíe a Sites.
