import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as runtime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";

function load(sourcePath, dependencies = {}) {
  const sandboxModule = { exports: {} };
  const source = ts.transpileModule(readFileSync(new URL(sourcePath, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInContext(source, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected dependency: ${name}`) }), { filename: sourcePath });
  return sandboxModule.exports;
}
const catalog = load("../app/actividades/catalog.ts");
const { correctAnswers } = load("../app/actividades/answers.ts");
function renderActivity(id, { stage = "maternal", canPlay = true } = {}) {
  // Keep the real catalog and renderer; put the requested activity first only
  // to select its initial SSR state, without triggering network or school writes.
  const selectedCatalog = { ...catalog, interactiveActivities: [...catalog.interactiveActivities].sort((a, b) => Number(b.id === id) - Number(a.id === id)) };
  const { ActivityLibrary } = load("../app/actividades/activity-library.tsx", { react: React, "react/jsx-runtime": runtime, "./catalog": selectedCatalog });
  return renderToStaticMarkup(React.createElement(ActivityLibrary, { students: [{ id: "synthetic-student", name: "Alumno sintético", groupName: "Grupo sintético", stage }], canPlay }));
}

test("seed question renders an independent three-seed pot with equivalent accessible text", () => {
  const html = renderActivity("semillas-contar");
  const figure = /<figure class="activity-seed-stimulus">([\s\S]*?)<\/figure>/.exec(html)?.[1];
  assert.ok(figure);
  assert.equal((figure.match(/data-seed="true"/g) ?? []).length, 3);
  assert.match(figure, /role="img" aria-label="Una maceta con tres semillas"/);
  assert.match(figure, /<title>Una maceta con tres semillas<\/title>/);
  assert.match(figure, /<figcaption>Observa la maceta y cuenta sus semillas\.<\/figcaption>/);
  assert.ok(html.indexOf("activity-seed-stimulus") < html.indexOf("activity-options"));
  assert.equal(correctAnswers["semillas-contar"], "3");
  assert.match(html, /Dos semillas/);
  assert.match(html, /Tres semillas/);
  assert.match(html, /Cuatro semillas/);
});

test("seed stimulus preserves stage restriction and read-only consultation", () => {
  assert.doesNotMatch(renderActivity("semillas-contar", { stage: "lactantes" }), /activity-seed-stimulus/);
  const readOnly = renderActivity("semillas-contar", { canPlay: false });
  assert.match(readOnly, /activity-seed-stimulus/);
  const options = /<div class="activity-options">([\s\S]*?)<\/div>/.exec(readOnly)?.[1];
  assert.equal((options.match(/disabled=""/g) ?? []).length, 3);
  assert.match(readOnly, /la actividad se guarda desde la cuenta familiar/);
  assert.doesNotMatch(renderActivity("palabra-cat"), /activity-seed-stimulus/);
});

test("drawing palette uses Spanish color names, selected state and original saved color values", () => {
  const html = renderActivity("dibuja-huerto");
  const palette = /<div role="group" aria-label="Color del lápiz">([\s\S]*?)<\/div>/.exec(html)?.[1];
  assert.ok(palette);
  for (const color of ["verde", "amarillo", "coral", "azul", "morado", "gris oscuro"]) assert.ok(palette.includes(`aria-label="Elegir color ${color}"`));
  assert.equal((palette.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((palette.match(/aria-pressed="false"/g) ?? []).length, 5);
  assert.match(palette, /aria-label="Elegir color verde" aria-pressed="true"/);
  for (const value of ["#237345", "#ffb629", "#ed6b68", "#4285d4", "#8659ad", "#293c30"]) assert.ok(palette.includes(`background-color:${value}`));
  assert.doesNotMatch(palette, /aria-label="Elegir color #/);
});

test("activity selector exposes exactly one selected available challenge", () => {
  for (const stage of ["lactantes", "maternal", "prekinder", "preescolar"]) {
    const html = renderActivity("semillas-contar", { stage });
    const nav = /<nav class="activity-list" aria-label="Actividades disponibles">([\s\S]*?)<\/nav>/.exec(html)?.[1];
    assert.ok(nav);
    const count = catalog.interactiveActivities.filter(activity => activity.stages.includes(stage)).length;
    assert.equal((nav.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((nav.match(/aria-pressed="false"/g) ?? []).length, count - 1);
    assert.match(nav, /class="active" aria-pressed="true"/);
  }
});

test("palette CSS maintains44px touch targets and wrapping at narrow widths", () => {
  const css = postcss.parse(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"));
  let wrapping = false;
  let targetRules = 0;
  css.walkRules(rule => {
    if (rule.selector === ".activity-drawing-tools > div") {
      rule.walkDecls("flex-wrap", declaration => { if (declaration.value === "wrap") wrapping = true; });
    }
    if (rule.selector === ".activity-drawing-tools > div button") {
      targetRules++;
      for (const dimension of ["width", "height"]) {
        const declaration = rule.nodes.find(node => node.type === "decl" && node.prop === dimension);
        assert.equal(declaration?.value, "44px");
      }
    }
  });
  assert.ok(wrapping, "Palette must wrap instead of overflowing a320px viewport");
  assert.equal(targetRules, 2, "Base and mobile overrides must agree");
});
