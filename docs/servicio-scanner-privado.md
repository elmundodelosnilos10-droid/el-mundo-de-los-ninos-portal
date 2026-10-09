# Servicio privado de análisis de archivos

## Estado y contrato

**Actualizado: 9 de octubre de 2026.** El antivirus real pasó 12 comprobaciones locales y participó en un recorrido real Next/Supabase con archivos privados: 149 solicitudes y 45 comprobaciones. Se utilizó una VM Lima Linux ARM aislada de 2 GiB; Docker y ClamAV se ejecutaron dentro de esa VM, sin instalación global en macOS, documentos escolares ni configuración productiva.

`services/file-scanner` conserva dos imágenes y un Compose **amd64 preparado, no ensayado como conjunto de producción**, con 4 GiB reservados para ClamAV y 256 MiB para HTTP. El ensayo ARM usó una imagen oficial Debian distinta; no cambió los digests ni recursos del Compose. Ninguno de esos resultados configura un servicio de producción.

El release publicado `dpl_44sWbxTREwV9Fu3WRSCCSH2ZBmaU` registra `productionScannerConfigured:false` en `outputs/vercel-release-final-20261009.json`. Las cargas de producción continúan bloqueadas hasta conectar y comprobar un servicio privado real aprobado. La VM de ensayo `school-scanner-test` quedó **Stopped**, de forma reversible; sus archivos y evidencias se conservaron.

El portal publicado limita todas las cargas nuevas a 4 MiB por archivo y el multipart completo a 4 MiB más 64 KiB, por debajo del límite de ingreso de Vercel. El máximo de 20 MiB del scanner admite esas cargas; desaparece el desajuste anterior de audios nuevos de 25 MiB. Los límites de descarga de archivos anteriores permanecen en 10/25 MiB. El límite de carga publicado no configura por sí solo el analizador productivo. Ver [el detalle de hosting](hosting-vercel.md).

El contrato coincide con `lib/file-scanner.ts`:

| Ruta | Solicitud | Respuesta |
| --- | --- | --- |
| `POST /scan` | Bearer privado, MIME, bytes crudos saneados | HTTP 200 `{"status":"clean"}` o `{"status":"infected"}` |
| `GET /health` | El mismo Bearer privado | HTTP 200 `{"status":"ready"}` cuando motor y firmas están disponibles |
| Error o límite | Sin confirmar análisis completo | HTTP no exitoso `{"status":"unavailable"}` |

El servicio no recibe nombres de archivo, IDs de alumnos ni metadatos escolares. Acepta únicamente las rutas exactas, sin parámetros, sin multipart ni codificación HTTP comprimida. No devuelve firmas, detalles del motor, contenido, tokens ni trazas de error. Rechaza `Origin` y los indicadores de navegador `Sec-Fetch-Site/Dest/User`, sin emitir permisos CORS. Se tolera únicamente `Sec-Fetch-Mode: cors`, que también agrega el `fetch` de Node; el token sigue siendo obligatorio.

## Motor y fuentes verificadas

