import assert from 'node:assert/strict';
import test from 'node:test';
import webpush from 'web-push';
import {createECDH,randomBytes} from 'node:crypto';
import {externalNoticeConfiguration,externalNoticeOrigin,validatePushDestination,opaquePushTopic,verifyPushHost,deliverExternalEmail,deliverExternalPush,EXTERNAL_NOTICE_TEXT} from '../lib/school-notification-delivery.ts';
import {runNotificationDeliveryWorker} from '../scripts/school-notification-delivery-worker.mjs';
const id='a1000000-0000-4000-8000-000000000001',nonce='a1000000-0000-4000-8000-000000000002';
const emailEnv={APP_ORIGIN:'https://portal.example.test',SCHOOL_NOTIFICATION_EMAIL_PROVIDER:'resend',SCHOOL_NOTIFICATION_RESEND_KEY:'synthetic-provider-key',SCHOOL_NOTIFICATION_EMAIL_FROM:'Portal escolar <notices@example.test>',SCHOOL_NOTIFICATION_WORKER_ENABLED:'manual-approved'};
const vapid=webpush.generateVAPIDKeys();
const pushEnv={APP_ORIGIN:emailEnv.APP_ORIGIN,SCHOOL_NOTIFICATION_PUSH_PROVIDER:'webpush',SCHOOL_NOTIFICATION_VAPID_SUBJECT:'mailto:notices@example.test',SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY:vapid.publicKey,SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY:vapid.privateKey};
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-endpoint',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const resolver=async()=>[{address:'8.8.8.8',family:4}];

