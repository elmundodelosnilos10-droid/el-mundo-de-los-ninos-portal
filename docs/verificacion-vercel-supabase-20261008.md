# Verificación Vercel + Supabase escolar

## Versión vigente · 8 octubre 2026, 23:09 CDMX

Producción READY `dpl_3ABfnzZfGT84WHgjZzXzZzfWzZpw`, URL única https://el-mundo-de-los-ninos-portal-daplq52b1-pandito.vercel.app y dominio canónico https://el-mundo-de-los-ninos-portal.vercel.app. Se desplegó con skip-domain, pasó 19 controles HTTP, se promovió ese ID y pasaron de nuevo los 19 controles en el dominio escolar.

- Realtime 30 se aplicó tras autorización específica del usuario y prueba de catálogo reversible sin errores. Publicación exclusiva de tres tablas, INSERT/UPDATE activados, DELETE/TRUNCATE desactivados. Veinticinco versiones SQL; cero alumnos/cuentas sintéticas y administradora activa. Respaldo29 independiente, sin aplicar.
- Indicador no secreto de Realtime configurado solo en Production. Con sesión escolar real, Comunicación y centro de avisos cargaron; el centro indicó conexión en vivo activa tras la confirmación del SDK. No se crearon avisos, mensajes o usuarios ficticios para esta comprobación.
- 446 unitarias,262 smoke D1 aislados, lint, Next/Sites locales y build remoto pasaron. Registros `/tmp/school-{unit,lint,next,sites,smoke}-realtime-release-20261008.log` y `/tmp/school-vercel-realtime-active-stage-20261008.log`.
- Nuevas cargas limitadas a4 MiB por archivo y4 MiB+64 KiB por cuerpo; la interfaz traduce errores413 del hosting aunque no sean JSON. Descargas anteriores conservan streaming privado y máximos de10/25 MiB. El escáner aún no está configurado; cargas bloqueadas.

Evidencias: `outputs/vercel-release-realtime-20261008.json`, `outputs/vercel-realtime-active-stage-http-20261008.json`, `outputs/vercel-realtime-production-http-20261008.json`, `outputs/supabase-realtime-release-20261008.json`, capturas Supabase y portal en vivo. La primera prueba sin autenticación CLI alcanzó la protección de Vercel; el ensayo inicial por CLI incluyó cuatro rutas erróneas404. Ambos se conservaron; el ensayo final usa los17 contratos del manifiesto anterior más los2 GET Realtime.

La conexión real no acredita entrega o aislamiento de eventos entre familias. Faltan esos recorridos en un entorno aislado, escáner/SMTP, archivos reales y respaldo/restauración. La revisión móvil de cinco pantallas y las18 lecturas administrativas corresponden al release anterior, conservado abajo. Web Push y correo de eventos no se activaron.

## Versión anterior · 8 octubre 2026, 22:30 CDMX

Producción READY `dpl_xkMxs8YubpLYXSrSADubeUpUXVXC`, URL única https://el-mundo-de-los-ninos-portal-33t9e22kd-pandito.vercel.app, alias https://el-mundo-de-los-ninos-portal.vercel.app. La fuente sigue en el directorio de trabajo, basada en `c2474e2` con cambios sin commit nuevo.

- 24 versiones SQL instaladas. Biblioteca 27 y calendario 28 pasaron fixtures PostgreSQL con ROLLBACK; se corrigió `tasks.created_at` del fixture y se añadió comprobación de columnas obligatorias. Se verificaron cero cuentas sintéticas, cero alumnos y una cuenta escolar administradora activa.
- 363 pruebas unitarias, ESLint, Next local, Sites local, build remoto y 262 smoke D1 aislados pasaron. Registros finales `/tmp/school-{unit,lint,next,sites,smoke,vercel}-release-final-ui-20261008.log`.
- 17 comprobaciones HTTP públicas pasaron: páginas públicas, datos privados sin sesión, GET405 y POST409 de los dos endpoints bootstrap legacy. El primer ensayo del release27/28 esperaba por error409 para GET; se conservó esa evidencia y se corrigió el método/contrato, sin modificar esos endpoints.
- Sesión real de `elmundodelosnilos10@gmail.com` comprobada en Mi cuenta y Superadministración; la consulta del estado de BD pasó. Lecturas de las 18 secciones del portal, búsqueda de biblioteca, filtros/agenda de calendario y centro de avisos comprobados con la base vacía. Comunicación de administración conserva horarios y explica el chat reservado a docentes/familias, sin consultas prohibidas ni errores falsos.
- Consulta de logs de nivel error del despliegue final, ventana10 minutos: “No logs found”. Es una consulta acotada; no acredita ausencia total de fallos ni monitoreo integral. Registro `/tmp/school-vercel-error-scan-final-ui-20261008.log`.
- Cinco pantallas autenticadas (Biblioteca, Calendario, Asistencia, Cuentas y Grupos) revisadas en viewport nominal390×844, ancho útil375 y scrollWidth375. Es emulación; no prueba teléfono físico ni red móvil lenta.

