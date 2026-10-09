import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const jsx = (type, props) => ({type, props});
const syntheticEmail = 'synthetic-login@example.test';
const receipt = {user:{id:'11111111-1111-4111-8111-111111111111',name:'Persona sintética',email:syntheticEmail}};
const tick = async () => { for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve)); };
function load(file,dependencies,globals={}) {
  const sandboxModule={exports:{}};
  const source=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInContext(source,vm.createContext({module:sandboxModule,exports:sandboxModule.exports,require:name=>dependencies[name]??assert.fail('Unexpected import '+name),...globals}),{filename:file});
  return sandboxModule.exports;
}
function elements(tree,type) {
  const output=[];
  const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}if(value.type===type)output.push(value);visit(value.props?.children);};
  visit(tree);return output;
}
const text=value=>value==null?'':typeof value==='string'?value:Array.isArray(value)?value.map(text).join(' '):typeof value==='object'?text(value.props?.children):String(value);
function harness() {
  const state={hooks:[],cursor:0,effects:[],calls:[],navigations:[],stopped:false,lateStateChanges:0};
  const {authClient}=load('lib/auth-client.ts',{}, {fetch:(url,options)=>new Promise((resolve,reject)=>state.calls.push({url,options,resolve,reject}))});
  const react={
    useState:initial=>{const index=state.cursor++;state.hooks[index]??={value:initial};return[state.hooks[index].value,next=>{if(state.stopped)state.lateStateChanges++;state.hooks[index].value=typeof next==='function'?next(state.hooks[index].value):next;}];},
    useRef:initial=>{const index=state.cursor++;state.hooks[index]??={current:initial};return state.hooks[index];},
    useEffect:effect=>{const index=state.cursor++;if(!state.hooks[index]){state.hooks[index]={};state.effects.push(()=>{state.hooks[index].cleanup=effect();});}},
  };
  const {default:Login}=load('app/ingresar/page.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({push:path=>state.navigations.push(path)})},'next/image':{__esModule:true,default:'img'},'@/lib/auth-client':{authClient},
  });
  const render=()=>{state.cursor=0;return Login();};
  const commit=()=>{for(const effect of state.effects.splice(0))effect();};
  const fill=()=>{let tree=render();elements(tree,'input').find(input=>input.props.id==='email').props.onChange({target:{value:syntheticEmail}});tree=render();elements(tree,'input').find(input=>input.props.id==='password').props.onChange({target:{value:'synthetic-login-password'}});};
  const submit=()=>elements(render(),'form')[0].props.onSubmit({preventDefault(){}});
  const stop=()=>{state.stopped=true;for(const hook of state.hooks)hook?.cleanup?.();};
  return{state,render,commit,fill,submit,stop,mount:async()=>{render();commit();await tick();render();}};
}

test('real React SSR renders both fields and submit disabled with a preparation status and no network',()=>{
  const React=require('react');let calls=0;
  const {default:Login}=load('app/ingresar/page.tsx',{
    react:React,'react/jsx-runtime':require('react/jsx-runtime'),'next/navigation':{useRouter:()=>({push:()=>assert.fail('SSR navigation')})},
    'next/image':{__esModule:true,default:({src,alt,width,height})=>React.createElement('img',{src,alt,width,height})},
    '@/lib/auth-client':{authClient:{signIn:{email:()=>{calls++;assert.fail('SSR auth');}}}},
  });
  const html=renderToStaticMarkup(React.createElement(Login));
  assert.match(html,/<input[^>]*id="email"[^>]*disabled=""/);
  assert.match(html,/<input[^>]*id="password"[^>]*disabled=""/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Preparando acceso…/);
  assert.match(html,/<p role="status"[^>]*>Preparando acceso…/);
  assert.doesNotMatch(html,/<input[^>]*name=/);assert.equal(calls,0);
});

test('preparation blocks callbacks until the client effect completes, then enables the form',async()=>{
  const ui=harness();let tree=ui.render();for(const control of [...elements(tree,'input'),...elements(tree,'button')])assert.equal(control.props.disabled,true);
  await ui.submit();assert.equal(ui.state.calls.length,0);ui.commit();await tick();tree=ui.render();
  for(const control of [...elements(tree,'input'),...elements(tree,'button')])assert.equal(control.props.disabled,false);
  assert.doesNotMatch(text(tree),/Preparando acceso/);ui.stop();
});

