# Aceptación de familias en navegador local · 9 de octubre de 2026

## Alcance comprobado

Se usó el navegador real de Codex sobre Next.js de desarrollo en `http://localhost:5205`, conectado únicamente al destino Native **sintético restaurado**. No se modificaron credenciales, expedientes ni configuración de producción. No se transportaron cookies manualmente ni se retiraron `Secure`, `HttpOnly`, `SameSite` o el prefijo `__Host-`.

Las dos familias ficticias preexistentes ingresaron con sus contraseñas originales. Los paneles mostraron un solo hijo propio; el expediente ajeno existente devolvió 404 y el propio estuvo disponible. La familia A consultó una tarea completada, su entrega y retroalimentación, y una observación visible sin mostrar la interna. Su descarga normal de un PDF privado coincidió byte por byte con el objeto de Storage local. La solicitud de ese archivo desde la familia B llegó al servidor y devolvió 404; el navegador bloqueó la navegación de esa respuesta, por lo que no se afirma render del rechazo.

La sesión familiar sobrevivió a una recarga. Cerrar sesión bloqueó de nuevo el expediente privado. La interfaz de Seguimiento a un viewport solicitado de 320px tuvo ancho documental igual al disponible, sin desbordamiento horizontal. La captura de familia B mostró el panel móvil; la primera captura de familia A conserva un raster anterior escalado y **no se acepta como prueba visual móvil**. Las mediciones DOM y las capturas se registran por separado; no sustituyen un teléfono físico.

## Defectos encontrados y correcciones

- Al usar el formulario de ingreso antes de su hidratación, el navegador enviaba GET `/ingresar?` y perdía los campos. El registro no mostró POST Auth en esa interacción. Los inputs carecen de `name`, por lo que esa solicitud no incluyó las credenciales en la URL. El formulario ahora permanece deshabilitado con «Preparando acceso…» hasta que el cliente está listo. El navegador mostró ese estado inicial y luego completó un nuevo ingreso real con las mismas credenciales ficticias. Las pruebas SSR/callbacks comprueban doble envío y respuestas tras desmontaje.
- Tareas ahora usa listas paginadas y descarta entregas de una selección anterior. La familia B vio cero tareas y página 1 de 1; la A vio su tarea y la retroalimentación existente mediante el componente corregido. Las carreras A→B, recibos inválidos y escrituras confirmadas con GET fallido se prueban por separado en los tests del TSX/handler, sin provocar fallos ni mutar expedientes en producción.

## Conservación y cierre

El baseline antes/después conserva **33 tablas públicas/69 filas, seis cuentas Auth, sus hashes e identidades y tres registros de objetos Storage**. Solo puede avanzar el timestamp de perfil administrado por Auth de las familias que ingresaron. No se escribieron alumnos, grupos, tareas ni nuevas identidades. Se cerraron las sesiones y pestañas temporales; Next, el servidor local de acceso de ensayo y el target Native se detuvieron. La comparación de Storage en este postflight cubre registros; los bytes de la descarga se verificaron aparte y la recuperación de los tres objetos pertenece al ensayo de restauración anterior.

Evidencia privada local:

- `outputs/supabase-family-browser-ui-20261009.json`: 16 observaciones delimitadas del navegador y sus límites.
- `outputs/supabase-family-browser-file-20261009.json`: 621 bytes PDF, igualdad exacta con Storage real local.
- `outputs/supabase-family-browser-acceptance-20261009-attempt2.json`: baseline preservado y parada oficial PASS.
- `outputs/supabase-family-browser-stopped-20261009.json`: nueve puertos propios verificados cerrados.
- `outputs/portal-local-family-b-mobile-20261009.jpg`: captura móvil ficticia utilizable.

El primer preflight `supabase-family-browser-acceptance-20261009.json` se conserva como FAIL antes de SQL/browser: asumía un dominio diferente para las cuentas ficticias preservadas. Se corrigió el reconocimiento del fixture y se comprobó contra Auth real antes de iniciar la app. No se reprodujo una escritura incierta ni se reinició la base.

## Lo que este ensayo no acredita

No es aceptación de Vercel por HTTPS, SMTP, invitaciones, recuperación de contraseña, cuentas reales de la escuela, edición docente en navegador, eventos Realtime del proveedor, admisión de Google Meet, lector de pantalla, teléfono físico ni conexión lenta. El analizador de archivos siguió ausente/cerrado en esta app de lectura. Los ensayos HTTP con analizador real son independientes. Las claves y contraseñas ficticias permanecen en archivos privados y no forman parte de esta documentación ni del repositorio.