// Separate worker gate test does not supply a pretending provider or database result.
test('unapproved manual dispatcher does not claim any job even with provider keys present',async()=>{
  let calls=0;const result=await runNotificationDeliveryWorker({...emailEnv,SCHOOL_NOTIFICATION_WORKER_ENABLED:'disabled'},{rpc:async()=>{calls++;}});
  assert.equal(result.enabled,false);assert.equal(result.delivered,0);assert.equal(calls,0);
});
test('disabled adapters stay closed without contacting any external provider',async()=>{
  let calls=0;const fetcher=async()=>{calls++;throw Error('must not send');};
  assert.deepEqual(await deliverExternalEmail({},id,'family@example.test',fetcher),{state:'rejected',code:'not_configured'});
  assert.deepEqual(await deliverExternalPush({},id,subscription,{fetcher}),{state:'rejected',code:'not_configured'});assert.equal(calls,0);
});
test('email sends generic content with stable provider idempotency and acceptance is not delivery',async()=>{
  const calls=[];const result=await deliverExternalEmail(emailEnv,id,'family@example.test',async(url,init)=>{calls.push({url,init});return Response.json({id:nonce});});
  assert.deepEqual(result,{state:'accepted',code:'provider_accepted'});assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers['Idempotency-Key'],`school-notice/${id}`);assert.equal(calls[0].init.redirect,'error');
  const payload=JSON.parse(calls[0].init.body);assert.equal(payload.text,`${EXTERNAL_NOTICE_TEXT}\nhttps://portal.example.test/`);assert.doesNotMatch(payload.html,/a1000000|student|conversation|contraseña|token=/);assert.equal('delivered' in result,false);
});
test('uncertain email results are not retried or exposed, including malformed and oversized successes',async()=>{
  for(const factory of [()=>{throw Error('private recipient/key upstream');},()=>Response.json({}),()=>Response.json({id:nonce},{status:500}),()=>new Response('x'.repeat(9000))]){
    let calls=0;const outcome=await deliverExternalEmail(emailEnv,id,'family@example.test',async()=>{calls++;return factory();});
    assert.deepEqual(outcome,{state:'uncertain',code:'transport_uncertain'});assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(outcome),/recipient|key|upstream/);
  }
});
test('push rejects credentials, redirects, fake providers, private IPs, invalid keys and DNS private answers',async()=>{
  for(const endpoint of ['http://fcm.googleapis.com/a','https://fcm.googleapis.com.evil.test/a','https://127.0.0.1/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://fcm.googleapis.com/a?target=private','https://fcm.googleapis.com/a#token'])assert.throws(()=>validatePushDestination({...subscription,endpoint}));
  assert.throws(()=>validatePushDestination({...subscription,keys:{...subscription.keys,p256dh:'a'.repeat(87)}}));
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.0.1','100.64.0.1','192.0.2.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])await assert.rejects(verifyPushHost('fcm.googleapis.com',async()=>[{address,family:address.includes(':')?6:4}]));
  let calls=0;assert.equal((await deliverExternalPush(pushEnv,id,subscription,{resolver:async()=>[{address:'127.0.0.1',family:4}],fetcher:async()=>{calls++;}})).code,'invalid_destination');assert.equal(calls,0);
});
test('push produces real encrypted request, opaque stable topic and generic notification data',async()=>{
  const calls=[];const outcome=await deliverExternalPush(pushEnv,id,subscription,{resolver,fetcher:async(url,init)=>{calls.push({url,init});return new Response(null,{status:201});}});
  assert.deepEqual(outcome,{state:'accepted',code:'provider_accepted'});assert.equal(calls.length,1);assert.equal(calls[0].init.headers.Topic,opaquePushTopic(id));assert.equal(opaquePushTopic(id).length,32);assert.doesNotMatch(opaquePushTopic(id),/a1000000/);
  assert.equal(calls[0].init.headers.TTL,300);assert.equal(calls[0].init.headers['Content-Encoding'],'aes128gcm');assert.ok(calls[0].init.body.length>100);assert.doesNotMatch(Buffer.from(calls[0].init.body).toString('utf8'),/Tienes un aviso|a1000000|synthetic-endpoint/);assert.equal(calls[0].init.redirect,'error');
});
test('push gone and uncertain status do not retry and never claim actual delivery',async()=>{
  for(const [status,code]of[[410,'subscription_gone'],[503,'transport_uncertain'],[302,'provider_rejected']]){let calls=0;const out=await deliverExternalPush(pushEnv,id,subscription,{resolver,fetcher:async()=>{calls++;return new Response(null,{status});}});assert.equal(out.code,code);assert.equal(calls,1);assert.equal('delivered'in out,false);}
});
test('unsafe portal origin and input email fail before sending',async()=>{
  for(const origin of ['http://portal.example.test','https://user@portal.example.test','https://127.0.0.1','https://portal.example.test/path','https://portal.example.test?token=a','https://school.localhost'])assert.throws(()=>externalNoticeOrigin(origin));
  let calls=0;assert.equal((await deliverExternalEmail(emailEnv,id,'child@example.test\r\nBcc: evil@example.test',async()=>{calls++;})).code,'invalid_destination');assert.equal(calls,0);
});
test('worker claims once, reauthorizes each destination and persists exact result without replay',async()=>{
  const calls=[];let sent=0,claims=0;const rpc=async(name,args)=>{calls.push({name,args});if(name==='school_claim_notification_deliveries')return{jobs:claims++===0?[{id,channel:'email',claimNonce:nonce}]:[]};if(name==='school_authorize_notification_delivery')return{authorized:true,id,channel:'email',idempotencyKey:`school-notice/${id}`,destination:{email:'family@example.test'}};return{confirmed:true};};
  const result=await runNotificationDeliveryWorker(emailEnv,{rpc,email:async()=>{sent++;return{state:'accepted',code:'provider_accepted'};}});
  assert.equal(result.accepted,1);assert.equal(result.delivered,0);assert.equal(sent,1);assert.deepEqual(calls.map(c=>c.name),['school_claim_notification_deliveries','school_authorize_notification_delivery','school_finish_notification_delivery','school_claim_notification_deliveries']);
});
test('worker does not send on revoked access or uncertain authorize and never replays uncertain sends/finish',async()=>{
  for(const stage of ['revoked','authorize','send','finish']){
    let sends=0,authorizations=0,finishes=0,claims=0;const rpc=async name=>{if(name==='school_claim_notification_deliveries')return{jobs:claims++===0?[{id,channel:'email',claimNonce:nonce}]:[]};if(name==='school_authorize_notification_delivery'){authorizations++;if(stage==='authorize')throw Error('uncertain');return stage==='revoked'?{authorized:false}:{authorized:true,id,channel:'email',idempotencyKey:`school-notice/${id}`,destination:{email:'family@example.test'}};}finishes++;if(stage==='finish')throw Error('uncertain');return{confirmed:true};};
    const result=await runNotificationDeliveryWorker(emailEnv,{rpc,email:async()=>{sends++;if(stage==='send')throw Error('uncertain');return{state:'accepted',code:'provider_accepted'};}});
    assert.equal(authorizations,1);assert.equal(sends,['revoked','authorize'].includes(stage)?0:1);assert.equal(finishes,['revoked','authorize'].includes(stage)?0:1);assert.equal(result.delivered,0);
  }
});

