/** Authorized isolated SOURCE only. Migration/fixtures live in one rolled-back transaction. */
import assert from 'node:assert/strict';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadSchoolBackupTables } from './supabase-school-backup.mjs';
const sourceId='5c72773b1c0e8d61f4a753957fb44b41e62fcd74a28e9f8dae2e76d295f606fe';
const localRoot='/tmp/school-isolated-runtime-20261008';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const notificationLocalPlan={code:'sql31-source-single-rollback-v1',root:localRoot,sourceId,project:path.join(localRoot,'supabase-test'),home:path.join(localRoot,'supabase-home'),cli:path.join(localRoot,'cli/node_modules/.bin/supabase'),migration:path.join(repository,'supabase/migrations/20261031000000_school_notification_delivery.sql'),fixture:path.join(repository,'tests/supabase-notification-delivery.integration.sql')};
export function noticeLocalEndpoint(value,protocol){
  assert.equal(typeof value,'string');assert.match(value,protocol==='http:'?/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/:/^postgres(?:ql)?:\/\/(?:[^/@]+@)?127\.0\.0\.1:[1-9][0-9]{0,4}\/postgres$/);
  const url=new URL(value);assert.equal(url.protocol,protocol);assert.equal(url.hostname,'127.0.0.1');assert.ok(url.port&&Number(url.port)>1024);assert.ok(!url.search&&!url.hash);
  if(protocol==='http:')assert.ok(!url.username&&!url.password&&url.pathname==='/');
  else assert.equal(url.pathname,'/postgres');
  return url;
}
export function stripMigrationTransaction(source){
  assert.equal((source.match(/^begin;$/gmi)??[]).length,1);assert.equal((source.match(/^commit;$/gmi)??[]).length,1);
  return source.replace(/^begin;$/mi,'').replace(/^commit;$/mi,'');
}
async function privateJson(filename){
  const stat=await lstat(filename);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode&0o777,0o600);assert.equal(stat.uid,process.getuid());assert.ok(stat.size<4*1024*1024);
  const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);try{const current=await file.stat();assert.equal(current.ino,stat.ino);assert.equal(current.dev,stat.dev);return JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
}
export async function validateNoticeSourceIdentity(plan=notificationLocalPlan){
  assert.equal(plan.sourceId,sourceId);assert.equal(await realpath(plan.project),await realpath(notificationLocalPlan.project));
  assert.equal(await realpath(plan.home),await realpath(notificationLocalPlan.home));
  const state=await privateJson(path.join(plan.home,'stacks',sourceId,'state.json'));
  assert.equal(state.id,sourceId);assert.equal(state.runtime,'native');assert.equal(state.identity.projectRoot,await realpath(plan.project));
  const target=await privateJson(path.join(localRoot,'restore-target-start-result.json'));
  assert.notEqual(target.id,sourceId);assert.equal(target.runtime,'native');
  return {targetApi:noticeLocalEndpoint(target.endpoints['rest.http'].url,'http:').origin,targetDb:noticeLocalEndpoint(target.env.DB_URL,'postgresql:').port};
}
async function officialCommand(args,stdoutFile,stderrFile){
  const out=await open(stdoutFile,'wx',0o600),err=await open(stderrFile,'wx',0o600);
  try{
    const child=spawn(notificationLocalPlan.cli,args,{cwd:notificationLocalPlan.project,env:{PATH:process.env.PATH,HOME:process.env.HOME,SUPABASE_HOME:notificationLocalPlan.home,SUPABASE_TELEMETRY_DISABLED:'1'},stdio:['ignore',out.fd,err.fd]});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0);
  }finally{await out.close();await err.close();}
}
export async function acceptNoticeDeliveryLocal({confirmation,evidenceFile,receiptFile}){
  assert.equal(confirmation,'empty-source-sql31-rollback');
  for(const filename of[evidenceFile,receiptFile]){assert.ok(path.isAbsolute(filename));assert.ok(filename.endsWith('.json'));}
  const evidence=await open(evidenceFile,'wx',0o600);const report={planCode:notificationLocalPlan.code,scope:'synthetic-empty-source-loopback-only',status:'FAIL',providerRequests:0,authPasswordsCreated:0,checks:[],startedAt:new Date().toISOString()};
  let sql,connection,started=false,transaction=false,step='identity';
  const check=(label,condition)=>{assert.ok(condition);report.checks.push({label,result:'passed'});};
  async function emptySnapshot(){
    const tables=await loadSchoolBackupTables();assert.equal(tables.length,33);
    const publicTables=await sql`select tablename from pg_tables where schemaname='public' order by tablename`;
    assert.deepEqual(publicTables.map(row=>row.tablename),tables.map(row=>row.name).sort());
    let rows=0;for(const table of tables){assert.match(table.name,/^[a-z_]+$/);rows+=Number((await sql.unsafe(`select count(*)::integer as count from public."${table.name}"`))[0].count);}
    const auth=Number((await sql`select count(*)::integer as count from auth.users`)[0].count);
    const storage=Number((await sql`select count(*)::integer as count from storage.objects`)[0].count);
    const absent=await sql`select to_regclass('public.notification_channel_preferences') is null and to_regclass('public.school_push_subscriptions') is null and to_regclass('public.notification_delivery_outbox') is null as absent`;
    return {tables:tables.length,rows,auth,storage,migration31Absent:absent[0].absent};
  }
  try{
    const excluded=await validateNoticeSourceIdentity();check('Official source identity and distinct restored target verified',true);
    step='start';started=true;
    await officialCommand(['stack','start','--runtime','native','--eager','--output-format','json'],receiptFile,receiptFile+'.stderr.log');
    const runtime=await privateJson(receiptFile);assert.equal(runtime.id,sourceId);assert.equal(runtime.runtime,'native');
    const api=noticeLocalEndpoint(runtime.endpoints['rest.http'].url,'http:');const database=noticeLocalEndpoint(runtime.env.DB_URL,'postgresql:');
    assert.equal(api.origin,noticeLocalEndpoint(runtime.env.API_URL,'http:').origin);assert.equal(Number(database.port),runtime.endpoints['database.sql'].port);
    assert.notEqual(api.origin,excluded.targetApi);assert.notEqual(database.port,excluded.targetDb);
    await validateNoticeSourceIdentity();check('Native source API and SQL are literal loopback and not target ports',true);
    sql=postgres(database.href,{max:1,prepare:false,connect_timeout:10,idle_timeout:20,onnotice:()=>undefined});
    step='preflight';report.preflight=await emptySnapshot();assert.deepEqual(report.preflight,{tables:33,rows:0,auth:0,storage:0,migration31Absent:true});check('Preflight Auth0/public33 rows0/Storage0 and migration31 absent',true);
    const migration=stripMigrationTransaction(await readFile(notificationLocalPlan.migration,'utf8'));
    const fixture=await readFile(notificationLocalPlan.fixture,'utf8');assert.ok(!/^\s*(begin|commit|rollback)\s*;/mi.test(fixture));
    connection=await sql.reserve();step='migration';await connection.unsafe('begin');transaction=true;await connection.unsafe("set local statement_timeout='30s'");
    await connection.unsafe(migration);check('SQL31 compiles in the single external transaction',true);
    step='fixture';await connection.unsafe(fixture);check('Real PostgreSQL five-account consent/RLS/resource/claim/replay fixture passes without provider delivery',true);
    step='rollback';await connection.unsafe('rollback');transaction=false;await connection.release();connection=null;check('DDL and synthetic fixture rolled back together',true);
    step='postflight';report.postflight=await emptySnapshot();assert.deepEqual(report.postflight,report.preflight);check('Postflight Auth0/public33 rows0/Storage0 and migration31 absent',true);
    report.status='PASS';
  }catch(error){report.failure={step,code:/^[0-9A-Z]{5}$/.test(error?.code??'')?error.code:'local_acceptance_failed'};}
  finally{
    if(transaction&&connection){try{await connection.unsafe('rollback');transaction=false;}catch{report.rollbackUnconfirmed=true;report.status='FAIL';}}
    if(connection){await connection.release();connection=null;}
    if(sql){try{if(!report.postflight){report.postflight=await emptySnapshot();assert.deepEqual(report.postflight,{tables:33,rows:0,auth:0,storage:0,migration31Absent:true});check('Failure cleanup confirmed complete rollback and empty source',true);}}catch{report.postflightUnconfirmed=true;report.status='FAIL';}await sql.end({timeout:5});}
    if(started){try{await officialCommand(['stack','stop','--output-format','json'],receiptFile+'.stop.json',receiptFile+'.stop.stderr.log');check('Official source stop completed preserving disks/reports',true);}catch{report.stopUnconfirmed=true;report.status='FAIL';}}
    report.finishedAt=new Date().toISOString();await evidence.writeFile(JSON.stringify(report,null,2)+'\n');await evidence.close();
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await acceptNoticeDeliveryLocal({confirmation:process.env.LOCAL_SCHOOL_NOTICE_CONFIRM,evidenceFile:process.env.LOCAL_SCHOOL_NOTICE_EVIDENCE_FILE,receiptFile:process.env.LOCAL_SCHOOL_NOTICE_RECEIPT_FILE});console.log(JSON.stringify({status:report.status,checks:report.checks.length,providerRequests:report.providerRequests,failure:report.failure}));if(report.status!=='PASS')process.exitCode=1;}
  catch{console.error('Isolated notice acceptance refused. No provider dispatch requested.');process.exitCode=1;}
}
