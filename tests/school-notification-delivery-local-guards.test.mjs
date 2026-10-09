import test from 'node:test';
import assert from 'node:assert/strict';
import {noticeLocalEndpoint,stripMigrationTransaction,notificationLocalPlan,acceptNoticeDeliveryLocal}from'../scripts/accept-school-notification-delivery-local.mjs';
test('local SQL acceptance requires deliberate isolated confirmation before any filesystem/service operation',async()=>{
  await assert.rejects(acceptNoticeDeliveryLocal({confirmation:'',evidenceFile:'/tmp/noop.json',receiptFile:'/tmp/noop2.json'}));assert.equal(notificationLocalPlan.code,'sql31-source-single-rollback-v1');
});
test('source endpoint guard rejects production, target credentials destinations, hostname aliases and ambiguous URLs',()=>{
  for(const url of ['https://school.supabase.co','http://localhost:25488','http://127.0.0.1:80','http://127.0.0.1:25488/path','http://127.0.0.1:25488/?token=x','http://user@127.0.0.1:25488','http://127.0.0.1:25488/#x'])assert.throws(()=>noticeLocalEndpoint(url,'http:'));
  assert.equal(noticeLocalEndpoint('http://127.0.0.1:25488','http:').hostname,'127.0.0.1');assert.throws(()=>noticeLocalEndpoint('postgres://user:synthetic@db.school.test:5432/postgres','postgres:'));
});
test('migration receives exactly one external transaction without nested commit',()=>{
  const source='-- prepared\nbegin;\ncreate table public.synthetic(id uuid);\ncommit;\n';const stripped=stripMigrationTransaction(source);assert.doesNotMatch(stripped,/^begin;|^commit;/m);assert.match(stripped,/create table/);
  for(const invalid of ['create table x();','begin;\ncommit;\ncommit;','begin;\nbegin;\ncommit;'])assert.throws(()=>stripMigrationTransaction(invalid));
});
