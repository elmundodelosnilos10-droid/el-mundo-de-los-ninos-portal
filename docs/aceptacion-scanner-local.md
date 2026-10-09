# Aceptación del scanner real en un entorno local aislado

## Estado

**Aceptación antivirus real local completada el 9 octubre 2026 UTC: 12/12 casos pasan.** Se utilizó Lima oficial 2.2.0 con VM VZ ARM aislada `school-scanner-test`, 2 CPU, 2 GiB de memoria y disco de 12 GiB. No se montaron carpetas del host, claves personales o documentos escolares. Docker se instaló únicamente dentro de Ubuntu desde sus repositorios oficiales. No se cambia producción ni se configura ningún hosting.

El motor real confirmó `ClamAV 1.4.6/28147/Thu Oct  8 06:24:12 2026`: firmas oficiales cargadas de menos de 24 horas **en el momento del ensayo**; no se acredita su vigencia actual. El PDF sintético recibió `clean` y EICAR oficial recibió `infected`; los casos de token, Origin, cobertura insuficiente, límites, política de firmas, versión y caída/recuperación del daemon se ejecutaron. La expiración se prueba con política restringida de 1 ms sobre la base real, no con una base histórica o un reloj alterado. El fichero de evidencia JSON tiene permisos 0600 y no incluye token ni contenido de archivos.

El runner eliminó exclusivamente su contenedor y volumen de firmas al terminar. La aceptación antivirus por sí sola no demuestra un upload completo; el **recorrido integrado local posterior sí pasó**, con 149 solicitudes HTTP y 45 comprobaciones, como se registra abajo. Ninguno habilita scanner o credenciales en Vercel. Las pruebas unitarias adicionales de protocolo, guardas y hook pasan **29/29**; esas pruebas siguen usando daemon sintético donde se indica y no deben confundirse con los 12 casos reales. La VM de ensayo quedó detenida de forma reversible, conservando configuración y evidencias.

La alternativa nativa macOS se descargó y comprobó previamente el 9 octubre UTC, con el diagnóstico histórico indicado al final. No llegó a iniciar el motor o FreshClam. La aceptación real posterior se completó dentro de Linux, sin instalar ni modificar binarios del sistema macOS.

## Dependencias y fuentes

