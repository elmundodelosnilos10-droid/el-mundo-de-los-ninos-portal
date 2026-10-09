# Errores de página, carga y páginas no disponibles

## Estado de esta entrega

Preparación en fuentes: `app/error.tsx`, `app/global-error.tsx`, `app/escuela/loading.tsx`, `app/not-found.tsx` y el componente compartido `components/portal-fallback.tsx`, con estilos propios. No se provocaron errores en producción ni se instalaron servicios. La compilación Next.js/Sites y la comprobación publicada corresponden a la integración posterior de esta entrega.

Las **11 pruebas dirigidas** de `tests/portal-fallback-ui.test.mjs` pasan: render real de React, ejecución explícita de callbacks, ausencia de lectura o exposición de mensaje/digest/stack, estructura del documento global, estados accesibles, logo original y contratos de las versiones instaladas. No acreditan por sí solas el comportamiento HTTP o la recuperación de un fallo real del hosting.

## Qué verá una persona

| Situación | Pantalla y acción |
| --- | --- |
| Error inesperado de una página | Mensaje genérico, botón «Volver a intentar» y enlace «Ir al inicio». |
| Error del diseño principal | El mismo mensaje en un documento propio con `html`, `body`, idioma español, título, viewport y estilos independientes del diseño principal. |
| Carga pendiente de la página pública `/escuela` | Mensaje de carga con `role="status"`; no inventa porcentajes, tiempos o registros escolares. |
| Página no disponible | Mensaje genérico y enlace al inicio; no muestra la URL solicitada ni confirma la existencia de un alumno, cuenta o expediente. Metadata `noindex`. |

Todas usan el logo oficial y verdes escolares, título principal, región principal, botones/enlaces de al menos 44 píxeles, foco visible y reglas para movimiento reducido. El logo se solicita como archivo público directo. El enlace al inicio hace navegación completa para funcionar también cuando el router no esté disponible. No consultan Auth, bases de datos o proveedores, no incluyen datos de sesión y no añaden telemetría ni impresión de errores.

## Recuperación explícita

Next.js instalado **16.3.4** entrega `retry` y `reset`; el botón prefiere `retry`, que vuelve a obtener contenido del servidor. Vinext instalado **1.0.0-beta.5** declara `reset` en sus límites de error; cuando `retry` no existe, el botón llama ese `reset`. Las pruebas verifican ambas ramas y que no se ejecutan automáticamente al montar la pantalla.

Un botón de recuperación de página no confirma ni repite automáticamente una escritura escolar. Si el fallo ocurrió mientras se enviaba una tarea, mensaje u otro cambio, la persona debe consultar el estado antes de volver a enviarlo. La pantalla recuerda esa precaución sin afirmar que una operación falló o se guardó.

Los errores de validación o de red manejados por cada formulario conservan sus estados propios. Estos límites no cubren por sí solos excepciones de manejadores de eventos, servicios externos o respuestas de API, ni sustituyen las comprobaciones de acceso del servidor.

## Compatibilidad y alcance HTTP

Se revisaron los contratos locales de Vinext en `dist/shims/error-boundary.d.ts`, `dist/routing/app-router.js` y `dist/entries/app-rsc-manifest.d.ts`: reconocen `error`, `global-error`, `loading` y `not-found`. Su render global omite el diseño habitual, por eso la pantalla global aporta su propio documento y estilos.

La carga se coloca **solo en `app/escuela/loading.tsx`**, correspondiente a la presentación pública sin expedientes ni guardas Auth. No hay `app/loading.tsx` raíz ni límites de carga nuevos en páginas privadas: se conservan sus respuestas de acceso/autorización antes de iniciar el cuerpo. La variante visual de carga queda reutilizable para futuros límites Suspense situados después de verificar el actor; no se añadieron esos límites en esta entrega.

Una pantalla `loading` puede iniciar streaming y fijar HTTP 200 antes de una decisión posterior. La integración debe comprobar HTTP y navegación. Las APIs siguen siendo responsables de sus estados 401/403/404 y de no entregar datos sin autorización; no se cambió ninguna de esas rutas.

Fuentes primarias: [convención de error y documento global de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/error), [carga y límites de streaming](https://nextjs.org/docs/app/api-reference/file-conventions/loading), [páginas no disponibles](https://nextjs.org/docs/app/api-reference/file-conventions/not-found). La documentación consultada describe `retry` estable desde 16.3; el código instalado confirmó su presencia. La revisión de Vinext es de código instalado, no una prueba de error real en el servicio.

## Comprobación reproducible

```sh
node --test tests/portal-fallback-ui.test.mjs
```

Al integrar, ejecutar lint y las compilaciones de ambos destinos. Comprobar una URL pública inexistente y la navegación normal sin forzar excepciones o editar datos escolares. Cualquier ensayo de fallo intencional debe hacerse en un entorno separado, con datos sintéticos y sin servicios productivos.

## Ensayo de integración aislado

El 9 de octubre se copiaron byte por byte los componentes, estilos y logo a un fixture Next separado bajo `/tmp`, sin configuración Auth, datos escolares ni proveedores. Se comprobaron 23 condiciones locales mediante seis GET: páginas de ensayo, 404 real/noindex, documento global React SSR y una excepción genérica exclusiva del fixture. Next llamó al hook real y el registro añadido produjo una línea con categoría y timestamp, sin datos de solicitud ni del error. El endpoint intencional nunca se añadió a la aplicación escolar.

CUA comprobó los callbacks de las páginas reales en ancho 320 y 1151: restablecer y reintentar se ejecutaron solo al pulsar el botón. También se observaron el estado accesible de carga, logo, página inexistente y documento global sin desbordamiento horizontal. El documento global de muestra era SSR, sin manejador en navegador; sus callbacks se probaron por separado con React. No es prueba de recuperación de una caída en Vercel ni de teléfono físico. Evidencia privada: `outputs/school-fallback-render-local-20261009.json`, `outputs/school-fallback-render-browser-20261009.json` y captura `outputs/portal-local-fallback-mobile-20261009.jpg`.

El fixture quedó detenido, su puerto cerrado y sus procesos ausentes según una comprobación independiente (`outputs/school-fallback-render-stop-20261009.json`). No se provocaron fallos ni se modificaron expedientes en producción.
