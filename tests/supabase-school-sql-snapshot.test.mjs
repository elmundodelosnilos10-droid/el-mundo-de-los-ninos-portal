import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { archiveSqlSnapshot, parseSnapshotCsv, parseSqlSnapshotArgs, SQL_SNAPSHOT_AUTH_CATALOG, SQL_SNAPSHOT_MAX_BYTES, SQL_SNAPSHOT_PROJECT_REF, validateSqlSnapshot, verifySqlSnapshot } from '../scripts/supabase-school-sql-snapshot.mjs';
import { loadSchoolBackupTables } from '../scripts/supabase-school-backup.mjs';
import { decryptBackupFile, deriveBackupKey } from '../scripts/backup-crypto.mjs';

const tables = await loadSchoolBackupTables();
const userId = '11111111-1111-4111-8111-111111111111';
const identityId = '22222222-2222-4222-8222-222222222222';
const phrase = 'synthetic snapshot encryption phrase';
function synthetic() {
  const authColumns = { ...Object.fromEntries(SQL_SNAPSHOT_AUTH_CATALOG.map(name => [name,['id']])), users: ['id','encrypted_password','email'], identities: ['id','user_id','provider','provider_id'], schema_migrations: ['version'], refresh_tokens: ['id','token'] };
  const authRows = { ...Object.fromEntries(SQL_SNAPSHOT_AUTH_CATALOG.map(name => [name,[]])), users: [JSON.stringify({ id:userId,encrypted_password:'$2a$10$'+'a'.repeat(53),email:'synthetic@example.invalid' })], identities: [JSON.stringify({id:identityId,user_id:userId,provider:'email',provider_id:userId})],schema_migrations:['{"version":"20260101000000"}'],refresh_tokens:['{"id":9223372036854775807,"token":"SYNTHETIC-PRIVATE-TOKEN"}'] };
  return {format:'school-sql-snapshot',version:1,project_ref:SQL_SNAPSHOT_PROJECT_REF,captured_at:'2026-10-09T13:00:00.123456+00:00',postgres_version:'PostgreSQL 17 synthetic',public_catalog:tables.map(t=>t.name),auth_catalog:Object.keys(authColumns),public_rows:Object.fromEntries(tables.map(t=>[t.name,[]])),auth_rows:authRows,columns:[...tables.flatMap(t=>t.columns.map((column_name,i)=>({table_schema:'public',table_name:t.name,column_name,ordinal_position:i+1,data_type:'synthetic'}))),...Object.entries(authColumns).flatMap(([table_name,columns])=>columns.map((column_name,i)=>({table_schema:'auth',table_name,column_name,ordinal_position:i+1})))],constraints:null,indexes:[],triggers:[],functions:[{name:'synthetic',definition:'select 1'}],policies:[],table_acl:[],migration_history:[{version:'20261008000000'}],enums:null,sequences:[{last_value:'9223372036854775807'}],storage_buckets:[{id:'school-files',name:'school-files',public:false}],school_file_object_count:0,students_count:0};
}
const csv = snapshot => Buffer.from('snapshot\r\n"'+JSON.stringify(snapshot).replaceAll('"','""')+'"\r\n');
const validate = snapshot => validateSqlSnapshot(Buffer.from(JSON.stringify(snapshot)),tables);
async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(),'school-sql-snapshot-'));
  t.after(()=>rm(parent,{recursive:true,force:true}));
  const csvFile=path.join(parent,'snapshot.csv'), passphraseFile=path.join(parent,'phrase.private'), directory=path.join(parent,'archive');
  await writeFile(csvFile,csv(synthetic()),{mode:0o600}); await writeFile(passphraseFile,phrase+'\n',{mode:0o600});
  return { parent,csvFile,passphraseFile,directory };
}

