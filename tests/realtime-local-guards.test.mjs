import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertLoopbackUrl, localConfiguration, readLocalCredentials, validateLocalCredentials, assertSyntheticUser, assertLocalUserSession, assertLocalTransportUrl, assertLocalWebSocketUrl, assertSafeSseEnvelope } from "./realtime-local/guards.mjs";
const id="a1000000-0000-4000-8000-000000000001";
const token = claims => ["header",Buffer.from(JSON.stringify({iss:"supabase-demo", exp:Math.floor(Date.now()/1000)+300,...claims})).toString("base64url"),"synthetic_signature"].join(".");
const credentials = () => ({anonKey:token({role:"anon"}),serviceRoleKey:token({role:"service_role"})});
const env = () => ({SCHOOL_REALTIME_TEST_ALLOW_LOCAL_WRITES:"I_ACCEPT_SYNTHETIC_LOOPBACK_ONLY",SCHOOL_REALTIME_TEST_API_URL:"http://127.0.0.1:54321",SCHOOL_REALTIME_TEST_DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:54322/postgres",SCHOOL_REALTIME_TEST_CREDENTIALS_FILE:"/tmp/school-realtime-local-credentials.synthetic.json"});
test("only explicit loopback literals with local synthetic Postgres credentials are accepted", () => {
 assert.equal(localConfiguration(env()).apiUrl,"http://127.0.0.1:54321");
 assert.equal(assertLoopbackUrl("http://[::1]:54321").hostname,"[::1]");
 assert.equal(assertLoopbackUrl("postgresql://postgres:local-synthetic-random-password@127.0.0.1:54322/postgres",["postgresql:"]).hostname,"127.0.0.1");
 for(const url of ["https://school.supabase.co","http://localhost:54321","http://127.1:54321","http://2130706433:54321","http://127.0.0.1.nip.io:54321","http://127.0.0.1:54321/?secret=x","http://127.0.0.1:54321/#x","http://remote@127.0.0.1:54321","http://127.0.0.1:80","http://127.0.0.1:54321/rest/v1"]) assert.throws(()=>assertLoopbackUrl(url));
 for(const url of ["postgresql://postgres:@127.0.0.1:54322/postgres","postgresql://postgres:postgres@remote.test:54322/postgres","postgresql://postgres:postgres@127.0.0.1:54322/school","postgresql://other:postgres@127.0.0.1:54322/postgres"]) assert.throws(()=>assertLoopbackUrl(url,["postgresql:"]));
});
test("missing opt-in or wrong file names fail closed and project env variables are never read", () => {
 const accessed=[]; const values=env(); const configuration=localConfiguration(new Proxy(values,{get:(target,key)=>{ accessed.push(key); assert.ok(key.startsWith("SCHOOL_REALTIME_TEST_")); return target[key]; }}));
 assert.equal(configuration.apiUrl,values.SCHOOL_REALTIME_TEST_API_URL); assert.equal(accessed.length,4);
 assert.throws(()=>localConfiguration({}),error=>error.code==="not_configured");
 assert.throws(()=>localConfiguration({...env(),SCHOOL_REALTIME_TEST_ALLOW_LOCAL_WRITES:"yes"}));
 for(const filename of ["/tmp/.env","/tmp/.dev.vars","./school-realtime-local-credentials.synthetic.json","/tmp/secrets.json"]) assert.throws(()=>localConfiguration({...env(),SCHOOL_REALTIME_TEST_CREDENTIALS_FILE:filename}));
});
test("local legacy keys require exact anon/service roles and demo issuer, rejecting school keys", () => {
 assert.deepEqual(validateLocalCredentials(credentials()),credentials());
 for(const bad of [null,{}, {anonKey:"sb_publishable_synthetic",serviceRoleKey:"sb_secret_synthetic"}, {...credentials(),anonKey:token({role:"service_role"})}, {...credentials(),serviceRoleKey:token({role:"service_role",iss:"https://school.supabase.co"})}, {...credentials(),serviceRoleKey:token({role:"service_role",exp:0})}, {...credentials(),extra:"private"}]) assert.throws(()=>validateLocalCredentials(bad));
});
test("credential files must be owned 0600 regular files, not symlinks or oversized input", () => {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),"realtime-guard-")); const filename=path.join(directory,"school-realtime-local-credentials.synthetic.json");
 try {
  fs.writeFileSync(filename,JSON.stringify(credentials()),{mode:0o600}); assert.deepEqual(readLocalCredentials(filename),credentials());
  fs.chmodSync(filename,0o644); assert.throws(()=>readLocalCredentials(filename)); fs.chmodSync(filename,0o600);
  const link=path.join(directory,"school-realtime-local-credentials.link.json");fs.symlinkSync(filename,link);assert.throws(()=>readLocalCredentials(link));
  fs.writeFileSync(filename,"x".repeat(20001));assert.throws(()=>readLocalCredentials(filename));
  assert.throws(()=>readLocalCredentials(directory));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test("fixtures and Auth sessions must be synthetic and issued by the exact loopback Auth", () => {
 const user={id,email:"realtime-local-123456abcdef-family-a@example.com"};assert.deepEqual(assertSyntheticUser(user),user);
 const api="http://127.0.0.1:54321";
 const session={user,access_token:token({iss:api+"/auth/v1",role:"authenticated",sub:id})};assert.equal(assertLocalUserSession(session,user,api),session);
 for(const changed of [{...user,email:"real-school@example.com"},{...user,id:"invalid"}])assert.throws(()=>assertSyntheticUser(changed));
 for(const claims of [{iss:"https://school.supabase.co/auth/v1"},{iss:"http://localhost:54321/auth/v1"},{iss:"http://127.0.0.1:54320/auth/v1"},{sub:"a1000000-0000-4000-8000-000000000002"},{role:"service_role"}])assert.throws(()=>assertLocalUserSession({...session,access_token:token({iss:api+"/auth/v1",role:"authenticated",sub:id,...claims})},user,api));
});

test("HTTP/WebSocket runtime boundary rejects all external origins and credential redirects", () => {
 const origins=new Set(["http://127.0.0.1:54321"]);
 assert.equal(assertLocalTransportUrl("http://127.0.0.1:54321/auth/v1/token?grant_type=password",origins,"http:").origin,"http://127.0.0.1:54321");
 assert.equal(assertLocalTransportUrl("ws://127.0.0.1:54321/realtime/v1/websocket?apikey=synthetic",origins,"ws:").protocol,"ws:");
 for(const url of ["https://remote.test/a","http://remote.test/a","http://localhost:54321/a","http://2130706433:54321/a","http://127.0.0.1:9999/a","http://private@127.0.0.1:54321/a","http://127.0.0.1:54321/a#secret"]) assert.throws(()=>assertLocalTransportUrl(url,origins,"http:"));
 for(const url of ["wss://remote.test/a","ws://remote.test/a","ws://127.0.0.1:9999/a","ws://private@127.0.0.1:54321/a"]) assert.throws(()=>assertLocalTransportUrl(url,origins,"ws:"));
});
test("real SSE receipt checker allows only the actual content-free protocol", () => {
 for(const [event,data] of [["ready",{}],["end",{reason:"unauthorized"}],["invalidate",{scope:"notifications"}],["invalidate",{scope:"all"}],["invalidate",{scope:"messages",conversationId:id}]]) assert.doesNotThrow(()=>assertSafeSseEnvelope(event,data));
 for(const [event,data] of [["ready",{jwt:"private"}],["end",{reason:"redirect"}],["invalidate",{scope:"notifications",title:"private"}],["invalidate",{scope:"messages",conversationId:id,body:"private"}],["invalidate",{scope:"messages",conversationId:"invalid"}]])assert.throws(()=>assertSafeSseEnvelope(event,data));
});

 test("native WebSocket HTTP normalization preserves the exact loopback origin guard",()=>{
 const origins=new Set(["http://127.0.0.1:54321"]);
 assert.equal(assertLocalWebSocketUrl("http://127.0.0.1:54321/realtime/v1/websocket?apikey=synthetic",origins).protocol,"ws:");
 for(const address of ["https://127.0.0.1:54321/realtime/v1","http://localhost:54321/realtime/v1","http://remote.example:54321/realtime/v1","http://127.0.0.1:54322/realtime/v1","http://u:p@127.0.0.1:54321/realtime/v1"]){assert.throws(()=>assertLocalWebSocketUrl(address,origins));}
 });