- VM Linux aislada con Node 22.13+ y Docker Engine/Compose funcionando con socket Unix local. Ejecutar el runner dentro de esa VM, con el repositorio disponible. Rechaza contextos Docker SSH/TCP y URLs de aplicación/Supabase/scanner fuera de loopback si aparecen en el entorno.
- Imagen ClamAV amd64 fijada en `services/file-scanner/Dockerfile.clamav`, obtenida de `clamav/clamav` oficial. No descarga instaladores de terceros ni instala Docker, Lima o Node. [Imágenes y memoria oficiales](https://docs.clamav.net/manual/Installing/Docker.html).
- Para el Compose amd64 original se recomiendan 4 GiB para ClamAV, además de los otros servicios. La alternativa oficial Debian ARM descrita abajo evita emulación; el ensayo acotado pasó con VM de 2 GiB y recarga concurrente desactivada. Ese resultado no establece capacidad productiva o carga sostenida. [ClamAV recomienda mínimo 3 GiB y preferido 4 GiB](https://docs.clamav.net/manual/Installing/Docker.html).
- Salida HTTPS hacia Docker Hub, las actualizaciones oficiales configuradas de FreshClam y `https://secure.eicar.org/eicar.com.txt`. El test EICAR se descarga de ese URL exacto, sin seguir redirecciones, y debe coincidir con sus 68 bytes estándar. [Información oficial de EICAR](https://www.eicar.org/download-anti-malware-testfile/). Si falta acceso, no declara detección exitosa.

## Ejecución explícita

Desde el repositorio **dentro de la VM local**, sin secretos ni URLs de producción:

```sh
node --experimental-strip-types scripts/accept-school-scanner.mjs --run
```

No se debe ejecutar con variables de producción heredadas. Sin `--run` solo muestra dependencias e instrucciones. Crea un proyecto Compose con nombre aleatorio propio; inicia únicamente `clamav`, con puerto TCP temporal publicado en `127.0.0.1`. Ese puerto sin autenticación es solo para este ensayo aislado y se elimina al terminar; no modifica el Compose de producción. El HTTP del scanner utiliza el código real del repositorio en el proceso Node, también en loopback. El token es aleatorio, efímero y permanece en memoria; no se imprime. El archivo temporal privado satisface la interpolación de Compose, pero no se monta porque no se inicia su contenedor HTTP.

Al terminar, cierra servidores y elimina exclusivamente los contenedores, redes y volumen de firmas de su proyecto. No borra proyectos Supabase ni otros volúmenes. Si falla la limpieza, informa solo el nombre del proyecto propio para inspección manual. Las primeras firmas pueden tardar hasta 15 minutos; el runner informa progreso y falla si no comprueba salud.

## Qué comprueba

1. Motor real 1.4.6 y versión de firmas realmente cargada, con antigüedad máxima 24 horas, mediante `VERSION` y salud autenticada.
2. Un PDF claramente marcado como documento sintético sin datos escolares recibe `clean` a través de `lib/file-scanner.ts`, sin modo mock.
3. El fichero estándar EICAR oficial recibe `infected` del motor real; no usa el marcador sintético de las pruebas unitarias.
4. Token incorrecto y solicitud con Origin de navegador se rechazan; archivos de hasta cinco bytes se rechazan por cobertura insuficiente; el límite declarado real de 20 MiB se rechaza antes de recibir el cuerpo.
5. Un servidor de ensayo con límite reducido de 128 bytes rechaza un flujo sin Content-Length al superar ese límite, aunque esté conectado al daemon real. Ese límite reducido es una **inyección de fallo de política**, no el límite productivo.
6. Un servidor de ensayo con antigüedad permitida de 1 ms rechaza las firmas reales que ya exceden esa política; otro rechaza una versión de motor incompatible. Son **inyecciones de fallo de política**: no se descargó una base histórica vencida ni se alteraron las firmas oficiales o el reloj de producción.
7. Detiene el daemon real de su proyecto, confirma indisponibilidad y bloqueo, lo reinicia y comprueba recuperación con el documento sintético.

Solo imprime un resumen de casos y versión, sin archivos, tokens o credenciales. `passed` significa aceptación antivirus local; no prueba por sí solo RLS, Storage, escrituras de alumnos, hosting o cargas del portal.

## Conexión con un harness Supabase local

El runner exporta `runScannerAcceptance({ runLocal: true, onReady })`. Tras comprobar y recuperar el daemon, espera a `onReady` antes de limpiar. Ese callback recibe en memoria `url`, `token`, `applicationUrl` y los bytes del documento sintético para que un harness de confianza de **Supabase local** ejecute su flujo. Debe usar únicamente endpoints loopback, identidades sintéticas y el proyecto local de ensayo; no imprimir o persistir el token, no registrar contenido y no enviar documentos reales. El runner no toca ni modifica el harness de otros agentes, ni consulta Supabase por su cuenta.

Las cargas nuevas del portal están limitadas a 4 MiB, por lo que caben bajo los 20 MiB del scanner. El scanner continúa sin habilitar en producción; su aceptación local no autoriza instalarlo ni guardar secretos en Vercel.

## Runner Lima ARM usado para la aceptación real

`scripts/accept-school-scanner-lima.mjs` usa una VM **ya provisionada**: no crea VMs, modifica el sistema macOS ni instala software en el host. Valida nombre propio, VZ ARM, máximo 2 CPU/2 GiB/12 GiB, ausencia de mounts, claves personales y SSH agent forwarding, proxy heredado desactivado e imagen Ubuntu HTTPS con SHA256. Solo permite el reenvío loopback `127.0.0.1:3310` del guest a `127.0.0.1:43310` del host e ignora todos los demás puertos.

La imagen usada es `clamav/clamav-debian:1.4.6_base@sha256:1b9f632fd2756d647ea76721c190f1a8821f3f1dc099b6b671e265d4346fcec4`, manifest ARM de la [imagen oficial Debian de Cisco-Talos](https://github.com/Cisco-Talos/clamav-docker/blob/main/clamav/README-debian.md). El índice oficial de esa versión es `sha256:a3cbbbc2b17a3871862689c0773bc9f5d70a1e4914ada7c8a05e157722ee8a9d`. El Dockerfile y digest amd64 del servicio original no se modificaron. El wrapper copia solo `clamd.conf`, `freshclam.conf` y el entrypoint del scanner; registra sus SHA256 en la evidencia. Conserva `OfficialDatabaseOnly yes`, `TestDatabases yes`, autenticación privada y la verificación estricta del motor/base cargada.

Ejemplo para este entorno temporal, sin URLs ni secretos productivos:

```sh
node --experimental-strip-types scripts/accept-school-scanner-lima.mjs --run /tmp/school-isolated-runtime-20261008/lima/bin/limactl /tmp/school-scanner-20261008/lima-home /tmp/school-scanner-20261008/acceptance-nueva.json
```

La evidencia se escribe con `wx` y modo 0600: una nueva ejecución requiere un nombre de evidencia nuevo. El wrapper genera un contenedor/volumen aleatorio exclusivo, impone memoria y CPU del ensayo, y elimina solo esos recursos y sus tres archivos temporales. No limpia otros contenedores, imágenes, volúmenes o proyectos. Para conectar un harness Supabase local de confianza, se puede importar `runLimaScannerAcceptance` y pasar `onReady`; mantiene el mismo contrato efímero en memoria del runner base.

### Hook de integración Next/HTTP: aceptación local real completada

`scripts/school-scanner-local-hook.mjs` exporta `createLocalScannerIntegrationHook({ appOrigin, supabaseOrigin, credentials, baseEnvironment, verifyEmpty, run })`. Su retorno se pasa como `onReady`. `verifyEmpty` es obligatorio y debe comprobar **Auth, tablas escolares y Storage vacíos en el stack local desechable** antes de iniciar el callback `run`. `run({ nextEnvironment, syntheticCleanBytes })` inicia su propio Next local, espera el recorrido HTTP de carga/descarga privada/preview/reemplazo/entrega y denegación a familia ajena, y debe cerrar ese proceso en su `finally`. El scanner permanece vivo hasta que ese callback termina; después el runner limpia su daemon propio.

El recorrido real completado figura en `outputs/supabase-school-http-native-20261009-retry3.json`: **149 solicitudes, 45 comprobaciones, PASS**, con archivos privados y dos familias sintéticas en Next/Auth/PostgreSQL/Storage locales separados. `/tmp/school-scanner-20261008/scanner-integrated-20261009-retry3.json` registra **12/12 comprobaciones antivirus reales PASS** mientras se ejecutaba el hook. El PDF limpio y EICAR oficial se analizaron con ClamAV real, sin modo mock; las firmas tenían menos de 24 horas en ese momento. Los tokens permanecieron en RAM y la evidencia privada del antivirus tiene permisos 0600. Los intentos previos se conservaron.

Las cookies Secure se transportaron manualmente en el runner Node: este resultado no representa un navegador sobre HTTP, el ingreso HTTPS del scanner ni un recorrido Vercel de producción. Ver [evidencia HTTP local y alcance](pruebas-http-supabase-local.md). El servicio productivo sigue sin configurar.

El entorno se construye en RAM con whitelist; conserva solo PATH/HOME/TMPDIR/LANG habituales y añade valores explícitos. No copia `.env`, variables de producción o flags Vercel. El helper exige tres endpoints de IP loopback literal y rechaza NODE_ENV production o presencia de VERCEL. Añade:

- `SCHOOL_FILE_SCAN_URL`: URL efímera `/scan` recibida del runner.
- `SCHOOL_FILE_SCAN_TOKEN`: token efímero recibido solo en memoria.
- `SCHOOL_FILE_SCAN_LOCAL_MOCK=false`: garantiza escaneo HTTP real.
- `NODE_ENV=development`, `SCHOOL_LOCAL_SUPABASE_HTTP=isolated-test`: excepción acotada de transporte Supabase local; no afecta HTTPS productivo.
- `APP_ORIGIN` y `BETTER_AUTH_URL`: origen Next `http://127.0.0.1:puerto`.
- Proveedores Auth/datos/archivos Supabase; `SUPABASE_URL` local y claves anon/service_role **exclusivamente del stack local**, bucket privado `school-files`.
- `SCHOOL_REALTIME_PROVIDER=disabled`; ese recorrido no necesita Realtime. Better Auth recibe un secreto sintético nuevo, aunque las identidades del flujo pertenecen a Supabase.

El helper elimina las claves y token del objeto de entorno al terminar y reemplaza mensajes de error desconocidos por una descripción genérica. El callback no debe imprimir ni serializar ese entorno, cookies o credenciales. La política local debe estar presente en **Auth, PostgREST y Storage** antes de ejecutar el recorrido; no debe sustituirse por un proxy a producción ni relajarse la seguridad del adaptador.

La imagen Ubuntu usada fue `https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-arm64.img`, SHA256 `1d6bffe64b848468ac97f821d369a4846d983de1800ccf6b5ec8853e85cefc55`, obtenido del SHA256SUMS oficial por HTTPS y comprobado por Lima. La imagen fechada anterior redirigía a un archivo inaccesible. Lima macOS ignoró `XDG_CACHE_HOME` y creó su caché de esa URL bajo Library/Caches; tras crear el disco independiente de la VM se trasladó únicamente esa caché conocida del ensayo al directorio `/tmp` de la tarea. No se tocaron otros archivos del usuario.

### Aceptación académica local posterior, sin scanner

El destino sintético restaurado separado también completó el recorrido académico `outputs/supabase-school-academic-restored-local-20261009-attempt2.json`: **43 solicitudes a las APIs reales de la aplicación, 213 solicitudes totales incluidas las lecturas de snapshot/verificación, 30 comprobaciones PASS**. Incluye calendario creado/editado por docente, filtros de grupo/tipo por vínculo familiar, hora CDMX y aislamiento; falta, justificación aceptada e historial; exportaciones CSV/XLSX/PDF; comunicado docente, avisos/acuse y denegaciones por rol o familia ajena. Comprueba persistencia y auditorías en PostgreSQL. No fue un nuevo ensayo antivirus ni una prueba de navegador/Vercel.

El primer intento `outputs/supabase-school-academic-restored-local-20261009-attempt1.json` conserva **FAIL** y cleanup **PASS**; no se reescribió como éxito. El cleanup del segundo conservó el baseline de **33 tablas/69 filas/6 identidades Auth/3 objetos**, campos escolares, hashes de objetos e identidades/contraseñas Auth; admite el avance de timestamp de perfil gestionado por Auth. `outputs/supabase-school-academic-restored-local-20261009-stopped.json` confirma la parada nativa reversible del destino, con configuración/datos conservados y origen/producción sin cambios.

## Alternativa nativa macOS, sin instalar

El runner también acepta `existingDaemon: { endpoint: { host: "127.0.0.1", port }, stop, start }`. En ese modo no usa Docker ni crea volúmenes: el operador debe proporcionar un daemon propio de ensayo ya iniciado, con motor real 1.4.6, firmas oficiales vigentes y controles `stop`/`start` restringidos a ese proceso. No acepta localhost ambiguo, direcciones externas o un daemon sin controles de ciclo de vida propios. El runner cierra sus servidores HTTP al terminar; el propietario sigue siendo responsable del daemon que proporcionó.

La preparación nativa autorizada se limita a `/tmp/school-clamav-native-20261008`: paquete universal oficial descargado desde [ClamAV](https://www.clamav.net/downloads), firma comprobada antes de expandir mediante pkgutil, sin ejecutar instalador ni scripts del paquete, sin privilegios y sin modificar `/usr/local`. Antes de ejecutar binarios se deben inspeccionar sus dylibs y usar únicamente bibliotecas extraídas del mismo paquete mediante un entorno de proceso local, si es compatible. Una firma, extracción o ejecución incompatible bloquea la prueba; no se reescriben rutas del sistema para forzarla.

### Diagnóstico nativo histórico comprobado · 9 octubre 2026 UTC

- Paquete oficial `clamav-1.4.6.macos.universal.pkg`, SHA256 `a1898a0269e1cad0dc9d9be988a79541f287f205c6537d4a846c5ff3ac3e4a1f`.
- `pkgutil --check-signature` confirma Developer ID Installer **Cisco (DE8Y96K9QP)**, timestamp confiable del 7 agosto 2026 y notarización Apple. Se expandió únicamente en la carpeta temporal autorizada; no se ejecutaron scripts de instalación.
- Los binarios incluyen arm64 y x86_64. `otool` muestra `@rpath` con `LC_RPATH /usr/local/clamav/lib`; `codesign` muestra Developer ID Application Cisco y flag hardened runtime.
- `freshclam --version` y `clamd --version`, con `DYLD_LIBRARY_PATH` apuntando exclusivamente a las bibliotecas extraídas del paquete, abortan en el cargador porque siguen buscando `/usr/local/clamav/lib`. No se cambiaron rpath, firmas, permisos del sistema o `/usr/local` para forzar la ejecución.
- En ese intento nativo no se inició daemon, no se descargaron firmas y no se obtuvo detección EICAR real. El bloqueo de macOS quedó conservado; la prueba real posterior se completó en Linux como se documenta arriba.

Pruebas ejecutables de guardas, protocolo y hook: **29/29** pasan. Son guardas y daemon sintético, con etiquetas explícitas; se reportan por separado de la aceptación real Linux.
