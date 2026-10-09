import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createSchoolErrorMonitor,SCHOOL_ERROR_WINDOW_MS,SCHOOL_ERROR_MAX_LINES,SCHOOL_ERROR_MAX_COUNTER}from'../lib/school-error-monitor.ts';
const require=createRequire(import.meta.url);
function fixture(){let instant=1_000_000;const lines=[];const monitor=createSchoolErrorMonitor({now:()=>instant,sink:line=>lines.push(JSON.parse(line))});return{monitor,lines,setTime:value=>instant=value,advance:()=>instant+=SCHOOL_ERROR_WINDOW_MS};}
const context={routerKind:'App Router',routeType:'route',routePath:'/alumnos/private-child',revalidateReason:undefined};
test('only fixed categories and actual timestamp survive private request/error/context content',()=>{
  const {monitor,lines}=fixture();const error=new Error('private student email@example.test password cookie');error.stack='private stack';error.cause={token:'secret'};error.digest='private-record-id';
  monitor.record(error,{...context,body:'private',headers:{Authorization:'secret'},routePath:'https://school.test/private?token=secret'});
  assert.deepEqual(lines,[{event:'school_server_request_error',router:'app',routeKind:'route',timestamp:new Date(1_000_000).toISOString()}]);assert.equal('status'in lines[0],false);
  assert.doesNotMatch(JSON.stringify(lines),/private|secret|student|email|password|cookie|Authorization|digest/);
});
test('error identity never invokes getters, proxy traps, JSON conversion or private error properties',()=>{
  const {monitor,lines}=fixture();let reads=0;const hostile=new Proxy({}, {get(){reads++;throw Error('private');},getOwnPropertyDescriptor(){reads++;throw Error('private');},ownKeys(){reads++;throw Error('private');}});
  monitor.record(hostile,context);monitor.record(hostile,context);assert.equal(reads,0);assert.equal(lines.length,1);
});
test('context accessors, inherited values and malicious categories become unknown without being read or serialized',()=>{
  const {monitor,lines}=fixture();let reads=0;const accessor={get routerKind(){reads++;throw Error('private getter');},get routeType(){reads++;throw Error('private getter');}};
  monitor.record({},accessor);monitor.record({},Object.create(context));monitor.record({},new Proxy({}, {getOwnPropertyDescriptor(){throw Error('private descriptor');}}));monitor.record({},{routerKind:'private-name',routeType:'private-ID'});
  assert.equal(reads,0);assert.ok(lines.every(row=>row.router==='unknown'&&row.routeKind==='unknown'));
});
test('all installed framework route categories project to finite enums',()=>{
  const {monitor,lines}=fixture();for(const routeType of['render','route','action','proxy','middleware'])monitor.record({}, {routerKind:'Pages Router',routeType});assert.deepEqual(lines.map(row=>row.routeKind),['render','route','action','proxy','middleware']);assert.ok(lines.every(row=>row.router==='pages'));
});
test('twenty-line budget includes the deferred numeric summary in the next window',()=>{
  const f=fixture();for(let i=0;i<25;i++)f.monitor.record({},context);assert.equal(f.lines.length,SCHOOL_ERROR_MAX_LINES);f.advance();for(let i=0;i<25;i++)f.monitor.record({},context);
  const second=f.lines.slice(SCHOOL_ERROR_MAX_LINES);assert.equal(second.length,SCHOOL_ERROR_MAX_LINES);assert.deepEqual(second[0],{event:'school_server_error_summary',emitted:20,suppressed:5,deduped:0,timestamp:new Date(1_060_000).toISOString()});assert.equal(second.filter(row=>row.event==='school_server_request_error').length,19);
});
test('same error object is deduplicated per window and no startup/heartbeat/fake error logs are produced',()=>{
  const f=fixture(),error={};assert.equal(f.lines.length,0);f.monitor.record(error,context);f.monitor.record(error,context);assert.equal(f.lines.length,1);f.advance();assert.equal(f.lines.length,1);f.monitor.record(error,context);
  assert.equal(f.lines.length,3);assert.equal(f.lines[1].deduped,1);assert.equal(f.lines[1].suppressed,0);assert.equal(f.lines[2].event,'school_server_request_error');
});
test('clock rollback never resets the budget and invalid/overflow clock values cause no exception',()=>{
  const f=fixture();for(let i=0;i<20;i++)f.monitor.record({},context);f.setTime(100);f.monitor.record({},context);assert.equal(f.lines.length,20);
  for(const value of[NaN,Infinity,-1,Number.MAX_SAFE_INTEGER,8_640_000_000_000_001]){f.setTime(value);assert.doesNotThrow(()=>f.monitor.record({},context));}assert.equal(f.lines.length,20);
  f.setTime(1_060_000);f.monitor.record({},context);assert.equal(f.lines.length,22);assert.equal(f.lines[20].suppressed,1);
});
test('aggregate counters saturate at a finite cap and output size stays bounded',()=>{
  const f=fixture();for(let i=0;i<SCHOOL_ERROR_MAX_COUNTER+30;i++)f.monitor.record('primitive private error',context);f.advance();f.monitor.record({},context);assert.equal(f.lines[20].suppressed,SCHOOL_ERROR_MAX_COUNTER);assert.ok(f.lines.every(row=>Buffer.byteLength(JSON.stringify(row))<256));
});
test('sink/clock exceptions never escape and a broken sink cannot exceed the per-window attempt budget',()=>{
  let attempts=0;const monitor=createSchoolErrorMonitor({now:()=>0,sink:()=>{attempts++;throw Error('private sink details');}});for(let i=0;i<100;i++)assert.doesNotThrow(()=>monitor.record({},context));assert.equal(attempts,20);
  const brokenClock=createSchoolErrorMonitor({now:()=>{throw Error('private');},sink:()=>assert.fail('no log')});assert.doesNotThrow(()=>brokenClock.record({},context));
});
function productionHook(monitor){
  const sandboxModule={exports:{}};const source=ts.transpileModule(fs.readFileSync(new URL('../instrumentation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,require:name=>{assert.equal(name,'./lib/school-error-monitor.ts');return{recordSchoolRequestError:(error,ctx)=>monitor.record(error,ctx)};}}));return sandboxModule.exports.onRequestError;
}
test('actual Next BaseServer dispatch calls the production hook while preserving request privacy',async()=>{
  const f=fixture(),BaseServer=require('next/dist/server/base-server.js').default;const hook=productionHook(f.monitor);const request={url:'/private?secret=1',method:'POST',headers:{cookie:'private-session',Authorization:'secret'}};
  await BaseServer.prototype.instrumentationOnRequestError.call({instrumentation:{onRequestError:hook}},new Error('private message'),request,context);assert.equal(f.lines.length,1);assert.deepEqual(Object.keys(f.lines[0]).sort(),['event','routeKind','router','timestamp']);
});
test('actual installed Vinext request-error dispatch uses the same hook and recognizes middleware',async()=>{
  const f=fixture();const {reportRequestError}=await import('../node_modules/vinext/dist/server/instrumentation.js');const previous=globalThis.__VINEXT_onRequestErrorHandler__;globalThis.__VINEXT_onRequestErrorHandler__=productionHook(f.monitor);
  try{await reportRequestError(new Error('private'),{path:'/private?token=x',method:'POST',headers:{Cookie:'private'}},{routerKind:'App Router',routeType:'middleware',routePath:'/private'});assert.equal(f.lines.length,1);assert.equal(f.lines[0].routeKind,'middleware');assert.doesNotMatch(JSON.stringify(f.lines),/private|token|Cookie/);}finally{if(previous===undefined)delete globalThis.__VINEXT_onRequestErrorHandler__;else globalThis.__VINEXT_onRequestErrorHandler__=previous;}
});
test('production hook never reads or enumerates a hostile request object',()=>{
  const f=fixture();let touched=0;const request=new Proxy({}, {get(){touched++;throw Error('private request');},ownKeys(){touched++;throw Error('private request');}});
  const hook=productionHook(f.monitor);assert.doesNotThrow(()=>hook({},request,context));assert.equal(touched,0);assert.equal(f.lines.length,1);
});
test('memory keeps at most twenty weak identities even if a storm retains every dropped error',()=>{
  let added=0;class BoundedProbeWeakSet extends WeakSet{add(value){added++;return super.add(value);}}
  const sandboxModule={exports:{}};const source=ts.transpileModule(fs.readFileSync(new URL('../lib/school-error-monitor.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,WeakSet:BoundedProbeWeakSet,Date,console:{error:()=>{}}}));const monitor=sandboxModule.exports.createSchoolErrorMonitor({now:()=>1000,sink:()=>{}});const retained=Array.from({length:1000},()=>({}));for(const error of retained)monitor.record(error,context);assert.equal(added,20);
});
