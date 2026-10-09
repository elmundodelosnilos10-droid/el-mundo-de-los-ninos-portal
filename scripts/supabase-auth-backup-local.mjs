/** Isolated local Auth complement. Never loads project env or connects to a remote host. */
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import postgres from "postgres";
import {deriveBackupKey,encryptBackupFile,decryptBackupFile,sha256} from "./backup-crypto.mjs";
import {stableStringify} from "./supabase-school-backup.mjs";
import {assertLoopbackUrl,LocalRealtimeTestError} from "../tests/realtime-local/guards.mjs";

const fail=code=>{throw new LocalRealtimeTestError(code);};
export function privateLocalFile(filename){
 let fd;try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid()||stat.size>1000000)fail("unsafe_local_private_file");return fs.readFileSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function nativeDumpEndpoint(script){
 const values={};for(const field of ["HOST","PORT","USER","DATABASE"]){const match=script.match(new RegExp('^export PG'+field+'="([^"\\r\\n]*)"$','m'));if(!match)fail("unrecognized_official_dump_script");values[field]=match[1];}
 if(!script.includes('--schema "auth"')||!script.includes('--data-only')||!script.includes('--exclude-table "auth.schema_migrations"')||!script.includes('SET session_replication_role = replica;'))fail("official_auth_dump_filter_required");return values;
}
export function verifyNativeDumpSource(script,databaseUrl){const expected=assertLoopbackUrl(databaseUrl,["postgres:","postgresql:"]);const actual=nativeDumpEndpoint(script);if(actual.HOST!==expected.hostname.replace(/^\[|\]$/g,"")||actual.PORT!==expected.port||actual.USER!=="postgres"||actual.DATABASE!=="postgres")fail("native_dump_source_mismatch");}
export function assertSyntheticAuthRows(rows){if(!rows.length||rows.length>20||rows.some(row=>!/^http-[a-f0-9]{8}-(direction|teacher|familya|familyb)@example\.test$/.test(row.email)&&!/^realtime-local-[a-f0-9]{12}-(teacher|family-a|family-b)@example\.com$/.test(row.email))||rows.some(row=>typeof row.encrypted_password!=="string"||!row.encrypted_password.startsWith("$2")))fail("non_synthetic_auth_source");}
async function protectedCli(config,args,label){
 const stdoutFile=path.join(config.scratch,label+".stdout.private"),stderrFile=path.join(config.scratch,label+".stderr.private");
 const out=fs.openSync(stdoutFile,"wx",0o600),err=fs.openSync(stderrFile,"wx",0o600);
 try{const exit=await new Promise(resolve=>{const child=spawn(config.cli,args,{cwd:config.workdir,env:{PATH:config.pgBin+path.delimiter+process.env.PATH,HOME:process.env.HOME,SUPABASE_HOME:config.supabaseHome,SUPABASE_TELEMETRY_DISABLED:"1",SUPABASE_DB_PASSWORD:decodeURIComponent(new URL(config.databaseUrl).password)},stdio:["ignore",out,err]});const timeout=setTimeout(()=>child.kill("SIGTERM"),120000);child.on("error",()=>{clearTimeout(timeout);resolve(-1);});child.on("close",code=>{clearTimeout(timeout);resolve(code);});});if(exit!==0)fail("official_local_dump_failed");return privateLocalFile(stdoutFile).toString("utf8");}finally{fs.closeSync(out);fs.closeSync(err);fs.rmSync(stdoutFile,{force:true});fs.rmSync(stderrFile,{force:true});}
}
async function authSnapshot(sql){
 const users=await sql`select id,email,encrypted_password from auth.users order by id`;assertSyntheticAuthRows(users);
 const identities=await sql`select * from auth.identities order by id`;
 const columns=await sql`select table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='auth' order by table_name,ordinal_position`;
 return{userCount:users.length,identityCount:identities.length,userUuidPasswordDigest:sha256(stableStringify(users)),identitiesDigest:sha256(stableStringify(identities)),authSchemaDigest:sha256(stableStringify(columns)),users};
}
export async function captureLocalAuthBackup(config){
 const parsed=assertLoopbackUrl(config.databaseUrl,["postgres:","postgresql:"]);
 for(const file of [config.cli,config.pgBin,config.workdir,config.supabaseHome,config.directory,config.scratch,config.passphraseFile])if(!path.isAbsolute(file)||!file.startsWith("/tmp/school-isolated-runtime-"))fail("isolated_paths_required");
 const passphrase=privateLocalFile(config.passphraseFile).toString("utf8");
 const sql=postgres({host:parsed.hostname.replace(/^\[|\]$/g,""),port:Number(parsed.port),database:"postgres",username:"postgres",password:decodeURIComponent(parsed.password),ssl:false,max:1,onnotice:()=>{},connect_timeout:5});
 fs.mkdirSync(config.directory,{mode:0o700});fs.mkdirSync(config.scratch,{mode:0o700});
 const plaintextFile=path.join(config.scratch,"auth-data.sql.private");let key;
 try{
  const before=await authSnapshot(sql);
  const connectionArgument=new URL(config.databaseUrl);connectionArgument.password="";
  const sourceArgs=["--db-url",connectionArgument.href];
  const dryRun=await protectedCli(config,["db","dump",...sourceArgs,"--dry-run","--data-only","--use-copy","--schema","auth"],"auth-dry-run");verifyNativeDumpSource(dryRun,config.databaseUrl);
  fs.writeFileSync(plaintextFile,"",{mode:0o600,flag:"wx"});
  await protectedCli(config,["db","dump",...sourceArgs,"--data-only","--use-copy","--schema","auth","--file",plaintextFile],"auth-dump");
  const bytes=privateLocalFile(plaintextFile);if(!bytes.includes(Buffer.from('COPY "auth"."users"'))||!bytes.includes(Buffer.from('COPY "auth"."identities"'))||bytes.includes(Buffer.from('COPY "public".'))||bytes.includes(Buffer.from('COPY "auth"."schema_migrations"')))fail("unexpected_auth_dump_scope");
  const after=await authSnapshot(sql);if(before.userUuidPasswordDigest!==after.userUuidPasswordDigest||before.identitiesDigest!==after.identitiesDigest||before.authSchemaDigest!==after.authSchemaDigest)fail("auth_changed_during_backup");
  const salt=randomBytes(16);key=await deriveBackupKey(passphrase,salt);
  const meta={format:"school-auth-cli-local-complement",version:1,createdAt:new Date().toISOString(),salt:salt.toString("base64")};
  const manifest={...before,dataSha256:sha256(bytes),dataSize:bytes.length,dump:"auth-data.sql.enc",method:"supabase-cli-local-native-data-only-auth",managedSchemaInstalledSeparately:true};
  fs.writeFileSync(path.join(config.directory,"auth-meta.json"),JSON.stringify(meta),{mode:0o600,flag:"wx"});
  fs.writeFileSync(path.join(config.directory,manifest.dump),encryptBackupFile(bytes,key,manifest.dump),{mode:0o600,flag:"wx"});
  fs.writeFileSync(path.join(config.directory,"auth-manifest.json.enc"),encryptBackupFile(Buffer.from(stableStringify(manifest)),key,"auth-manifest.json.enc"),{mode:0o600,flag:"wx"});
  const reopened=decryptBackupFile(fs.readFileSync(path.join(config.directory,manifest.dump)),key,manifest.dump);if(sha256(reopened)!==manifest.dataSha256)fail("auth_archive_verification_failed");
  return{status:"CAPTURED_AND_VERIFIED",scope:"synthetic-local-auth-data",users:before.userCount,identities:before.identityCount,authRestoreLoginProven:false,plaintextRemovedOnExit:true};
 }finally{key?.fill(0);await sql.end({timeout:5});fs.rmSync(config.scratch,{recursive:true,force:true});}
}
