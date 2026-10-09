/** Real provider integration; loopback fixtures only. Does not read project env files. */
import fs from "node:fs";
import http from "node:http";
import { channel as diagnosticChannel } from "node:diagnostics_channel";
import vm from "node:vm";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { Agent } from "undici";
import { loadSchoolBackupTables } from "../../scripts/supabase-school-backup.mjs";
import ts from "typescript";
import { localConfiguration, readLocalCredentials, assertSyntheticUser, assertLocalUserSession, assertLocalTransportUrl, assertLocalWebSocketUrl, assertSafeSseEnvelope, LocalRealtimeTestError } from "./guards.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const requireCondition = (condition, code) => { if (!condition) throw new LocalRealtimeTestError(code); };
async function waitFor(predicate, code, timeout = 15000) {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new LocalRealtimeTestError(code); await sleep(50); }
}
export function networkGuard(apiUrl, expectedApiKey) {
  const origins = new Set([apiUrl]); const nativeFetch = globalThis.fetch; const NativeSocket = globalThis.WebSocket; const socketStates=[]; const dispatcherClosures=[]; const handshakeStates=[]; const requestStates=[]; const socketIds=new WeakMap();let nextSocketId=1;
  const watchedRequest=request=>String(request?.origin)===apiUrl&&typeof request?.path==="string"&&request.path.startsWith("/realtime/v1/websocket?");
  const headerDiagnostics=diagnosticChannel("undici:request:headers");
  const errorDiagnostics=diagnosticChannel("undici:request:error");
  const headersListener=({request,response})=>{if(watchedRequest(request)) handshakeStates.push({kind:"response",status:response?.statusCode??null});};
  const errorsListener=({request,error})=>{if(watchedRequest(request)) handshakeStates.push({kind:"error",code:typeof error?.code==="string"&&/^(?:UND_ERR_|E)[A-Z_]+$/.test(error.code)?error.code:"other",name:["TypeError","Error","AbortError","RequestAbortedError","InvalidArgumentError","NotSupportedError"].includes(error?.name)?error.name:"other",causeCode:typeof error?.cause?.code==="string"&&/^(?:UND_ERR_|E)[A-Z_]+$/.test(error.cause.code)?error.cause.code:null,reason:["Invalid URL protocol","invalid connection header","invalid upgrade header","Unsupported upgrade","unsupported upgrade","aborted","fetch failed","bad port","Connection was closed","WebSocket was closed"].find(reason=>typeof error?.message==="string"&&error.message.includes(reason))??null});};
  const sendDiagnostics=diagnosticChannel("undici:client:sendHeaders");
  const sendListener=({request,socket})=>{
    let origin;try{origin=new URL(String(request?.origin)).origin;}catch{return;}
    if(origin!==apiUrl)return;
    const kind=request.path?.startsWith("/realtime/v1/websocket?")?"websocket":request.path?.startsWith("/auth/v1/")?"auth":request.path?.startsWith("/rest/v1/")?"rest":"other";
    if(kind==="other")return;if(!socketIds.has(socket))socketIds.set(socket,nextSocketId++);
    requestStates.push({kind,socketId:socketIds.get(socket)});
  };
  headerDiagnostics.subscribe(headersListener);errorDiagnostics.subscribe(errorsListener);sendDiagnostics.subscribe(sendListener);
  requireCondition(typeof NativeSocket === "function", "native_websocket_required");
  globalThis.fetch = (input, options = {}) => {
    assertLocalTransportUrl(input instanceof Request ? input.url : input, origins, "http:");
    return nativeFetch(input, { ...options, redirect: "error" });
  };
  globalThis.WebSocket = class LoopbackWebSocket extends NativeSocket {
    constructor(address, protocols) {
      const guarded=assertLocalWebSocketUrl(address, origins);
      // Local Native gateway/Node differential: never reuse Auth/REST HTTP
      // sockets for WS upgrades. Real native socket + real SDK, no transport mock.
      const dispatcher=new Agent({connections:1});
      super(guarded.href, {protocols:protocols??[],dispatcher});
      this.addEventListener("close",()=>{dispatcherClosures.push(dispatcher.destroy().catch(()=>{}));},{once:true});
      const state={opened:false,errored:false,closed:false,closeCode:null,errorCategory:null,errorStatus:null,apiKeyMatches:expectedApiKey===undefined?null:guarded.searchParams.get("apikey")===expectedApiKey,vsn:["1.0.0","2.0.0"].includes(guarded.searchParams.get("vsn"))?guarded.searchParams.get("vsn"):"other",path:guarded.pathname==="/realtime/v1/websocket"?"websocket":"other",protocolCount:Array.isArray(protocols)?protocols.length:protocols===undefined?0:typeof protocols==="string"?1:null};socketStates.push(state);
      this.addEventListener("open",()=>{state.opened=true;});
      this.addEventListener("error",event=>{
        state.errored=true;
        const message=[event?.message,event?.error?.message,event?.error?.cause?.message].filter(v=>typeof v==="string").join(" ");
        state.errorCategory=["non-101","not 101","network error","timed out","ECONNREFUSED","ECONNRESET","Sec-WebSocket-Accept","invalid status","socket hang up","Parser Error"].find(category=>message.toLowerCase().includes(category.toLowerCase()))??"other";
        const status=event?.error?.statusCode??event?.error?.cause?.statusCode;
        state.errorStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
      });
      this.addEventListener("close",event=>{state.closed=true;state.closeCode=Number.isInteger(event.code)?event.code:null;});
    }
  };
  return { socketStates, handshakeStates, requestStates, dispatcherClosures, allow: origin => origins.add(origin), restore() { headerDiagnostics.unsubscribe(headersListener);errorDiagnostics.unsubscribe(errorsListener);sendDiagnostics.unsubscribe(sendListener);globalThis.fetch = nativeFetch; globalThis.WebSocket = NativeSocket; } };
}
function apiClient(configuration, credentials) {
  async function request(path, { method = "GET", jwt, admin = false, body, raw = false } = {}) {
    requireCondition(path.startsWith("/auth/v1/") || path.startsWith("/rest/v1/"), "invalid_fixture_api_path");
    const response = await fetch(new URL(path, configuration.apiUrl), {
      method, redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { apikey: admin ? credentials.serviceRoleKey : credentials.anonKey,
        Authorization: `Bearer ${admin ? credentials.serviceRoleKey : jwt ?? credentials.anonKey}`,
        "Content-Type": "application/json", Prefer: "return=representation" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (raw) return response;
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      const allowed=new Set(["email_address_invalid","email_not_confirmed","invalid_credentials","validation_failed","weak_password","unexpected_failure","signup_disabled","user_already_exists","email_provider_disabled","provider_disabled"]);
      let code=typeof error?.error_code==="string"?error.error_code:typeof error?.code==="string"?error.code:null;
      const diagnostic=typeof error?.msg==="string"?error.msg:typeof error?.error_description==="string"?error.error_description:"";
      if(/email logins are disabled/i.test(diagnostic)) code="email_provider_disabled";
      throw new LocalRealtimeTestError("local_api_request_failed_"+response.status+(allowed.has(code)?"_"+code:""));
    }
    if (response.status === 204) return null;
    const text = await response.text(); requireCondition(text.length < 100000, "local_api_response_too_large");
    return text ? JSON.parse(text) : null;
  }
  return { request };
}
export async function assertPristineDatabase(sql) {
  const tables = await loadSchoolBackupTables();
  requireCondition(tables.length === 33, "local_school_catalog_mismatch");
  for (const table of tables) {
    const [count] = await sql`select count(*) as rows from ${sql("public." + table.name)}`;
    requireCondition(Number(count.rows) === 0, "local_database_not_pristine");
  }
  const [privateState] = await sql`select
    (select count(*) from auth.identities) as identities,
    (select count(*) from storage.objects) as objects`;
  requireCondition(Number(privateState.identities) === 0 && Number(privateState.objects) === 0, "local_private_data_not_pristine");
  const [state] = await sql`select
    (select count(*) from auth.users) as users,
    (select count(*) from public.profiles) as profiles,
    (select count(*) from public.students) as students,
    (select count(*) from public.school_years) as years,
    (select count(*) from public.communication_settings) as settings,
    (select count(*) from public.messages) as messages,
    (select count(*) from public.notifications) as notifications,
    (select count(*) from public.conversations) as conversations,
    (select count(*) from public.user_roles) as roles,
    current_database() as database,
    current_setting('server_version_num') as version`;
  requireCondition(state.database === "postgres" && [state.users, state.profiles, state.students, state.years, state.settings, state.messages, state.notifications, state.conversations, state.roles].every(count => Number(count) === 0), "local_database_not_pristine");
  const publication = await sql`select p.pubinsert,p.pubupdate,p.pubdelete,p.pubtruncate,p.puballtables,
    (select count(*) from pg_publication_namespace where pnpubid=p.oid) as schemas
    from pg_publication p where p.pubname='supabase_realtime'`;
  requireCondition(publication.length === 1 && publication[0].pubinsert && publication[0].pubupdate && !publication[0].pubdelete && !publication[0].pubtruncate && !publication[0].puballtables && Number(publication[0].schemas) === 0, "safe_local_publication_required");
  const members = await sql`select schemaname,tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename`;
  requireCondition(members.length === 3 && members.every(row => row.schemaname === "public") && members.map(row => row.tablename).join(",") === "communication_settings,messages,notifications", "exact_local_publication_required");
  return state.version;
}
function fixtureIds() {
  return Object.fromEntries(["year","group","teacher","guardianA","guardianB","studentA","studentB","enrollmentA","enrollmentB","conversationA","conversationB"].map(name => [name, randomUUID()]));
}
async function seedRelations(sql, ids, users) {
  await sql.begin(async tx => {
    const found = await tx`select id from public.profiles where id = any(${users.map(user => user.id)}::uuid[])`;
    requireCondition(found.length === 3, "auth_database_instance_mismatch");
    await tx`update public.profiles set active=true where id=any(${users.map(user=>user.id)}::uuid[])`;
    for (const [index, role] of [[0,"docente"],[1,"tutor"],[2,"tutor"]]) await tx`insert into public.user_roles(user_id,role) values(${users[index].id},${role})`;
    await tx`insert into public.school_years(id,name,starts_on,ends_on,active) values(${ids.year},${"Local realtime "+ids.year},'2020-01-01','2099-12-31',true)`;
    await tx`insert into public.groups(id,year_id,name,stage,active) values(${ids.group},${ids.year},'Grupo sintético','preescolar',true)`;
    await tx`insert into public.teachers(id,user_id,active) values(${ids.teacher},${users[0].id},true)`;
    await tx`insert into public.teacher_groups(teacher_id,group_id) values(${ids.teacher},${ids.group})`;
    for(const suffix of ["A","B"]) {
      const user=users[suffix==="A"?1:2];
      await tx`insert into public.guardians(id,user_id,active) values(${ids["guardian"+suffix]},${user.id},true)`;
      await tx`insert into public.students(id,given_name,family_name,active) values(${ids["student"+suffix]},${"Menor sintético "+suffix},'Prueba local',true)`;
      await tx`insert into public.student_guardians(student_id,guardian_id,relationship,active) values(${ids["student"+suffix]},${ids["guardian"+suffix]},'tutor sintético',true)`;
      await tx`insert into public.enrollments(id,student_id,group_id,enrolled_at) values(${ids["enrollment"+suffix]},${ids["student"+suffix]},${ids.group},now())`;
      await tx`insert into public.conversations(id,student_id,teacher_id,guardian_id,created_at) values(${ids["conversation"+suffix]},${ids["student"+suffix]},${ids.teacher},${ids["guardian"+suffix]},now())`;
    }
    await tx`insert into public.communication_settings(id,enabled,updated_at) values('school',false,now())`;
  });
}
function subscribeAdapter(subscribe, configuration, credentials, user, session) {
  const state = { ready: false, failed: false, signals: [], failure: null };
  const handle = subscribe({ url: configuration.apiUrl, publishableKey: credentials.anonKey, accessToken: session.access_token, userId: user.id, canMessage: true,
    onReady:()=>{state.ready=true;}, onFailure:reason=>{state.failed=true;state.failure=reason;}, onInvalidate: event => {state.signals.push(event);} });
  return { state, stop:()=>handle.stop() };
}
async function rawObserver(RealtimeClient, configuration, credentials, user, session, maliciousUserId, timeout=10000) {
  const state = { ready: false, failed: false, receipts: [], statuses: [], systems: [], errorCategory: null };
  const client=new RealtimeClient(configuration.apiUrl+"/realtime/v1",{params:{apikey:credentials.anonKey},accessToken:async()=>session.access_token,logger:()=>{},timeout});
  await client.setAuth(session.access_token);
  const channel=client.channel("local-proof:"+user.id, {config:{broadcast:{replication_ready:true}}});
  channel.on("system", {}, payload => {
    if (["ok","error"].includes(payload?.status)) state.systems.push({status:payload.status,extension:["system","postgres_changes"].includes(payload.extension)?payload.extension:"other"});
  });
  for(const table of ["messages","notifications"]) for(const event of ["INSERT","UPDATE"]) channel.on("postgres_changes",{event,schema:"public",table},payload=>{
    // Keep only synthetic identifiers, never bodies/titles/tokens in receipts.
    state.receipts.push({table,event:payload.eventType,id:payload.new.id,conversationId:payload.new.conversation_id,userId:payload.new.user_id});
  });
  if(maliciousUserId) channel.on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications",filter:"user_id=eq."+maliciousUserId},payload=>{state.receipts.push({table:"malicious-notifications",event:"INSERT",id:payload.new.id});});
  channel.subscribe((status,error)=>{if(["SUBSCRIBED","CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status))state.statuses.push(status);if(status==="SUBSCRIBED")state.ready=true;else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status))state.failed=true;const message=typeof error?.message==="string"?error.message:"";state.errorCategory=["mismatch","timeout","Unauthorized","tenant","UnableToConnect","Database","not found"].find(label=>message.toLowerCase().includes(label.toLowerCase()))??state.errorCategory;});
  return { state, async stop(){try{await channel.unsubscribe(1000);}finally{channel.teardown();await client.disconnect();}} };
}
export function loadSseBridge(subscribe) {
  const sandboxModule={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(new URL("../../lib/school-realtime-server.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const dependencies={"@/lib/runtime/env":{env:{}},"@/lib/access":{actorFromRequest:()=>{throw new LocalRealtimeTestError("production_actor_forbidden");}},"@/lib/supabase/realtime":{subscribeSchoolDatabaseChanges:subscribe}};
  vm.runInNewContext(source,{module:sandboxModule,exports:sandboxModule.exports,require:name=>{requireCondition(Boolean(dependencies[name]),"unexpected_bridge_dependency");return dependencies[name];},URL,Request,Response,Headers,ReadableStream,TextEncoder,setInterval,setTimeout,clearInterval,clearTimeout});
  const factory=sandboxModule.exports.createSchoolRealtimeHandlers;factory.productionSubscribe=subscribe;return factory;
}
export async function startSse(createHandlers, api, configuration, credentials, users, sessions, network) {
  const verifiedActor = async request => {
    const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
    const index=sessions.findIndex(session=>session.access_token===token);
    if(index<0)return null;
    const authResponse=await api.request("/auth/v1/user",{jwt:token,raw:true});if(!authResponse.ok)return null;
    const authUser=await authResponse.json();if(authUser.id!==users[index].id)return null;
    const profile=await api.request(`/rest/v1/profiles?id=eq.${users[index].id}&select=id,name,email,active`,{jwt:token});
    if(profile.length!==1||profile[0].active!==true)return null;
    const roles=await api.request(`/rest/v1/user_roles?user_id=eq.${users[index].id}&select=role`,{jwt:token});
    transport.roles=roles.map(row=>row.role).filter(role=>["docente","tutor","direccion","superadmin"].includes(role));
    return {id:authUser.id,name:profile[0].name,email:profile[0].email,roles:roles.map(row=>row.role),supabaseAuth:{userId:authUser.id,accessToken:token}};
  };
  const transport={ready:false,failure:null,actorMatches:false,canMessage:false,roles:[]};
  const handlers=createHandlers({subscribe:options=>{transport.canMessage=options.canMessage;transport.actorMatches=options.userId===users[1].id&&options.accessToken===sessions[1].access_token&&options.url===configuration.apiUrl&&options.publishableKey===credentials.anonKey;return createHandlers.productionSubscribe({...options,onReady:()=>{transport.ready=true;options.onReady();},onFailure:reason=>{transport.failure=reason;options.onFailure(reason);}});},environment:{SCHOOL_REALTIME_PROVIDER:"supabase",SCHOOL_AUTH_PROVIDER:"supabase",SCHOOL_DATA_PROVIDER:"supabase",SUPABASE_URL:configuration.apiUrl,SUPABASE_PUBLISHABLE_KEY:credentials.anonKey},actor:verifiedActor});
  const server=http.createServer(async(req,res)=>{
    const controller=new AbortController();res.on("close",()=>controller.abort());
    try{
      const request=new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{headers:{authorization:req.headers.authorization??""},signal:controller.signal});
      const response=req.url==="/api/realtime/events"?await handlers.eventsGET(request):req.url==="/api/realtime/config"?await handlers.configGET(request):new Response(null,{status:404});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if(response.body)Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);else res.end();
    }catch{res.writeHead(500);res.end();}
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const origin=`http://127.0.0.1:${server.address().port}`;network.allow(origin);
  const abort=new AbortController();const response=await fetch(origin+"/api/realtime/events",{headers:{Authorization:"Bearer "+sessions[1].access_token},signal:abort.signal});
  requireCondition(response.ok,"real_sse_open_failed");
  const reader=response.body.getReader();const state={frames:[],closed:false,failed:false,transport};
  const reading=(async()=>{let buffer="";const decoder=new TextDecoder();try{for(;;){const part=await reader.read();if(part.done){state.closed=true;break;}buffer+=decoder.decode(part.value,{stream:true});requireCondition(buffer.length<8192,"sse_buffer_unbounded");let cut;while((cut=buffer.indexOf("\n\n"))>=0){const frame=buffer.slice(0,cut);buffer=buffer.slice(cut+2);if(frame.startsWith(":"))continue;const event=frame.match(/^event: (\w+)/)?.[1];const data=JSON.parse(frame.match(/^data: (.*)$/m)?.[1]??"null");assertSafeSseEnvelope(event,data);state.frames.push({event,data});}}}catch{if(!abort.signal.aborted)state.failed=true;}})();
  return {state,async stop(){abort.abort();await reader.cancel().catch(()=>{});await reading;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
async function cleanup(sql, api, ids, users) {
  const userIds=users.map(user=>user.id);
  await sql.begin(async tx=>{
    await tx`delete from public.messages where conversation_id=any(${[ids.conversationA,ids.conversationB]}::uuid[])`;
    await tx`delete from public.notifications where user_id=any(${userIds}::uuid[])`;
    await tx`delete from public.audit_log where actor_id=any(${userIds}::uuid[])`;
    await tx`delete from public.conversations where id=any(${[ids.conversationA,ids.conversationB]}::uuid[])`;
    await tx`delete from public.student_guardians where student_id=any(${[ids.studentA,ids.studentB]}::uuid[])`;
    await tx`delete from public.enrollments where id=any(${[ids.enrollmentA,ids.enrollmentB]}::uuid[])`;
    await tx`delete from public.teacher_groups where teacher_id=${ids.teacher}`;
    await tx`delete from public.students where id=any(${[ids.studentA,ids.studentB]}::uuid[])`;
    await tx`delete from public.teachers where id=${ids.teacher}`;
    await tx`delete from public.guardians where id=any(${[ids.guardianA,ids.guardianB]}::uuid[])`;
    await tx`delete from public.user_roles where user_id=any(${userIds}::uuid[])`;
    await tx`delete from public.communication_settings where id='school'`;
    await tx`delete from public.groups where id=${ids.group}`;
    await tx`delete from public.school_years where id=${ids.year}`;
  });
  for(const user of users){assertSyntheticUser(user);await api.request(`/auth/v1/admin/users/${user.id}`,{method:"DELETE",admin:true});}
}

export async function runLocalRealtimeIntegration(environment=process.env) {
  const configuration=localConfiguration(environment);const credentials=readLocalCredentials(configuration.credentialsFile);
  const network=networkGuard(configuration.apiUrl, credentials.anonKey);const parsed=new URL(configuration.databaseUrl);
  const sql=postgres({host:parsed.hostname.replace(/^\[|\]$/g,""),port:Number(parsed.port),database:"postgres",username:"postgres",password:decodeURIComponent(parsed.password),ssl:false,max:1,connect_timeout:5,idle_timeout:5,onnotice:()=>{}});
  const api=apiClient(configuration,credentials);const ids=fixtureIds();const users=[];const sessions=[];const adapters=[];const raw=[];let sse;let warmup;let warmupProbe;let seeded=false;let stage="preflight";const checks=[];const recordCheck=check=>{checks.push(check);process.send?.({type:"local-realtime-check",check});};let primaryError;
  try{
    const [lock]=await sql`select pg_try_advisory_lock(hashtextextended('school-realtime-local-integration',0)) as acquired`;
    requireCondition(lock.acquired,"another_local_runner_active");
    const version=await assertPristineDatabase(sql);seeded=true;
    const namespace=randomBytes(6).toString("hex");const password="LocalSynthetic-"+randomBytes(20).toString("hex");
    stage="auth-create";
    for(const suffix of ["teacher","family-a","family-b"]){
      stage="auth-create-"+suffix;
      const created=await api.request("/auth/v1/admin/users",{method:"POST",admin:true,body:{email:`realtime-local-${namespace}-${suffix}@example.com`,password,email_confirm:true,user_metadata:{name:"Local synthetic "+suffix}}});
      const user=assertSyntheticUser(created);users.push(user);
      stage="auth-sign-in-"+suffix;
      const session=await api.request("/auth/v1/token?grant_type=password",{method:"POST",body:{email:user.email,password}});sessions.push(assertLocalUserSession(session,user,configuration.apiUrl));
      const verified=await api.request("/auth/v1/user",{jwt:session.access_token});requireCondition(verified.id===user.id,"real_auth_verification_failed");
    }
    await seedRelations(sql,ids,users);recordCheck("real_auth_and_fixture_relations");
    stage="subscribe";
    const {subscribeSchoolDatabaseChanges}=await import("../../lib/supabase/realtime.ts");const {RealtimeClient}=await import("@supabase/realtime-js");
    stage="native-provider-warmup";warmupProbe=await rawObserver(RealtimeClient,configuration,credentials,users[0],sessions[0],null,10000);await sleep(1000);warmup=await rawObserver(RealtimeClient,configuration,credentials,users[1],sessions[1],null,30000);
    recordCheck("real_native_provider_activation_probes");
    for(const i of [0,1,2]){stage="subscribe-adapter-"+i;adapters[i]=subscribeAdapter(subscribeSchoolDatabaseChanges,configuration,credentials,users[i],sessions[i]);stage="subscribe-observer-"+i;raw[i]=await rawObserver(RealtimeClient,configuration,credentials,users[i],sessions[i],i===1?users[2].id:null);}
    await waitFor(()=>adapters.every(a=>a.state.ready&&!a.state.failed)&&raw.every(a=>a.state.ready&&!a.state.failed),"real_realtime_subscription_not_ready");
    recordCheck("real_sdk_subscriptions");
    stage="notifications";
    for(let i=0;i<3;i++){
      const id=randomUUID();const before=adapters[i].state.signals.filter(s=>s.scope==="notifications").length;
      await sql`insert into public.notifications(id,user_id,kind,title,dedupe_key,created_at) values(${id},${users[i].id},'local-test','Aviso sintético',${"local-test:"+id},now())`;
      const readable=await api.request(`/rest/v1/notifications?id=eq.${id}&select=id`,{jwt:sessions[i].access_token});
      requireCondition(readable.length===1&&readable[0].id===id,"own_notification_positive_rls_read_failed");
      await waitFor(()=>raw[i].state.receipts.some(r=>r.table==="notifications"&&r.id===id&&r.event==="INSERT")&&adapters[i].state.signals.filter(s=>s.scope==="notifications").length>before,"own_notification_insert_not_delivered");
      const updateBefore=adapters[i].state.signals.filter(s=>s.scope==="notifications").length;
      await api.request(`/rest/v1/notifications?id=eq.${id}`,{method:"PATCH",jwt:sessions[i].access_token,body:{read_at:new Date().toISOString()}});
      await waitFor(()=>raw[i].state.receipts.some(r=>r.table==="notifications"&&r.id===id&&r.event==="UPDATE")&&adapters[i].state.signals.filter(s=>s.scope==="notifications").length>updateBefore,"own_notification_update_not_delivered");
    }
    await sleep(1500);requireCondition(raw.every((observer,index)=>observer.state.receipts.filter(r=>r.table==="notifications").every(r=>r.userId===users[index].id))&&!raw[1].state.receipts.some(r=>r.table==="malicious-notifications"),"foreign_notification_leaked");recordCheck("notification_insert_update_rls");
    stage="messages";
    for(const [suffix,index] of [["A",1],["B",2]]){
      const conversationId=ids["conversation"+suffix];const id=randomUUID();const baseline=adapters.map(a=>a.state.signals.filter(s=>s.scope==="messages"&&s.conversationId===conversationId).length);
      const sent=await api.request("/rest/v1/rpc/school_send_message",{method:"POST",jwt:sessions[0].access_token,body:{p_id:id,p_conversation_id:conversationId,p_body:"Mensaje sintético local"}});
      await waitFor(()=>[0,index].every(i=>raw[i].state.receipts.some(r=>r.table==="messages"&&r.id===id&&r.event==="INSERT")&&adapters[i].state.signals.filter(s=>s.scope==="messages"&&s.conversationId===conversationId).length>baseline[i]),"member_message_insert_not_delivered");
      const updateBefore=adapters.map(a=>a.state.signals.filter(s=>s.scope==="messages"&&s.conversationId===conversationId).length);
      await api.request("/rest/v1/rpc/school_mark_conversation_read",{method:"POST",jwt:sessions[index].access_token,body:{p_conversation_id:conversationId,p_through_sent_at:sent.sentAt,p_through_id:id}});
      await waitFor(()=>[0,index].every(i=>raw[i].state.receipts.some(r=>r.table==="messages"&&r.id===id&&r.event==="UPDATE")&&adapters[i].state.signals.filter(s=>s.scope==="messages"&&s.conversationId===conversationId).length>updateBefore[i]),"member_message_update_not_delivered");
      const foreign=index===1?2:1;const foreignRows=await api.request(`/rest/v1/messages?id=eq.${id}&select=id`,{jwt:sessions[foreign].access_token});requireCondition(Array.isArray(foreignRows)&&foreignRows.length===0,"foreign_message_read_allowed");
      await sleep(1500);requireCondition(!raw[foreign].state.receipts.some(r=>r.table==="messages"&&r.id===id)&&adapters[foreign].state.signals.filter(s=>s.scope==="messages"&&s.conversationId===conversationId).length===baseline[foreign],"foreign_message_realtime_leaked");
    }
    recordCheck("message_insert_update_member_and_foreign_rls");
    stage="sse-start";sse=await startSse(loadSseBridge(subscribeSchoolDatabaseChanges),api,configuration,credentials,users,sessions,network);
    await waitFor(()=>sse.state.frames.some(frame=>frame.event==="ready"),"real_sse_not_ready");recordCheck("real_sse_subscription");
    const sseNotice=randomUUID();await sql`insert into public.notifications(id,user_id,kind,title,dedupe_key,created_at) values(${sseNotice},${users[1].id},'local-test','Control SSE',${"local-test:"+sseNotice},now())`;
    await api.request("/rest/v1/rpc/school_send_message",{method:"POST",jwt:sessions[0].access_token,body:{p_id:randomUUID(),p_conversation_id:ids.conversationA,p_body:"Control SSE sintético"}});
    await waitFor(()=>sse.state.frames.some(frame=>frame.event==="invalidate"&&frame.data.scope==="notifications")&&sse.state.frames.some(frame=>frame.event==="invalidate"&&frame.data.scope==="messages"&&frame.data.conversationId===ids.conversationA),"real_sse_invalidation_not_delivered");
    recordCheck("real_sse_delivery_without_private_rows");
    stage="close";const closedCount=adapters[2].state.signals.length;await adapters[2].stop();const closedId=randomUUID();
    await sql`insert into public.notifications(id,user_id,kind,title,dedupe_key,created_at) values(${closedId},${users[2].id},'local-test','Después del cierre',${"local-test:"+closedId},now())`;
    await waitFor(()=>raw[2].state.receipts.some(r=>r.id===closedId),"close_control_event_not_delivered");await sleep(1000);requireCondition(adapters[2].state.signals.length===closedCount,"stopped_adapter_received_event");recordCheck("adapter_close_suppresses_real_events");
    stage="revocation";await sql`update public.profiles set active=false where id=${users[1].id}`;
    const revokedCount=adapters[1].state.signals.length;const revokeId=randomUUID();
    await api.request("/rest/v1/rpc/school_send_message",{method:"POST",jwt:sessions[0].access_token,body:{p_id:revokeId,p_conversation_id:ids.conversationA,p_body:"Control después de revocar familia"}});
    await waitFor(()=>raw[0].state.receipts.some(r=>r.id===revokeId),"revocation_control_not_delivered");await sleep(2000);
    requireCondition(adapters[1].state.signals.length===revokedCount&&!raw[1].state.receipts.some(r=>r.id===revokeId),"revoked_family_received_event");
    const revokedRead=await api.request(`/rest/v1/messages?id=eq.${revokeId}&select=id`,{jwt:sessions[1].access_token});requireCondition(revokedRead.length===0,"revoked_family_read_allowed");
    await waitFor(()=>sse.state.frames.some(frame=>frame.event==="end"&&frame.data.reason==="unauthorized")&&sse.state.closed,"real_sse_revocation_not_closed",40000);
    recordCheck("profile_revocation_rls_and_real_sse_close");
    requireCondition(adapters.every(a=>!a.state.failed)&&raw.every(a=>!a.state.failed)&&!sse.state.failed,"unexpected_real_transport_failure");
    return {status:"PASS",provider:"real-local-auth-postgres-realtime",transport:"native-websocket-isolated-undici-dispatcher-harness-only",productionTransportVerified:false,postgresVersion:version,localActivationProbeStatuses:[warmupProbe.state.statuses,warmup.state.statuses].map(s=>[...s]),checks};
  }catch(error){primaryError=new LocalRealtimeTestError(error instanceof LocalRealtimeTestError?error.code:"local_provider_operation_failed");primaryError.stage=stage;primaryError.socketStates=network.socketStates;primaryError.handshakeStates=network.handshakeStates;primaryError.requestStates=network.requestStates;primaryError.completedChecks=[...checks];primaryError.subscriptionState={warmupProbe:warmupProbe?{ready:warmupProbe.state.ready,failed:warmupProbe.state.failed,statuses:warmupProbe.state.statuses}:null,warmup:warmup?{ready:warmup.state.ready,failed:warmup.state.failed,statuses:warmup.state.statuses}:null,adapters:adapters.map(a=>({ready:a.state.ready,failed:a.state.failed,failure:a.state.failure,signalCounts:{notifications:a.state.signals.filter(s=>s.scope==="notifications").length,messages:a.state.signals.filter(s=>s.scope==="messages").length}})),observers:raw.map(a=>({ready:a.state.ready,failed:a.state.failed,statuses:a.state.statuses,systems:a.state.systems,receiptCounts:{notifications:a.state.receipts.filter(r=>r.table==="notifications").length,messages:a.state.receipts.filter(r=>r.table==="messages").length,foreignNotifications:a.state.receipts.filter(r=>r.table==="malicious-notifications").length},errorCategory:a.state.errorCategory}))};if(sse)primaryError.sseState={closed:sse.state.closed,failed:sse.state.failed,transport:sse.state.transport,frames:sse.state.frames.map(frame=>({event:frame.event,scope:frame.data.scope,reason:frame.data.reason}))};primaryError.errorType=["TypeError","ReferenceError","RangeError","SyntaxError"].includes(error?.name)?error.name:undefined;try {
      primaryError.replicationState={
        slots:await sql`select slot_type,active,temporary,wal_status,pg_wal_lsn_diff(pg_current_wal_lsn(),confirmed_flush_lsn)::text as pending_bytes from pg_replication_slots`,
        subscriptions:await sql`select entity::text as table_name,claims_role::text as role,action_filter,cardinality(selected_columns) as selected_columns,count(*)::int as subscriptions from realtime.subscription group by entity,claims_role,action_filter,cardinality(selected_columns) order by entity::text,claims_role::text,action_filter`,
      };
    } catch { primaryError.replicationDiagnosticsFailed=true; }
    throw primaryError;}
  finally{
    try{
      await Promise.allSettled([...adapters.map(a=>a.stop()),...raw.map(a=>a.stop()),...(sse?[sse.stop()]:[]),...(warmup?[warmup.stop()]:[]),...(warmupProbe?[warmupProbe.stop()]:[])]);
      if(seeded){await cleanup(sql,api,ids,users);await assertPristineDatabase(sql);}
    }catch{if(!primaryError)throw new LocalRealtimeTestError("local_fixture_cleanup_failed");else primaryError.cleanupFailed=true;}
    finally{await sql.end({timeout:5}).catch(()=>{});network.restore();await Promise.allSettled(network.dispatcherClosures);}
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runLocalRealtimeIntegration()));}
  catch(error){const notRun=["not_configured","local_writes_not_acknowledged","unsafe_credentials_file"].includes(error?.code);console.log(JSON.stringify({status:notRun?"NOT_RUN":"FAIL",code:error instanceof LocalRealtimeTestError?error.code:"local_provider_operation_failed",...(error?.stage?{stage:error.stage}:{}),...(error?.cleanupFailed?{cleanupFailed:true}:{}),...(error?.errorType?{errorType:error.errorType}:{}),...(error?.subscriptionState?{subscriptionState:error.subscriptionState}:{}),...(error?.sseState?{sseState:error.sseState}:{}),...(error?.completedChecks?{completedChecks:error.completedChecks}:{}),...(error?.replicationState?{replicationState:error.replicationState}:{}),...(error?.replicationDiagnosticsFailed?{replicationDiagnosticsFailed:true}:{}),...(error?.socketStates?{socketStates:error.socketStates}:{}),...(error?.handshakeStates?{handshakeStates:error.handshakeStates}:{}),...(error?.requestStates?{requestStates:error.requestStates}:{})}));process.exitCode=notRun?2:1;}
}
