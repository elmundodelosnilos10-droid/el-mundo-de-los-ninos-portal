# Propuesta para habilitar archivos en el hosting

**Fecha de consulta: 9 de octubre de 2026. Estado: propuesta; ningún servicio contratado ni publicado.**

## Trabajo preparado

El portal publicado en Vercel necesita un analizador privado HTTPS para aceptar materiales, fotografías y entregas. El servidor recibe los bytes durante el análisis; debe quedar bajo operación autorizada de la escuela. Las nuevas cargas siguen bloqueadas mientras falte esta dependencia.

La implementación está en `services/file-scanner`: HTTP autenticado, ClamAV, firmas persistentes, límites de tamaño/tiempo y rechazo cuando el motor o sus firmas no estén disponibles. Hay evidencia de 12 comprobaciones AV y un recorrido HTTP local real de 149 solicitudes/45 comprobaciones. Ese ensayo utilizó ARM/Debian en una VM Lima de 2 GiB. No prueba el despliegue amd64 de producción ni firmas vigentes hoy. Ver [servicio privado](servicio-scanner-privado.md) y [aceptación local](aceptacion-scanner-local.md).

## Recursos y costo consultado

ClamAV documenta un mínimo de 3 GiB y una preferencia de 4 GiB; la recarga de firmas y su validación también consumen memoria. [Requisitos oficiales](https://docs.clamav.net/manual/Installing/Docker.html#memory-ram-requirements).

La configuración preparada asigna 4 GiB al daemon y 256 MiB al servidor HTTP. **Decisión técnica propuesta:** una máquina amd64 de 8 GiB para dejar margen al sistema operativo, Docker, TLS y actualización de firmas. Esta capacidad es una recomendación del proyecto; necesita pruebas de carga y renovación antes del uso escolar.

| Opción | Referencia pública consultada | Condición pendiente |
| --- | --- | --- |
| Servidor Linux existente de la escuela | Reutilizar uno autorizado que tenga recursos y administración suficientes. | Identificar host, responsable, acceso y dominio; evaluar recursos disponibles. |
| DigitalOcean Basic Regular, 8 GiB/4 vCPU/160 GiB | USD 48/mes, precio listado del servidor, sin fijar impuestos, dominio u otros cargos. [Tarifa oficial](https://www.digitalocean.com/pricing/droplets). | Cuenta, aprobación de gasto recurrente, disponibilidad/región, acceso y dominio. |
| Hetzner CX33, 8 GB/4 vCPU/80 GB, Europa | USD 9.99/mes sin IVA ni IPv4, según ajuste vigente desde el 15 de junio de 2026. [Tarifa oficial](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/). [Especificaciones](https://www.hetzner.com/cloud/cost-optimized/). | La página consultada muestra «not available». No tratar ese precio como una oferta contratable. Confirmar stock, impuestos/IPv4, ubicación y transferencia internacional con la escuela. |

Los precios son referencias, no una contratación ni un presupuesto total garantizado. No se añadieron backups, snapshots ni complementos de pago al servidor. Su disco solo requiere firmas y configuración; el respaldo escolar de Supabase se gestiona por separado.

Vercel admite contenedores, pero sus instancias sin tráfico se reducen después de cinco minutos en producción. Para este analizador la carga del motor y actualización de firmas deben caber en el plazo del portal; **no se ha comprobado ese comportamiento en Functions**. La propuesta conserva un daemon disponible y firmas persistentes en un host separado. [Funcionamiento oficial de contenedores](https://vercel.com/docs/functions/container-images#scale-in-behavior).

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
