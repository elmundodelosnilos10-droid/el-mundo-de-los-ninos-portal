/** Synthetic harness plumbing only: this test does not prove provider delivery. */
import assert from "node:assert/strict";
import test from "node:test";
import {loadSseBridge,startSse} from "./realtime-local/run.mjs";

test("synthetic harness SSE retains verified roles, emits ready and cleans up HTTP cancellation",async()=>{
 const users=[0,1,2].map(index=>({id:`a1000000-0000-4000-8000-00000000000${index+1}`,name:"Synthetic",email:`synthetic-${index}@example.com`}));
 const sessions=users.map((_,index)=>({access_token:`synthetic-token-${index}`}));
 const configuration={apiUrl:"http://127.0.0.1:54321"};const credentials={anonKey:"synthetic-anon"};
 let stopped=0;let seenOptions;
 const syntheticSubscribe=options=>{seenOptions=options;queueMicrotask(()=>options.onReady());return{stop:async()=>{stopped++;}};};
 const api={async request(path,options){const index=sessions.findIndex(session=>session.access_token===options.jwt);assert.ok(index>=0);if(path==="/auth/v1/user")return Response.json(users[index]);if(path.startsWith("/rest/v1/profiles?"))return[{...users[index],active:true}];if(path.startsWith("/rest/v1/user_roles?"))return[{role:index===0?"docente":"tutor"}];throw Error("unexpected synthetic API request");}};
 let bridge;
 try{
  bridge=await startSse(loadSseBridge(syntheticSubscribe),api,configuration,credentials,users,sessions,{allow:()=>{}});
  for(let i=0;i<20&&!bridge.state.frames.some(frame=>frame.event==="ready");i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(bridge.state.frames,[{event:"ready",data:{}}]);
  assert.equal(bridge.state.transport.actorMatches,true);assert.equal(bridge.state.transport.canMessage,true);
  assert.deepEqual(bridge.state.transport.roles,["tutor"]);assert.equal(seenOptions.userId,users[1].id);assert.equal(seenOptions.accessToken,sessions[1].access_token);
 }finally{await bridge?.stop();}
 for(let i=0;i<20&&stopped<1;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(stopped>=1);
});
