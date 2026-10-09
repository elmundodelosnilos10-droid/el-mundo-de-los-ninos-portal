import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({ type, props });
const id = '00000000-0000-4000-8000-000000000001';
const publicKey = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
const defaultSettings = () => ({ capabilities: { email: true, webpush: true, publicVapidKey: publicKey }, preferences: [], subscriptions: [] });
function load(file, dependencies, globals = {}) {
  const sandboxModule = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInContext(code, vm.createContext({ module: sandboxModule, exports: sandboxModule.exports, require: name => dependencies[name] ?? assert.fail(`Unexpected dependency ${name}`), ...globals }), { filename: file });
  return sandboxModule.exports;
}
function elements(tree, type) {
  const found = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value.type === type) found.push(value);
    walk(value.props?.children);
  }
  walk(tree); return found;
}
const text = tree => !tree ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : '';
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness({ secure = true, supported = true, existing = false, permission = 'granted' } = {}) {
  const state = { hooks: [], cursor: 0, effects: [], calls: [], browserCalls: [], settings: defaultSettings(), existing, permission, requestOverride: null };
  const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-only', keys: { p256dh: publicKey, auth: Buffer.alloc(16, 1).toString('base64url') } }), unsubscribe: async () => { state.browserCalls.push('unsubscribe'); state.existing = false; return true; } };
  const registration = { pushManager: { getSubscription: async () => { state.browserCalls.push('getSubscription'); return state.existing ? subscription : null; }, subscribe: async options => { state.browserCalls.push({ subscribe: options }); state.existing = true; return subscription; } } };
  const worker = { getRegistration: async () => { state.browserCalls.push('getRegistration'); return state.registrationOverride ? await state.registrationOverride(registration) : registration; }, register: async (...args) => { state.browserCalls.push({ register: args }); return registration; }, ready: Promise.resolve(registration) };
  const { NotificationPreferences } = load('app/mi-cuenta/notification-preferences.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './notification-preferences.module.css': new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) }),
    react: {
      useState: initial => { const index = state.cursor++; state.hooks[index] ??= { value: initial }; return [state.hooks[index].value, next => { state.hooks[index].value = typeof next === 'function' ? next(state.hooks[index].value) : next; }]; },
      useRef: initial => { const index = state.cursor++; state.hooks[index] ??= { current: initial }; return state.hooks[index]; },
      useEffect: effect => { const index = state.cursor++; if (!state.hooks[index]) { state.hooks[index] = {}; state.effects.push(effect); } },
    },
  }, {
    fetch: async (url, options) => {
      const call = { url, ...options, body: options.body ? JSON.parse(options.body) : null }; state.calls.push(call);
      if (state.requestOverride) { const result = await state.requestOverride(call); if (result !== undefined) return result; }
      if (options.method === 'GET') return Response.json(state.settings);
      if (options.method === 'PATCH') { state.settings.preferences = state.settings.preferences.filter(item => item.channel !== call.body.channel).concat({ channel: call.body.channel, enabled: call.body.enabled }); return Response.json({ channel: call.body.channel, enabled: call.body.enabled }); }
      if (options.method === 'POST') { state.settings.subscriptions = [{ id, active: true, createdAt: '2026-10-09T08:00:00Z' }]; return Response.json({ id, registered: true }); }
      if (options.method === 'DELETE') { state.settings.subscriptions = state.settings.subscriptions.filter(item => item.id !== call.body.id); return Response.json({ removed: true }); }
      assert.fail('Unexpected HTTP method');
    },
    Response, AbortSignal, Uint8Array, atob, Date, setTimeout, clearTimeout,
    window: { isSecureContext: secure, ...(supported ? { PushManager: {}, Notification: {} } : {}) },
    navigator: supported ? { serviceWorker: worker } : {},
    Notification: { requestPermission: async () => { state.browserCalls.push('requestPermission'); return state.permission; } },
  });
  const render = () => { state.cursor = 0; const tree = NotificationPreferences(); for (const effect of state.effects.splice(0)) state.cleanup = effect(); return tree; };
  const button = label => elements(render(), 'button').find(item => text(item).includes(label)) ?? assert.fail(`Missing button ${label}`);
  const click = async label => { button(label).props.onClick(); await tick(); };
  const consent = index => elements(render(), 'input')[index].props.onChange({ target: { checked: true } });
  return { state, render, button, click, consent, mount: async () => { render(); await tick(); }, stop: () => state.cleanup?.() };
}

