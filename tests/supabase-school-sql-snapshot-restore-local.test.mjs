// Offline contract tests with synthetic SQL replies. These do not prove PostgreSQL/Auth execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,realpath,rm,writeFile,chmod,utimes } from 'node:fs/promises';
import path from 'node:path';
import { loadSchoolBackupTables,stableStringify } from '../scripts/supabase-school-backup.mjs';
import { archiveSqlSnapshot,SQL_SNAPSHOT_AUTH_CATALOG,SQL_SNAPSHOT_PROJECT_REF } from '../scripts/supabase-school-sql-snapshot.mjs';
import { conservativeSequenceRestart,openSchoolSnapshotLocalDatabase,restoreSchoolSnapshotRows,validateSnapshotNativeTarget,readSchoolSqlSnapshotArchive,preflightSchoolSnapshotMetadata } from '../scripts/supabase-school-sql-snapshot-restore-local.mjs';
const nativeInstances=()=>[{creation:{service:'pgmeta',config:{databaseUrl:'postgresql://supabase_admin:synthetic-local-admin@127.0.0.1:38888/postgres'}}}];
const tables=await loadSchoolBackupTables(),id='11111111-1111-4111-8111-111111111111',stackId='a'.repeat(64);
function snapshot(){
 const authColumns={...Object.fromEntries(SQL_SNAPSHOT_AUTH_CATALOG.map(name=>[name,['id']])),users:['id','encrypted_password'],identities:['id','user_id','provider','provider_id'],schema_migrations:['version'],refresh_tokens:['id','token']};
 return {format:'school-sql-snapshot',version:1,project_ref:SQL_SNAPSHOT_PROJECT_REF,captured_at:'2026-10-09T00:00:00Z',postgres_version:'synthetic PG17',public_catalog:tables.map(t=>t.name),auth_catalog:[...SQL_SNAPSHOT_AUTH_CATALOG],public_rows:Object.fromEntries(tables.map(t=>[t.name,[]])),auth_rows:{...Object.fromEntries(SQL_SNAPSHOT_AUTH_CATALOG.map(name=>[name,[]])),users:[JSON.stringify({id,encrypted_password:'$2a$10$'+'a'.repeat(53)})],schema_migrations:Array.from({length:82},(_,i)=>JSON.stringify({version:String(i+1)}))},columns:[...tables.flatMap(t=>t.columns.map((column_name,i)=>({table_schema:'public',table_name:t.name,column_name,ordinal_position:i+1}))),...Object.entries(authColumns).flatMap(([table_name,cols])=>cols.map((column_name,i)=>({table_schema:'auth',table_name,column_name,ordinal_position:i+1})))],constraints:tables.map(t=>({schema:'public',table:t.name,name:t.name+'_pkey',kind:'p',definition:'PRIMARY KEY ('+t.primaryKey.join(', ')+')'})),indexes:tables.map(t=>({schemaname:'public',tablename:t.name,indexname:t.name+'_pkey',tablespace:null,indexdef:'CREATE UNIQUE INDEX '+t.name+'_pkey ON public.'+t.name+' ('+t.primaryKey.join(', ')+')'})),triggers:[{schema:'public',table:'user_roles',name:'synthetic_guard',definition:'CREATE TRIGGER synthetic_guard synthetic'}],functions:[{name:'school_actor_active',definition:'CREATE FUNCTION public.school_actor_active() synthetic'}],policies:[{schemaname:'public',tablename:'profiles',policyname:'synthetic_profile_read',permissive:'PERMISSIVE',roles:['authenticated'],cmd:'SELECT',qual:'synthetic_policy',with_check:null}],table_acl:tables.map(t=>({schema:'public',table:t.name,owner:'postgres',acl:'{postgres=arwdDxt/postgres}',rls:true,force_rls:true})),migration_history:[],enums:[{schema:'auth',type:'synthetic_auth_enum',sort_order:1,label:'synthetic'}],sequences:[],storage_buckets:[{id:'school-files',name:'school-files',public:false}],school_file_object_count:0,students_count:0};
}
function receipt(){return {id:stackId,env:{DB_URL:'postgresql://postgres:synthetic-local-password@127.0.0.1:38888/postgres'},endpoints:{'rest.http':{url:'http://127.0.0.1:38889/'},'auth.http':{url:'http://127.0.0.1:38889/'},'storage.http':{url:'http://127.0.0.1:38889/'}}};}
async function sqlFixture(t,source,{failAt=null,foreignInvalid=false,columnMismatch=false,unknownRow=false,generated=[],sequence=null,storageObjects='0',defaultMatching=false,nonemptyAuth=false,migrationsMismatch=false,postWriteMismatch=false,metadataMismatch=null,storageMetadataExtra=false,targetAclExtraGrant=false,targetRlsDisabled=false,targetPolicyExtra=false}={}){
 const base=await mkdtemp('/tmp/school-isolated-runtime-sqltest-');t.after(()=>rm(base,{recursive:true,force:true}));
 const project=path.join(base,'new-target');await mkdir(project);const projectDirectory=await realpath(project);
 const stateDirectory=path.join(base,'home','stacks',stackId);await mkdir(stateDirectory,{recursive:true});const stateFile=path.join(stateDirectory,'state.json'),receiptFile=path.join(base,'receipt.json');
 await writeFile(stateFile,JSON.stringify({runtime:'native',identity:{projectRoot:projectDirectory},instances:nativeInstances()}),{mode:0o600});await writeFile(receiptFile,JSON.stringify(receipt()),{mode:0o600});
 const sql=await openSchoolSnapshotLocalDatabase({receiptFile,stateFile,expectedStackId:stackId,projectDirectory});t.after(()=>sql.end({timeout:1}));
 const original=Object.fromEntries([...tables.map(t=>['public.'+t.name,[]]),...SQL_SNAPSHOT_AUTH_CATALOG.map(name=>['auth.'+name,name==='schema_migrations'?[...source.auth_rows.schema_migrations]:[]])]);
 if(unknownRow)original['public.communication_settings']=['{"synthetic":"unrelated"}'];
 if(defaultMatching){const row=Object.fromEntries(tables.find(t=>t.name==='communication_settings').columns.map(column=>[column,column==='id'?'school':null]));source.public_rows.communication_settings=[JSON.stringify(row)];original['public.communication_settings']=[JSON.stringify(row)];}
 if(nonemptyAuth)original['auth.users']=[...source.auth_rows.users];
 if(migrationsMismatch)original['auth.schema_migrations'][0]='{"version":"different"}';
 const metadataTarget=structuredClone(Object.fromEntries(['constraints','indexes','triggers','functions','policies','table_acl','enums'].map(field=>[field,source[field]??[]])));
 let current=structuredClone(original);const calls=[];let rollback=false,committed=false,restart;
 const unsafe=async(text,params=[])=>{
   calls.push({text,params});if(failAt&&text.includes(failAt)){const error=Error('SYNTHETIC PRIVATE DRIVER ERROR password/hash/token');error.code='42703';throw error;}
   if(text.includes('r.rolsuper'))return [{rolsuper:true}];
   if(text.startsWith('SET ')||text.startsWith('LOCK '))return [];
   if(text.includes('AS relation_name'))return Object.keys(original).sort().map(relation_name=>({relation_name}));
   const aclNormalize=row=>({...row,acl:row.acl===null?[row.owner+'=arwdDxt/'+row.owner]:row.acl.slice(1,-1).split(',').sort()});
   if(text.startsWith('SELECT (value ||'))return JSON.parse(params[0]).table_acl.filter(row=>row.schema==='public').map(row=>({row_text:stableStringify(aclNormalize(row))})).sort((a,b)=>a.row_text.localeCompare(b.row_text));
   if(text.startsWith('SELECT value::text AS row_text')){const key=text.match(/->'([^']+)'/)[1];let rows=JSON.parse(params[0])[key]??[];const scope=text.match(/WHERE value->>'([^']+)'='([^']+)'/);if(scope)rows=rows.filter(row=>row[scope[1]]===scope[2]);return rows.map(x=>({row_text:stableStringify(x)})).sort((a,b)=>a.row_text.localeCompare(b.row_text));}
   let metadataField;
   if(text.startsWith('SELECT jsonb_build_object'))metadataField=text.includes('FROM pg_constraint')?'constraints':text.includes('FROM pg_trigger')?'triggers':text.includes('FROM pg_proc')?'functions':text.includes('FROM pg_type')?'enums':text.includes('FROM pg_class')?'table_acl':null;
   if(text.startsWith('SELECT to_jsonb(i)::text'))metadataField='indexes';
   if(text.startsWith('SELECT to_jsonb(p)::text'))metadataField='policies';
   if(metadataField){const scope=text.includes("='storage'")?'storage':'public',scopeKey=['indexes','policies'].includes(metadataField)?'schemaname':'schema';let rows=metadataTarget[metadataField].filter(row=>metadataField==='functions'||row[scopeKey]===scope);if(metadataField==='table_acl'&&scope==='public'&&targetAclExtraGrant)rows=rows.map((row,i)=>i===0?{...row,acl:row.acl.slice(0,-1)+',=r/postgres}'}:row);if(metadataField==='table_acl'&&scope==='public'&&targetRlsDisabled)rows=rows.map((row,i)=>i===0?{...row,rls:false,force_rls:false}:row);if(metadataField==='policies'&&scope==='public'&&targetPolicyExtra)rows=[...rows,{...rows[0],policyname:'unexpected_public_all',roles:['public'],cmd:'ALL',qual:'true',with_check:'true'}];if(metadataMismatch===metadataField&&scope==='public')rows=rows.length?rows.slice(1):[{schema:'public',synthetic:'unexpected'}];if(storageMetadataExtra&&scope==='storage')rows=[...rows,{schema:'storage',synthetic:'managed-extra'}];if(metadataField==='table_acl'&&scope==='public')rows=rows.map(aclNormalize);return rows.map(row=>({row_text:stableStringify(row)})).sort((a,b)=>a.row_text.localeCompare(b.row_text));} 
   if(text.includes('to_jsonb(c)::text'))return (columnMismatch?source.columns.slice(1):source.columns).map(x=>({row_text:stableStringify(x)})).sort((a,b)=>a.row_text.localeCompare(b.row_text));
   if(text.startsWith('SELECT table_schema,table_name,column_name'))return generated;
   if(text.includes('FROM pg_trigger'))return [];
   if(text.includes('object_count FROM storage.objects'))return [{object_count:storageObjects}];
   if(text.includes('FROM storage.buckets'))return [{id:'school-files',name:'school-files',public:false}];
   if(text.startsWith('SELECT value AS raw_row'))return JSON.parse(params[0]).map(raw_row=>({raw_row,row_text:raw_row})).sort((a,b)=>a.row_text.localeCompare(b.row_text));
   if(text.startsWith('SELECT row_to_json(t)')){const match=text.match(/FROM "([^"]+)"\."([^"]+)"/);return (postWriteMismatch&&restart&&match[2]==='users'?['{"invalid":"late"}']:current[match[1]+'.'+match[2]]).map(row_text=>({row_text})).sort((a,b)=>a.row_text.localeCompare(b.row_text));}
   if(text.startsWith('INSERT INTO')){const match=text.match(/INSERT INTO "([^"]+)"\."([^"]+)"/);current[match[1]+'.'+match[2]].push(params[0]);return [];}
   if(text.includes("WHERE c.contype='f'"))return [{conname:'synthetic_fk',conmatchtype:'f',child_schema:'auth',child_table:'identities',parent_schema:'auth',parent_table:'users',child_columns:['user_id','provider_id'],parent_columns:['id','id']}];
   if(text.startsWith('SELECT 1 FROM'))return foreignInvalid?[{synthetic:1}]:[];
   if(text.includes('jsonb_to_recordset'))return sequence?[sequence.source]:[];
   if(text.includes('FROM pg_sequences'))return sequence?[sequence.target]:[];
   if(text.startsWith('SELECT DISTINCT n.nspname'))return [{table_schema:'auth',table_name:'refresh_tokens',column_name:'id'}];
   if(text.startsWith('SELECT MAX('))return [{maximum_id:sequence?.maximumId??null}];
   if(text.startsWith('ALTER SEQUENCE')){restart=text.match(/RESTART WITH (-?\d+)$/)[1];return [];}
   if(text.startsWith('SELECT last_value::text'))return [{last_value:restart,is_called:false}];
   throw Error('unexpected synthetic query');
 };
 sql.unsafe=unsafe;sql.begin=async fn=>{try{const result=await fn({unsafe});committed=true;return result;}catch(error){rollback=true;current=structuredClone(original);throw error;}};
 return {sql,calls,receiptFile,stateFile,projectDirectory,get rows(){return current},get rollback(){return rollback},get committed(){return committed}};
}

