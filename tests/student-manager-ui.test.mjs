import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const jsx = (type, props) => ({type, props});
const studentId = '11111111-1111-4111-8111-111111111111';
const createdId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const student = {id:studentId,givenName:'Alumno sintético',familyName:'Ejemplo',birthDate:'2023-01-01',active:true,groupId,groupName:'Grupo sintético'};
const tick = async () => { for (let i=0;i<6;i++) await new Promise(resolve=>setImmediate(resolve)); };
const deferred = () => { let resolve,reject; const promise = new Promise((res,rej)=>{resolve=res;reject=rej;}); return {promise,resolve,reject}; };
function elements(tree,type) {
  const result=[];
  const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}if(value.type===type)result.push(value);visit(value.props?.children);};
  visit(tree);return result;
}
const text=tree=>tree==null?'':typeof tree==='string'?tree:Array.isArray(tree)?tree.map(text).join(' '):typeof tree==='object'?text(tree.props?.children):String(tree);
function harness({rows=[student],total=rows.length}={}) {
  const state={hooks:[],cursor:0,effects:[],calls:[],handler:null,confirmations:[],resets:0,stopped:false};
  const depsEqual=(left,right)=>left&&right&&left.length===right.length&&left.every((value,index)=>Object.is(value,right[index]));
  const react={
    useState:initial=>{const index=state.cursor++;state.hooks[index]??={value:initial};return[state.hooks[index].value,next=>{state.hooks[index].value=typeof next==='function'?next(state.hooks[index].value):next;}];},
    useRef:initial=>{const index=state.cursor++;state.hooks[index]??={current:initial};return state.hooks[index];},
    useCallback:(callback,deps)=>{const index=state.cursor++;if(!depsEqual(state.hooks[index]?.deps,deps))state.hooks[index]={value:callback,deps};return state.hooks[index].value;},
    useEffect:(effect,deps)=>{const index=state.cursor++;if(!depsEqual(state.hooks[index]?.deps,deps)){const previous=state.hooks[index];state.hooks[index]={deps,cleanup:previous?.cleanup};state.effects.push(()=>{previous?.cleanup?.();state.hooks[index].cleanup=effect();});}},
  };
  class SyntheticFormData {constructor(form){this.fields=form.fields;}[Symbol.iterator](){return Object.entries(this.fields)[Symbol.iterator]();}get(name){return this.fields[name]??null;}}
  const sandboxModule={exports:{}};
  const source=ts.transpileModule(readFileSync(new URL('../app/alumnos/student-manager.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx,Fragment:'Fragment'}:name==='next/link'?{__esModule:true,default:'a'}:assert.fail('Unexpected import '+name),
    URL,URLSearchParams,AbortController,AbortSignal,Promise,FormData:SyntheticFormData,
    window:{confirm:message=>{state.confirmations.push(message);return true;}},
    fetch:async(url,options={})=>{const call={url,...options,method:options.method??'GET',body:options.body?JSON.parse(options.body):null};state.calls.push(call);if(state.handler){const response=await state.handler(call);if(response!==undefined)return response;}return call.method==='GET'?Response.json({items:rows,total}):call.method==='POST'?Response.json({id:createdId},{status:201}):Response.json({updated:true});},
  }),{filename:'student-manager.tsx'});
  const render=()=>{state.cursor=0;const tree=sandboxModule.exports.StudentManager({initialStudents:rows,initialTotal:total,groups:[{id:groupId,name:'Grupo sintético'}]});for(const effect of state.effects.splice(0))effect();return tree;};
  const form={fields:{givenName:'Nuevo sintético',familyName:'Ensayo',birthDate:'',groupId},reset:()=>{state.resets++;}};
  const event={preventDefault(){},currentTarget:form};
  const create=()=>elements(render(),'form')[0].props.onSubmit(event);
  const click=label=>{const button=elements(render(),'button').find(item=>text(item).includes(label));assert.ok(button,'Missing button '+label);return button.props.onClick();};
  const stop=()=>{state.stopped=true;for(const hook of state.hooks)hook?.cleanup?.();};
  return{state,render,create,click,form,event,mount:async()=>{render();await tick();render();},stop};
}

test('mount uses private same-origin GET and preserves complete initial directory',async()=>{
  const ui=harness();await ui.mount();assert.equal(ui.state.calls.length,1);assert.equal(ui.state.calls[0].method,'GET');assert.equal(ui.state.calls[0].credentials,'same-origin');assert.equal(ui.state.calls[0].cache,'no-store');assert.ok(ui.state.calls[0].signal);assert.match(text(ui.render()),/Alumno sintético/);ui.stop();
});

