# Respaldo y restauración de ensayo — Supabase escolar

Actualizado: 9 de octubre de 2026. La copia SQL del proyecto escolar está cifrada, verificada offline y sus datos se recuperaron en un destino Native separado. La comprobación de contraseña y recuperación de configuración de servicios sigue pendiente. Los ensayos sintéticos anteriores se conservan al final de esta guía.

## Estado comprobado

El hosting publicado es [Vercel](https://el-mundo-de-los-ninos-portal.vercel.app), despliegue READY `dpl_AmZ38XZYKW78An34G9Hn3pTpizVn`, con Supabase escolar como Auth/datos/Storage. Hay 25 versiones registradas: base 08 a 28 y publicación Realtime 30. El grant SELECT de SQL29 ya se autorizó y ejecutó sobre las 33 tablas; su versión todavía no se registra en el historial de migraciones. Biblioteca 27 y calendario 28 pasaron pruebas PostgreSQL con ROLLBACK. Ver [Hosting Vercel](hosting-vercel.md), [Verificación Vercel/Supabase](verificacion-vercel-supabase-20261008.md) y [Estado de requisitos](estado-requisitos.md).

El intento HTTP anterior se detuvo por **403 al leer `profiles`** y se conserva como fallo histórico. Ahora se verificó SELECT efectivo para `service_role` en las 33 tablas mediante SQL de solo lectura. La copia nueva se obtuvo mediante Export CSV del SQL Editor; no acredita que se haya repetido el export HTTP con una clave. Las cargas siguen bloqueadas sin scanner real. Los directorios parciales del intento anterior no son copias válidas.

## Comprobación actual del proyecto escolar · 9 de octubre de 2026

Por petición del usuario se priorizó el respaldo completo. Se comprobó acceso autenticado al dashboard correcto `gzojyxrxamydrqcxljdg`, organización escolar, plan Free y estado Healthy. La pantalla de Backups informa que el plan no incluye copias del proyecto; no se contrató ningún servicio ni plan.

La consulta previa de **solo lectura**, cuyo texto completo se verificó antes de ejecutar, confirmó **33 tablas del catálogo, 0 con SELECT para `service_role`, 0 alumnos, 1 cuenta Auth y 0 objetos en `school-files`**. En ese momento confirmó el permiso pendiente. SQL31 sigue ausente y el historial no registra SQL29. Evidencia histórica: `outputs/production-backup-preflight-20261009-current.json`.

El usuario aprobó el grant preparado mediante «Si Haslo». Tras comprobar de nuevo el texto exacto, se ejecutó una vez: `Success. No rows returned`. La consulta posterior confirmó **33 tablas / 33 legibles** para `service_role`; alumnos, Auth, objetos e historial conservaron sus conteos. No concede acceso a `anon` ni `authenticated` ni modifica RLS, contraseñas o datos escolares. Evidencia: `outputs/production-backup-postflight-20261009.json` y `outputs/portal-production-backup-permission-applied-20261009.jpg`. La captura anterior corresponde únicamente a la preparación.

Una única sentencia SELECT capturó las **33 tablas públicas y las 27 tablas Auth completas**, con columnas, restricciones, índices, triggers, políticas, ACL, funciones públicas, enums, secuencias e historial. Las filas se conservan como cadenas JSON originales para no redondear enteros de 64 bits. Captura: **09:17:16 UTC del 9 de octubre**, 3 filas públicas, 95 Auth, 1 usuario y 1 identidad, **0 alumnos y 0 objetos Storage**. Auth incluye su historial administrado y datos sensibles de acceso; no se imprime su contenido.

El CSV original y el manifiesto se cifraron con AES-256-GCM/scrypt y se verificaron dos veces offline, comparando el CSV byte por byte. Después se retiró el CSV en claro. La frase privada está separada del paquete. Evidencia: `outputs/production-backup-sql-encrypted-20261009.json`; el primer fallo del límite CSV de Python se conserva en `outputs/production-backup-sql-capture-20261009-attempt1.json` y se corrigió leyendo el mismo archivo, sin repetir la consulta.

Este formato es una **instantánea SQL del estado actual con Storage vacío**, no un `pg_dump` ni una copia de configuración de servicios, secretos, SMTP o proveedores. No exporta bytes Storage porque su ausencia se comprobó. Los datos de esta copia ya se restauraron; el inicio de sesión con la contraseña del usuario sigue pendiente. La copia está local; falta custodia externa, frecuencia y retención definidas por la escuela. Las herramientas Auth de ensayo anteriores conservan sus restricciones a datos sintéticos.

## Recuperación real de los datos escolares actuales

Un destino nuevo, identificado y vacío, recibió las 25 migraciones registradas, el SELECT29 y cuatro índices secundarios Auth capturados. Se comprobaron las 494 columnas con todas sus propiedades, restricciones, índices, versiones Auth82, políticas, RLS y permisos públicos. La función pública administrada `rls_auto_enable` se reconstruyó desde su definición; la copia no contiene el registro de su event trigger ni ACL de funciones Auth y no acredita su equivalencia.

La recuperación insertó **16 filas** en una transacción: 3 públicas y 13 Auth. Las 82 filas de migraciones Auth ya existían y se comprobaron exactas sin sobrescribirlas. **Las 60 colecciones de filas (33 públicas +27 Auth), 3 filas públicas/95 Auth, quedaron iguales en PostgreSQL**, incluidos UUID, hash de contraseña, correo, identidad y rol escolar superadmin activo. Todos los FK se comprobaron después de importar; los triggers de origen solo se suspendieron dentro de esa transacción y se restablecieron. Los 14 campos del bucket privado se recuperaron por separado, sin objetos.

La única secuencia se reinició transaccionalmente por encima del contador capturado para evitar colisiones. `pg_sequences` no captura `is_called`: el avance es conservador y no se afirma restauración exacta de ese indicador. El servicio Auth Native reconoció la cuenta mediante su API administrativa real; después se volvieron a comparar las 60 colecciones. La comprobación bajo rol `authenticated` y claims propios confirmó liderazgo escolar mediante RLS. **No se probó un login por contraseña**, ni aislamiento entre familias en esta copia sin alumnos; los ensayos sintéticos anteriores mantienen sus pruebas independientes.

Evidencia terminal: `outputs/production-backup-school-data-restore-20261009-final.json`. Los fallos anteriores se conservaron: límite CSV; formato de parámetros JSON, corregido con `text::jsonb`; nombre de catálogo FK, corregido a `confmatchtype`; ruta de lectura Auth, corregida a `/auth/v1/admin/users`. Los dos intentos fallidos anteriores a la importación definitiva conservaron Auth/perfiles vacíos mediante rollback; no se repitió la importación después del commit.

Límites del destino: Storage Native tiene dos tablas administradas adicionales y permisos más restrictivos en tres tablas; no se ampliaron para imitar al proveedor. Esto prueba recuperación de los datos escolares capturados, **no una réplica completa de la configuración administrada**. Las credenciales, SMTP, proyectos, configuración Vercel y secretos de proveedores requieren su procedimiento separado.

## Procedimiento del formato SQL escolar actual

El validador admite exclusivamente el catálogo escolar 33, Auth27 observado, cero alumnos y cero archivos. Cuando esos conteos o catálogos cambien, se debe revisar el procedimiento y exportar también los bytes privados; no omitir tablas para conseguir una validación.

Generar la consulta pública de lectura con `node scripts/supabase-school-sql-snapshot-query.mjs`, revisarla y ejecutarla en el SQL Editor del proyecto correcto. El generador no se conecta ni lee credenciales. Conserva catálogos reales para detectar tablas adicionales, filas como texto JSON y la salida completa `TEXT` para evitar redondeos al exportar. La variante generada tiene pruebas offline; la captura existente se ejecutó con la consulta original equivalente, no con una ejecución posterior del generador.

Exportar mediante **Export → Download CSV**. El archivo contiene datos de acceso privados: trasladarlo inmediatamente a una carpeta 0700 y fijar 0600. Guardar la frase de al menos 20 caracteres en otro archivo privado 0600, fuera del paquete y del repositorio.

```sh
node scripts/supabase-school-sql-snapshot.mjs archive "/custodia/snapshot.csv" "/respaldos/directorio-nuevo" "/custodia/frase.private"
node scripts/supabase-school-sql-snapshot.mjs verify "/respaldos/directorio-nuevo" "/custodia/frase.private" "/custodia/snapshot.csv"
```

`archive` verifica antes de devolver éxito. La segunda verificación compara con el original; retirarlo únicamente después de ese éxito. Sin el CSV original, `verify` sigue comprobando autenticidad, manifiesto, hashes, catálogos y conteos. Estos comandos no conectan a servicios ni restauran datos. Las pruebas de captura, consulta y recuperación usan datos sintéticos. El procedimiento HTTP siguiente usa otro formato y no verifica ni restaura este archivo SQL.

La recuperación SQL usa `scripts/supabase-school-sql-snapshot-restore-local.mjs`: no tiene CLI que acepte URLs libres. `openSchoolSnapshotLocalDatabase` exige recibo oficial Native fresco 0600, estado oficial propio, identidad y proyecto local permitidos, conexión loopback literal y exclusión de destinos previos. Después, `readSchoolSqlSnapshotArchive` verifica el cifrado y mantiene los datos en memoria; `restoreSchoolSnapshotRows` comprueba esquema, Auth82, destino vacío, bucket privado y paridad de los metadatos públicos capturados antes de escribir. Rechaza metadatos obligatorios ausentes y cambios de restricciones, índices, triggers, definiciones de funciones, políticas, ACL de tablas o enums públicos. Mantener `rawSnapshotJson` para conservar numéricos sin redondeo y borrarlo de memoria al terminar. Este recuperador está restringido a la copia actual sin alumnos/objetos y una cuenta; no ejecutarlo sobre producción ni reutilizar el destino ya restaurado para importar.

`preflightSchoolSnapshotMetadata` revisa esos metadatos dentro de una transacción **READ ONLY** y acepta el destino local ocupado, sin importar datos, ejecutar DDL ni ampliar permisos. El ensayo real en la copia escolar preservada pasó: 133 restricciones, 75 índices, 2 triggers públicos, 85 definiciones de funciones, 79 políticas, 33 ACL de tablas y ningún enum público. Las 60 colecciones/98 filas siguieron iguales al archivo capturado antes y después. Storage coincidió en sus 7 triggers y cero políticas capturadas; su catálogo ACL administrado de 10 tablas difiere de las 8 capturadas y se reporta como diferencia, sin cambiar permisos. Evidencia: `outputs/production-backup-metadata-preflight-20261009.json`; parada oficial con servicios y endpoints cerrados: `outputs/production-backup-metadata-preflight-stopped-20261009.json`.

Esta comprobación cubre los campos del formato v1; no acredita ACL de funciones, registros de event triggers, estado habilitado de triggers, configuración administrada, Auth/Realtime completos ni equivalencia de servicios. Las diferencias de Storage no se presentan como un rechazo de acceso familiar comprobado. No sustituye la prueba de contraseña ni la custodia externa pendientes.

## Qué incluye el formato HTTP y qué queda fuera

| Incluye el paquete cifrado | No incluye el paquete |
|---|---|
| Filas de las 33 tablas públicas del catálogo actual, incluidos perfiles, roles, registros escolares y `school_account_invitation_provisions` | Identidades completas de `auth.users`, hashes de contraseñas, sesiones, MFA ni credenciales Auth |
| Contenido de objetos del bucket privado `school-files`, rutas y metadatos registrados | Credenciales del proyecto, tokens, frase de cifrado o configuración de proveedores |
| Manifiesto con conteos, hashes y firma del catálogo de tablas/columnas/claves primarias | DDL de funciones, constraints y RLS; conservar por separado las migraciones y la versión del repositorio |

Perfiles y roles públicos sí se respaldan; contienen referencias al UUID Auth y correo escolar. Eso **no sustituye** una copia/restauración de Supabase Auth. Auth necesita el mecanismo de respaldo del proveedor y una recuperación que preserve los UUID originales; hay que comprobar su disponibilidad y ensayarla por separado. Este CLI no crea identidades ni cambia sus contraseñas.

El formato cifra tablas, objetos y manifiesto con AES-256-GCM y deriva la clave mediante scrypt. `backup-meta.json` contiene formato, versión, fecha y salt no secreto. La frase debe tener al menos 20 caracteres; guardarla en el almacén seguro de la escuela separado del paquete. La herramienta no incluye esa frase en el respaldo.

## Exportar una copia

Ejecutar desde la carpeta del proyecto con Node compatible y dependencias instaladas. La persona responsable carga las variables desde su almacén seguro, sin pegarlas en comandos/documentación/Git:

- `SUPABASE_URL`: proyecto **origen** escolar.
- `SUPABASE_SECRET_KEY`: secreto servidor autorizado para leer catálogo, tablas y Storage. No usar la clave publicable ni un token personal como sustituto.
- `SCHOOL_BACKUP_PASSPHRASE`: frase privada de cifrado.

El SELECT efectivo ya se comprobó; sigue faltando repetir y verificar esta rutina HTTP con la clave autorizada. Elegir un momento sin escrituras/cargas y una carpeta nueva en una ubicación segura. Ejemplo de comando sin credenciales:

```sh
npm run backup:supabase -- backup "/ruta-segura/escuela-2026-10-08"
```

La herramienta lee todas las tablas y Storage y vuelve a comparar el contenido para detectar cambios durante la copia. **No es una instantánea transaccional única entre PostgreSQL y Storage**; la doble lectura no sustituye una ventana sin modificaciones. Una carpeta existente debe estar vacía; una exportación fallida puede dejar archivos parciales y requiere otra carpeta para el siguiente intento.

Solo una exportación terminada, seguida de `verify`, puede registrarse como paquete íntegro. Guardar fecha, versión del código/migraciones, cantidades de tablas/filas/objetos y resultado, sin incluir contenido personal ni secretos. Mantener la copia cifrada separada del equipo de operación.

## Verificar offline

`verify` necesita la carpeta, el catálogo local del repositorio y `SCHOOL_BACKUP_PASSPHRASE`. **No necesita `SUPABASE_URL`, claves Supabase, conexión a la red ni acceso al proyecto**. Descifra en memoria y comprueba autenticidad, rutas, conteos, tamaños y SHA-256.

```sh
npm run backup:supabase -- verify "/ruta-segura/escuela-2026-10-08"
```

El resultado esperado es el resumen “Respaldo Supabase íntegro” con 33 tablas y sus cantidades. Un error de frase, archivo, hash, manifiesto o catálogo invalida el paquete; no continuar con restauración.

Para un paquete histórico de 32 tablas únicamente:

```sh
npm run backup:supabase -- verify "/ruta-segura/respaldo-historico" --legacy-school-schema
```

Ese modo solo admite `verify`; no prueba cobertura de `school_account_invitation_provisions` ni convierte la copia antigua en un respaldo completo del estado actual.

## Restauración exclusivamente en ensayo

Esta guía utiliza un proyecto de ensayo identificado y vacío. No elegir el proyecto escolar operativo como destino. La herramienta no cambia la configuración de Vercel ni hace un corte de producción.

Antes de ejecutar:

1. Preparar el esquema del destino con las migraciones correspondientes y conservar la misma versión del catálogo usado en el paquete. El CLI compara tablas/columnas/claves mediante la firma; no instala DDL ni verifica por sí solo toda la equivalencia de funciones/RLS.
2. Restablecer Auth mediante el mecanismo del proveedor para que **los mismos UUID originales y sus correos** ya existan. Crear invitaciones nuevas con otros UUID no satisface esta condición. La comprobación Auth del CLI es de lectura; no exporta ni recrea usuarios.
3. Las tablas públicas deben estar vacías, salvo perfiles que Auth haya creado con UUID incluidos en el respaldo. El CLI rechaza cualquier perfil fuera del paquete y datos en las demás tablas.
4. Usar un bucket privado `school-files` vacío para el ensayo. El CLI rechaza rutas coincidentes y no sobrescribe objetos; no exige por sí solo que todo el bucket esté vacío.
5. Cargar `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del **destino de ensayo**, y la frase de la copia, desde el entorno seguro. Revisar el proyecto elegido antes de ejecutar: el comando no incluye confirmación de project-ref.

La escritura requiere la opción explícita:

```sh
npm run backup:supabase -- restore "/ruta-segura/escuela-2026-10-08" --confirm-restore
```

El CLI valida el paquete, esquema, identidades, tablas y colisiones antes de copiar. Inserta siguiendo las dependencias y vuelve a verificar filas y contenido de objetos. Storage conserva contenido/ruta/metadatos enviados, pero Supabase asigna nuevos IDs y fechas de objeto.

La restauración abarca varias llamadas HTTP, **no una transacción global**. Ante un fallo intenta retirar lo escrito/subido y recuperar perfiles previos. Si informa limpieza incompleta o existe un resultado de red incierto, revisar el destino de ensayo antes de repetir; no asumir rollback total por una respuesta de error.

Después de un resultado exitoso, comprobar login con Auth restaurado, UUID/roles, aislamiento entre dos familias, vínculos y descargas reales en el ensayo. Registrar la verificación y sus límites. Un `verify` offline o una prueba con mocks no acredita que ese recorrido funcione. La copia SQL escolar actual tiene recuperación de datos comprobada arriba; login y configuración de servicios mantienen su aceptación pendiente.

## Relación con D1/R2 legacy

`backup:school`, Wrangler, `restore-d1` y `restore-r2` operan sobre el destino anterior de Sites/Cloudflare. No respaldan ni restauran este portal Vercel/Supabase. Se conservan documentados como procedimientos legacy en [Pruebas y operación](pruebas-y-operacion.md), únicamente para recursos anteriores identificados y autorizados.

## Ensayo real del catálogo opcional36 · 9 de octubre de 2026

SQL31 añade preferencias, suscripciones y cola privada; al instalarlo debe elegirse explícitamente el catálogo36 y detener realmente cualquier dispatcher antes de respaldar/restaurar. No usar un catálogo33 parcial. Instrucciones: [avisos externos](notificaciones-externas.md#respaldo-y-restauración).

En dos proyectos native nuevos separados, el ensayo registró **14 comprobaciones PASS** (`outputs/supabase-backup36-auth-local-20261009-attempt2.json`): respaldo cifrado/verificación offline y restauración de las 36 tablas/51 filas, complemento Auth real con tres usuarios/tres identidades, conservación de UUID/hashes/identidades y acceso Auth/RLS de dos familias. El snapshot contenía 6 trabajos pending, 1 claimed, 1 uncertain y 2 suppressed. Después de restaurar, el claimed vencido pasó a uncertain/lease_expired; los inciertos no volvieron a reclamarse ni pudieron reautorizarse. Solo se reclamaron los pendientes como ejercicio de base de datos; **no hubo dispatcher, envíos ni estados accepted inventados**.

Se comprobó la igualdad de todas las filas antes del ejercicio posterior de la cola/login. Storage estaba vacío; este ensayo36 no acredita bytes de objetos. El ensayo33 anterior conserva su prueba independiente de tres objetos privados. Ambos proyectos nuevos se detuvieron oficialmente, conservando cifrados y datos. Los dos stacks anteriores siguieron detenidos y se comparó la huella de todos sus archivos de datos, sin diferencias. El FAIL inicial de la guarda de protocoloTCP se conserva en el informe intento1 y ocurrió antes de arrancar o escribir. El runner privado se reforzó después para atribuir/detener únicamente su propio arranque; no se reejecutó el PASS.

Ese ensayo no aplicó SQL31 ni el permiso29 en producción. Posteriormente se autorizó/aplicó el SELECT33, se creó la copia SQL escolar cifrada y se comprobó su recuperación de datos arriba. SQL31 sigue ausente. Login, configuración de servicios y custodia externa conservan sus límites explícitos.