test('one-column RFC4180 CSV preserves escaped quotes and embedded newline exactly',()=>{
  const text='{"text":"line\\nquote\\\"","large":9223372036854775807}';
  assert.equal(parseSnapshotCsv(Buffer.from('\ufeff"snapshot"\r\n"'+text.replaceAll('"','""')+'"\r\n')).toString(),text);
  assert.equal(parseSnapshotCsv(Buffer.from('snapshot\n"{\n}"\n')).toString(),'{\n}');
});
test('CSV rejects extra records, columns, unclosed quotes, invalid UTF8 and >8MiB',()=>{
  for(const input of ['snapshot\n{}\n{}','snapshot,other\n{},{}','snapshot\n"bad','snapshot\n{}\n\n','other\n{}','snapshot\n"{}"junk','snapshot\r{}','snapshot\n']) assert.throws(()=>parseSnapshotCsv(Buffer.from(input)));
  assert.throws(()=>parseSnapshotCsv(Buffer.from([0xff]))); assert.throws(()=>parseSnapshotCsv(Buffer.alloc(SQL_SNAPSHOT_MAX_BYTES+1)));
});
test('valid snapshot has all33 public tables and the approved Auth27 catalog with row strings',()=>{
  const s=synthetic(),result=validate(s); assert.equal(result.publicTables,33); assert.equal(result.authTables,27); assert.equal(result.authUsers,1); assert.equal(result.authIdentities,1); assert.equal(result.authRows,4); assert.equal(result.objects,0);
  assert.equal(s.auth_rows.refresh_tokens[0],'{"id":9223372036854775807,"token":"SYNTHETIC-PRIVATE-TOKEN"}');
});
test('rejects wrong project/version or missing metadata field without reflecting payload',()=>{
  for(const mutate of [s=>s.project_ref='other',s=>s.version=2,s=>delete s.sequences,s=>s.constraints='SYNTHETIC-PRIVATE-TOKEN']) {
    const s=synthetic(); mutate(s); assert.throws(()=>validate(s),error=>!error.message.includes('SYNTHETIC-PRIVATE-TOKEN'));
  }
});
test('rejects omitted/extra/duplicate public or Auth tables and missing row collections',()=>{
  for(const mutate of [s=>s.public_catalog.pop(),s=>s.public_catalog.push('unknown'),s=>s.public_catalog[0]=s.public_catalog[1],s=>delete s.public_rows.notifications,s=>s.auth_catalog.push('users'),s=>delete s.auth_rows.refresh_tokens,s=>s.auth_catalog=s.auth_catalog.filter(x=>x!=='schema_migrations'),s=>s.auth_rows.unknown=[]]) {const s=synthetic();mutate(s);assert.throws(()=>validate(s));}
});
test('rejects coherent omission of an Auth table from catalog, rows and columns',()=>{
  const s=synthetic();s.auth_catalog=s.auth_catalog.filter(name=>name!=='flow_state');delete s.auth_rows.flow_state;s.columns=s.columns.filter(column=>!(column.table_schema==='auth'&&column.table_name==='flow_state'));
  assert.throws(()=>validate(s));
});
test('rejects missing/extra/duplicate column or row columns and non-string rows',()=>{
  for(const mutate of [s=>s.columns.shift(),s=>s.columns.push(s.columns[0]),s=>s.columns[0].column_name='unknown',s=>s.auth_rows.users=[{id:userId}],s=>s.auth_rows.users=[JSON.stringify({id:userId,encrypted_password:''})],s=>s.auth_rows.users.push(s.auth_rows.users[0])]) {const s=synthetic();mutate(s);assert.throws(()=>validate(s));}
});
test('rejects duplicate PKs even if their row text differs',()=>{
  const s=synthetic();const row=Object.fromEntries(tables.find(t=>t.name==='school_years').columns.map(c=>[c,c==='id'?userId:null]));s.public_rows.school_years=[JSON.stringify({...row,name:'A'}),JSON.stringify({...row,name:'B'})];
  assert.throws(()=>validate(s));
});
test('rejects malformed Auth UUID/hash or orphan identity',()=>{
  for(const mutate of [s=>s.auth_rows.users=[JSON.stringify({id:'bad',encrypted_password:'',email:'x'})],s=>s.auth_rows.users=[JSON.stringify({id:userId,encrypted_password:'plaintext',email:'x'})],s=>s.auth_rows.identities=[JSON.stringify({id:identityId,user_id:identityId,provider:'email',provider_id:'x'})]]) {const s=synthetic();mutate(s);assert.throws(()=>validate(s));}
});
test('fails closed on students/files counts or public/missing school storage bucket',()=>{
  for(const mutate of [s=>s.students_count=1,s=>s.school_file_object_count=1,s=>s.storage_buckets[0].public=true,s=>s.storage_buckets=[],s=>s.storage_buckets.push(s.storage_buckets[0])]) {const s=synthetic();mutate(s);assert.throws(()=>validate(s));}
});
test('encrypt+verify is byte-exact and preserves 64bit Auth text, sequences and metadata',async t=>{
  const f=await fixture(t),result=await archiveSqlSnapshot(f);assert.equal(result.offlineVerified,true);assert.equal(result.sourceByteExactCompared,true);assert.equal(result.restored,false);assert.equal(result.cliDump,false);
  assert.equal('tableCounts' in result,false);assert.equal('schemaSha256' in result,false);
  const meta=JSON.parse(await readFile(path.join(f.directory,'backup-meta.json'),'utf8'));const key=await deriveBackupKey(phrase,Buffer.from(meta.salt,'base64'));
  const encrypted=await readFile(path.join(f.directory,'snapshot.csv.enc'));assert.equal(encrypted.includes(Buffer.from('SYNTHETIC-PRIVATE-TOKEN')),false);
  const decrypted=decryptBackupFile(encrypted,key,'school-sql-snapshot-encrypted:1:snapshot.csv.enc');assert.deepEqual(decrypted,await readFile(f.csvFile));assert.ok(decrypted.includes(Buffer.from('9223372036854775807')));key.fill(0);decrypted.fill(0);
  assert.deepEqual(await verifySqlSnapshot({...f,expectedCsvFile:f.csvFile}),result);
});
test('wrong phrase, modified ciphertext and different original CSV fail verification',async t=>{
  const f=await fixture(t);await archiveSqlSnapshot(f);
  await writeFile(f.passphraseFile,'different synthetic snapshot phrase');await assert.rejects(verifySqlSnapshot(f));await writeFile(f.passphraseFile,phrase);
  await writeFile(f.csvFile,csv({...synthetic(),postgres_version:'different'}));await assert.rejects(verifySqlSnapshot({...f,expectedCsvFile:f.csvFile}));
  const file=path.join(f.directory,'snapshot.csv.enc'),bytes=await readFile(file);bytes[bytes.length-1]^=1;await writeFile(file,bytes);await assert.rejects(verifySqlSnapshot(f));
});
test('authenticated manifest mismatch and tampered metadata fail verification',async t=>{
  const f=await fixture(t);await archiveSqlSnapshot(f);const manifest=path.join(f.directory,'manifest.enc'),bytes=await readFile(manifest);bytes[20]^=1;await writeFile(manifest,bytes);await assert.rejects(verifySqlSnapshot(f));
  const meta=path.join(f.directory,'backup-meta.json');await writeFile(meta,'{}');await assert.rejects(verifySqlSnapshot(f));
});
test('private file guard rejects world-readable input, symlink and repeated archive paths',async t=>{
  const f=await fixture(t);await chmod(f.csvFile,0o644);await assert.rejects(archiveSqlSnapshot(f));await chmod(f.csvFile,0o600);
  const link=path.join(f.parent,'link.csv');await symlink(f.csvFile,link);await assert.rejects(archiveSqlSnapshot({...f,csvFile:link}));
  await assert.rejects(archiveSqlSnapshot({...f,passphraseFile:f.csvFile}));await archiveSqlSnapshot(f);await assert.rejects(archiveSqlSnapshot(f));
});
test('CLI offline verify works without Supabase credentials and emits no private row data',async t=>{
  const f=await fixture(t);await archiveSqlSnapshot(f);
  const child=spawnSync(process.execPath,[path.resolve('scripts/supabase-school-sql-snapshot.mjs'),'verify',f.directory,f.passphraseFile,f.csvFile],{env:{PATH:process.env.PATH},encoding:'utf8'});
  assert.equal(child.status,0);assert.match(child.stdout,/"offlineVerified":true/);assert.doesNotMatch(child.stdout+child.stderr,/SYNTHETIC-PRIVATE-TOKEN|encrypted_password|synthetic@example|\$2a\$/);
});
test('argument parser accepts only explicit archive/verify path arguments',()=>{
  assert.equal(parseSqlSnapshotArgs(['archive','/csv','/new','/phrase']).mode,'archive');assert.equal(parseSqlSnapshotArgs(['verify','/new','/phrase']).mode,'verify');
  assert.throws(()=>parseSqlSnapshotArgs(['restore','/new','/phrase']));assert.throws(()=>parseSqlSnapshotArgs(['archive','/csv','/new','/phrase','--url','https://remote']));
});
