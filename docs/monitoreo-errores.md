# Registro mínimo de errores del servidor

`instrumentation.ts` conecta el hook oficial `onRequestError` de Next 16.3.4 con `lib/school-error-monitor.ts`. El Vinext 1.0.0-beta.5 instalado también reconoce ese archivo raíz y el hook dentro de su entorno servidor/Worker. No se instala un proveedor ni se añade una solicitud de red.

Ante un error real comunicado por el framework, el registro añadido escribe una línea JSON en los logs del hosting autorizado con:

- `event`: `school_server_request_error`.
- `router`: `app`, `pages` o `unknown`.
- `routeKind`: `render`, `route`, `action`, `proxy`, `middleware` o `unknown`.
- `timestamp`: hora del servidor en formato ISO.

El hook no proporciona un código HTTP definitivo. No se registra ni se inventa un status 500, ni se deduce de una propiedad del error. Tampoco se registran rutas, URLs, parámetros, nombres, correos, cookies, encabezados, cuerpos, mensajes, stack, cause, digest o identificadores de alumnos/expedientes. Los campos desconocidos se descartan. Los accesores del contexto no se invocan.

## Límites y agregados

Cada instancia del servidor tiene una ventana de 60 segundos con un máximo de 20 intentos de escritura, incluyendo cualquier resumen. No hay timers ni latidos. Repeticiones del mismo objeto de error dentro de la ventana se deduplican usando únicamente identidad débil, sin leer sus propiedades ni conservarlo fuertemente.

Si hubo eventos suprimidos o deduplicados, el primer error de la siguiente ventana genera un resumen `school_server_error_summary` con contadores `emitted`, `suppressed` y `deduped`, además del timestamp. El resumen consume una de las 20 líneas de esa nueva ventana. Cada contador tiene un tope de 1000000. Se mantienen solo contadores de una ventana y hasta veinte referencias débiles; no se guardan solicitudes ni una lista de errores. Una regresión del reloj no repone el presupuesto de la ventana.

Las líneas generadas son menores de 256 bytes. Una excepción del reloj o del sink se absorbe y no hace fallar una solicitud ni provoca un segundo log de error. Los límites se aplican por instancia; varias instancias serverless pueden registrar líneas en paralelo.

## Alcance operativo

Este registro ayuda a detectar categorías de fallos revisando los logs ya disponibles del hosting. No crea una alerta externa, un dashboard de incidencia, almacenamiento propio o una garantía de retención. El retorno del sink no demuestra conservación permanente del log.

Solo cubre errores que el framework comunica al hook. Una API que captura un fallo y devuelve 503, o una pantalla que muestra un estado de error controlado, no dispara automáticamente este registro. No se añade telemetría de navegador ni una API pública para fabricar errores o consultar logs.

**El framework y el hosting conservan sus propios logs fuera de este hook.** Esta mejora garantiza la proyección mínima del registro que añadimos; no sustituye ni sanea globalmente los mensajes que puedan escribir Next, Vinext, dependencias o la infraestructura. No se parchea `console`, ni se promete que todos los logs del hosting estén libres de datos privados. Los equipos deben evitar introducir información privada en otros logs y mantener el acceso operativo autorizado.

## Pruebas

`tests/school-error-monitor.test.mjs` ejecuta el monitor real y el hook de producción, incluyendo el despacho del método `Next BaseServer.instrumentationOnRequestError` instalado y de `Vinext reportRequestError`. Comprueba privacidad con errores/solicitudes sintéticos, getters y proxies hostiles, enums, duplicados, límite conjunto de líneas, reloj hacia atrás, counters saturados y sink fallido. No inicia servicios ni envía errores a producción.

```sh
node --experimental-strip-types --test tests/school-error-monitor.test.mjs
```

Las pruebas dirigidas verifican el contrato local; el build general y la publicación corresponden al proceso de release coordinado.

Resultado dirigido: **13 pruebas PASS**, sin fallos ni skips. ESLint y TypeScript focalizado sin errores; no se realizó una prueba de error ni una solicitud en producción.

## Estado de integración publicada

La integración posterior quedó READY `dpl_8YhGFfsnnz5MH1GpMN7v2cVFvJtT` en el dominio habitual, con fuente `fadddc3e0b35b4413fa73cf948668d1547144c24`. Pasaron 656 pruebas generales, lint, TypeScript, ambas compilaciones y 32 controles HTTP por destino. La consulta administrativa con escuela vacía y la pantalla pública inexistente se comprobaron; los ensayos dirigidos/locales de esta guía conservan su alcance y no equivalen a aceptación de familias o datos en producción. Ver [release y límites](hosting-vercel.md#release-de-estabilidad-publicado--9-de-octubre-de-2026).