test('synchronous repeated click produces exactly one actual auth POST and confirmed receipt navigates once',async()=>{
  const ui=harness();await ui.mount();ui.fill();const submit=elements(ui.render(),'form')[0].props.onSubmit;
  const first=submit({preventDefault(){}});await submit({preventDefault(){}});
  assert.equal(ui.state.calls.length,1);assert.equal(ui.state.calls[0].url,'/api/auth/sign-in/email');assert.equal(ui.state.calls[0].options.method,'POST');assert.equal(ui.state.calls[0].options.credentials,'same-origin');assert.equal(ui.state.calls[0].options.cache,'no-store');
  for(const control of [...elements(ui.render(),'input'),...elements(ui.render(),'button')])assert.equal(control.props.disabled,true);
  assert.deepEqual(ui.state.navigations,[]);ui.state.calls[0].resolve(Response.json(receipt));await first;assert.deepEqual(ui.state.navigations,['/']);ui.stop();
});

test('HTTP503 preserves only an approved availability message, keeps fields and enables explicit retry',async()=>{
  const ui=harness();await ui.mount();ui.fill();const pending=ui.submit();ui.state.calls[0].resolve(Response.json({message:'No fue posible comprobar el acceso escolar. Inténtalo más tarde o consulta a dirección.'},{status:503}));await pending;
  const tree=ui.render();assert.deepEqual(ui.state.navigations,[]);assert.match(text(tree),/No fue posible comprobar el acceso escolar/);assert.equal(elements(tree,'p').find(item=>item.props.role==='alert')?.props.role,'alert');assert.equal(elements(tree,'input').find(item=>item.props.id==='email').props.value,syntheticEmail);assert.equal(elements(tree,'button')[0].props.disabled,false);
  const retry=ui.submit();assert.equal(ui.state.calls.length,2);ui.state.calls[1].resolve(Response.json(receipt));await retry;assert.deepEqual(ui.state.navigations,['/']);ui.stop();
});

test('private upstream message is sanitized and unsuccessful response never navigates',async()=>{
  const ui=harness();await ui.mount();ui.fill();const pending=ui.submit();ui.state.calls[0].resolve(Response.json({message:'SYNTHETIC SECRET INTERNAL ERROR'},{status:401}));await pending;
  assert.match(text(ui.render()),/No pudimos iniciar sesión/);assert.doesNotMatch(text(ui.render()),/SYNTHETIC SECRET/);assert.deepEqual(ui.state.navigations,[]);ui.stop();
});

test('200 without a complete matching auth receipt never becomes false login success',async()=>{
  for(const data of[null,{}, {user:{id:'x',name:'Sintético',email:'other@example.test'}},{user:{name:'Sintético',email:syntheticEmail}}, {user:{id:'',name:'Sintético',email:syntheticEmail}}]){
    const ui=harness();await ui.mount();ui.fill();const pending=ui.submit();ui.state.calls[0].resolve(Response.json(data));await pending;assert.deepEqual(ui.state.navigations,[]);assert.match(text(ui.render()),/No pudimos confirmar el acceso/);assert.equal(elements(ui.render(),'button')[0].props.disabled,false);ui.stop();
  }
});

test('network failure remains generic, does not navigate and does not retry automatically',async()=>{
  const ui=harness();await ui.mount();ui.fill();const pending=ui.submit();ui.state.calls[0].reject(Error('Synthetic private network details'));await pending;await tick();
  assert.match(text(ui.render()),/No fue posible conectar con la escuela/);assert.doesNotMatch(text(ui.render()),/private network/);assert.equal(ui.state.calls.length,1);assert.deepEqual(ui.state.navigations,[]);ui.stop();
});

test('late auth success or failure after unmount cannot navigate or change state',async()=>{
  for(const status of[200,503]){
    const ui=harness();await ui.mount();ui.fill();const pending=ui.submit();ui.stop();ui.state.calls[0].resolve(Response.json(status===200?receipt:{message:'No fue posible conectar con el servicio de acceso.'},{status}));await pending;
    assert.deepEqual(ui.state.navigations,[]);assert.equal(ui.state.lateStateChanges,0);assert.equal(ui.state.calls.length,1);
  }
});

test('cleanup before preparation microtask prevents enabling an abandoned form',async()=>{
  const ui=harness();ui.render();ui.commit();ui.stop();await tick();assert.equal(ui.state.lateStateChanges,0);assert.equal(ui.state.calls.length,0);
});