test('SSR guard mounts no notification component with flags off, legacy provider or student role', async () => {
  const NotificationSentinel = () => null;
  const environment = { SCHOOL_AUTH_PROVIDER: 'supabase', SCHOOL_DATA_PROVIDER: 'supabase' };
  let capabilities = { email: false, webpush: false };
  let roles = ['direccion'];
  let configurationCalls = 0;
  const { default: Page } = load('app/mi-cuenta/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/headers': { headers: async () => ({}) }, 'next/navigation': { redirect: () => assert.fail('Unexpected redirect') },
    'drizzle-orm': { and() {}, desc() {}, eq() {} }, '@/db': { getDb: () => assert.fail('No D1 read') }, '@/db/schema': {},
    '@/lib/supabase/page-actor': { getSchoolPageActor: async () => ({ id, roles, name: 'Synthetic adult', email: 'synthetic@example.test' }) },
    '@/components/portal-shell': { PortalShell: 'PortalShell' }, './password-change-form': { PasswordChangeForm: 'PasswordChangeForm' },
    '@/lib/runtime/env': { env: environment }, '@/lib/supabase/database': { createSchoolDatabaseClient: () => assert.fail('No database request for notices') }, '@/lib/supabase/family-consents': {},
    '@/lib/school-notification-delivery': { externalNoticeConfiguration: () => { configurationCalls++; return capabilities; } }, './notification-preferences': { NotificationPreferences: NotificationSentinel },
  });
  assert.equal(elements(await Page(), NotificationSentinel).length, 0);
  capabilities = { email: true, webpush: false }; assert.equal(elements(await Page(), NotificationSentinel).length, 1);
  capabilities = { email: false, webpush: false }; environment.SCHOOL_NOTIFICATION_SETTINGS_ENABLED = 'schema31-ready';
  assert.equal(elements(await Page(), NotificationSentinel).length, 1);
  environment.SCHOOL_NOTIFICATION_SETTINGS_ENABLED = 'not-ready'; assert.equal(elements(await Page(), NotificationSentinel).length, 0);
  environment.SCHOOL_NOTIFICATION_SETTINGS_ENABLED = 'schema31-ready';
  roles = ['alumno']; assert.equal(elements(await Page(), NotificationSentinel).length, 0);
  roles = ['alumno', 'direccion']; assert.equal(elements(await Page(), NotificationSentinel).length, 0);
  roles = ['direccion']; environment.SCHOOL_DATA_PROVIDER = 'd1'; assert.equal(elements(await Page(), NotificationSentinel).length, 0);
  assert.equal(configurationCalls, 4);
});

test('mount reads only own settings, without permission, worker registration or subscriptions', async () => {
  const ui = harness(); await ui.mount();
  assert.equal(ui.state.calls.length, 1); assert.equal(ui.state.calls[0].url, '/api/notification-channels');
  assert.equal(ui.state.calls[0].credentials, 'same-origin'); assert.equal(ui.state.calls[0].cache, 'no-store');
  assert.deepEqual(ui.state.browserCalls, []);
  assert.equal(ui.button('Activar correo').props.disabled, true);
  assert.equal(ui.button('Activar en este equipo').props.disabled, true);
  assert.match(text(ui.render()), /genérico/);
});