test('Native guard denies remote/DNS/credential API URLs, identity mismatch and preserved target IDs',()=>{
 const projectDirectory='/private/tmp/school-isolated-runtime-test/new-target',config={receipt:receipt(),state:{runtime:'native',identity:{projectRoot:projectDirectory},instances:nativeInstances()},expectedStackId:stackId,projectDirectory};
 assert.equal(validateSnapshotNativeTarget(config).host,'127.0.0.1');
 for(const mutate of [c=>c.receipt.env.DB_URL='postgresql://postgres:synthetic@localhost:38888/postgres',c=>c.receipt.endpoints['rest.http'].url='https://school.example.com/',c=>c.receipt.endpoints['auth.http'].url='http://evil@127.0.0.1:38889/',c=>c.state.runtime='docker',c=>c.state.identity.projectRoot='/tmp/other',c=>c.expectedStackId='f2bd8563efba25e7d7846cceacb670b5ab8238cfb82aab83989d0c8942e6ddea']){const c=structuredClone(config);mutate(c);assert.throws(()=>validateSnapshotNativeTarget(c));}
});
test('private Native receipt must be0600, fresh and matched to its owned official state',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s);await chmod(f.receiptFile,0o644);await assert.rejects(openSchoolSnapshotLocalDatabase({...f,expectedStackId:stackId}));
});
test('unregistered or remote SQL adapter is denied before begin',async()=>{
 const sql={options:{host:['127.0.0.1'],port:1,username:'postgres',database:'postgres',ssl:false},unsafe:()=>{},begin:()=>{throw Error('must not begin')}};
 await assert.rejects(restoreSchoolSnapshotRows({snapshot:snapshot(),sql,tables}),e=>e.code==='official_native_target_authorization_required');sql.options.host=['remote.example'];await assert.rejects(restoreSchoolSnapshotRows({snapshot:snapshot(),sql,tables}),e=>e.code==='local_database_required');
});
test('synthetic transaction inserts raw rows preserving64bit text; migrations82 never overwritten',async t=>{
 const s=snapshot();s.auth_rows.refresh_tokens=['{"id":9223372036854775807,"token":"SYNTHETIC-PRIVATE"}'];const f=await sqlFixture(t,s),result=await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});
 assert.equal(f.committed,true);assert.equal(result.authUsers,1);assert.equal(result.restoreAcceptanceComplete,false);assert.equal(result.loginVerified,false);assert.equal(result.exactIsCalledRestored,false);
 const writes=f.calls.filter(call=>call.text.startsWith('INSERT '));assert.ok(writes.some(call=>call.params[0].includes('9223372036854775807')));assert.ok(writes.every(call=>call.text.includes('jsonb_populate_record')));assert.ok(writes.every(call=>!call.text.includes('"schema_migrations"')));assert.equal(JSON.stringify(result).includes('SYNTHETIC-PRIVATE'),false);
 assert.ok(f.calls.find(call=>call.text.includes('IS NULL')&&call.text.includes('IS NOT NULL')&&call.text.includes('NOT EXISTS')));
});
test('schema mismatch and unrelated preexisting rows rollback without deletes',async t=>{
 for(const options of [{columnMismatch:true},{unknownRow:true},{storageObjects:'1'}]){const s=snapshot(),f=await sqlFixture(t,s,options);await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}));assert.equal(f.rollback,true);assert.ok(f.calls.every(call=>!call.text.startsWith('DELETE')));}
});
test('missing migrations, nonempty Auth and malformed scope are rejected',async t=>{
 const s=snapshot();s.auth_rows.schema_migrations.pop();const f=await sqlFixture(t,s);await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),e=>e.code==='current_school_snapshot_scope_required');assert.equal(f.calls.length,0);
});
test('FK failure and insert error rollback all synthetic inserts and redact driver messages',async t=>{
 for(const options of [{foreignInvalid:true},{failAt:'INSERT INTO'}]){const s=snapshot(),f=await sqlFixture(t,s,options);await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),error=>!error.message.includes('PRIVATE DRIVER'));assert.equal(f.rollback,true);assert.equal(f.rows['auth.users'].length,0);}
});
test('generated ALWAYS columns are omitted explicitly from inserts',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{generated:[{table_schema:'auth',table_name:'users',column_name:'encrypted_password'}]});await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});const insert=f.calls.find(call=>call.text.startsWith('INSERT INTO "auth"."users"'));assert.ok(!insert.text.includes('r."encrypted_password"'));
});
test('bigint highwater is advanced transactionally from PGnumerictext without setval',async t=>{
 const sequence={schemaname:'auth',sequencename:'refresh_tokens_id_seq',data_type:'bigint',start_value:'1',min_value:'1',max_value:'9223372036854775807',increment_by:'1',cycle:false,cache_size:'1',last_value:'9223372036854775800'};
 const s=snapshot();s.sequences=[{...sequence,last_value:9223372036854775800}];const raw=JSON.stringify(s).replace(/"last_value":\d+/,'"last_value":9223372036854775800');
 const f=await sqlFixture(t,s,{sequence:{source:sequence,target:{...sequence,last_value:null},maximumId:'9223372036854775800'}});
 await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),e=>e.code==='raw_sequence_precision_required');
 const result=await restoreSchoolSnapshotRows({snapshot:s,rawSnapshotJsonText:raw,sql:f.sql,tables});assert.equal(result.conservativeSequenceAdvance,true);
 assert.ok(f.calls.some(call=>call.text==='ALTER SEQUENCE "auth"."refresh_tokens_id_seq" RESTART WITH 9223372036854775801'));assert.ok(f.calls.every(call=>!call.text.includes('setval')));
 const extract=f.calls.find(call=>call.text.includes('jsonb_to_recordset'));assert.ok(extract.params[0].includes('"last_value":9223372036854775800'));
});
test('sequence negative increments/cycles/mismatch/highwater belowIDs fail closed',async t=>{
 const base={schemaname:'auth',sequencename:'refresh_tokens_id_seq',data_type:'bigint',start_value:'1',min_value:'1',max_value:'1000',increment_by:'1',cycle:false,cache_size:'1',last_value:'10'};
 for(const change of [{increment_by:'-1'},{cycle:true},{last_value:'5'}]){const source={...base,...change},s=snapshot();s.sequences=[source];const f=await sqlFixture(t,s,{sequence:{source,target:{...source,last_value:null},maximumId:'10'}});await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}));assert.equal(f.rollback,true);}
});
test('decimal-text sequence helper rejects overflow and supports unsafe JS integers exactly',()=>{
 assert.equal(conservativeSequenceRestart({lastValue:'9007199254740993',increment:'1',minValue:'1',maxValue:'9223372036854775807',maximumId:'9007199254740993'}),'9007199254740994');
 for(const override of [{lastValue:'1e20'},{increment:'-1'},{maximumId:'11'},{maxValue:'10'}])assert.throws(()=>conservativeSequenceRestart({lastValue:'10',increment:'1',minValue:'1',maxValue:'1000',maximumId:'10',...override}));
});
test('exact matching public defaults remain without overwrite or deletion',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{defaultMatching:true});await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});assert.equal(f.rows['public.communication_settings'].length,1);assert.ok(f.calls.every(call=>!call.text.startsWith('INSERT INTO "public"."communication_settings"')&&!call.text.startsWith('DELETE')));
});
test('preexisting Auth and82-row migrations with different content reject before any insert',async t=>{
 for(const options of [{nonemptyAuth:true},{migrationsMismatch:true}]){const s=snapshot(),f=await sqlFixture(t,s,options);await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}));assert.equal(f.rollback,true);assert.ok(f.calls.every(call=>!call.text.startsWith('INSERT')));}
});
test('failure after conservative sequence restart still rolls back synthetic transaction',async t=>{
 const source={schemaname:'auth',sequencename:'refresh_tokens_id_seq',data_type:'bigint',start_value:'1',min_value:'1',max_value:'1000',increment_by:'1',cycle:false,cache_size:'1',last_value:'10'},s=snapshot();s.sequences=[source];
 const f=await sqlFixture(t,s,{postWriteMismatch:true,sequence:{source,target:{...source,last_value:null},maximumId:'10'}});await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),e=>e.code==='restored_rows_mismatch');assert.equal(f.rollback,true);assert.ok(f.calls.some(call=>call.text.startsWith('ALTER SEQUENCE')));
});
test('uninitialized sequence with restored dependent rows fails closed',async t=>{
 const source={schemaname:'auth',sequencename:'refresh_tokens_id_seq',data_type:'bigint',start_value:'1',min_value:'1',max_value:'1000',increment_by:'1',cycle:false,cache_size:'1',last_value:null},s=snapshot();s.sequences=[source];
 const f=await sqlFixture(t,s,{sequence:{source,target:source,maximumId:'10'}});await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),e=>e.code==='uninitialized_sequence_has_restored_rows');assert.equal(f.rollback,true);
});
test('encrypted archive reader preserves raw authenticated JSON in RAM without a connection',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s),base=path.dirname(f.receiptFile),csvFile=path.join(base,'synthetic.csv'),passphraseFile=path.join(base,'phrase.private'),directory=path.join(base,'archive');
 const json=JSON.stringify(s);await writeFile(csvFile,'snapshot\n"'+json.replaceAll('"','""')+'"\n',{mode:0o600});await writeFile(passphraseFile,'synthetic offline restore passphrase',{mode:0o600});await archiveSqlSnapshot({csvFile,passphraseFile,directory});
 const archive=await readSchoolSqlSnapshotArchive({directory,passphraseFile});assert.equal(archive.rawSnapshotJson.toString(),json);assert.equal(archive.snapshot.auth_rows.schema_migrations.length,82);archive.rawSnapshotJson.fill(0);assert.equal(f.calls.length,0);
});
test('stale receipt and native pgmeta wrong port are rejected',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s);await utimes(f.receiptFile,1,1);await assert.rejects(openSchoolSnapshotLocalDatabase({...f,expectedStackId:stackId}),e=>e.code==='fresh_native_receipt_required');
 const projectDirectory='/private/tmp/school-auth-schema-compat-20261009/project',config={receipt:receipt(),state:{runtime:'native',identity:{projectRoot:projectDirectory},instances:nativeInstances()},expectedStackId:stackId,projectDirectory};assert.equal(validateSnapshotNativeTarget(config).username,'supabase_admin');config.state.instances[0].creation.config.databaseUrl='postgresql://supabase_admin:synthetic@127.0.0.1:39999/postgres';assert.throws(()=>validateSnapshotNativeTarget(config));
});

