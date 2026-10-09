# Estado de requisitos — El Mundo de los Niños

**Actualizado:** 8 de octubre de 2026 · **Hosting:** Vercel/Next.js · **Backend seleccionado:** Supabase Auth, PostgreSQL/RLS y Storage privado. Sites/D1 se conserva como destino legacy.

Detalle vigente: `docs/verificacion-vercel-supabase-20261008.md` y `docs/hosting-vercel.md`. Las 25 migraciones (base y versiones 10–28 más Realtime 30) ya están instaladas en Supabase escolar. No se han cargado alumnos reales ni datos ficticios persistentes.

Este registro separa funciones implementadas en código, verificaciones sintéticas y requisitos todavía no demostrados en producción. Ninguna prueba con `example.test` equivale a validar cuentas, datos o políticas del proyecto escolar.

## Requisitos 1–20

| # | Requisito | Estado comprobado | Falta para darlo por terminado |
|---|---|---|---|
| 1 | Conservar proyecto, logo y colores | Hecho en el código actual; se usa `public/logo-escuela.jpg` y la identidad verde/amarilla. | Revisión visual final con la escuela. |
| 2 | Experiencia clara, accesible y adaptable | Pestañas por secciones, menú móvil, estados de formulario, foco visible y movimiento reducido; las pantallas principales cargan en smoke. | Auditoría de accesibilidad y prueba en teléfono físico/conexión lenta. |
| 3 | Roles y permisos | Roles verificados por UUID, perfil activo y relaciones PostgreSQL/RLS; cuenta escolar superadmin activada con autorización. | Sesión escolar autenticada y acceso a administración general comprobados en el navegador; acceso infantil alumno no configurado; decidir su necesidad por etapa. |
| 4 | Paneles por rol | Dashboard Supabase por rol, conteos reales y aislamiento probado por SQL reversible. | Lectura del panel escolar comprobada con sesión real; faltan recorridos de docentes/familias y revisión con escuela. |
| 5 | Comunicación | Chat, comunicados, acuses, avisos, historial paginado y horarios en RPC instalados; pruebas PostgreSQL reversibles pasaron. | Recorrido HTTP autenticado y adjuntos reales tras configurar escáner. Conexión Supabase Realtime → SSE comprobada con la administradora; consulta periódica como respaldo. Entrega y aislamiento de eventos entre familias y push pendientes. La pantalla de administración conserva horarios y explica el acceso al chat sin mostrar errores de permisos esperados. |
| 6 | Clases virtuales | Se programa la sesión y se limita en el portal la visibilidad del enlace Meet al grupo. | Meet se crea manualmente; verificar admisión en Google; no hay registro automático de asistencia. Grabaciones apagadas. |
| 7 | Materiales y archivos | Biblioteca y archivos privados con validación, limpieza de metadatos, reemplazo/retiro auditado; RPC instalados y PostgreSQL probado. Nueve contratos de handlers pasan sin D1. | Escáner privado pendiente: cargas bloqueadas. Verificar upload/download real de Storage y restauración antes de uso escolar. |
| 8 | Tareas y actividades | Tareas, entregas, revisión y notificaciones PostgreSQL pasaron pruebas reversibles; migración instalada. Actividades por etapa con validación SQL. | Recorrido HTTP autenticado, carga de evidencia real y revisión pedagógica. |
| 9 | Calendario escolar | Calendario/Meet/comunicados instalados y probados en PostgreSQL; zona CDMX, filtros y vistas mensual/semanal/agenda. | Capturar eventos reales y verificar las salas de Meet por parte del organizador. |
| 10 | Asistencia digital | Asistencia, matrículas, correcciones, justificaciones y reportes pasaron fixture PostgreSQL reversible; migraciones instaladas. D1 también conserva pruebas. | Recorrido HTTP autenticado; confirmar política escolar de porcentajes y exportaciones reales. |
| 11 | Seguimiento infantil | Observaciones, progreso y logros con RLS/validación y auditoría pasaron pruebas PostgreSQL reversibles; sin diagnóstico automático. | Revisión pedagógica por etapa y recorrido familiar HTTP. |
| 12 | Notificaciones | Notificaciones internas atómicas probadas en PostgreSQL para tareas, eventos, clases, revisiones, mensajes y privacidad. | Lectura del centro de avisos comprobada con sesión real; correo de eventos y push pendientes. Supabase Auth sí tiene recuperación configurada, recepción sin confirmar. |
| 13 | Administración escolar | Cuentas, ciclos, grupos, alumnos, tutores, matrículas, auditoría y baja lógica portados a Supabase; RPC instalados y fixtures reversibles pasan. | Pruebas de invitaciones/altas desde navegador y revisión operativa con escuela. |
| 14 | Seguridad y protección de menores | Invitación solamente, JWT/roles/RLS, Storage privado, auditoría, privacidad/consentimientos y archivos bloqueados sin escáner. | Ingreso real, revisión legal escolar, scanner, SMTP, respaldo/restauración y pruebas productivas. No se afirma cumplimiento legal. |
| 15 | Arquitectura y tecnología | Vercel ejecuta Next.js y APIs Node; datos/Auth/Storage en Supabase. Se mantiene Vinext/Cloudflare/D1 para legacy, sin usar proxy al Site. | Servicios externos pendientes; acceso y persistencia deben verificarse por recorridos HTTP de producción. |
| 16 | Calidad y pruebas | 446 pruebas unitarias pasaron; PostgreSQL reversible de todos los módulos portados pasó; compilaciones Sites y Next pasaron. | 262 comprobaciones smoke D1 pasaron desde entorno desechable nuevo. El primer fallo por reinicio de Worker quedó registrado; no se reintentó automáticamente el POST. Recorridos HTTP y Storage real pendientes. |
| 17 | Rendimiento | Paginación del servidor, límites de carga, optimización/sanitización de imágenes y reintentos de red del chat. | Medir Core Web Vitals, teléfono real, conexión lenta y monitoreo sin datos personales. |
| 18 | Fases de implementación | Base escolar, académico, comunicación, privacidad y operaciones portados a Supabase; migraciones instaladas; Meet por enlaces manuales. | Completar scanner/SMTP, backup/restore, ingreso, revisión autenticada móvil y lanzamiento escolar. |
| 19 | Entregables y documentación | Código, 25 migraciones instaladas, variables de ejemplo, guías y manifiestos de fuentes sin credenciales; hosting real Vercel. | Registrar último despliegue y pruebas de servicios externos. Nunca incluir claves en documentación/Git. |
| 20 | Reglas críticas | No hay altas públicas; acceso a datos protegido; archivos fallan cerrados sin escáner; las grabaciones no se admiten; pruebas usan datos sintéticos. | Evitar operar con expedientes reales hasta cerrar los pendientes de producción descritos abajo. |