test('malformed VAPID configuration never exposes a browser capability',()=>{
  for(const changed of[{SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY:'secret-not-a-public-key'},{SCHOOL_NOTIFICATION_VAPID_PRIVATE_KEY:'bad'},{SCHOOL_NOTIFICATION_VAPID_SUBJECT:'http://localhost:80'},{SCHOOL_NOTIFICATION_VAPID_SUBJECT:'mailto:private@example.test\r\nInjected'},{SCHOOL_NOTIFICATION_VAPID_PUBLIC_KEY:subscription.keys.p256dh}]){
    const capability=externalNoticeConfiguration({...pushEnv,...changed});assert.equal(capability.webpush,false);assert.equal(capability.publicVapidKey,undefined);
  }
  assert.equal(externalNoticeConfiguration(pushEnv).webpush,true);
});
test('worker response bound cancels oversized streaming data before retaining the entire body',async()=>{
  const {createDeliveryWorkerClient}=await import('../scripts/school-notification-delivery-worker.mjs');let pulled=0,canceled=false;
  const stream=new ReadableStream({pull(controller){pulled++;controller.enqueue(new Uint8Array(32768));},cancel(){canceled=true;}});
  const client=createDeliveryWorkerClient({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_SECRET_KEY:'synthetic-local-key'},async()=>new Response(stream));
  await assert.rejects(client('school_claim_notification_deliveries',{}),/response invalid/);assert.equal(canceled,true);assert.ok(pulled<=4);
});
test('finite dispatcher claims only one job so valid leases do not expire while waiting for other sends',async()=>{
  let claims;const result=await runNotificationDeliveryWorker(emailEnv,{rpc:async(name,args)=>{assert.equal(name,'school_claim_notification_deliveries');claims=args;return {jobs:[]};}});assert.equal(claims.p_limit,1);assert.equal(result.claimed,0);
});
test('one finite dispatch performs at most five separate claims and sends five distinct jobs without waiting leases',async()=>{
  const jobs=Array.from({length:6},(_,i)=>({id:`a2000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,channel:'email',claimNonce:nonce}));const operations=[],sent=[];let count=0;
  const rpc=async(name,args)=>{operations.push(name);if(name==='school_claim_notification_deliveries'){assert.equal(args.p_limit,1);return{jobs:[jobs[count++]]};}if(name==='school_authorize_notification_delivery')return{authorized:true,id:args.p_id,channel:'email',idempotencyKey:`school-notice/${args.p_id}`,destination:{email:'family@example.test'}};return{confirmed:true};};
  const result=await runNotificationDeliveryWorker(emailEnv,{rpc,email:async(_env,job)=>{sent.push(job);return{state:'accepted',code:'provider_accepted'};}});assert.equal(result.claimed,5);assert.equal(result.accepted,5);assert.equal(count,5);assert.equal(new Set(sent).size,5);assert.equal(result.delivered,0);
  assert.deepEqual(operations,Array.from({length:5},()=>['school_claim_notification_deliveries','school_authorize_notification_delivery','school_finish_notification_delivery']).flat());
});
test('uncertain claim, authorization, provider or finish stops the finite run before another claim or send',async()=>{
  for(const uncertainAt of['claim','authorize','send','finish']){let claims=0,sends=0;const rpc=async(name,args)=>{if(name==='school_claim_notification_deliveries'){claims++;if(uncertainAt==='claim')throw Error('uncertain');return{jobs:[{id,channel:'email',claimNonce:nonce}]};}if(name==='school_authorize_notification_delivery'){if(uncertainAt==='authorize')throw Error('uncertain');return{authorized:true,id:args.p_id,channel:'email',idempotencyKey:`school-notice/${id}`,destination:{email:'family@example.test'}};}if(uncertainAt==='finish')throw Error('uncertain');return{confirmed:true};};
    const result=await runNotificationDeliveryWorker(emailEnv,{rpc,email:async()=>{sends++;return uncertainAt==='send'?{state:'uncertain',code:'transport_uncertain'}:{state:'accepted',code:'provider_accepted'};}});assert.equal(claims,1);assert.equal(sends,['claim','authorize'].includes(uncertainAt)?0:1);assert.equal(result.delivered,0);
  }
});
test('a duplicate or malformed claimed job is never authorized or sent twice',async()=>{
  let sends=0;await assert.rejects(runNotificationDeliveryWorker(emailEnv,{rpc:async(name,args)=>name==='school_claim_notification_deliveries'?{jobs:[{id,channel:'email',claimNonce:nonce}]}:name==='school_authorize_notification_delivery'?{authorized:true,id:args.p_id,channel:'email',idempotencyKey:`school-notice/${id}`,destination:{email:'family@example.test'}}:{confirmed:true},email:async()=>{sends++;return{state:'accepted',code:'provider_accepted'};}}),/Invalid delivery batch/);assert.equal(sends,1);
});
