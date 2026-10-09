# Repositorio privado y Vercel

Fecha: 8 de octubre de 2026.

## Código publicado

Repositorio privado: https://github.com/elmundodelosnilos10-droid/el-mundo-de-los-ninos-portal

Se verificaron 472 archivos remotos y el commit inicial `9e925d2c236b2994132c37fd666894620c23437c`. Incluye código, logo, migraciones, pruebas y documentación. No incluye configuración local con secretos, respaldos, capturas, directorios temporales ni el historial local anterior. El historial original se conserva en el checkout local.

## Hosting actual

https://el-mundo-de-los-ninos-portal.vercel.app sigue siendo la aplicación publicada. Supabase continúa como servicio de cuentas y datos.

El usuario decidió conservar el hosting en la cuenta Vercel actual y continuar terminando la plataforma. No se transfirió el proyecto. El registro con el correo escolar llegó al requisito de verificación telefónica; esa verificación quedó pendiente y no es necesaria para continuar trabajando en el hosting existente.

La conexión automática del repositorio al proyecto Vercel aún no está completada. `vercel git connect` devolvió `github_login_connection_required`: primero se requiere vincular la cuenta GitHub escolar al usuario Vercel que tiene acceso al proyecto. No se cambiaron permisos ni conexiones de acceso de Vercel durante ese intento.

Al configurar la integración, limitar el acceso de la aplicación Vercel al repositorio escolar. Mantener las claves de servidor fuera de Git, conservar la protección de forks y comprobar el build y las rutas privadas antes de promover una nueva versión.

## Checkout de publicación

La primera subida se preparó en un checkout independiente `work/github-publication`. El checkout original conserva el trabajo y su historial. Las modificaciones siguientes deben sincronizarse deliberadamente, revisar los archivos elegidos y publicarse como nuevos commits; no reemplazar ni forzar el historial remoto.

## Actualización del 9 de octubre de 2026

Esta actualización del código incorpora el diseño adaptable y las correcciones verificadas con 538 pruebas: guardado de actividades, salida de sesión, foco de avisos, bloqueo de grabaciones y respuestas de privacidad. Incluye los runners de aceptación aislada HTTP, Realtime y respaldo/restauración, junto con documentación que diferencia las pruebas locales de lo todavía pendiente en producción. El corte se sincroniza deliberadamente al checkout de publicación y se comprueba por hashes antes de commit/push; no se incluye el historial original, secretos, archivos temporales, respaldos ni capturas. La evidencia del push y del árbol remoto se conserva localmente en `outputs/github-publication-remote-final-20261009.json`.

## Fuente del release de estabilidad

El commit `fadddc3e0b35b4413fa73cf948668d1547144c24` incluye 538 blobs auditados, con pantallas de recuperación/carga/404, registro mínimo de errores, acceso sin lecturas repetidas e historial de seguimiento paginado. El árbol remoto privado se comparó con el snapshot por hashes; la historia original permanece intacta. El release Vercel `dpl_8YhGFfsnnz5MH1GpMN7v2cVFvJtT` proviene de ese corte de código. Esta actualización documental se publica por separado; no se rehace ni altera aquel build. Suite general 656 PASS y 32 controles HTTP en cada destino. Evidencia privada: `outputs/github-publication-remote-readiness-20261009.json` y `outputs/vercel-release-readiness-20261009.json`.

## Publicación vigente: acceso y directorios · 9 de octubre de 2026

Vercel READY `dpl_AmZ38XZYKW78An34G9Hn3pTpizVn`, promovido al dominio habitual desde el mismo build comprobado. Fuente escolar privada `52b7fb3813357c23b246831b4f7b0c248f019a14`: 546 archivos comparados por SHA-256 con la fuente auditada. La historia GitHub se conserva; los commits documentales posteriores no cambian este build.

Pasaron **745 pruebas**, lint, TypeScript y las compilaciones Next/Sites; **32 comprobaciones HTTP** antes de promover y otras **32** en el dominio principal. Las confirmaciones de alta/edición se conservan cuando falla la consulta posterior; una denegación 401/403 retira el directorio privado. Se controlan el doble envío y las respuestas tardías. Los resultados inciertos no se reenvían automáticamente; no se afirma idempotencia de servidor para toda pérdida de respuesta.

Con la sesión escolar existente se observaron administración activa, una cuenta superadmin, cero alumnos y conexión de avisos. Escape cerró el panel y devolvió el foco a Avisos. No se cambiaron contraseñas, permisos, matrícula ni datos de producción. **No se comprobó un nuevo ingreso por contraseña**: la contraseña privada actual del usuario se desconoce. Tampoco se probaron altas reales ni recepción de invitaciones en esta revisión publicada.

La recuperación escolar preservada pasó además la comprobación de metadatos públicos capturados y de las 60 colecciones antes/después, sin importar filas ni ampliar permisos; el destino local volvió a quedar detenido. No acredita configuración administrada completa ni contraseña recuperada.

Evidencia local privada: `outputs/vercel-release-admin-stability-20261009.json`, `outputs/portal-production-admin-stability-ui-20261009.json`, `outputs/github-publication-admin-stability-verified-20261009.json`, `outputs/production-backup-metadata-preflight-20261009.json` y su informe de parada. Captura: `outputs/portal-production-admin-stability-release-20261009.jpg`.

Siguen pendientes el analizador privado publicado, recepción de correos Auth, aceptación docente/familiar, Meet, aprobación escolar de privacidad/retención y custodia externa del respaldo. No se habilitaron proveedores ni se cambiaron planes.
