import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/attendance-export.ts", import.meta.url), "utf8");
const sandboxModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { module: sandboxModule, exports: sandboxModule.exports, require, TextEncoder, Uint8Array });
const { buildAttendancePdf } = sandboxModule.exports;
const widths = source.match(/const HELVETICA_WIDTHS = \[([\s\S]*?)\];/)[1].split(",").map(value => value.trim()).filter(Boolean).map(Number);
const headings = ["Fecha", "Grupo", "Alumno", "Estado", "Observación"];
const xColumns = [41, 111, 221, 406, 516];
const columnRights = [101, 211, 396, 506, 751];

function report(rows = [], group = "Todos los grupos") {
  const bytes = buildAttendancePdf(group, "2026-10-01", "2026-10-08", [headings, ...rows]);
  const pdf = new TextDecoder().decode(bytes);
  const pages = [...pdf.matchAll(/stream\n([\s\S]*?)endstream/g)].map(match => {
    const text = [...match[1].matchAll(/BT \/F1 ([\d.]+) Tf ([\d.]+) ([\d.]+) Td <([A-F\d]*)> Tj ET/g)].map(item => {
      const bytes = Uint8Array.from(item[4].match(/../g) ?? [], hex => Number.parseInt(hex, 16));
      return { size: Number(item[1]), x: Number(item[2]), y: Number(item[3]), bytes, value: new TextDecoder("windows-1252").decode(bytes) };
    });
    return { stream: match[1], text };
  });
  return { bytes, pdf, pages, body: pages.flatMap(page => page.text.filter(item => item.size === 8.5)) };
}
function cellText(result, column) { return result.body.filter(item => item.x === xColumns[column]).map(item => item.value).join(""); }
function assertFits(result) {
  for (const item of result.body) {
    const advance = [...item.bytes].reduce((sum, byte) => sum + widths[byte], 0) * item.size / 1000;
    assert.ok(item.x + advance <= columnRights[xColumns.indexOf(item.x)] + 0.001, `column overflow: ${item.value}`);
    assert.ok(item.y >= 81, `body in footer: ${item.y}`);
    assert.ok(item.y <= 511, `body overlaps page heading: ${item.y}`);
  }
  result.pages.forEach((page, index) => {
    assert.ok(page.text.some(item => item.value === `Página ${index + 1} de ${result.pages.length}`));
  });
}

test("PDF includes every row's own group, complete names, status and observations", () => {
  const rows = [
    ["2026-10-02", "Preescolar verde", "María Fernanda del Carmen Rodríguez Hernández", "justificada por enfermedad familiar", "La familia envió una nota detallada. Revisar la participación y acompañar las actividades pendientes al regresar a clases."],
    ["2026-10-03", "Preescolar azul", "José Ángel de los Santos Pérez", "presente", "Último fragmento de la observación: completo."],
  ];
  const result = report(rows);
  for (let column = 0; column < 5; column++) assert.equal(cellText(result, column), rows.map(row => row[column]).join(""));
  assert.ok(result.pages[0].text.some(item => item.value === "Grupo"));
  assertFits(result);
});

test("explicit CRLF, blank lines and tabs preserve readable line breaks", () => {
  const result = report([["2026-10-02", "Azul", "José", "presente", "Primera línea\r\n\r\nSegunda línea\tfinal"]]);
  const notes = result.body.filter(item => item.x === 516);
  assert.deepEqual(notes.map(item => item.value), ["Primera línea", "Segunda línea    final"]);
  assert.equal(notes[0].y - notes[1].y, 23);
  assertFits(result);
});

test("long words and all wide WinAnsi glyphs fit without cutting characters", () => {
  const word = "W".repeat(1800);
  const result = report([["2026-10-02", "Grupo con Œ € ™", "ÁÉÍÓÚ Ñ Ç Œ Š Ž ÿ", "estado".repeat(70), word]]);
  assert.equal(cellText(result, 1), "Grupo con Œ € ™");
  assert.equal(cellText(result, 2), "ÁÉÍÓÚ Ñ Ç Œ Š Ž ÿ");
  assert.equal(cellText(result, 3), "estado".repeat(70));
  assert.equal(cellText(result, 4), word);
  assert.ok(result.pages.length > 1);
  assertFits(result);
});

