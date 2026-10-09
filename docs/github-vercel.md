# Repositorio privado y Vercel

Fecha: 8 de octubre de 2026.

## Código publicado

Repositorio privado: https://github.com/elmundodelosnilos10-droid/el-mundo-de-los-ninos-portal

Se verificaron 472 archivos remotos y el commit inicial `9e925d2c236b2994132c37fd666894620c23437c`. Incluye código, logo, migraciones, pruebas y documentación. No incluye configuración local con secretos, respaldos, capturas, directorios temporales ni el historial local anterior. El historial original se conserva en el checkout local.

## Hosting actual

https://el-mundo-de-los-ninos-portal.vercel.app sigue siendo la aplicación publicada. Supabase continúa como servicio de cuentas y datos.

La conexión automática del repositorio al proyecto Vercel aún no está completada. `vercel git connect` devolvió `github_login_connection_required`: primero se requiere vincular la cuenta GitHub escolar al usuario Vercel que tiene acceso al proyecto. No se cambiaron permisos ni conexiones de acceso de Vercel durante ese intento.

Al configurar la integración, limitar el acceso de la aplicación Vercel al repositorio escolar. Mantener las claves de servidor fuera de Git, conservar la protección de forks y comprobar el build y las rutas privadas antes de promover una nueva versión.

## Checkout de publicación

La primera subida se preparó en un checkout independiente `work/github-publication`. El checkout original conserva el trabajo y su historial. Las modificaciones siguientes deben sincronizarse deliberadamente, revisar los archivos elegidos y publicarse como nuevos commits; no reemplazar ni forzar el historial remoto.