test('email requires explicit consent and confirmed PATCH, then refreshes own state', async () => {
  const ui = harness(); await ui.mount(); await ui.click('Activar correo'); assert.equal(ui.state.calls.length, 1);
  ui.consent(0); await ui.click('Activar correo');
  assert.deepEqual(ui.state.calls[1].body, { channel: 'email', enabled: true, consentConfirmed: true });
  assert.equal(ui.state.calls[2].method, 'GET'); assert.match(text(ui.render()), /correo activados/);
  await ui.click('Desactivar correo'); assert.deepEqual(ui.state.calls[3].body, { channel: 'email', enabled: false, consentConfirmed: false });
});

test('ambiguous writes never retry and require an explicit fresh GET before another mutation', async () => {
  const ui = harness(); await ui.mount(); ui.consent(0);
  ui.state.requestOverride = call => call.method === 'PATCH' ? Promise.reject(Error('Synthetic network lost after commit')) : undefined;
  await ui.click('Activar correo'); assert.equal(ui.state.calls.length, 2);
  assert.match(text(ui.render()), /Puede haberse guardado/); assert.equal(ui.button('Activar correo').props.disabled, true);
  await ui.click('Activar correo'); assert.equal(ui.state.calls.length, 2);
  ui.state.requestOverride = null; await ui.click('Consultar estado'); await ui.click('Activar correo');
  assert.deepEqual(ui.state.calls.map(call => call.method), ['GET', 'PATCH', 'GET', 'PATCH', 'GET']);
});

test('failed or malformed reads expose a refresh action and block writes', async () => {
  const ui = harness(); ui.state.requestOverride = () => Response.json({ private: 'synthetic invalid response' }); await ui.mount();
  assert.equal(elements(ui.render(), 'fieldset').length, 0); assert.match(text(ui.render()), /No se pudo consultar/);
  assert.doesNotMatch(text(ui.render()), /synthetic invalid/); ui.state.requestOverride = null; await ui.click('Consultar estado');
  assert.equal(ui.button('Activar correo').props.disabled, true);
});

test('push permission and subscription are only created by an explicitly consented click', async () => {
  const ui = harness(); await ui.mount(); await ui.click('Activar en este equipo'); assert.deepEqual(ui.state.browserCalls, []);
  ui.consent(1); await ui.click('Activar en este equipo');
  assert.deepEqual(ui.state.browserCalls.slice(0, 3), ['requestPermission', 'getRegistration', 'getSubscription']);
  assert.deepEqual(ui.state.calls.map(call => call.method), ['GET', 'PATCH', 'POST', 'GET']);
  assert.deepEqual(ui.state.calls[1].body, { channel: 'webpush', enabled: true, consentConfirmed: true });
  assert.equal(ui.state.calls[2].url, '/api/push-subscriptions'); assert.match(ui.state.calls[2].body.endpoint, /synthetic-only/);
  const subscribe = ui.state.browserCalls.find(item => item?.subscribe)?.subscribe;
  assert.equal(subscribe.userVisibleOnly, true); assert.equal(subscribe.applicationServerKey.length, 65);
  assert.match(text(ui.render()), /Avisos activados en este navegador/);
});

test('denied permission sends no preference or subscription mutation', async () => {
  const ui = harness({ permission: 'denied' }); await ui.mount(); ui.consent(1); await ui.click('Activar en este equipo');
  assert.deepEqual(ui.state.calls.map(call => call.method), ['GET']); assert.equal(ui.button('Activar en este equipo').props.disabled, true);
  assert.match(text(ui.render()), /Consultar estado/);
});

test('a shared-browser subscription is not adopted, rebound or removed without its separate reset click', async () => {
  const ui = harness({ existing: true }); await ui.mount(); ui.consent(1); await ui.click('Activar en este equipo');
  assert.deepEqual(ui.state.calls.map(call => call.method), ['GET']); assert.deepEqual(ui.state.browserCalls, ['requestPermission', 'getRegistration', 'getSubscription']);
  assert.match(text(ui.render()), /no podemos confirmar que pertenezcan/);
  await ui.click('Reiniciar avisos'); assert.equal(ui.state.existing, true);
  await ui.click('Consultar estado'); await ui.click('Reiniciar avisos'); assert.equal(ui.state.existing, false);
  assert.equal(ui.state.browserCalls.filter(item => item === 'unsubscribe').length, 1);
  assert.equal(ui.state.calls.filter(call => call.method !== 'GET').length, 0);
});

