# Seguimiento con historial paginado

## Consulta y permisos

`GET /api/students/<id>/observations` devuelve las 25 observaciones más recientes, ordenadas por `recorded_at DESC, id DESC`. Lee como máximo 26 filas para determinar si existen anteriores:

```json
{ "items": [], "hasMore": false, "nextCursor": null }
```

Si `hasMore` es verdadero, la siguiente consulta añade `?cursor=<nextCursor>`. El cursor contiene versión, alumno, fecha e ID; no autoriza el acceso. Un cursor de otro alumno, duplicado, mal formado o con fecha inválida devuelve 400. La sesión y la relación con el alumno se comprueban antes de leer: acceso anónimo 401, alumno ajeno o inválido 404. Tanto las respuestas correctas como los errores incluyen `Cache-Control: no-store`.

Supabase conserva el JWT del usuario y las políticas RLS existentes. Las familias reciben únicamente observaciones visibles para ellas. La primera página usa una consulta; las siguientes usan una consulta para los registros con la misma fecha e ID menor y, si faltan filas, otra para fechas anteriores. Ambas llevan límite y orden. No se añadieron permisos, SQL remoto, migraciones ni operadores generales al cliente PostgREST.

Las fechas de PostgreSQL conservan seis decimales al normalizarse a UTC; no se reducen a los milisegundos de `Date`. SQLite legacy conserva su precisión original de segundos enteros y usa `OR`/`AND` de Drizzle con el mismo orden y límite. Los cursores de esa rama no admiten fracciones que la columna no puede representar.

## Interfaz

- «Cargar anteriores» consulta y añade otra página real.
- «Actualizar avances» vuelve a la primera página.
- Cambiar de alumno limpia inmediatamente el historial y cancela la consulta anterior. Las respuestas tardías se descartan.
- Los fallos de lectura permiten reintentar solamente la consulta fallida. Una denegación de acceso limpia el historial y no se presenta como una consulta exitosa sin observaciones.
- El selector y el formulario quedan bloqueados durante el guardado. El controlador también impide un segundo envío aunque llegue antes del siguiente renderizado.
- Solo una respuesta 201 con ID válido confirma el guardado, limpia el formulario y consulta de nuevo la primera página.
- Si no se puede confirmar el envío, se conserva el formulario y se indica consultar el registro antes de volver a enviarlo. No hay reintento automático de POST.
- Un resultado tardío después de desmontar la vista no limpia otro formulario ni inicia consultas nuevas.

El historial es una consulta de los datos actuales, no una instantánea inmutable de toda la navegación. Los nuevos registros se consultan al actualizar la primera página. Los textos se entregan completos, sin el anterior recorte a las 500 observaciones más antiguas.

## Comprobación local

```sh
node --experimental-strip-types --test tests/observation-page.test.mjs tests/observation-client.test.mjs tests/observation-route.test.mjs tests/observation-progress-ui.test.mjs
```

36 pruebas pasaron en Node 24.20.0. Cubren microsegundos, fechas inválidas, cursores cruzados, 26 filas, última página, 70 registros empatados, límite restante entre consultas, visibilidad docente/familia, permisos y caché, cambios tardíos de alumno, doble envío, resultados inciertos y rechazo de respuestas 200/202 con ID válido sin limpiar el formulario ni volver a consultar. La rama legacy ejecuta el SQL generado por Drizzle en SQLite real en memoria, sin archivos ni datos escolares. Incluye cuentas con roles tutor/docente: las observaciones internas requieren una asignación docente activa al alumno, salvo dirección o superadmin; una asignación de otro grupo, una maestra inactiva o una matrícula finalizada conserva el filtro familiar. Se prueban el permiso real de `maySeeStudent`, las consultas de asignación, errores de lectura 503 sin caché y la proyección de la interfaz tras una denegación.

Los transportes Supabase/Auth/RLS de estas pruebas son sintéticos y prueban los contratos de la aplicación; no constituyen una nueva aceptación del proveedor ni del endpoint desplegado. ESLint de los archivos modificados pasó. La compilación general y la revisión de la interfaz se integran en el proceso de publicación; esta tarea no desplegó cambios ni consultó cuentas reales.

## Estado de integración publicada

La integración posterior quedó READY `dpl_8YhGFfsnnz5MH1GpMN7v2cVFvJtT` en el dominio habitual, con fuente `fadddc3e0b35b4413fa73cf948668d1547144c24`. Pasaron 656 pruebas generales, lint, TypeScript, ambas compilaciones y 32 controles HTTP por destino. La consulta administrativa con escuela vacía y la pantalla pública inexistente se comprobaron; los ensayos dirigidos/locales de esta guía conservan su alcance y no equivalen a aceptación de familias o datos en producción. Ver [release y límites](hosting-vercel.md#release-de-estabilidad-publicado--9-de-octubre-de-2026).