## Pruebas obligatorias 1–18

| # | Flujo | Resultado de evidencia disponible |
|---|---|---|
| 1 | Dirección registra alumno | Pasó en smoke local sintético. |
| 2 | Dirección vincula tutor | Pasó en smoke D1; el fixture de vinculación también pasó en PostgreSQL real con rollback. |
| 3 | Tutor entra y solo ve a sus hijos | Pasó para dos familias sintéticas en smoke D1; el aislamiento familiar RLS pasó en PostgreSQL reversible; falta recorrido de navegador. |
| 4 | Docente publica material | Pasó en smoke local; la carga real requiere configurar el escáner. |
| 5 | Familia descarga material autorizado | Pasó con objeto privado sintético y control de vínculo. |
| 6 | Docente crea tarea | Pasó en smoke local. |
| 7 | Tutor entrega actividad | Pasó en smoke local. |
| 8 | Docente revisa y comenta | Pasó en smoke local. |
| 9 | Docente registra asistencia | Pasó en smoke local sintético con D1; se añadieron rechazos de origen cruzado a cuatro mutaciones de asistencia. El fixture Supabase pasó en PostgreSQL real con rollback. |
| 10 | Familia consulta seguimiento | Pasó en smoke local con un alumno vinculado. |
| 11 | Docente publica comunicado | Pasó en smoke local. |
| 12 | Tutor recibe notificación | Pasó para aviso interno; correo/push no están configurados. |
| 13 | Dos usuarios autorizados intercambian mensajes | Pasó en smoke local; envío y recibos del chat también comprobados por SQL PostgreSQL reversible. Falta el recorrido HTTP Supabase; conexión Realtime/SSE escolar comprobada; falta entrega HTTP/eventos entre familias. |
| 14 | Acceso a otro alumno bloqueado | Pasó entre familias sintéticas en D1. RLS y RPC de conversaciones y metadatos de adjuntos bloquearon a otra familia en PostgreSQL; asistencia, académico, progreso, cuentas y privacidad también pasaron fixtures SQL; falta recorrido HTTP autenticado. |
| 15 | Respaldo y restauración | Pasó con D1/R2 locales simulados; no prueba los recursos reales del Site. |
| 16 | Móvil y red lenta | Parcial: hay emulación móvil y estilos responsivos; falta teléfono físico y red real lenta. |
| 17 | Acceso Meet solo autorizado | El portal mostró el enlace solo al grupo autorizado; no se verificó la sala/admisión real de Google Meet ni el reenvío del enlace. |
| 18 | Grabaciones sin autorización no disponibles | Grabación apagada y carga rechazada en smoke; falta la política final de consentimiento/retención y comprobar permisos del proveedor. |

## Pendientes que requieren operación escolar

1. Completar recorridos de altas e invitaciones con la escuela. La sesión escolar y la pantalla de superadministración ya se comprobaron en el navegador.
2. Configurar respaldo cifrado de las 33 tablas escolares y Storage y probar restauración en recursos de ensayo. La herramienta actual conserva referencias UUID de Auth, pero no exporta identidades completas, contraseñas ni sesiones; se requiere además una estrategia de recuperación de Supabase Auth. La lectura del servidor sobre las tablas sigue pendiente de autorización específica. Ver `docs/respaldo-supabase.md`. D1/R2 corresponde al destino legacy.
3. Verificar recorridos HTTP autenticados de los módulos Supabase ya instalados. No hay registros de alumnos en la nueva base. Si hubiera información escolar anterior, importarla únicamente desde un respaldo verificado con preflight; no crear datos de demostración en producción.
4. Revisar y aprobar responsable, aviso, consentimiento, retención y proceso de privacidad; no es una tarea que la plataforma pueda certificar por sí sola.
5. Configurar SMTP de Supabase y un escáner privado aprobado; probar un envío y una carga controlados antes de invitar a familias.
6. Si se necesita creación automática de Meet, preparar Google Workspace/credenciales y políticas del organizador. Las grabaciones permanecen deshabilitadas.
7. Probar desde un teléfono y una conexión móvil real; completar la revisión operativa y legal antes de usar expedientes de menores.

### Evidencia automatizada

```sh
node --experimental-strip-types --test tests/*.test.mjs
npm run test:smoke:isolated
npm run lint
npm run build
```

Compila antes del smoke. `test:smoke:isolated` crea variables aleatorias sintéticas, puerto libre, Worker y base D1 desechables; aplica las migraciones y elimina el entorno al terminar. No lee `.dev.vars` ni usa recursos de la escuela.