test('unknown POST outcome leaves browser subscription intact and never repeats or adopts it after refresh', async () => {
  const ui = harness(); await ui.mount(); ui.consent(1);
  ui.state.requestOverride = call => call.method === 'POST' ? Promise.reject(Error('Synthetic POST uncertain')) : undefined;
  await ui.click('Activar en este equipo'); const count = ui.state.calls.length;
  assert.equal(ui.state.existing, true); assert.equal(ui.state.browserCalls.includes('unsubscribe'), false);
  await ui.click('Activar en este equipo'); assert.equal(ui.state.calls.length, count);
  ui.state.requestOverride = null; await ui.click('Consultar estado'); await ui.click('Activar en este equipo');
  assert.equal(ui.state.calls.filter(call => call.method === 'POST').length, 1);
  assert.match(text(ui.render()), /No los vincularemos automáticamente/);
});

test('revocation uses only own IDs from GET and unsubscribes the confirmed current browser association', async () => {
  const ui = harness(); await ui.mount(); ui.consent(1); await ui.click('Activar en este equipo');
  await ui.click('Retirar');
  const remove = ui.state.calls.find(call => call.method === 'DELETE'); assert.deepEqual(remove.body, { id });
  assert.equal(ui.state.existing, false); assert.equal(ui.state.browserCalls.filter(item => item === 'unsubscribe').length, 1);
  assert.match(text(ui.render()), /No tienes suscripciones registradas/);
});

test('unavailable capability or insecure browser never requests a permission', async () => {
  const ui = harness({ secure: false }); await ui.mount(); assert.match(text(ui.render()), /conexión segura/);
  assert.equal(elements(ui.render(), 'button').some(item => text(item).includes('Activar en este equipo')), false);
  assert.deepEqual(ui.state.browserCalls, []);
  ui.state.settings.capabilities = { email: false, webpush: false }; await ui.click('Consultar estado');
  assert.match(text(ui.render()), /todavía no tiene un canal externo/);
});

