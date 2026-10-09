# Exportación de asistencia a PDF

## Contrato conservado

`buildAttendancePdf(group, from, to, rows)` devuelve `Uint8Array`. Cada fila contiene, en este orden: Fecha, Grupo, Alumno, Estado y Observación. La primera fila es el encabezado y no se exporta como un registro. El formato sigue siendo PDF 1.4, tamaño carta horizontal. XLSX y CSV conservan sus contratos y generadores existentes.

## Texto y páginas

Las cinco columnas se incluyen en el documento. El ajuste de líneas usa las métricas de Helvetica para WinAnsi, con márgenes de columna; ya no se recortan cadenas por cantidad de caracteres. Los nombres, estados, grupos y observaciones completos caben en tantas líneas como necesiten. Las palabras que no caben en una línea se dividen sin eliminar caracteres.

Las filas ordinarias se mantienen juntas. Una fila más alta que el espacio disponible se divide entre páginas, con el número de registro y una etiqueta de continuación. Cuando las celdas de identificación ya fueron consumidas y caben completas en el siguiente fragmento, se repiten con letra ligeramente menor como contexto; el resto del texto continúa una sola vez. Los encabezados de tabla se repiten en las páginas de registros. La selección de grupo y el periodo se incluyen completos al inicio del documento y pueden ocupar páginas adicionales si son excepcionalmente extensos. El pie indica el número de página y el total definitivo.

Los saltos CRLF/CR se normalizan a LF; se mantienen las líneas vacías. Cada tabulación se convierte en cuatro espacios. Los acentos descompuestos se normalizan a NFC, sin cambiar su significado.

## Límites de la fuente

Se conserva Helvetica estándar sin incrustar, con `/WinAnsiEncoding` (Windows-1252). Los acentos españoles y los caracteres de esa codificación se representan. Emojis, muchos alfabetos no latinos y controles que no pertenecen a ella se sustituyen por `?`. En ese caso, todas las páginas muestran un aviso explícito y recomiendan Excel/CSV para conservar el texto original. El PDF no ofrece cobertura Unicode completa, una fuente incrustada ni estructura etiquetada para lectores de pantalla. La sustitución visual de Helvetica depende del visor del PDF.

## Verificación reproducible

```sh
node --test tests/attendance-export-pdf.test.mjs tests/supabase-attendance-route.test.mjs
node tests/attendance-export-pdf-fixture.mjs
```

Las nueve pruebas específicas verifican contenido completo por columna, grupos distintos, saltos y líneas vacías, palabras muy largas, filas de varias páginas, filas ordinarias completas, reporte vacío, aviso de caracteres no representables, metadatos extensos, numeración, longitudes de streams y posiciones xref. Las nueve pruebas existentes de rutas continúan pasando.

El generador produce `output/pdf/asistencia-ejemplo-sintetico.pdf` con datos enteramente ficticios. Su última versión tiene tres páginas: se abrió con `pypdf` en modo estricto, se confirmó la presencia de 55 pasos de una observación y ocho registros finales, y se renderizaron e inspeccionaron visualmente todas las páginas mediante Poppler. Las 256 métricas de caracteres coinciden con las métricas Helvetica de ReportLab del runtime de revisión. No se emplearon datos de alumnos, credenciales, servicios externos, cambios SQL ni despliegues para estas comprobaciones.