test('confirmed201 resets once before refresh and GET503 cannot turn registration into an unconfirmed write',async()=>{
  const ui=harness();await ui.mount();const refresh=deferred();ui.state.handler=call=>call.method==='GET'?refresh.promise:undefined;
  const saved=ui.create();await tick();assert.equal(ui.state.resets,1);assert.match(text(ui.render()),/Alumno registrado correctamente/);assert.equal(ui.state.calls.filter(call=>call.method==='POST').length,1);
  refresh.resolve(Response.json({error:'Synthetic unavailable'},{status:503}));await saved;
  const tree=ui.render();assert.equal(ui.state.resets,1);assert.match(text(tree),/Alumno registrado correctamente/);assert.match(text(tree),/No se pudo actualizar el listado/);assert.match(text(tree),/Alumno sintético/);assert.doesNotMatch(text(tree),/Puede haberse guardado/);
  ui.state.handler=null;ui.click('Actualizar listado');await tick();assert.equal(ui.state.calls.filter(call=>call.method==='POST').length,1);assert.doesNotMatch(text(ui.render()),/No se pudo actualizar el listado/);assert.match(text(ui.render()),/Alumno registrado correctamente/);ui.stop();
});

test('synchronous double-submit lock works before React rerenders and blocks context controls',async()=>{
  const ui=harness();await ui.mount();const write=deferred();ui.state.handler=call=>call.method==='POST'?write.promise:undefined;
  const callback=elements(ui.render(),'form')[0].props.onSubmit;const first=callback(ui.event),second=callback(ui.event);await second;
  assert.equal(ui.state.calls.filter(call=>call.method==='POST').length,1);
  for(const input of elements(ui.render(),'input'))assert.equal(input.props.disabled,true);
  for(const select of elements(ui.render(),'select'))assert.equal(select.props.disabled,true);
  write.resolve(Response.json({id:createdId},{status:201}));await first;assert.equal(ui.state.resets,1);assert.equal(elements(ui.render(),'form')[0].props.children.at(-1).props.disabled,false);ui.stop();
});

test('200202 and malformed201 never confirm/reset/refresh and do not automatically replay POST',async()=>{
  for(const [status,payload]of[[200,{id:createdId}],[202,{id:createdId}],[201,{id:'bad'}],[201,{}]]){
    const ui=harness();await ui.mount();ui.state.handler=call=>call.method==='POST'?Response.json(payload,{status}):undefined;await ui.create();
    assert.equal(ui.state.calls.length,2);assert.equal(ui.state.resets,0);assert.match(text(ui.render()),/Puede haberse guardado/);assert.doesNotMatch(text(ui.render()),/Alumno registrado correctamente/);await tick();assert.equal(ui.state.calls.length,2);ui.stop();
  }
});

test('network ambiguity keeps form, exposes explicit GET check and allows a subsequent explicit new registration',async()=>{
  const ui=harness();await ui.mount();ui.state.handler=call=>call.method==='POST'?Promise.reject(Error('SYNTHETIC PRIVATE NETWORK DETAIL')):undefined;await ui.create();
  assert.equal(ui.state.resets,0);assert.equal(ui.state.calls.length,2);assert.match(text(ui.render()),/Consulta el listado antes/);assert.doesNotMatch(text(ui.render()),/SYNTHETIC PRIVATE/);
  ui.state.handler=null;ui.click('Comprobar listado');await tick();assert.deepEqual(ui.state.calls.map(call=>call.method),['GET','POST','GET']);
  await ui.create();assert.deepEqual(ui.state.calls.map(call=>call.method),['GET','POST','GET','POST','GET']);assert.equal(ui.state.resets,1);ui.stop();
});

test('validation rejection preserves form without implying confirmation or generating a refresh',async()=>{
  const ui=harness();await ui.mount();ui.state.handler=call=>call.method==='POST'?Response.json({error:'Revisa el grupo.'},{status:400}):undefined;await ui.create();
  assert.equal(ui.state.resets,0);assert.equal(ui.state.calls.length,2);assert.match(text(ui.render()),/Revisa el grupo/);assert.doesNotMatch(text(ui.render()),/Alumno registrado correctamente|Puede haberse guardado/);ui.stop();
});