Evidencias sin credenciales: `outputs/vercel-release-final-ui-20261008.json`, `outputs/vercel-public-http-final-ui-20261008.json`, `outputs/supabase-library-calendar-release-20261008.json` y capturas indicadas en el manifiesto. La lectura de pantallas vacías no acredita operaciones CRUD completas, invitaciones, aislamiento HTTP entre familias ni carga/descarga de objetos reales. La biblioteca y el calendario sí tienen fixtures PostgreSQL reversibles por roles. Las notificaciones consultan periódicamente, sin WebSocket/push.

## Producción

Hosting real Next.js en https://el-mundo-de-los-ninos-portal.vercel.app. Auth, datos y almacenamiento privado: proyecto escolar Supabase `gzojyxrxamydrqcxljdg`. Sin redirección proxy al sitio Sites.

Se activó la cuenta escolar como superadmin con aprobación específica y auditoría bootstrap. La clave de servidor existente se guardó como Sensitive (Production, Preview); configuración comprobada sin imprimir su valor. Supabase Site URL y callback `/restablecer` exacto configurados.

## PostgreSQL real

Fixtures ejecutados con datos ficticios dentro de BEGIN/ROLLBACK, sin dejarlos en producción:

- Chat: historial, mensajes no leídos, aislamiento, metadatos y auditoría.
- Horarios: límites, zona CDMX, cambios auditados, trigger de mensajes y rechazo ante configuración corrupta.
- Seguimiento/actividades: vínculos, observaciones privadas, respuestas por etapa, dibujo, auditoría.
- Dashboard: conteos sintéticos autorizados por rol; aviso legal público y rechazo anónimo al dashboard.
- Académico: biblioteca, tareas, entregas, revisiones, calendario, Meet, comunicados, avisos y atomicidad. Se corrigió alias `profiles.id` en notificaciones de entregas.
- Matrículas/asistencia: grupos, ciclos, vínculos, corrección diaria, justificaciones, informes, baja lógica y reactivación.
- Cuentas: provisión, recibo de invitación, permisos, bloqueo, cuarentena y auditoría.
- Operaciones: feed de auditoría, orden, límite, DTO, RLS y estado de BD superadmin.
- Privacidad: evidencia propia, versión aprobada del aviso, consentimientos, solicitudes, transición, permisos, notificaciones y auditoría.

Después de los primeros fixtures se comprobaron cero cuentas `@example.test`, cero menores y una cuenta escolar activa. Migraciones10–24 instaladas:20 versiones; después25–26:22 versiones, incluyendo las cuatro bases. Los resultados PASS de fixtures no equivalen a recorridos HTTP completos del hosting.

## Pruebas del primer despliegue (21:42 CDMX)

- 278 pruebas unitarias pasaron con fuentes finales; registro `/tmp/school-unit-release-final-20261008.log`.
- Build Sites final pasó. Smoke aislado nuevo:258 verificaciones PASS en `/tmp/school-smoke-release-retry-20261008.log`. Primer intento falló al check25 por reinicio del Worker durante POST (503 Wrangler), conservado en `/tmp/school-smoke-release-final-20261008.log`; no se reintentó ese POST. El nuevo intento partió de otro entorno desechable, sin escrituras concurrentes. Trigger preciso del reinicio no confirmado.
- Build Next final local pasó con chequeo TypeScript y rutas/API completas: `/tmp/school-next-release-final-20261008.log`. Nuevo despliegue final READY en producción: `dpl_8g4Q2BeNPdgNrLWhrM9DXcBz9xcy`, URL única https://el-mundo-de-los-ninos-portal-ibm3zwvl7-pandito.vercel.app y alias https://el-mundo-de-los-ninos-portal.vercel.app. Build remoto Next completo pasó, secreto servidor presente. Fuente de trabajo sin commit nuevo; no se publicaron secretos.
- 12 controles HTTP públicos reales del alias pasaron: páginas públicas200, datos protegidos401, bootstrap legacy409. Evidencia `outputs/vercel-public-http-20261008.json`. No equivalen al recorrido autenticado pendiente.
- Presentación pública revisada en viewport móvil nominal390×844: ancho útil375, scrollWidth375, sin desbordamiento horizontal. Captura `outputs/portal-vercel-mobile-20261008.jpg`. Esto no verifica todavía las pantallas autenticadas móviles.

## Pendientes de operación

- Sesión escolar real y acceso administrativo comprobados; la contraseña nueva no se pidió, leyó ni registró. Faltan recorridos de docentes/familias e invitaciones reales.
- Scanner privado sin configurar: uploads bloqueados por diseño. No desactivar este control para una presentación.
- SMTP de Supabase para invitaciones fuera de destinatarios autorizados y mayor volumen: no verificado.
- Respaldo cifrado/restauración del proyecto real: pendiente. El intento anterior recibió403 en profiles; la migración29 de solo lectura para service_role sigue sin aplicar, pendiente de aprobación específica. La herramienta no incluye identidades completas, contraseñas ni sesiones Auth. Ver `docs/respaldo-supabase.md`.
- Meet funciona mediante enlaces autorizados por grupo, sin afirmar grabación o participación automática. Grabaciones deshabilitadas.
- La escuela debe proporcionar/revisar su aviso legal y consentimientos aplicables antes de usar información real de menores.
