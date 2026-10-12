# Aceptación de dirección, maestra y familia en navegador local

Ensayo realizado el 12 de octubre de 2026 con Chrome, Next.js y un destino
Native de Supabase restaurado exclusivamente con datos ficticios. No se
conectó con la escuela publicada ni se cambió una contraseña escolar.

## Recorridos observados

1. Dirección inicia sesión mediante el formulario normal y ve su panel.
2. Dirección registra un alumno ficticio; el listado cambia de dos a tres.
3. Dirección vincula un tutor; la relación permanece después de recargar.
4. El cierre de sesión espera la preparación del botón y regresa a Ingresar.
5. Una maestra asignada publica una tarea; permanece tras recargar y muestra
   la fecha del 14 de octubre a las 12:00 en Ciudad de México.
6. La familia ve el nuevo alumno vinculado y la tarea de su grupo. La entrega
   con archivos permanece deshabilitada porque este ensayo no tiene analizador.
7. La maestra publica un comunicado importante y recibe confirmación.
8. La familia recibe el comunicado, confirma su lectura y conserva «Visto»
   después de recargar.
9. La maestra guarda presente y retardo para dos alumnos ficticios. El retardo
   sigue seleccionado después de recargar.
10. La familia consulta el historial del alumno recién vinculado: muestra un
    retardo, su fecha y la fórmula del porcentaje de asistencia.
11. Los participantes cierran sus sesiones al terminar.

Las consultas directas de PostgreSQL comprobaron el nuevo alumno, su vínculo,
la autoría de la tarea y del comunicado, y la fecha UTC de la tarea
(`2026-10-14T18:00:00Z`). Las lecturas de navegador acreditan la representación
de los datos; no sustituyen la aceptación de los servicios publicados.

## Defecto encontrado y corregido

Al pulsar Cerrar sesión inmediatamente después de recargar el expediente,
el botón aún no tenía su controlador y no se produjo el POST. Se corrigió
la preparación inicial, el bloqueo síncrono de doble envío y las respuestas
después de desmontar. Siete pruebas específicas pasaron y el navegador
confirmó el botón inicialmente deshabilitado y el cierre posterior correcto.

Una espera de la prueba buscaba «Visto» como botón, pero la interfaz lo
representa como texto y retira el botón de lectura. Se corrigió el selector;
no se repitió el POST de lectura.

## Conservación y evidencia

El cierre del ensayo retiró únicamente las filas nuevas y las dos cuentas
ficticias creadas para esta prueba. Antes y después se compararon las claves
y valores originales: 33 tablas públicas, 69 filas, seis cuentas Auth y tres
objetos Storage. Se conservaron identidades y hashes de contraseña; solo
se admite el avance del timestamp de perfil de las familias gestionado por
Auth. El destino Native se detuvo sin borrar sus archivos de datos.

Evidencia privada, excluida del repositorio y del despliegue:

- `outputs/supabase-staff-browser-acceptance-20261009.json`: supervisor y
  conservación PASS. Su nombre procede de la preparación inicial del harness;
  sus fechas reales de inicio y fin son del 12 de octubre de 2026.
- `outputs/portal-local-staff-browser-attendance-20261012.jpg`.
- `outputs/portal-local-staff-browser-family-20261012.jpg`.
- `outputs/release-validation-staff-ui-stability-20261012.json`: 862 pruebas,
  lint, TypeScript y compilaciones Next/Sites aprobados.

## Límites

No se probaron en este recorrido la entrega/revisión de archivos, un nuevo
grupo o ciclo, el chat en navegador ni la entrega Realtime por HTTPS. Las
pruebas de componentes de chat y grupos son evidencia separada. Quedan
pendientes el analizador publicado, recepción de correos Auth, Meet,
dispositivos físicos, aprobación escolar de privacidad y custodia externa.

Nunca ejecutar este harness contra la base escolar publicada.