test('GET401403 erases personal directory, blocks all controls and suppresses successful empty state',async()=>{
  for(const status of[401,403]){
    const ui=harness();ui.state.handler=()=>Response.json({error:'Synthetic denied'},{status});await ui.mount();const tree=ui.render();
    assert.doesNotMatch(text(tree),/Alumno sintético|2023-01-01|Abrir expediente|Todavía no hay alumnos registrados/);assert.match(text(tree),/Tu sesión o tus permisos/);assert.match(text(tree),/Vuelve a iniciar sesión/);
    for(const control of[...elements(tree,'input'),...elements(tree,'select'),...elements(tree,'button')])assert.equal(control.props.disabled,true);
    const before=ui.state.calls.length;await ui.create();assert.equal(ui.state.calls.length,before);assert.equal(elements(tree,'a').find(link=>link.props.href==='/ingresar')?.props.href,'/ingresar');ui.stop();
  }
});

test('POST401403 clears directory and prevents another attempt without returning a misleading empty success',async()=>{
  for(const status of[401,403]){
    const ui=harness();await ui.mount();ui.state.handler=call=>call.method==='POST'?Response.json({error:'Synthetic denied'},{status}):undefined;await ui.create();
    assert.doesNotMatch(text(ui.render()),/Alumno sintético|Todavía no hay alumnos registrados/);assert.match(text(ui.render()),/Tu sesión o tus permisos/);assert.equal(ui.state.resets,0);const before=ui.state.calls.length;await ui.create();assert.equal(ui.state.calls.length,before);ui.stop();
  }
});

test('GET503 preserves existing rows with alert and allows explicit read-only recovery',async()=>{
  const ui=harness();ui.state.handler=()=>Response.json({error:'Synthetic unavailable'},{status:503});await ui.mount();assert.match(text(ui.render()),/Alumno sintético/);assert.match(text(ui.render()),/No se pudo actualizar el listado/);assert.doesNotMatch(text(ui.render()),/Tu sesión o tus permisos/);
  ui.state.handler=null;ui.click('Actualizar listado');await tick();assert.match(text(ui.render()),/Alumno sintético/);assert.doesNotMatch(text(ui.render()),/No se pudo actualizar el listado/);assert.ok(ui.state.calls.every(call=>call.method==='GET'));ui.stop();
});

test('old ignored-abort GET cannot overwrite newer filtered rows or resurrect records after access loss',async()=>{
  const ui=harness();const old=deferred();ui.state.handler=()=>old.promise;ui.render();await tick();const firstSignal=ui.state.calls[0].signal;
  elements(ui.render(),'input').find(input=>input.props.id==='student-search').props.onChange({target:{value:'Sin coincidencias'}});
  ui.state.handler=()=>Response.json({items:[],total:0});ui.render();await tick();assert.equal(firstSignal.aborted,true);
  old.resolve(Response.json({items:[student],total:1}));await tick();assert.doesNotMatch(text(ui.render()),/Alumno sintético/);
  ui.state.handler=()=>Response.json({error:'Synthetic denied'},{status:403});ui.click('Actualizar listado');await tick();assert.match(text(ui.render()),/Tu sesión o tus permisos/);assert.doesNotMatch(text(ui.render()),/Todavía no hay alumnos registrados/);ui.stop();
});

test('confirmed PATCH and failed refresh preserve mutation confirmation; double status clicks are locked',async()=>{
  const ui=harness();await ui.mount();const write=deferred();ui.state.handler=call=>call.method==='PATCH'?write.promise:Response.json({error:'Unavailable'},{status:503});
  const button=elements(ui.render(),'button').find(item=>text(item)==='Dar de baja');const first=button.props.onClick();await button.props.onClick();assert.equal(ui.state.calls.filter(call=>call.method==='PATCH').length,1);assert.equal(ui.state.confirmations.length,1);
  write.resolve(Response.json({updated:true,active:false}));await first;assert.match(text(ui.render()),/Baja lógica registrada/);assert.match(text(ui.render()),/No se pudo actualizar el listado/);assert.doesNotMatch(text(ui.render()),/Puede haberse guardado/);ui.stop();
});

test('unmounted late POST cannot reset a different form, update UI or initiate a refresh',async()=>{
  const ui=harness();await ui.mount();const write=deferred();ui.state.handler=call=>call.method==='POST'?write.promise:undefined;const pending=ui.create();ui.stop();write.resolve(Response.json({id:createdId},{status:201}));await pending;assert.equal(ui.state.resets,0);assert.equal(ui.state.calls.length,2);
});