test('restore sets public search_path before information_schema comparison',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s);await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});
 const search=f.calls.findIndex(call=>call.text==='SET LOCAL search_path = public'),columns=f.calls.findIndex(call=>call.text.includes('to_jsonb(c)::text'));
 assert.ok(search>=0&&columns>search);
});

test('every raw JSON parameter parses through explicit text to avoid driverJSONB double encoding',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s);await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});
 const boundaries=f.calls.filter(call=>call.params.length&&call.text.includes('jsonb'));
 assert.ok(boundaries.some(call=>call.text.includes('jsonb_array_elements_text($1::text::jsonb)')));
 assert.ok(boundaries.some(call=>call.text.includes('jsonb_populate_record')&&call.text.includes('$1::text::jsonb')));
 assert.ok(boundaries.some(call=>call.text.includes('jsonb_to_recordset')&&call.text.includes('$1::text::jsonb')));
 assert.ok(boundaries.every(call=>!call.text.includes('$1::jsonb')&&call.text.includes('$1::text::jsonb')));
});

test('FK catalog uses PGconfmatchtype and explicit text arrays',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s);await restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables});
 const fk=f.calls.find(call=>call.text.includes("WHERE c.contype='f'"));assert.ok(fk.text.includes('c.confmatchtype AS conmatchtype'));assert.ok(!fk.text.includes('c.conmatchtype'));assert.equal((fk.text.match(/a\.attname::text/g)??[]).length,2);
});
test('driver failure exposes only static phase and SQLSTATE, never private PGdetails',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{failAt:"WHERE c.contype='f'"});
 await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),error=>{assert.equal(error.code,'restore_transaction_failed');assert.equal(error.phase,'foreign_key_catalog');assert.equal(error.sqlState,'42703');assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.ok(!error.message.includes('password'));assert.equal(error.cause,undefined);return true;});assert.equal(f.rollback,true);
});

