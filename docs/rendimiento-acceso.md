# Verificación de acceso por petición

## Estado y alcance

Cambio preparado en fuentes de `lib/supabase/session.ts`, `lib/access.ts` y `lib/supabase/page-actor.ts`. Este documento no afirma que esté desplegado. No se ejecutó un benchmark de red, latencia o carga en producción.

En el modo **Supabase Auth y datos Supabase**, un actor autorizado de API o página necesitaba cinco solicitudes antes de consultar sus datos escolares: Auth, perfil y roles para crear la sesión, más otra lectura del mismo perfil y roles al construir el actor. Ahora necesita **tres solicitudes de verificación por invocación**:

| Orden | Lectura | Qué verifica |
| --- | --- | --- |
| 1 | Supabase Auth `verifyCurrentUser` | Identidad actual del JWT. |
| 2 | `profiles`, usando ese JWT | UUID, perfil activo, nombre y correo coincidente con Auth. |
| 3 | `user_roles`, usando ese JWT | Roles escolares actuales y reconocidos. |

El actor reutiliza únicamente la prueba de esas lecturas dentro de la sesión exacta que acaba de obtener. Las consultas posteriores de matrícula, tareas u otros módulos siguen siendo adicionales; no se afirma que una página completa use solo tres solicitudes. Si una verificación inicial falla, el acceso se rechaza y las lecturas posteriores pueden no ejecutarse.

## Procedencia y duración

Un `WeakMap` privado del módulo asocia el **objeto exacto de sesión retornado** con una copia congelada de la cuenta y de sus roles. Solo se registra después de completar las tres verificaciones. No se puede registrar una cuenta a través del lector público del helper.

`readVerifiedSupabaseSchoolAccount(session)` funciona únicamente en contexto servidor, devuelve una nueva copia congelada y falla cerrado si:

- La sesión no procede de esa verificación, fue inventada o es una copia de otro objeto, aunque sus campos sean iguales.
- Su UUID de usuario, UUID de contexto/Auth, nombre, correo o token difieren de los valores verificados.
- Se intenta usar el lector en un contexto de navegador.

La entrada no mantiene viva su clave: cuando el objeto de sesión deja de estar referenciado, puede ser recogido por el recolector de basura. Los consumidores deben tratar esa sesión como propia de la invocación y no conservarla para otro acceso.

**No hay caché por JWT, usuario, UUID, correo, `Headers` o `Request`, ni reutilización de autorización entre peticiones.** Cada llamada nueva de `actorFromRequest` o `getSchoolPageActor` vuelve a obtener una sesión y verificar Auth, perfil y roles. Incluso reutilizando el mismo objeto de headers/request, una nueva invocación vuelve a leer el estado actual. Una baja o un cambio de roles no espera a vencer una caché de autorización.

## Controles que se conservan

- Los roles se leen de `user_roles`; no se aceptan roles de `user_metadata` de Auth.
- El JWT y los tokens de sesión permanecen en el servidor. La cuenta que devuelve el helper no incluye tokens, y las respuestas JSON públicas de Auth siguen sin exponerlos. Los actores/sesiones internos no deben serializarse como props de cliente.
- RLS, permisos de las RPC y comprobaciones de vínculo de cada operación siguen vigentes. El cambio elimina una lectura repetida; no concede permisos nuevos ni sustituye la autorización de los datos.
- La rama legacy D1 conserva su flujo. No se cambia Better Auth ni el modo Supabase Auth con datos D1.
- No se añadieron escrituras, reintentos de mutaciones, telemetría, servicios o modificaciones de SQL.

## Evidencia reproducible

```sh
node --experimental-strip-types --test tests/supabase-runtime-session.test.mjs
```

**22 pruebas dirigidas PASS**, con clientes REST y rutas reales del repositorio, bindings sintéticos y **HTTP simulado**. Comprueban tres llamadas exactas en actor de API/página, nueva verificación ante cambio de roles/baja, cuentas intercaladas sin cruce, copias congeladas, rechazo de sesiones falsas/modificadas y contexto de navegador, rechazo de sesión expirada, errores de base/credenciales y JSON de Auth sin tokens. Las pruebas históricas de acceso/recuperación/cambio de contraseña permanecen en esa suite.

Lint de los archivos cambiados y TypeScript de fuentes terminaron sin errores; la integración todavía debe ejecutar sus compilaciones y comprobaciones del hosting. Reducir solicitudes duplicadas no acredita una mejora concreta de tiempo o capacidad: esa medición queda pendiente en un entorno autorizado, sin datos personales.
