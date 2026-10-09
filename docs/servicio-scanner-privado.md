# Servicio privado de análisis de archivos

## Estado y contrato

`services/file-scanner` contiene dos imágenes y un archivo Compose para un servidor independiente. Este artefacto no está desplegado. No se instaló Docker ni ClamAV, no se probaron firmas reales y no se modificaron las variables productivas de la escuela. Las cargas de producción continúan bloqueadas hasta conectar y comprobar el servicio real.

Las fuentes del portal ahora limitan todas las cargas nuevas a 4 MiB por archivo y el multipart completo a 4 MiB más 64 KiB, por debajo del límite de ingreso de Vercel. El máximo de 20 MiB del scanner preparado admite esas cargas; desaparece el desajuste anterior de audios nuevos de 25 MiB. Los límites de descarga de archivos anteriores permanecen en 10/25 MiB. Esta corrección no despliega ni valida el antivirus y no habilita cargas de producción. Ver [el detalle de hosting](hosting-vercel.md#límite-de-nuevas-cargas-preparado-en-fuentes).

El contrato coincide con `lib/file-scanner.ts`:

| Ruta | Solicitud | Respuesta |
| --- | --- | --- |
| `POST /scan` | Bearer privado, MIME, bytes crudos saneados | HTTP200 `{"status":"clean"}` o `{"status":"infected"}` |
| `GET /health` | El mismo Bearer privado | HTTP200 `{"status":"ready"}` cuando motor y firmas están disponibles |
| Error o límite | Sin confirmar análisis completo | HTTP no exitoso `{"status":"unavailable"}` |

El servicio no recibe nombres de archivo, IDs de alumnos ni metadatos escolares. Acepta únicamente las rutas exactas, sin parámetros, sin multipart ni codificación HTTP comprimida. No devuelve firmas, detalles del motor, contenido, tokens ni trazas de error. Rechaza `Origin` y los indicadores de navegador `Sec-Fetch-Site/Dest/User`, sin emitir permisos CORS. Se tolera únicamente `Sec-Fetch-Mode: cors`, que también agrega el `fetch` de Node; el token sigue siendo obligatorio.

## Motor y fuentes verificadas

El cliente utiliza el protocolo oficial NUL/INSTREAM con longitud de 32 bits en orden de red, terminador cero y lectura completa de una respuesta limitada. El socket ClamAV no incorpora autenticación: por eso no se publica el puerto 3310 y se usa una red de Compose separada. [Protocolo oficial](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [advertencia oficial sobre TCP](https://docs.clamav.net/manual/Usage/Scanning.html).

Imágenes fijadas con digest obtenido del registro público Docker y comprobado contra SHA256 del manifiesto el 8 de octubre de 2026:

| Imagen | Digest | Alcance verificado |
| --- | --- | --- |
| `clamav/clamav:1.4.6_base` | `sha256:90effb795234e6a93b070310a4bab5a58d93d94b9a077a09ce2229947679782b` | Manifiesto linux/amd64 |
| `node:22-alpine3.23` | `sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a` | Índice de plataformas; config amd64 declara Node 22.23.3 |

La comprobación del manifiesto verifica la referencia y su integridad, no una firma criptográfica del editor ni el comportamiento del contenedor. ClamAV 1.4.6 aparece en las publicaciones oficiales con correcciones de seguridad; Node 22.23.3 figura como LTS. Los tags/digests deben revisarse antes de aprovisionar y durante mantenimiento. No se actualizan automáticamente sin repetir la revisión. [Publicaciones ClamAV](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.4.6), [Node oficial](https://nodejs.org/en/download).

La imagen `_base` descarga las firmas al iniciar y las conserva en un volumen exclusivamente de firmas. FreshClam las revisa doce veces al día; las comprueba antes de activar el motor y notifica recargas. La imagen ClamAV verificada es amd64: elegir un servidor con esa arquitectura. El servicio reserva4 GiB de RAM para el motor y256 MiB para HTTP; la recomendación oficial es prever4 GiB para ClamAV. La CPU está limitada a dos para ClamAV y una para HTTP. Estos recursos y sus costos requieren un servidor elegido por la escuela; este trabajo no contrata ninguno. [Imágenes y memoria oficiales](https://docs.clamav.net/manual/Installing/Docker.html).

## Protección y resultados

- Antes y después de cada análisis se consulta `VERSION` del motor cargado. Debe coincidir con 1.4.6 y traer una fecha válida UTC con antigüedad máxima 24 horas. Se rechazan fechas futuras superiores a cinco minutos. La comprobación utiliza la versión cargada en memoria, no la fecha de un archivo descargado. El contenedor define `TZ=UTC`; el host necesita reloj sincronizado.
- Se limita el archivo a 20 MiB, cada bloque del protocolo a 64 KiB, y la respuesta del daemon a 1024 bytes. No se acepta un `OK` recibido antes de completar la entrada. ClamAV 1.4.6 omite entradas de hasta cinco bytes: el servicio las rechaza para no presentar una omisión como análisis confirmado. [Código oficial de esa versión](https://raw.githubusercontent.com/Cisco-Talos/clamav/clamav-1.4.6/libclamav/scanners.c).
- Hay como máximo dos operaciones activas, incluidas comprobaciones de salud; la saturación falla cerrada. Se limitan a 32 las conexiones y a cinco segundos los encabezados incompletos. El plazo total HTTP es 12 segundos, cada consulta de motor tiene hasta dos y el análisis hasta ocho, dentro del plazo de 15 segundos del cliente actual.
- Límites internos: archivo 20 MiB, expansión 100 MiB, profundidad 16, 1000 elementos, dos hilos y cola cuatro. `AlertExceedsMax` y `AlertEncrypted` están activos. Los avisos de límites o contenido cifrado se traducen a indisponible y bloquean la carga. Un resultado distinto de la respuesta exacta limpia o una detección reconocida también bloquea. [Configuración oficial](https://raw.githubusercontent.com/Cisco-Talos/clamav/clamav-1.4.6/etc/clamd.conf.sample).
- Las respuestas HTTP infectadas representan una detección del motor; no contienen el nombre de la firma. No se promete detectar todas las amenazas. El análisis complementa los controles de MIME, tamaño, contenido y saneamiento del portal.
- HTTP no escribe los documentos en disco. ClamAV puede descomprimirlos temporalmente, por lo que `/tmp` es un tmpfs de256 MiB y los temporales no van al volumen persistente. No se conservan hashes del motor (`DisableCache`), archivos recibidos ni logs de detección. Los logs de contenedores están deshabilitados, el destino de logs ClamAV es `/dev/null` y el servicio solo informa errores genéricos de inicio. El host debe impedir que swap, volcados de memoria o el ingreso HTTPS retengan contenido/token.

Cerrar una conexión no garantiza detener de inmediato el análisis interno del motor. Los límites del daemon, CPU y memoria protegen recursos, pero su comportamiento ante archivos complejos debe medirse con el motor real antes de habilitar cargas.

## Aprovisionamiento posterior

Se necesita un servidor amd64 con Docker/Compose, RAM suficiente, almacenamiento de firmas, salida para actualizaciones oficiales, DNS y un ingreso HTTPS. El Node HTTP se publica solo en `127.0.0.1:8080`; ClamAV no tiene puertos publicados. La red de salida de firmas es exclusiva del daemon: no conectar otros servicios a ella. `Caddyfile.example` muestra un ingreso **en el host**, pendiente de revisión y configuración, sin logs de acceso. La sintaxis de límite de cuerpo y transporte se revisó en la [documentación Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy); no se ejecutó esa configuración. Debe transmitir el Bearer y desactivar la captura de cuerpos/headers en observabilidad y cachés; el servicio ya devuelve `Cache-Control: no-store`.

Antes de iniciar, un operador debe crear un token aleatorio de 32 bytes o más, entregarlo mediante un archivo privado fuera del repositorio y asegurarse de que el UID del usuario `node` pueda leer el montaje de secreto. Compose con archivos locales no garantiza aplicar `uid/gid/mode` declarados: revisar permisos reales del archivo y volumen. No introducir un token en Dockerfile, build args, Git, URL, navegador ni línea de comando.

Para una ejecución aprobada en ese servidor, con `SCANNER_TOKEN_PATH` apuntando al archivo privado, desde `services/file-scanner`:

```sh
docker compose config --quiet
docker compose build
docker compose up -d
```

El arranque falla si no consigue inicializar/verificar las firmas. La salud solo pasa después de disponer del motor con firmas vigentes. El archivo Caddy no está instalado ni configurado automáticamente. No publicar el puerto 3310 ni el HTTP sin TLS hacia Internet.

Configurar posteriormente en Vercel, desde el almacenamiento seguro de secretos:

| Variable de la aplicación | Valor |
| --- | --- |
| `SCHOOL_FILE_SCAN_URL` | URLHTTPS aprobada terminada en `/scan` |
| `SCHOOL_FILE_SCAN_TOKEN` | El mismo token privado del servicio |

El mock local de la aplicación no debe habilitarse para producción. El servicio independiente no tiene modo mock. Para rotar el token, coordinar el cambio del archivo del servicio, su reinicio y el secreto de Vercel; cualquier desajuste bloquea temporalmente las cargas.

## Pruebas y aceptación pendiente

Se ejecutaron 17 pruebas entre el adaptador existente y el nuevo servicio: todas pasaron. Incluyen sockets TCP reales a un **daemon sintético**, en loopback, para framing, datos completos, detecciones simuladas, errores, tiempos, tamaño, saturación, estado de firmas, autenticación, antiCORS y compatibilidad HTTP. ESLint pasó. Ninguna prueba ejecutó antivirus, descargó firmas, construyó las imágenes ni aprovisionó hosting.

Antes de conectar producción falta:

1. Construir y arrancar las imágenes fijadas, comprobar sintaxis real de configuración, permisos, límites, actualizaciones y consumo en un servidor aprobado.
2. Obtener salud privada 200; probar documento inocuo sintético con respuesta limpia y el fichero de prueba antivirus estándar obtenido de su fuente oficial con respuesta infectada. No usar documentos escolares reales.
3. Comprobar token incorrecto, parada del daemon, firmas vencidas, límites, cifrados, tiempos y actualización del motor: todas las cargas deben bloquearse y no guardarse en Storage.
4. Revisar el ingreso TLS, ausencia de captura de headers/cuerpos y acceso exclusivamente desde el servidor de la aplicación; comprobar carga/descarga escolar con datos sintéticos y los roles autorizados.
5. Solo después guardar URL/token en Vercel y confirmar el flujo completo. El servicio no sustituye el respaldo ni añade acceso a Supabase.