test("a very tall row continues across pages and the following row is retained", () => {
  const note = Array.from({ length: 110 }, (_, index) => `Línea ${index + 1}: dato sintético completo.`).join("\n");
  const rows = [["2026-10-02", "Grupo coral", "Ana Ejemplo", "presente", note], ["2026-10-03", "Grupo verde", "Luis Ejemplo", "retardo", "FIN DEL REPORTE"]];
  const result = report(rows);
  assert.equal(cellText(result, 4), note.replaceAll("\n", "") + "FIN DEL REPORTE");
  assert.equal(cellText(result, 1), "Grupo coralGrupo verde");
  assert.ok(result.pages.length >= 3);
  assert.ok(result.pages[0].text.some(item => item.value === "Registro 1 - continúa en otra página"));
  assert.ok(result.pages[1].text.some(item => item.value === "Registro 1 - continuación"));
  assert.ok(result.pages[1].text.some(item => item.value === "Grupo coral" && item.size === 8));
  assert.ok(result.pages[1].text.some(item => item.value === "Ana Ejemplo" && item.size === 8));
  for (const page of result.pages) for (const heading of headings) assert.ok(page.text.some(item => item.value === heading));
  assertFits(result);
});

test("ordinary rows remain together and every row appears once through pagination", () => {
  const rows = Array.from({ length: 85 }, (_, index) => ["2026-10-02", `Grupo ${index}`, `Nombre sintético ${index}`, "presente", `Observación ${index}: ` + "Una frase extensa con espacios para conservar todas sus palabras. ".repeat(3)]);
  const result = report(rows);
  assert.equal(cellText(result, 2), rows.map(row => row[2]).join(""));
  assert.equal(cellText(result, 4), rows.map(row => row[4]).join(""));
  assert.ok(result.pages.length > 5);
  assert.ok(!result.pages.some(page => page.text.some(item => item.value.startsWith("Registro "))));
  for (const row of rows) {
    const page = result.pages.find(page => page.text.some(item => item.value === row[2]));
    assert.ok(page?.text.some(item => item.value === row[1]));
  }
  assertFits(result);
});

test("empty report has one valid page and explicit empty-state text", () => {
  const result = report();
  assert.equal(result.pages.length, 1);
  assert.ok(result.pages[0].text.some(item => item.value === "No hay registros de asistencia en este periodo."));
  assertFits(result);
});

test("decomposed Spanish accents normalize and unsupported text has a visible warning", () => {
  const normal = report([["2026-10-02", "Azul", "Mari\u0301a Nin\u0303ez", "presente", "sí"]]);
  assert.equal(cellText(normal, 2), "María Niñez");
  assert.ok(!normal.pages[0].text.some(item => item.value.startsWith("Aviso:")));
  const result = report([["2026-10-02", "Azul", "Ana 😀 王", "presente", "¿Qué pasó?"]]);
  assert.equal(cellText(result, 2), "Ana ? ?");
  assert.equal(cellText(result, 4), "¿Qué pasó?");
  assert.ok(result.pages.every(page => page.text.some(item => item.value.startsWith("Aviso: caracteres fuera de Windows-1252"))));
  assertFits(result);
});

test("long selection metadata paginates without loss or colliding with table", () => {
  const group = "Grupo " + "W".repeat(12000);
  const result = report([["2026-10-02", "Azul", "Alumno final", "presente", "Final"]], group);
  const metadata = result.pages.flatMap(page => page.text.filter(item => item.size === 9.5)).map(item => item.value).join("");
  assert.equal(metadata, "Periodo: 2026-10-01 a 2026-10-08Grupo seleccionado: " + group);
  assert.equal(cellText(result, 2), "Alumno final");
  assertFits(result);
});

test("PDF stream lengths, xref positions and page references match actual bytes", () => {
  const result = report([["2026-10-02", "Árbol", "José Núñez", "presente", "Muy bien.\n".repeat(100)]]);
  assert.equal(result.bytes.length, result.pdf.length);
  for (const match of result.pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)) assert.equal(Number(match[1]), match[2].length);
  const xrefPosition = Number(result.pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(result.pdf.slice(xrefPosition, xrefPosition + 4), "xref");
  const xref = result.pdf.slice(xrefPosition).match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  const entries = xref[2].trimEnd().split("\n");
  assert.equal(entries.length, Number(xref[1]));
  entries.slice(1).forEach((entry, index) => assert.ok(result.pdf.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj\n`)));
  assert.equal(Number(result.pdf.match(/\/Count (\d+)/)[1]), result.pages.length);
});
