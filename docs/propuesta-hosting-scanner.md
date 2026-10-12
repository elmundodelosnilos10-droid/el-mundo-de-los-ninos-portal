# Propuesta para habilitar archivos en el hosting

**Consulta inicial: 9 de octubre de 2026. Opción Google revisada: 12 de octubre de 2026. Estado: propuesta; ningún servicio contratado ni publicado.**

## Trabajo preparado

El portal publicado en Vercel necesita un analizador privado HTTPS para aceptar materiales, fotografías y entregas. El servidor recibe los bytes durante el análisis; debe quedar bajo operación autorizada de la escuela. Las nuevas cargas siguen bloqueadas mientras falte esta dependencia.

La implementación está en `services/file-scanner`: HTTP autenticado, ClamAV, firmas persistentes, límites de tamaño/tiempo y rechazo cuando el motor o sus firmas no estén disponibles. Hay evidencia de 12 comprobaciones AV y un recorrido HTTP local real de 149 solicitudes/45 comprobaciones. Ese ensayo utilizó ARM/Debian en una VM Lima de 2 GiB. No prueba el despliegue amd64 de producción ni firmas vigentes hoy. Ver [servicio privado](servicio-scanner-privado.md) y [aceptación local](aceptacion-scanner-local.md).

## Recursos y costo consultado