test('captured public metadata parity runs before inserts and rejects every component mismatch',async t=>{
 for(const field of ['constraints','indexes','triggers','functions','policies','table_acl','enums']){const s=snapshot(),f=await sqlFixture(t,s,{metadataMismatch:field});await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),error=>error.code==='metadata_public_mismatch_'+field&&error.phase==='captured_metadata_preflight');assert.equal(f.rollback,true);assert.ok(f.calls.every(call=>!call.text.startsWith('INSERT')));}
});
test('null or empty mandatory metadata is never accepted as successful parity',async t=>{
 for(const field of ['constraints','indexes','triggers','functions','policies','table_acl'])for(const value of [null,[]]){const s=snapshot();s[field]=value;const f=await sqlFixture(t,s);await assert.rejects(preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables}),error=>error.code==='metadata_capture_missing_'+field);assert.ok(f.calls.every(call=>!call.text.startsWith('INSERT')));}
});
test('metadata coverage rejects omitted public ACL, PK or index entries',async t=>{
 for(const field of ['table_acl','constraints','indexes']){const s=snapshot();s[field].pop();const f=await sqlFixture(t,s);await assert.rejects(preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables}),error=>['metadata_table_acl_coverage','metadata_primary_key_coverage','metadata_index_coverage'].includes(error.code));}
});
test('public grant expansion, disabled RLS and additional permissive policy all block import',async t=>{
 for(const options of [{targetAclExtraGrant:true},{targetRlsDisabled:true},{targetPolicyExtra:true}]){const s=snapshot(),f=await sqlFixture(t,s,options);await assert.rejects(restoreSchoolSnapshotRows({snapshot:s,sql:f.sql,tables}),error=>error.code.startsWith('metadata_public_mismatch_'));assert.ok(f.calls.every(call=>!call.text.startsWith('INSERT')));}
});
test('ACL order is canonical and NULL rowACL has PostgreSQL owner defaults',async t=>{
 const s=snapshot();s.table_acl[0].acl='{postgres=arwdDxt/postgres,authenticated=r/postgres}';const f=await sqlFixture(t,s);s.table_acl[0].acl='{authenticated=r/postgres,postgres=arwdDxt/postgres}';s.table_acl[1].acl=null;
 const result=await preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables});assert.equal(result.publicCapturedMetadataVerified,true);
 assert.ok(f.calls.some(call=>call.text.includes('acldefault')&&call.text.includes('aclitem[]')));
});
test('read-only metadata API accepts preserved occupied target without replay or DDL',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{nonemptyAuth:true}),result=await preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables});
 assert.equal(result.scope,'public-captured-v1');assert.equal(result.publicCapturedMetadataVerified,true);assert.equal(result.components.table_acl.count,33);assert.equal(result.components.enums.sourceCapture,'declared_empty_public_scope');
 assert.ok(f.calls.some(call=>call.text==='SET TRANSACTION READ ONLY'));assert.ok(f.calls.every(call=>!/^INSERT|ALTER|DELETE|LOCK/.test(call.text)&&!call.text.includes('session_replication_role')));assert.equal(f.rows['auth.users'].length,1);
 assert.deepEqual(result.uncaptured,['function_acl','event_trigger_registrations','trigger_enabled_state','managed_service_configuration']);assert.equal(result.managedAuthMetadataVerified,false);
});
test('managed Storage differences are explicit and never require permission expansion',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{storageMetadataExtra:true}),result=await preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables});
 for(const component of Object.values(result.managedStorage.components)){assert.equal(component.parity,'different');assert.equal(component.sourceCount,0);assert.equal(component.targetCount,1);}
 assert.equal(result.managedStorage.permissionChangesPerformed,false);assert.equal(result.managedStorage.managedServiceEquivalenceVerified,false);assert.ok(f.calls.every(call=>!/^GRANT|REVOKE|ALTER|INSERT|DELETE/.test(call.text)));
});
test('legitimate empty public enums are explicitly marked, not silently inferred complete',async t=>{
 const s=snapshot();s.enums=null;const f=await sqlFixture(t,s),result=await preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables});assert.deepEqual(result.components.enums,{count:0,parity:'matching',sourceCapture:'declared_null_empty'});
});
test('metadata driver errors redact DDL and report only generic phase/SQLSTATE',async t=>{
 const s=snapshot(),f=await sqlFixture(t,s,{failAt:'FROM pg_policies'});await assert.rejects(preflightSchoolSnapshotMetadata({snapshot:s,sql:f.sql,tables}),error=>{assert.equal(error.code,'metadata_preflight_failed');assert.equal(error.phase,'captured_metadata_preflight');assert.equal(error.sqlState,'42703');assert.ok(!JSON.stringify(error).includes('PRIVATE'));assert.equal(error.cause,undefined);return true;});
});