El cliente utiliza el protocolo oficial NUL/INSTREAM con longitud de 32 bits en orden de red, terminador cero y lectura completa de una respuesta limitada. El socket ClamAV no incorpora autenticación: por eso no se publica el puerto 3310 y se usa una red de Compose separada. [Protocolo oficial](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [advertencia oficial sobre TCP](https://docs.clamav.net/manual/Usage/Scanning.html).

Referencias fijadas con digest obtenido del registro público Docker y comprobado contra SHA256 del manifiesto durante la preparación del 8 de octubre y el ensayo ARM del 9 de octubre de 2026:

| Imagen | Digest | Alcance verificado |
| --- | --- | --- |
| `clamav/clamav:1.4.6_base` | `sha256:90effb795234e6a93b070310a4bab5a58d93d94b9a077a09ce2229947679782b` | Manifiesto linux/amd64 |
| `node:22-alpine3.23` | `sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a` | Índice de plataformas; config amd64 declara Node 22.23.3 |
| `clamav/clamav-debian:1.4.6_base` | `sha256:1b9f632fd2756d647ea76721c190f1a8821f3f1dc099b6b671e265d4346fcec4` | Manifiesto linux/arm64; motor ejecutado en el ensayo Lima de 2 GiB |

La comprobación del manifiesto verifica la referencia y su integridad, no una firma criptográfica del editor ni el comportamiento del contenedor. ClamAV 1.4.6 aparece en las publicaciones oficiales con correcciones de seguridad; Node 22.23.3 figura como LTS. Los tags/digests deben revisarse antes de aprovisionar y durante mantenimiento. No se actualizan automáticamente sin repetir la revisión. [Publicaciones ClamAV](https://github.com/Cisco-Talos/clamav/releases/tag/clamav-1.4.6), [Node oficial](https://nodejs.org/en/download).

La imagen `_base` descarga las firmas al iniciar y las conserva en un volumen exclusivamente de firmas. FreshClam las revisa doce veces al día; las comprueba antes de activar el motor y notifica recargas. **El Compose original fija amd64:** elegir un servidor con esa arquitectura para usarlo sin cambios. Reserva 4 GiB de RAM para el motor y 256 MiB para HTTP; la recomendación oficial es prever 4 GiB para ClamAV. La CPU está limitada a dos para ClamAV y una para HTTP. Estos recursos y sus costos requieren un servidor elegido por la escuela; este trabajo no contrata ninguno. [Imágenes y memoria oficiales](https://docs.clamav.net/manual/Installing/Docker.html).

El ensayo ARM de 2 CPU, 2 GiB y disco de 12 GiB utilizó la imagen oficial Debian arm64 y mantuvo `ConcurrentDatabaseReload no`. Ese resultado acotado demuestra los casos ejecutados; no establece capacidad de producción, carga sostenida ni funcionamiento del Compose amd64. El servicio HTTP real corrió en Node en loopback, sin construir el contenedor HTTP del Compose. Ver [aceptación local y guardas](aceptacion-scanner-local.md).

## Protección y resultados

- Antes y después de cada análisis se consulta `VERSION` del motor cargado. Debe coincidir con 1.4.6 y traer una fecha válida UTC con antigüedad máxima 24 horas. Se rechazan fechas futuras superiores a cinco minutos. La comprobación utiliza la versión cargada en memoria, no la fecha de un archivo descargado. El contenedor define `TZ=UTC`; el host necesita reloj sincronizado.
- Se limita el archivo a 20 MiB, cada bloque del protocolo a 64 KiB, y la respuesta del daemon a 1024 bytes. No se acepta un `OK` recibido antes de completar la entrada. ClamAV 1.4.6 omite entradas de hasta cinco bytes: el servicio las rechaza para no presentar una omisión como análisis confirmado. [Código oficial de esa versión](https://raw.githubusercontent.com/Cisco-Talos/clamav/clamav-1.4.6/libclamav/scanners.c).
- Hay como máximo dos operaciones activas, incluidas comprobaciones de salud; la saturación falla cerrada. Se limitan a 32 las conexiones y a cinco segundos los encabezados incompletos. El plazo total HTTP es 12 segundos, cada consulta de motor tiene hasta dos y el análisis hasta ocho, dentro del plazo de 15 segundos del cliente actual.
- Límites internos: archivo 20 MiB, expansión 100 MiB, profundidad 16, 1000 elementos, dos hilos y cola cuatro. `AlertExceedsMax` y `AlertEncrypted` están activos. Los avisos de límites o contenido cifrado se traducen a indisponible y bloquean la carga. Un resultado distinto de la respuesta exacta limpia o una detección reconocida también bloquea. [Configuración oficial](https://raw.githubusercontent.com/Cisco-Talos/clamav/clamav-1.4.6/etc/clamd.conf.sample).
- Las respuestas HTTP infectadas representan una detección del motor; no contienen el nombre de la firma. No se promete detectar todas las amenazas. El análisis complementa los controles de MIME, tamaño, contenido y saneamiento del portal.
- HTTP no escribe los documentos en disco. ClamAV puede descomprimirlos temporalmente, por lo que el Compose preparado define `/tmp` como tmpfs de 256 MiB y los temporales no van al volumen persistente. No se conservan hashes del motor (`DisableCache`), archivos recibidos ni logs de detección. Los logs de contenedores están deshabilitados, el destino de logs ClamAV es `/dev/null` y el servicio solo informa errores genéricos de inicio. El host debe impedir que swap, volcados de memoria o el ingreso HTTPS retengan contenido/token.

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
| `SCHOOL_FILE_SCAN_URL` | URL HTTPS aprobada terminada en `/scan` |
| `SCHOOL_FILE_SCAN_TOKEN` | El mismo token privado del servicio |

El mock local de la aplicación no debe habilitarse para producción. El servicio independiente no tiene modo mock. Para rotar el token, coordinar el cambio del archivo del servicio, su reinicio y el secreto de Vercel; cualquier desajuste bloquea temporalmente las cargas.

## Pruebas completadas y alcance

El registro inicial de **17 pruebas con daemon sintético** corresponde a la fase de implementación del protocolo/servicio. Se conserva como evidencia histórica, no como resumen de la aceptación actual. Después pasaron **29 pruebas dirigidas de guardas, protocolo y hook**; donde usan daemon sintético siguen etiquetadas como tales. La suite final del portal publicado pasó 538 pruebas, lint y compilaciones, según `outputs/release-validation-final3-20261009.json`; ese conteo tampoco sustituye al ensayo antivirus real.

### Antivirus real en Lima ARM

`/tmp/school-scanner-20261008/acceptance-2g.json` registra **12/12 PASS** a las `2026-10-09T05:53:37.914Z`. `/tmp/school-scanner-20261008/scanner-integrated-20261009-retry3.json` registra nuevamente **12/12 PASS** a las `2026-10-09T06:14:38.963Z`, manteniendo el scanner real durante el recorrido integrado. Ambos archivos son privados, con permisos 0600, sin token ni contenido de documentos.

El motor observado fue `ClamAV 1.4.6/28147/Thu Oct  8 06:24:12 2026`, con firmas oficiales cargadas de menos de 24 horas **en esos momentos de prueba**. No se afirma que esas firmas sigan vigentes ahora, ni que exista un motor productivo activo.

Los casos ejecutados comprobaron PDF sintético `clean`, EICAR oficial `infected`, token incorrecto, Origin de navegador, entradas de hasta cinco bytes, límite declarado de 20 MiB, flujo con límite reducido, versión incompatible y parada/recuperación del daemon real. La comprobación de antigüedad aplicó una política restringida de 1 ms a la base real: fue una inyección de fallo de política, no la instalación de una base histórica vencida ni una alteración del reloj. Los recursos temporales propios se limpiaron; no se modificaron proyectos escolares.

### Flujo integrado con Supabase local real

`outputs/supabase-school-http-native-20261009-retry3.json` registra **PASS: 149 solicitudes y 45 comprobaciones**, entre `2026-10-09T06:13:25.769Z` y `2026-10-09T06:14:40.259Z`. Usó Next.js, Auth/PostgreSQL/Storage nativos separados y el scanner real mediante el hook, con token solo en RAM y entorno whitelist. Incluyó carga y descarga privada, PDF/preview, reemplazo, entrega y rechazo a otra familia/anónimo, con documentos y cuentas sintéticos. No se imprimieron credenciales ni se enviaron documentos escolares.

Ese PASS pertenece al destino local aislado. Las cookies Secure se transportaron manualmente en el runner Node; no prueba un navegador sobre HTTP ni el ingreso HTTPS del servicio productivo. Los intentos anteriores y su evidencia se conservaron. Ver [recorrido HTTP y límites](pruebas-http-supabase-local.md).

### Repetir el ensayo propio, si se autoriza

La VM `school-scanner-test` está detenida de forma reversible. El CLI oficial usado está en `/tmp/school-isolated-runtime-20261008/lima/bin/limactl` y su estado aislado en `/tmp/school-scanner-20261008/lima-home`. No se usa una instalación global ni se monta el directorio del usuario. Para un nuevo ensayo expresamente aprobado de esa VM, sin variables o documentos productivos:

```sh
LIMA_HOME=/tmp/school-scanner-20261008/lima-home /tmp/school-isolated-runtime-20261008/lima/bin/limactl start school-scanner-test
node --experimental-strip-types scripts/accept-school-scanner-lima.mjs --run /tmp/school-isolated-runtime-20261008/lima/bin/limactl /tmp/school-scanner-20261008/lima-home /tmp/school-scanner-20261008/acceptance-nueva.json
LIMA_HOME=/tmp/school-scanner-20261008/lima-home /tmp/school-isolated-runtime-20261008/lima/bin/limactl stop school-scanner-test
```

El runner valida la VM propia y loopback, exige un archivo de evidencia nuevo, comprueba firmas cargadas y elimina solo sus contenedores/volumen temporales. El callback de integración debe cerrar su Next en `finally`; el cierre de VM corresponde al operador. No ejecutar estos comandos contra un servicio o proyecto real escolar. No se repitió ni reinició el ensayo al actualizar esta guía.

## Aceptación de producción pendiente

Antes de conectar producción falta:

1. Construir y arrancar las imágenes fijadas, comprobar sintaxis real de configuración, permisos, límites, actualizaciones y consumo en un servidor aprobado.
2. Obtener salud privada 200; probar documento inocuo sintético con respuesta limpia y el fichero de prueba antivirus estándar obtenido de su fuente oficial con respuesta infectada. No usar documentos escolares reales.
3. Comprobar token incorrecto, parada del daemon, firmas vencidas, límites, cifrados, tiempos y actualización del motor: todas las cargas deben bloquearse y no guardarse en Storage.
4. Revisar el ingreso TLS, ausencia de captura de headers/cuerpos y acceso exclusivamente desde el servidor de la aplicación; comprobar carga/descarga escolar con datos sintéticos y los roles autorizados.
5. Solo después guardar URL/token en Vercel y confirmar el flujo completo. El servicio no sustituye el respaldo ni añade acceso a Supabase.
