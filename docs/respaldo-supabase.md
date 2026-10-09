# Respaldo y restauración de ensayo — Supabase escolar

Actualizado: 8 de octubre de 2026. Fuente del procedimiento: `scripts/supabase-school-backup.mjs` y `scripts/backup-crypto.mjs`. Esta guía describe la herramienta actual y sus límites; no acredita un respaldo operativo ni un ensayo de restauración real exitosos.

## Estado comprobado

El hosting publicado es [Vercel](https://el-mundo-de-los-ninos-portal.vercel.app), despliegue READY `dpl_xkMxs8YubpLYXSrSADubeUpUXVXC`, con Supabase escolar como Auth/datos/Storage. Hay 24 migraciones instaladas de las versiones base 08 a la 28. Biblioteca 27 y calendario 28 pasaron pruebas PostgreSQL con ROLLBACK; el despliegue integrado está publicado en Vercel y registrado en la guía de hosting. Ver [Hosting Vercel](hosting-vercel.md), [Verificación Vercel/Supabase](verificacion-vercel-supabase-20261008.md) y [Estado de requisitos](estado-requisitos.md).

El intento real de respaldo se detuvo por **HTTP403 al leer `profiles`**. Falta confirmar permisos de lectura `service_role` sobre las **33 tablas escolares**. Una clave configurada en Vercel no acredita esos permisos. Las cargas de archivos también siguen bloqueadas sin scanner real. No se debe presentar un directorio parcial de ese intento como una copia válida: la herramienta crea `manifest.enc` solo al completar la exportación y comprobar su estabilidad.

## Qué incluye y qué queda fuera

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

Debe resolverse y confirmarse el 403 de lectura antes de considerar operativa esta rutina. Elegir un momento sin escrituras/cargas y una carpeta nueva en una ubicación segura. Ejemplo de comando sin credenciales:

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

Después de un resultado exitoso, comprobar login con Auth restaurado, UUID/roles, aislamiento entre dos familias, vínculos y descargas reales en el ensayo. Registrar la verificación y sus límites. Un `verify` offline o una prueba con mocks no acredita que ese recorrido funcione. El respaldo/restauración de producción permanece pendiente hasta resolver permisos, comprobar el mecanismo Auth y completar ese ensayo.

## Relación con D1/R2 legacy

`backup:school`, Wrangler, `restore-d1` y `restore-r2` operan sobre el destino anterior de Sites/Cloudflare. No respaldan ni restauran este portal Vercel/Supabase. Se conservan documentados como procedimientos legacy en [Pruebas y operación](pruebas-y-operacion.md), únicamente para recursos anteriores identificados y autorizados.