ClamAV documenta un mínimo de 3 GiB y una preferencia de 4 GiB; la recarga de firmas y su validación también consumen memoria. [Requisitos oficiales](https://docs.clamav.net/manual/Installing/Docker.html#memory-ram-requirements).

La configuración preparada asigna 4 GiB al daemon y 256 MiB al servidor HTTP. **Decisión técnica propuesta:** una máquina amd64 de 8 GiB para dejar margen al sistema operativo, Docker, TLS y actualización de firmas. Esta capacidad es una recomendación del proyecto; necesita pruebas de carga y renovación antes del uso escolar.

| Opción | Referencia pública consultada | Condición pendiente |
| --- | --- | --- |
| Servidor Linux existente de la escuela | Reutilizar uno autorizado que tenga recursos y administración suficientes. | Identificar host, responsable, acceso y dominio; evaluar recursos disponibles. |
| Google Cloud Compute Engine, `e2-standard-2`, 2 vCPU/8 GiB | Referencia de Iowa (`us-central1`): USD 0.06701142/h; unas 730 horas son USD 48.92 solo de cómputo. Disco, IP externa, tráfico, dominio e impuestos se cotizan por separado. [Tarifa oficial](https://cloud.google.com/products/compute/pricing/general-purpose?hl=en). [Tipo de máquina](https://docs.cloud.google.com/compute/docs/general-purpose-machines#e2_standard). | Proyecto escolar con facturación, región aprobada, presupuesto completo, operador y dominio. La disponibilidad y el precio de la región elegida deben comprobarse antes de crear la VM. |
| DigitalOcean Basic Regular, 8 GiB/4 vCPU/160 GiB | USD 48/mes, precio listado del servidor, sin fijar impuestos, dominio u otros cargos. [Tarifa oficial](https://www.digitalocean.com/pricing/droplets). | Cuenta, aprobación de gasto recurrente, disponibilidad/región, acceso y dominio. |
| Hetzner CX33, 8 GB/4 vCPU/80 GB, Europa | USD 9.99/mes sin IVA ni IPv4, según ajuste vigente desde el 15 de junio de 2026. [Tarifa oficial](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/). [Especificaciones](https://www.hetzner.com/cloud/cost-optimized/). | La página consultada muestra «not available». No tratar ese precio como una oferta contratable. Confirmar stock, impuestos/IPv4, ubicación y transferencia internacional con la escuela. |

Los precios son referencias, no una contratación ni un presupuesto total garantizado. No se añadieron backups, snapshots ni complementos de pago al servidor. Su disco solo requiere firmas y configuración; el respaldo escolar de Supabase se gestiona por separado.

**Recomendación del proyecto al 12 de octubre:** conservar Vercel para la web y Supabase para los datos; para el analizador separado, preferir inicialmente DigitalOcean Basic Regular de 8 GiB si la escuela acepta su presupuesto, región y operación. Su tarifa lista disco y transferencia incluidos en el plan de USD 48/mes; el precio Google citado corresponde solo a cómputo. Es un juicio técnico sobre el servicio que ya implementamos, no una decisión de contratación. Antes de activar cualquiera, comprobar disponibilidad regional, cargos adicionales, TLS, mantenimiento y aceptación del daemon con firmas vigentes y archivos sintéticos. [Precio DigitalOcean consultado de nuevo](https://www.digitalocean.com/pricing/droplets).

Vercel admite contenedores, pero sus instancias sin tráfico se reducen después de cinco minutos en producción. Para este analizador la carga del motor y actualización de firmas deben caber en el plazo del portal; **no se ha comprobado ese comportamiento en Functions**. La propuesta conserva un daemon disponible y firmas persistentes en un host separado. [Funcionamiento oficial de contenedores](https://vercel.com/docs/functions/container-images#scale-in-behavior).

## Alternativa Google solicitada por la escuela

**Recomendación técnica para conservar el flujo implementado:** alojar `services/file-scanner` en una VM Linux amd64 de Compute Engine, con Docker/Compose, firmas persistentes y entrada HTTPS autenticada. El portal continúa en Vercel y los archivos autorizados en Supabase. La VM recibe temporalmente los bytes para analizarlos; su ubicación, operador y tratamiento deben aprobarse antes de transmitir archivos escolares. Una cuenta Gmail por sí sola no configura este servicio: se necesita un proyecto de Google Cloud y una cuenta de facturación.

El cálculo anterior es una referencia reproducible de cómputo (`0.06701142 × 730 = 48.9183366`), sin descuentos, créditos promocionales ni compromisos de permanencia. No es el total mensual ni un límite automático de gasto. Antes de contratar hay que completar una estimación para la región aprobada, disco persistente, IP, transferencia, impuestos y dominio. No se ha abierto una cuenta, habilitado facturación ni creado una VM.

Google también publica una arquitectura con ClamAV en Cloud Run, Cloud Storage y Eventarc. Mantiene al menos una instancia activa por el tiempo de arranque del motor y requiere facturación. [Guía oficial](https://docs.cloud.google.com/architecture/automate-malware-scanning-for-documents-uploaded-to-cloud-storage/deployment?hl=en). Ese flujo mueve objetos entre depósitos pendientes, limpios y en cuarentena; requiere adaptar nuestra carga síncrona y almacenamiento Supabase. No es una configuración equivalente que pueda activarse cambiando solamente la URL del analizador.

La VM propuesta debe usar una identidad operadora autorizada y acceso administrativo restringido. No necesita claves de base de datos ni permisos sobre expedientes Supabase. El token del analizador se configura solo en el servidor de Vercel y en el host, con custodia y rotación. La aprobación previa del servidor Vercel no autoriza por sí sola una nueva contratación Google ni el acceso del nuevo analizador a archivos.

Para ejecutar la opción Google faltan: proyecto y facturación escolar, autorización de gasto concreto, región y responsable, dominio/TLS y aprobación del acceso del servidor Vercel al analizador. Primero se comprueba disponibilidad, versión soportada de ClamAV e imágenes fijadas; después se provisiona y se realiza el ensayo con archivos sintéticos indicado abajo. Hasta esa aceptación, las cargas permanecen cerradas.

## Configuración exacta propuesta

1. Host Linux amd64 con Docker/Compose oficial, 8 GiB y almacenamiento persistente de firmas. Confirmar región y responsable escolar antes de transmitir archivos.
2. Subdominio HTTPS de la escuela para el analizador y certificado válido. `services/file-scanner/Caddyfile.example` es una plantilla para ingreso TLS en el host; requiere sustituir el dominio y validar Caddy.
3. Mantener `compose.yaml`: ClamAV solo en la red interna; HTTP solo en `127.0.0.1:8080`; no publicar 3310. Ingreso externo HTTPS 443; 80 solo cuando lo requiera la validación del certificado. Acceso administrativo limitado al operador.
4. Token privado en archivo de servidor con permisos restringidos, usando `SCANNER_TOKEN_PATH`. Nunca incluirlo en Git, capturas, argumentos de proceso o registros. Definir custodia y procedimiento de rotación.
5. Configurar únicamente en el servidor Vercel `SCHOOL_FILE_SCAN_URL` y `SCHOOL_FILE_SCAN_TOKEN`, siguiendo [la guía del servicio](servicio-scanner-privado.md). Confirmar los nombres en `.env.example` antes de escribir variables; no usar variables `NEXT_PUBLIC_*` para secretos.
6. Conservar límites: 20 MiB en analizador, 12 s de solicitud, dos análisis concurrentes, firmas con edad máxima de 24 horas; los límites de cada carga del portal son menores y también se mantienen. Deshabilitar registros de cuerpos, archivos y encabezados de autenticación en el ingreso y en observabilidad.
7. Probar salud autenticada, archivo sintético limpio, EICAR, error de autenticación, firmas vencidas, daemon detenido y límites. Después comprobar material/entrega/adjunto privado y aislamiento por roles en el hosting con un ensayo autorizado, sin datos de menores.
8. Retirar solo el fixture identificado y conservar evidencias sin datos personales. Registrar responsables, mantenimiento y respuesta a fallos. El código debe seguir rechazando cargas si el analizador deja de estar disponible.

## Lo necesario para ejecutar

Falta un host autorizado (o aprobación de una contratación concreta), una cuenta operadora, un dominio para TLS y custodio del token. Cuando esos datos estén disponibles, revisar los accesos y cargos de la acción concreta antes de ejecutarla. No usar la computadora personal ni publicar la VM de ensayo para atender a familias.
