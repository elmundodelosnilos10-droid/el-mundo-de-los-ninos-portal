import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import {renderToStaticMarkup} from 'react-dom/server';
import {createObservationController,EMPTY_OBSERVATION_STATE} from '../lib/observation-client.ts';
const require=createRequire(import.meta.url),student='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function render(state){const sandboxModule={exports:{}};const source=ts.transpileModule(fs.readFileSync(new URL('../app/seguimiento/progress-manager.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;const mockedRequire=name=>{if(name==='react')return{...require('react'),useState:()=>[state,()=>{}],useRef:()=>({current:null}),useEffect:()=>{}};if(name==='react/jsx-runtime')return require(name);if(name==='next/link')return{default:'a'};if(name==='@/lib/observation-client')return{createObservationController,EMPTY_OBSERVATION_STATE};throw Error('Unexpected import '+name);};vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,require:mockedRequire,Date}),{filename:'progress-manager.tsx'});return renderToStaticMarkup(require('react').createElement(sandboxModule.exports.ProgressManager,{students:[{id:student,name:'Alumno',familyName:'Sintético',groupName:'Grupo sintético'}],canWrite:true}));}
test('POST access denial clears rows without displaying an empty successful history',async()=>{for(const status of[401,403,404]){let state;const controller=createObservationController({onChange:next=>{state=next;},fetcher:async(_url,init)=>init.method==='GET'?Response.json({items:[],hasMore:false,nextCursor:null}):Response.json({error:'Synthetic denied'},{status})});controller.selectStudent(student);await settle();await controller.save({category:'lenguaje',body:'Observación sintética',visibleToFamily:true});assert.equal(state.accessDenied,true);assert.equal(state.readError,'');assert.equal(state.items.length,0);const html=render(state);assert.doesNotMatch(html,/Todavía no hay observaciones/);assert.match(html,/Tu cuenta ya no puede registrar avances/);assert.match(html,/fieldset disabled/);controller.dispose();}});
