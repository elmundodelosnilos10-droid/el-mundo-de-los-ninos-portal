# Aceptación del scanner real en un entorno local aislado

## Estado

`scripts/accept-school-scanner.mjs` está preparado. No se ejecutó ClamAV real ni se descargaron firmas o EICAR durante su preparación. Las pruebas unitarias de guardas no prueban detección antivirus. Docker y Lima no están disponibles en el entorno inspeccionado; el operador está preparando una VM Linux separada. No se cambia producción ni se configura ningún hosting.

La alternativa nativa macOS se descargó y comprobó posteriormente el 9 de octubre UTC, con el resultado de diagnóstico indicado al final. No llegó a iniciar el motor o FreshClam, ni cambió el estado de aceptación antivirus.

## Dependencias y fuentes

- VM Linux aislada con Node 22.13+ y Docker Engine/Compose funcionando con socket Unix local. Ejecutar el runner dentro de esa VM, con el repositorio disponible. Rechaza contextos Docker SSH/TCP y URLs de aplicación/Supabase/scanner fuera de loopback si aparecen en el entorno.
- Imagen ClamAV amd64 fijada en `services/file-scanner/Dockerfile.clamav`, obtenida de `clamav/clamav` oficial. No descarga instaladores de terceros ni instala Docker, Lima o Node. [Imágenes y memoria oficiales](https://docs.clamav.net/manual/Installing/Docker.html).
- Al menos 4 GiB para ClamAV, además de memoria para Node, Docker y Supabase local si se ejecuta simultáneamente. En una máquina arm64 hace falta capacidad Linux/amd64; no se ha comprobado su rendimiento.
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

## Alternativa nativa macOS, sin instalar

El runner también acepta `existingDaemon: { endpoint: { host: "127.0.0.1", port }, stop, start }`. En ese modo no usa Docker ni crea volúmenes: el operador debe proporcionar un daemon propio de ensayo ya iniciado, con motor real 1.4.6, firmas oficiales vigentes y controles `stop`/`start` restringidos a ese proceso. No acepta localhost ambiguo, direcciones externas o un daemon sin controles de ciclo de vida propios. El runner cierra sus servidores HTTP al terminar; el propietario sigue siendo responsable del daemon que proporcionó.

La preparación nativa autorizada se limita a `/tmp/school-clamav-native-20261008`: paquete universal oficial descargado desde [ClamAV](https://www.clamav.net/downloads), firma comprobada antes de expandir mediante pkgutil, sin ejecutar instalador ni scripts del paquete, sin privilegios y sin modificar `/usr/local`. Antes de ejecutar binarios se deben inspeccionar sus dylibs y usar únicamente bibliotecas extraídas del mismo paquete mediante un entorno de proceso local, si es compatible. Una firma, extracción o ejecución incompatible bloquea la prueba; no se reescriben rutas del sistema para forzarla.

### Diagnóstico nativo comprobado · 9 octubre 2026 UTC

- Paquete oficial `clamav-1.4.6.macos.universal.pkg`, SHA256 `a1898a0269e1cad0dc9d9be988a79541f287f205c6537d4a846c5ff3ac3e4a1f`.
- `pkgutil --check-signature` confirma Developer ID Installer **Cisco (DE8Y96K9QP)**, timestamp confiable del 7 agosto 2026 y notarización Apple. Se expandió únicamente en la carpeta temporal autorizada; no se ejecutaron scripts de instalación.
- Los binarios incluyen arm64 y x86_64. `otool` muestra `@rpath` con `LC_RPATH /usr/local/clamav/lib`; `codesign` muestra Developer ID Application Cisco y flag hardened runtime.
- `freshclam --version` y `clamd --version`, con `DYLD_LIBRARY_PATH` apuntando exclusivamente a las bibliotecas extraídas del paquete, abortan en el cargador porque siguen buscando `/usr/local/clamav/lib`. No se cambiaron rpath, firmas, permisos del sistema o `/usr/local` para forzar la ejecución.
- No se inició daemon, no se descargaron firmas y no se obtuvo una detección EICAR real. Quedan pendientes un entorno Linux/Docker local funcional u otra alternativa aprobada que respete esas restricciones.

Pruebas ejecutables de guardas y protocolo: **21/21** pasan. Son guardas y daemon sintético, con etiquetas explícitas; no sustituyen la aceptación real pendiente.
