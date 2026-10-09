# Chat en Supabase

La migración local `20261017000000_school_conversation_rpcs.sql` prepara contactos y conversaciones privadas, historial paginado, envío de mensajes con adjuntos privados, avisos internos y recibos de lectura. Las rutas usan Supabase solo cuando `SCHOOL_DATA_PROVIDER=supabase`; con el proveedor actual `d1`, continúa la implementación D1.

Las funciones derivan la identidad del JWT de Supabase. Solo permiten iniciar y consultar conversaciones con alumno, matrícula, docente y tutoría activos. Un mensaje, su fila de adjunto (cuando existe), la notificación y la auditoría se guardan en una única transacción de PostgreSQL. El cursor combina fecha y UUID, así no depende del `rowid` local de D1.

## Antes de habilitar

1. Crear un respaldo verificable y conservar D1 como fuente activa.
2. Aplicar primero esquema, perfiles/roles, funciones RLS, RPC de módulos previos y políticas de Storage en un proyecto Supabase de ensayo.
3. Importar perfiles, roles, alumnos, matrículas, docentes, grupos y tutores conservando UUID y relaciones activas.
4. Aplicar `20261017000000_school_conversation_rpcs.sql`.
5. Usar cuentas sintéticas de una docente asignada, otra no asignada y dos familias. Revisar contactos, conversaciones repetidas, aislamiento, historial con más de 50 mensajes, orden, adjuntos, notificaciones, lectura, auditoría y compensación si falla el guardado de metadatos.
6. Ejecutar la migración y las pruebas de aislamiento en PostgreSQL de ensayo antes de cambiar `SCHOOL_DATA_PROVIDER`.

## Comprobación PostgreSQL del 8 de octubre de 2026

Se ejecutaron las definiciones del chat y el escenario de `tests/supabase-conversation.integration.sql` en el editor SQL del proyecto escolar, dentro de una transacción terminada con `ROLLBACK`. El resultado fue `PASS`: contactos privados, apertura idempotente, paginación de 51 mensajes con fechas iguales, límite de recibos de lectura, notificaciones, auditoría, aislamiento de metadatos de adjuntos y rechazo de escrituras directas. Después se confirmó que quedaron cero usuarios y alumnos sintéticos y cero funciones del chat creadas por la prueba.

Esta prueba revierte también los cambios de esquema y permisos; la migración no está instalada de forma permanente y D1 continúa activo. No prueba una sesión HTTP de Supabase ni la carga/descarga real de bytes en Storage. Las demás migraciones pendientes no se ejecutaron en esta comprobación.

El chat revisa mensajes por sondeo periódico; no ofrece WebSocket ni notificaciones push. Los adjuntos nuevos requieren almacenamiento privado Supabase y el escáner de archivos operativo.
