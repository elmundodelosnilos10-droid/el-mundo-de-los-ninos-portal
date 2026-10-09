import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire}from'node:module';
import test from'node:test';
import ts from'typescript';
const require=createRequire(import.meta.url),id='e1000000-0000-4000-8000-000000000001',origin='https://portal.example.test';
function harness(route){
  const state={actor:{id,roles:['tutor'],supabaseAuth:{userId:id,accessToken:'synthetic-user-jwt'}},env:{SCHOOL_DATA_PROVIDER:'supabase',SUPABASE_URL:'https://school.example.test',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',APP_ORIGIN:origin},calls:[],status:200,payload:{preferences:[],subscriptions:[]},d1:0};
  const deps={'@/lib/runtime/env':{env:state.env},'@/lib/access':{actorFromRequest:async()=>state.actor,hasRole:(actor,...roles)=>roles.some(role=>actor.roles.includes(role)),errorResponse:(status,error)=>Response.json({error},{status})},zod:require('zod')};
  const modules=new Map();
  const names={'@/lib/supabase/auth-route-utils':'lib/supabase/auth-route-utils.ts','@/lib/supabase/database':'lib/supabase/database.ts','@/lib/supabase/notification-delivery-preferences':'lib/supabase/notification-delivery-preferences.ts','@/lib/school-notification-delivery':'lib/school-notification-delivery.ts','../school-notification-delivery.ts':'lib/school-notification-delivery.ts','./local-http-test-policy.ts':'lib/supabase/local-http-test-policy.ts'};
  function load(file){if(modules.has(file))return modules.get(file).exports;const sandboxModule={exports:{}};modules.set(file,sandboxModule);
    const source=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    const fakeFetch=async(input,options)=>{state.calls.push({url:new URL(input),options});assert.equal(options.headers.Authorization,'Bearer synthetic-user-jwt');return Response.json(state.status===200?state.payload:{code:'42501',message:'private-provider-contents'},{status:state.status});};
    const mockRequire=name=>{if(deps[name])return deps[name];if(name.startsWith('node:')||name==='web-push')return require(name);if(names[name])return load(names[name]);if(name==='@/db'){state.d1++;throw Error('D1 forbidden');}throw Error(`Unexpected import ${name}`);};
    vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,require:mockRequire,fetch:fakeFetch,URL,Request,Response,Headers,Buffer,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout}),{filename:file});return sandboxModule.exports;
  }return{state,...load(route)};
}
const req=(path='/api/notification-channels',method='GET',body,requestOrigin=origin)=>new Request(origin+path,{method,headers:{Origin:requestOrigin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('channel preferences require adult session, CSRF on writes, and default-off means zero RPC opt-in',async()=>{
  for(const roles of [null,['alumno'],[]]){const r=harness('app/api/notification-channels/route.ts');if(roles===null)r.state.actor=null;else r.state.actor.roles=roles;assert.equal((await r.GET(req())).status,roles===null?401:403);assert.equal(r.state.calls.length,0);}
  const cross=harness('app/api/notification-channels/route.ts');assert.equal((await cross.PATCH(req(undefined,'PATCH',{channel:'email',enabled:true,consentConfirmed:true},'https://foreign.example.test'))).status,403);assert.equal(cross.state.calls.length,0);
  const disabled=harness('app/api/notification-channels/route.ts');assert.equal((await disabled.PATCH(req(undefined,'PATCH',{channel:'email',enabled:true,consentConfirmed:true}))).status,409);assert.equal(disabled.state.calls.length,0);
});
test('preferences response omits unexpected private fields and provides honest capabilities',async()=>{
  const r=harness('app/api/notification-channels/route.ts');r.state.payload={privateKey:'do-not-return',preferences:[{channel:'email',enabled:true,consentedAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z',email_at_consent:'private@example.test'}],subscriptions:[{id,active:true,createdAt:'2026-10-09T00:00:00Z',endpoint:'https://private-service.example',auth:'do-not-return'}]};
  const response=await r.GET(req());assert.equal(response.status,200);const body=await response.json();assert.equal(body.capabilities.email,false);assert.equal(body.deliveryGuaranteed,false);assert.doesNotMatch(JSON.stringify(body),/do-not-return|private@example|private-service|email_at_consent/);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(r.state.d1,0);
});
test('own opt-out remains possible while provider is disabled and missing consent never touches RPC',async()=>{
  const r=harness('app/api/notification-channels/route.ts');r.state.payload={channel:'email',enabled:false};assert.equal((await r.PATCH(req(undefined,'PATCH',{channel:'email',enabled:false}))).status,200);assert.equal(JSON.parse(r.state.calls[0].options.body).p_consent_confirmed,false);
  const noConsent=harness('app/api/notification-channels/route.ts');assert.equal((await noConsent.PATCH(req(undefined,'PATCH',{channel:'email',enabled:true}))).status,400);assert.equal(noConsent.state.calls.length,0);
});
test('push registration remains disabled and unregister needs session, CSRF and owned RPC',async()=>{
  const r=harness('app/api/push-subscriptions/route.ts');assert.equal((await r.POST(req('/api/push-subscriptions','POST',{}))).status,409);assert.equal(r.state.calls.length,0);
  r.state.payload={removed:true};assert.equal((await r.DELETE(req('/api/push-subscriptions','DELETE',{id}))).status,200);assert.equal(r.state.calls.length,1);assert.equal(r.state.calls[0].url.pathname,'/rest/v1/rpc/school_remove_push_subscription');
  const cross=harness('app/api/push-subscriptions/route.ts');assert.equal((await cross.DELETE(req('/api/push-subscriptions','DELETE',{id},'https://foreign.example.test'))).status,403);assert.equal(cross.state.calls.length,0);
});
test('preference denial/upstream error is sanitized, identity mismatch never calls Supabase',async()=>{
  const r=harness('app/api/notification-channels/route.ts');r.state.status=403;const response=await r.GET(req());assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/private-provider|synthetic-user|42501/);
  const foreign=harness('app/api/notification-channels/route.ts');foreign.state.actor.supabaseAuth.userId='other';assert.equal((await foreign.GET(req())).status,503);assert.equal(foreign.state.calls.length,0);
});
test('service worker only displays the exact generic same-origin payload and opens no private deep links',async()=>{
  const code=ts.transpileModule(fs.readFileSync(new URL('../app/school-notices-sw.js/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const workerModule={exports:{}};vm.runInContext(code,vm.createContext({module:workerModule,exports:workerModule.exports,Response}));const response=await workerModule.exports.GET();const events={},shown=[],opened=[];
  vm.runInContext(await response.text(),vm.createContext({URL,self:{location:{origin},addEventListener:(name,callback)=>events[name]=callback,registration:{showNotification:async(...args)=>shown.push(args)},clients:{openWindow:async url=>opened.push(url)}}}));
  const generic={title:'Portal escolar',body:'Tienes un aviso en tu portal escolar. Inicia sesión para consultarlo.',tag:'A'.repeat(32),url:origin+'/'};
  for(const payload of[{...generic,body:'Private student content'},{...generic,url:origin+'/alumnos/private-id'},{...generic,url:'https://foreign.example.test/'},{...generic,tag:'private-uuid'}])events.push({data:{json:()=>payload},waitUntil:()=>assert.fail('must not display')});
  let promise;events.push({data:{json:()=>generic},waitUntil:p=>promise=p});await promise;assert.equal(shown.length,1);assert.deepEqual(Object.keys(shown[0][1].data),['url']);
  events.notificationclick({notification:{close:()=>{},data:{url:origin+'/'}},waitUntil:p=>promise=p});await promise;assert.deepEqual(opened,[origin+'/']);
});
