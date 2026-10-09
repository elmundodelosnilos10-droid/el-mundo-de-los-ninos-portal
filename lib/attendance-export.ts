import { strToU8, zipSync } from "fflate";

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function buildAttendanceXlsx(rows: string[][]) {
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    const bold = rowIndex === 0 ? ' s="1"' : "";
    return `<c r="${reference}" t="inlineStr"${bold}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Asistencia" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const widths = [13, 22, 32, 22, 48].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:E${rows.length}"/></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  }, { level: 6 });
}

function windows1252(value: string) {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0) ?? 63;
    if (point >= 32 && point <= 126 || point >= 160 && point <= 255) bytes.push(point);
    else if (point === 0x20ac) bytes.push(0x80);
    else if (point === 0x201a) bytes.push(0x82);
    else if (point === 0x0192) bytes.push(0x83);
    else if (point === 0x201e) bytes.push(0x84);
    else if (point === 0x2026) bytes.push(0x85);
    else if (point === 0x2020) bytes.push(0x86);
    else if (point === 0x2021) bytes.push(0x87);
    else if (point === 0x02c6) bytes.push(0x88);
    else if (point === 0x2030) bytes.push(0x89);
    else if (point === 0x0160) bytes.push(0x8a);
    else if (point === 0x2039) bytes.push(0x8b);
    else if (point === 0x0152) bytes.push(0x8c);
    else if (point === 0x017d) bytes.push(0x8e);
    else if (point === 0x2018) bytes.push(0x91);
    else if (point === 0x2019) bytes.push(0x92);
    else if (point === 0x201c) bytes.push(0x93);
    else if (point === 0x201d) bytes.push(0x94);
    else if (point === 0x2022) bytes.push(0x95);
    else if (point === 0x2013) bytes.push(0x96);
    else if (point === 0x2014) bytes.push(0x97);
    else if (point === 0x02dc) bytes.push(0x98);
    else if (point === 0x2122) bytes.push(0x99);
    else if (point === 0x0161) bytes.push(0x9a);
    else if (point === 0x203a) bytes.push(0x9b);
    else if (point === 0x0153) bytes.push(0x9c);
    else if (point === 0x017e) bytes.push(0x9e);
    else if (point === 0x0178) bytes.push(0x9f);
    else bytes.push(63);
  }
  return bytes;
}

function pdfHex(value: string) {
  return windows1252(value).map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function pdfText(x: number, y: number, size: number, value: string) {
  return `BT /F1 ${size} Tf ${x} ${y} Td <${pdfHex(value)}> Tj ET\n`;
}

// Standard Helvetica / WinAnsi glyph advances, in thousandths of a point.
// Keep layout measurements aligned with the PDF's unembedded base font.
const HELVETICA_WIDTHS = [
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 350,
  556, 350, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 350, 611, 350,
  350, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 350, 500, 667,
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

function pdfValue(value: string) {
  // Canonically decomposed Spanish accents can be represented in WinAnsi too.
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replaceAll("\t", "    ");
}

function textWidth(value: string, size: number) {
  return windows1252(value).reduce((width, byte) => width + HELVETICA_WIDTHS[byte], 0) * size / 1000;
}

function wrapPdfText(value: string, width: number, size: number) {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const characters = Array.from(paragraph);
    if (!characters.length) { lines.push(""); continue; }
    let start = 0;
    while (start < characters.length) {
      let end = start;
      let advance = 0;
      let breakAt = -1;
      while (end < characters.length) {
        const next = textWidth(characters[end], size);
        if (advance + next > width && end > start) break;
        advance += next;
        end++;
        // Include spaces in the preceding line, retaining all source characters.
        if (characters[end - 1] === " ") breakAt = end;
      }
      if (end < characters.length && breakAt > start) end = breakAt;
      lines.push(characters.slice(start, end).join(""));
      start = end;
    }
  }
  return lines;
}

export function buildAttendancePdf(group: string, from: string, to: string, rows: string[][]) {
  const data = rows.slice(1).map(row => Array.from({ length: 5 }, (_, index) => pdfValue(row[index] ?? "")));
  const metadata = [pdfValue(`Periodo: ${from} a ${to}`), pdfValue(`Grupo seleccionado: ${group}`)];
  const hasUnsupportedCharacters = [...metadata, ...data.flat()].some(value =>
    Array.from(value).some(character => character !== "\n" && character !== "?" && windows1252(character)[0] === 63));
  const columns = [
    { label: "Fecha", x: 36, width: 70 },
    { label: "Grupo", x: 106, width: 110 },
    { label: "Alumno", x: 216, width: 185 },
    { label: "Estado", x: 401, width: 110 },
    { label: "Observación", x: 511, width: 245 },
  ];
  const fontSize = 8.5;
  const lineHeight = 11.5;
  const bottom = 72;
  const pages: string[] = [];
  let content = "";
  let cursor = 550;
  const startPage = () => {
    if (content) pages.push(content);
    content = pdfText(36, 570, 15, "Reporte de asistencia escolar");
    cursor = 550;
  };
  const drawTableHeading = () => {
    content += "0.95 g 36 " + (cursor - 23) + " 720 23 re f 0 g\n";
    for (const column of columns) content += pdfText(column.x + 5, cursor - 15, 9, column.label);
    content += `0.6 w 36 ${cursor - 23} m 756 ${cursor - 23} l S\n`;
    cursor -= 23;
  };
  const startTablePage = () => { startPage(); cursor -= 15; drawTableHeading(); };
  startPage();
  for (const value of metadata) {
    for (const line of wrapPdfText(value, 720, 9.5)) {
      if (cursor - 13 < bottom) startPage();
      content += pdfText(36, cursor - 10, 9.5, line);
      cursor -= 13;
    }
    cursor -= 4;
  }
  cursor -= 12;
  if (cursor - 23 - 22 < bottom) startTablePage();
  else drawTableHeading();
  if (!data.length) content += pdfText(41, cursor - 18, 9, "No hay registros de asistencia en este periodo.");
  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const cells = data[rowIndex].map((value, index) => wrapPdfText(value, columns[index].width - 10, fontSize));
    const lineCount = Math.max(...cells.map(cell => cell.length));
    const fullHeight = lineCount * lineHeight + 10;
    const freshPageSpace = 550 - 15 - 23 - bottom;
    // Keep ordinary rows together. Very tall rows consume as many pages as needed.
    if (fullHeight <= freshPageSpace && fullHeight > cursor - bottom) startTablePage();
    const fragmented = fullHeight > cursor - bottom;
    let offset = 0;
    while (offset < lineCount) {
      const padding = fragmented ? 22 : 10;
      let capacity = Math.floor((cursor - bottom - padding) / lineHeight);
      if (capacity < 1) { startTablePage(); capacity = Math.floor((cursor - bottom - padding) / lineHeight); }
      const count = Math.min(capacity, lineCount - offset);
      const height = count * lineHeight + padding;
      if (rowIndex % 2 === 1) content += `0.98 g 36 ${cursor - height} 720 ${height} re f 0 g\n`;
      if (fragmented) content += pdfText(41, cursor - 9, 7, `Registro ${rowIndex + 1} - ${offset ? "continuación" : "continúa en otra página"}`);
      const textTop = cursor - (fragmented ? 24 : 12);
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
        // Repeat complete, already-consumed identity cells on a continuation when
        // they fit. Smaller type distinguishes context from newly exported text.
        const repeatContext = offset > 0 && columnIndex < 4 && offset >= cells[columnIndex].length && cells[columnIndex].length <= count;
        for (let line = 0; line < count; line++) {
          const value = cells[columnIndex][repeatContext ? line : offset + line];
          if (value !== undefined && value !== "") content += pdfText(columns[columnIndex].x + 5, textTop - line * lineHeight, repeatContext ? 8 : fontSize, value);
        }
      }
      cursor -= height;
      content += `0.25 w 36 ${cursor} m 756 ${cursor} l S\n`;
      offset += count;
      if (offset < lineCount) startTablePage();
    }
  }
  pages.push(content);
  const objects: string[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"];
  const pageIds: number[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    let pageContent = pages[pageIndex] + pdfText(36, 24, 8, `Página ${pageIndex + 1} de ${pages.length}`);
    if (hasUnsupportedCharacters) pageContent += pdfText(36, 43, 7, "Aviso: caracteres fuera de Windows-1252 aparecen como ?. Excel/CSV conservan el texto original.");
    objects.push(`<< /Length ${pageContent.length} >>\nstream\n${pageContent}endstream`);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  // All non-ASCII text is hexadecimal, so string lengths equal encoded byte offsets.
  let pdf = "%PDF-1.4\n%School attendance report\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
