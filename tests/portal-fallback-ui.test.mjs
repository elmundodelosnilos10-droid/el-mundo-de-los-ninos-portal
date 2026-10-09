import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const css = new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) });
function load(file, dependencies) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInContext(code, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => name === 'react/jsx-runtime' ? jsxRuntime : dependencies[name] ?? assert.fail(`Unexpected dependency ${name}`), fetch: () => assert.fail('A public fallback must not fetch') }), { filename: file });
  return sandboxModule.exports;
}
const fallback = load('components/portal-fallback.tsx', { './portal-fallback.module.css': css });
const dependencies = { '@/components/portal-fallback': fallback };
const PageError = load('app/error.tsx', dependencies).default;
const GlobalError = load('app/global-error.tsx', dependencies).default;
const Loading = load('app/escuela/loading.tsx', dependencies).default;
const notFound = load('app/not-found.tsx', dependencies);
function elements(tree, type) {
  const found = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value.type === 'function') { walk(value.type(value.props)); return; }
    if (value.type === type) found.push(value);
    walk(value.props?.children);
  }
  walk(tree); return found;
}
function secretError() {
  return Object.defineProperties({}, Object.fromEntries(['message', 'digest', 'stack'].map(key => [key, { get() { assert.fail(`Fallback read private error.${key}`); } }])));
}

for (const [name, Component] of [['page', PageError], ['global', GlobalError]]) {
  test(`${name} error button performs only the explicit reset callback in the Vinext contract`, () => {
    let resets = 0;
    const tree = Component({ error: secretError(), reset: () => { resets++; } });
    assert.equal(resets, 0);
    const buttons = elements(tree, 'button'); assert.equal(buttons.length, 1);
    assert.equal(buttons[0].props.type, 'button'); assert.equal(buttons[0].props.children, 'Volver a intentar');
    buttons[0].props.onClick(); assert.equal(resets, 1);
    assert.equal(elements(tree, 'a')[0].props.href, '/');
  });
  test(`${name} prefers the Next retry callback when available, without automatic retry or reset`, () => {
    let retries = 0; let resets = 0;
    const tree = Component({ error: secretError(), reset: () => { resets++; }, retry: () => { retries++; } });
    assert.equal(retries, 0); assert.equal(resets, 0);
    elements(tree, 'button')[0].props.onClick(); assert.equal(retries, 1); assert.equal(resets, 0);
  });
  test(`${name} error renders a generic accessible view and original logo without error details or school data`, () => {
    const error = Object.assign(Error('SYNTHETIC_PRIVATE_STUDENT_ACCOUNT_ROUTE'), { digest: 'SYNTHETIC_PRIVATE_DIGEST', stack: 'SYNTHETIC_PRIVATE_STACK' });
    const html = renderToStaticMarkup(createElement(Component, { error, reset() {} }));
    assert.doesNotMatch(html, /SYNTHETIC_PRIVATE|undefined|null|exception|Error:/);
    assert.match(html, /No pudimos cargar esta página/); assert.match(html, /role="alert"/);
    assert.match(html, /aria-labelledby="portal-fallback-title"/); assert.match(html, /<h1[^>]*id="portal-fallback-title"/);
    assert.match(html, /src="\/logo-escuela\.jpg"/); assert.match(html, /alt="Logo de El Mundo de los Niños"/);
    assert.match(html, /href="\/"/); assert.match(html, /consulta su estado antes de volver a enviarlo/);
    assert.equal(elements(Component({ error, reset() {} }), 'main').length, 1);
  });
}

test('global fallback carries its own Spanish html/body/title/viewport independent of root layout', () => {
  const tree = GlobalError({ error: secretError(), reset() {} });
  assert.equal(tree.type, 'html'); assert.equal(tree.props.lang, 'es-MX');
  assert.equal(elements(tree, 'body').length, 1); assert.equal(elements(tree, 'body')[0].props.style.margin, 0);
  assert.equal(elements(tree, 'title').length, 1);
  assert.equal(elements(tree, 'meta')[0].props.name, 'viewport');
  const html = renderToStaticMarkup(tree);
  assert.match(html, /^<html lang="es-MX">/); assert.match(html, /<head>/); assert.match(html, /<body/);
});

test('public school loading announces a truthful status and provides home navigation without a retry or fake progress', () => {
  assert.equal(existsSync(new URL('../app/loading.tsx', import.meta.url)), false, 'No root loader may start private/Auth streaming');
  assert.equal(existsSync(new URL('../app/escuela/loading.tsx', import.meta.url)), true);
  const tree = Loading(); const html = renderToStaticMarkup(tree);
  assert.match(html, /Estamos preparando tu página/); assert.match(html, /role="status" aria-live="polite"/);
  assert.equal(elements(tree, 'button').length, 0); assert.equal(elements(tree, 'a')[0].props.href, '/');
  assert.doesNotMatch(html, /progressbar|aria-valuenow|\d+%|role="alert"/);
});

test('404 reveals no requested URL, account or record and carries noindex metadata', () => {
  const tree = notFound.default(); const html = renderToStaticMarkup(tree);
  assert.match(html, /Esta página no está disponible/); assert.match(html, /Volvamos al inicio/);
  assert.equal(elements(tree, 'h1').length, 1); assert.equal(elements(tree, 'a')[0].props.href, '/');
  assert.equal(elements(tree, 'button').length, 0); assert.doesNotMatch(html, /role="alert"/);
  assert.equal(notFound.metadata.robots.index, false); assert.equal(notFound.metadata.robots.follow, false);
});

test('fallback dependencies remain public, styles are self-contained and touch/focus/reduced-motion rules exist', () => {
  const files = ['app/error.tsx', 'app/global-error.tsx', 'app/escuela/loading.tsx', 'app/not-found.tsx', 'components/portal-fallback.tsx'];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /PortalShell|actorFromRequest|getSchoolPageActor|next\/headers|usePathname|fetch\(|console\.|localStorage|navigator|error\.(message|digest|stack)/);
  }
  const cssSource = readFileSync(new URL('../components/portal-fallback.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(cssSource, /@import|url\(/); assert.match(cssSource, /font-family: system-ui/);
  assert.match(cssSource, /min-height: 44px/); assert.match(cssSource, /:focus-visible/); assert.match(cssSource, /prefers-reduced-motion: reduce/);
  assert.match(cssSource, /flex-wrap: wrap/); assert.match(cssSource, /width: min\(100%, 580px\)/);
});

test('installed framework contracts recognize the four conventions and optional retry compatibility', () => {
  const vinext = readFileSync(new URL('../node_modules/vinext/dist/routing/app-router.js', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../node_modules/vinext/dist/entries/app-rsc-manifest.d.ts', import.meta.url), 'utf8');
  const vinextBoundary = readFileSync(new URL('../node_modules/vinext/dist/shims/error-boundary.d.ts', import.meta.url), 'utf8');
  const nextBoundary = readFileSync(new URL('../node_modules/next/dist/client/components/error-boundary.d.ts', import.meta.url), 'utf8');
  assert.match(vinext, /app\/loading\.tsx/); assert.match(vinext, /app\/error\.tsx/); assert.match(vinext, /app\/not-found\.tsx/);
  assert.match(manifest, /globalErrorPath/); assert.match(vinextBoundary, /reset: \(\) => void/);
  assert.match(nextBoundary, /retry: \(\) => void/); assert.match(nextBoundary, /reset: \(\) => void/);
});