test('UI avoids persistent credentials and preserves accessible consent and 44px touch targets', () => {
  const source = readFileSync(new URL('../app/mi-cuenta/notification-preferences.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/mi-cuenta/notification-preferences.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|serviceRole|PRIVATE_KEY|RESEND_KEY/);
  assert.match(source, /role="alert"/); assert.match(source, /aria-labelledby="external-notices-title"/);
  assert.match(css, /min-height: 44px/); assert.match(css, /flex-wrap: wrap/);
});

test('disabled provider still permits own channel opt-out and revocation of GET-listed subscriptions', async () => {
  const ui = harness({ supported: false });
  ui.state.settings.capabilities = { email: true, webpush: false };
  ui.state.settings.preferences = [{ channel: 'webpush', enabled: true }];
  ui.state.settings.subscriptions = [{ id, active: true, createdAt: '2026-10-09T08:00:00Z' }];
  await ui.mount();
  assert.match(text(ui.render()), /pas disponible|no está disponible/);
  await ui.click('Desactivar canal');
  assert.deepEqual(ui.state.calls.find(call => call.method === 'PATCH').body, { channel: 'webpush', enabled: false, consentConfirmed: false });
  await ui.click('Retirar'); assert.deepEqual(ui.state.calls.find(call => call.method === 'DELETE').body, { id });
  assert.deepEqual(ui.state.browserCalls, []);
});

test('pending writes lock synchronous double clicks and state refresh; successful mutation with failed refresh stays uncertain', async () => {
  const ui = harness(); await ui.mount(); ui.consent(0);
  let resolveMutation;
  ui.state.requestOverride = call => call.method === 'PATCH' ? new Promise(resolve => { resolveMutation = resolve; }) : undefined;
  ui.button('Activar correo').props.onClick();
  ui.button('Activar correo').props.onClick(); ui.button('Consultar estado').props.onClick();
  assert.equal(ui.state.calls.length, 2); assert.equal(ui.button('Activar correo').props.disabled, true);
  ui.state.requestOverride = call => call.method === 'GET' ? Response.json({ message: 'synthetic sensitive error' }, { status: 503 }) : undefined;
  resolveMutation(Response.json({ channel: 'email', enabled: true })); await tick();
  assert.match(text(ui.render()), /Puede haberse guardado/); assert.doesNotMatch(text(ui.render()), /synthetic sensitive error/);
  await ui.click('Activar correo'); assert.equal(ui.state.calls.length, 3);
});

test('unmount during pending preference confirmation prevents worker registration or subscription creation', async () => {
  const ui = harness(); await ui.mount(); ui.consent(1);
  let resolveLookup;
  ui.state.browserCalls.length = 0;
  // The PATCH was explicitly requested; closing the view prevents subsequent browser steps.
  ui.state.requestOverride = call => call.method === 'PATCH' ? new Promise(resolve => { resolveLookup = resolve; }) : undefined;
  ui.button('Activar en este equipo').props.onClick(); await tick();
  assert.equal(ui.state.calls.length, 2); ui.stop();
  resolveLookup(Response.json({ channel: 'webpush', enabled: true })); await tick();
  assert.equal(ui.state.calls.length, 2);
  assert.equal(ui.state.browserCalls.some(call => call?.register || call?.subscribe), false);
});

test('permission starts synchronously from the consented click before a deferred worker lookup', async () => {
  const ui = harness(); await ui.mount(); ui.consent(1);
  let resolveLookup;
  ui.state.registrationOverride = registration => new Promise(resolve => { resolveLookup = () => resolve(registration); });
  ui.button('Activar en este equipo').props.onClick();
  assert.deepEqual(ui.state.browserCalls, ['requestPermission']);
  await tick();
  assert.deepEqual(ui.state.browserCalls, ['requestPermission', 'getRegistration']);
  assert.equal(ui.state.calls.length, 1);
  resolveLookup(); await tick();
  assert.deepEqual(ui.state.calls.map(call => call.method), ['GET', 'PATCH', 'POST', 'GET']);
});

test('both disabled providers still allow own opt-out and removal while never exposing activation', async () => {
  const ui = harness({ supported: false });
  ui.state.settings.capabilities = { email: false, webpush: false };
  ui.state.settings.preferences = [{ channel: 'email', enabled: true }, { channel: 'webpush', enabled: true }];
  ui.state.settings.subscriptions = [{ id, active: true, createdAt: '2026-10-09T08:00:00Z' }];
  await ui.mount();
  assert.equal(elements(ui.render(), 'button').some(item => /^Activar/.test(text(item))), false);
  await ui.click('Desactivar correo'); await ui.click('Desactivar canal'); await ui.click('Retirar');
  assert.deepEqual(ui.state.calls.filter(call => call.method !== 'GET').map(call => ({ method: call.method, body: call.body })), [
    { method: 'PATCH', body: { channel: 'email', enabled: false, consentConfirmed: false } },
    { method: 'PATCH', body: { channel: 'webpush', enabled: false, consentConfirmed: false } },
    { method: 'DELETE', body: { id } },
  ]);
  assert.deepEqual(ui.state.browserCalls, []);
});

test('invalid public VAPID key fails synchronously before permission or worker access', async () => {
  const ui = harness(); ui.state.settings.capabilities.publicVapidKey = 'invalid'; await ui.mount(); ui.consent(1);
  await ui.click('Activar en este equipo');
  assert.deepEqual(ui.state.browserCalls, []); assert.equal(ui.state.calls.length, 1);
  assert.match(text(ui.render()), /Consultar estado/);
});
