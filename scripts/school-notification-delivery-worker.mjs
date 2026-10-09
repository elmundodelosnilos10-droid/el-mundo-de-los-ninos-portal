/** Explicit, finite manual dispatcher. It never reads .env or starts a cron. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { externalNoticeConfiguration, deliverExternalEmail, deliverExternalPush } from '../lib/school-notification-delivery.ts';
import { permitsIsolatedSupabaseHttp } from '../lib/supabase/local-http-test-policy.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createDeliveryWorkerClient(env,fetcher=fetch){
  let url;try{url=new URL(env.SUPABASE_URL);}catch{throw Error('Delivery database configuration unavailable');}
  if((url.protocol!=='https:'&&!permitsIsolatedSupabaseHttp(url.origin))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Delivery database configuration unavailable');
  const key=env.SUPABASE_SECRET_KEY;
  if(typeof key!=='string'||!key.trim()||/[\r\n]/.test(key))throw Error('Delivery database configuration unavailable');
  return async(name,args)=>{
    if(!['school_claim_notification_deliveries','school_authorize_notification_delivery','school_finish_notification_delivery'].includes(name))throw Error('Invalid delivery operation');
    let response;try{response=await fetcher(new URL(`/rest/v1/rpc/${name}`,url),{method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),'Content-Type':'application/json'},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Delivery database operation uncertain');}
    if(!response.ok){await response.body?.cancel();throw Error('Delivery database operation unavailable');}
    const reader=response.body?.getReader();if(!reader)throw Error('Delivery database response invalid');
    let size=0;const chunks=[];
    try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>65536)throw Error('Delivery database response invalid');chunks.push(item.value);}}
    catch{throw Error('Delivery database response invalid');}
    finally{await reader.cancel().catch(()=>undefined);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Delivery database response invalid');}
  };
}
export async function runNotificationDeliveryWorker(env,{rpc,email=deliverExternalEmail,push=deliverExternalPush}={}){
  const capability=externalNoticeConfiguration(env),channels=['email','webpush'].filter(channel=>capability[channel]);
  const result={enabled:channels.length>0,claimed:0,accepted:0,uncertain:0,rejected:0,suppressed:0,unconfirmed:0,delivered:0};
  if(!channels.length)return result;
  if(env.SCHOOL_NOTIFICATION_WORKER_ENABLED!=='manual-approved')return {...result,enabled:false};
  const call=rpc??createDeliveryWorkerClient(env);
  const seen=new Set();
  for(let index=0;index<5;index++){
    let batch;try{batch=await call('school_claim_notification_deliveries',{p_channels:channels,p_limit:1});}
    catch{result.unconfirmed++;break;} // An uncertain claim may have reserved a job; stop.
    if(!batch||!Array.isArray(batch.jobs)||batch.jobs.length>1)throw Error('Invalid delivery batch');
    if(batch.jobs.length===0)break;
    const job=batch.jobs[0];
    if(!job||!uuid.test(job.id)||!uuid.test(job.claimNonce)||!channels.includes(job.channel)||seen.has(job.id))throw Error('Invalid delivery batch');
    seen.add(job.id);result.claimed++;
    let authorized;
    try{authorized=await call('school_authorize_notification_delivery',{p_id:job.id,p_claim_nonce:job.claimNonce});}
    catch{result.unconfirmed++;break;} // Never authorize again after an uncertain response.
    if(authorized?.authorized===false){result.suppressed++;continue;}
    if(authorized?.authorized!==true||authorized.id!==job.id||authorized.channel!==job.channel||authorized.idempotencyKey!==`school-notice/${job.id}`){result.unconfirmed++;break;}
    let outcome;
    try{outcome=job.channel==='email'?await email(env,job.id,authorized.destination?.email):await push(env,job.id,authorized.destination);}
    catch{outcome={state:'uncertain',code:'transport_uncertain'};}
    if(!outcome||!['accepted','uncertain','rejected'].includes(outcome.state)||!['provider_accepted','transport_uncertain','provider_rejected','subscription_gone','invalid_destination','not_configured'].includes(outcome.code)){result.unconfirmed++;break;}
    try{
      const finished=await call('school_finish_notification_delivery',{p_id:job.id,p_claim_nonce:job.claimNonce,p_state:outcome.state,p_result_code:outcome.code});
      if(finished?.confirmed!==true){result.unconfirmed++;break;}
      result[outcome.state]++;
      if(outcome.state==='uncertain')break;
    }catch{result.unconfirmed++;break;} // The persisted lease expires to uncertain; stop and never replay.
  }
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--dispatch-once'){
    process.stderr.write('Use --dispatch-once with explicitly configured, approved channels. No dispatch performed.\n');process.exitCode=1;
  }else{
    try{process.stdout.write(JSON.stringify(await runNotificationDeliveryWorker(process.env))+'\n');}
    catch{process.stderr.write('Dispatch could not be confirmed. Inspect private queue state before another operation; no automatic replay.\n');process.exitCode=1;}
  }
}
