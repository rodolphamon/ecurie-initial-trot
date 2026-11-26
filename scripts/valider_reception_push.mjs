// Tests de réception et de préférences : aucun réseau ni envoi Push réel.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {repairPushConnection} from '../docs/application/push-repair.js';

function repairFixture({sameEndpoint=false,inactive=false,saveFailsOnce=false,cleanupFails=false}={}){
  const order=[],requests=[];let localRemovals=0,browserSubscriptions=0,saveAttempts=0;
  const preferences={audience:'associate',scope:'all',confirmed:true,daily:true,before15:true,results:true,
    withdrawn:true,private_news:true,general_news:true,public_news:false};
  const subscription={endpoint:'https://fcm.googleapis.com/old-current',async unsubscribe(){localRemovals++;order.push('local-unsubscribe');return true;}};
  const replacement={endpoint:sameEndpoint?subscription.endpoint:'https://fcm.googleapis.com/new-current',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'test-key',auth:'test-auth'}};}};
  const args={subscription,deviceToken:'test-device-token',applicationServerKey:new Uint8Array([1,2,3]),
    registration:{pushManager:{async subscribe(options){
      browserSubscriptions++;order.push('browser-subscribe');assert.equal(options.userVisibleOnly,true);return replacement;
    }}},
    async callServer(body){
      requests.push(body);order.push(body.action);
      if(body.action==='status')return {active:!inactive,preferences};
      if(body.action==='subscribe'){
        saveAttempts++;assert.deepEqual(body.preferences,preferences,'Tous les choix doivent être conservés');
        assert.equal(body.subscription.endpoint,replacement.endpoint);
        if(saveFailsOnce&&saveAttempts===1)throw Error('Réseau momentanément indisponible');
        return {audience:'associate',scope:preferences.scope};
      }
      if(body.action==='unsubscribe'){
        assert.equal(body.endpoint,subscription.endpoint,'Seule l’ancienne inscription de ce navigateur peut être retirée');
        if(cleanupFails)throw Error('Nettoyage différé');
        return {ok:true};
      }
      throw Error('Action inattendue');
    },
  };
  return {args,order,requests,replacement,get localRemovals(){return localRemovals;},get browserSubscriptions(){return browserSubscriptions;}};
}
for(const options of [{},{sameEndpoint:true},{cleanupFails:true}]){
  const f=repairFixture(options),result=await repairPushConnection(f.args);
  assert.equal(result.subscription,f.replacement);
  assert.equal(f.order[0],'status');
  assert.equal(f.localRemovals,1);assert.equal(f.browserSubscriptions,1);
  const cleanup=f.order.indexOf('unsubscribe');
  assert.equal(cleanup>=0,!options.sameEndpoint);
  if(cleanup>=0)assert.ok(f.order.indexOf('subscribe')<cleanup,'Enregistrer la nouvelle connexion avant de retirer l’ancienne');
}
{
  const f=repairFixture({saveFailsOnce:true});let state;
  try{await repairPushConnection(f.args);assert.fail('Le premier enregistrement doit échouer');}
  catch(error){state=error.repairState;assert.ok(state);}
  assert.equal(f.requests.some(r=>r.action==='unsubscribe'),false,'Ne pas retirer l’ancienne inscription serveur avant succès');
  await repairPushConnection({...f.args,state});
  assert.equal(f.browserSubscriptions,1,'Une reprise ne doit pas recréer la connexion en boucle');
  assert.equal(f.localRemovals,1);
}
{
  const f=repairFixture({inactive:true});
  await assert.rejects(repairPushConnection(f.args),/plus enregistrée/);
  assert.equal(f.localRemovals,0,'Une inscription non vérifiée ne doit pas être supprimée');
}
console.log('[OK] Réparation : choix conservés, connexion locale seule, enregistrement avant nettoyage et reprise sans double réinscription');

const workerSource=readFileSync(new URL('../docs/application/sw.js',import.meta.url),'utf8');
function worker({displayFails=false,displayHangs=false,cacheFails=false,cacheHangs=false}={}){
  const handlers={},shown=[],reports=[],timers=new Map();
  const order=[];
  let sequence=0,skipped=false;
  const context={URL,Date,AbortController,Promise,console,
    setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    indexedDB:{open(){return {}; /* Simule un stockage bloqué sans événement. */}},
    fetch(_url,options){order.push('report');reports.push(JSON.parse(options.body));return new Promise(()=>{});},
    caches:{async open(){if(cacheHangs)return new Promise(()=>{});if(cacheFails)throw Error('Cache indisponible');return {async add(){throw Error('Icône indisponible');}};},async keys(){return [];}},
    self:{location:{origin:'https://fiches.ecurie-initial.com'},
      addEventListener(name,handler){handlers[name]=handler;},
      async skipWaiting(){skipped=true;},
      clients:{async claim(){}},
      registration:{async showNotification(title,options){
        order.push('show');shown.push({title,options});if(displayFails)throw new TypeError('Affichage refusé');
        if(displayHangs)return new Promise(()=>{});
      }},
    },
  };
  vm.runInNewContext(workerSource,context);
  return {handlers,shown,reports,timers,order,get skipped(){return skipped;}};
}
for(const displayFails of [false,true]){
  const r=worker({displayFails});let completion;
  r.handlers.push({data:{json(){return {title:'Course',receipt_id:'12345678-1234-4234-8234-123456789abc'};}},
    waitUntil(promise){completion=promise;}});
  // showNotification est appelé avant les premières opérations de diagnostic.
  assert.equal(r.shown.length,1);
  assert.equal(r.order[0],'show');
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.ok(r.reports.some(p=>p.status===(displayFails?'error':'shown')));
  const deadline=[...r.timers.values()].find(timer=>timer.ms===6000);
  assert.ok(deadline,'Le traitement Push doit avoir une échéance');
  deadline.fn();
  await completion;
}
{
  const r=worker({displayHangs:true});
  r.handlers.push({data:{json(){return {receipt_id:'12345678-1234-4234-8234-123456789abc'};}},waitUntil(){}});
  assert.equal(r.order[0],'show');
  assert.ok(r.reports.some(p=>p.status==='received'),'La réception doit être signalée même si le système bloque l’affichage');
  assert.ok(!r.reports.some(p=>p.status==='shown'),'Un affichage bloqué ne doit pas être annoncé comme réussi');
}
for(const cacheFails of [false,true]){
  const r=worker({cacheFails});let completion;
  r.handlers.install({waitUntil(promise){completion=promise;}});
  await completion;
  assert.equal(r.skipped,true,'Le cache ne doit pas empêcher le nouveau worker de prendre la relève');
}
{
  const r=worker({cacheHangs:true});let completion;
  r.handlers.install({waitUntil(promise){completion=promise;}});
  for(let i=0;i<5;i++)await Promise.resolve();
  const deadline=[...r.timers.values()].find(t=>t.ms===3000);
  assert.ok(deadline);deadline.fn();await completion;
  assert.equal(r.skipped,true);
  let reply;r.handlers.message({data:{type:'ei-push-worker-info'},ports:[{postMessage(value){reply=value;}}]});
  assert.ok(reply.version,'La version du worker actif doit pouvoir être identifiée');
}
console.log('[OK] Affichage immédiat avec stockage et télémétrie bloqués, erreur mesurée et installation possible sans cache');

// Le même code partagé doit actualiser le worker depuis une fiche hors scope.
const nav=readFileSync(new URL('../docs/application/nav.js',import.meta.url),'utf8');
const updateCode=nav.slice(nav.indexOf('  if ("serviceWorker" in navigator)'),nav.indexOf('  // En-tête Écurie Initial partagé'));
async function updateScenario({existing=true,path='/chevaux/moondance-okina/',failure=false,heartbeat=false}={}){
  const listeners={},calls=[],heartbeats=[];let clock=1000000;
  class Channel{
    constructor(){this.port1={close(){},onmessage:null};this.port2={close(){},reply:value=>this.port1.onmessage?.({data:value})};}
  }
  const context={URL,location:{pathname:path},Date:{now:()=>clock},
    MessageChannel:Channel,setTimeout,clearTimeout,AbortController,Notification:{permission:'granted'},
    localStorage:{getItem(){return heartbeat?'a'.repeat(64):null;}},
    async fetch(_url,options){heartbeats.push(JSON.parse(options.body));return {};},
    applicationBase:new URL('https://fiches.ecurie-initial.com/application/'),
    document:{hidden:false,addEventListener(name,fn){listeners[name]=fn;}},
    window:{addEventListener(name,fn){listeners[name]=fn;}},
    navigator:{serviceWorker:{
      async getRegistration(url){assert.equal(url,'https://fiches.ecurie-initial.com/application/');return existing?{}:undefined;},
      async register(url,options){calls.push({url,options});if(failure)throw Error('Hors réseau');return {async update(){},
        active:{postMessage(_message,[port]){port.reply({version:'test-worker-v17'});}},
        pushManager:{async getSubscription(){return {endpoint:'https://fcm.googleapis.com/test-device'};}},
      };},
    }},
  };
  vm.runInNewContext(updateCode,context);
  for(let i=0;i<40;i++)await Promise.resolve();
  if(!existing&&!path.startsWith('/application/')){assert.equal(calls.length,0);return;}
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.updateViaCache,'none');
  assert.equal(calls[0].options.scope,'https://fiches.ecurie-initial.com/application/');
  if(heartbeat){
    assert.equal(heartbeats.length,1);
    assert.equal(heartbeats[0].action,'heartbeat');
    assert.equal(heartbeats[0].clientInfo.workerVersion,'test-worker-v17');
    assert.equal(heartbeats[0].clientInfo.permission,'granted');
  }else assert.equal(heartbeats.length,0,'Un visiteur non inscrit ne doit pas être suivi');
  await listeners.pageshow();
  assert.equal(calls.length,failure?2:1,'Les mises à jour réussies sont limitées, les échecs peuvent être retentés');
  const count=calls.length;
  clock+=61000;context.document.hidden=true;
  await listeners.visibilitychange();assert.equal(calls.length,count);
  context.document.hidden=false;
  await listeners.visibilitychange();assert.equal(calls.length,count+1,'Le retour au premier plan doit vérifier le correctif');
  const beforeRepair=calls.length;
  listeners['ei-push-device-changed']();
  for(let i=0;i<40;i++)await Promise.resolve();
  assert.equal(calls.length,beforeRepair+1,'Une réparation doit identifier immédiatement la nouvelle inscription');
}
await updateScenario();
await updateScenario({existing:false});
await updateScenario({existing:false,path:'/application/mes-chevaux/'});
await updateScenario({failure:true});
await updateScenario({heartbeat:true});
console.log('[OK] Mise à jour depuis une fiche et au retour de veille, sans inscription de visiteur ni rechargement');

// Exécuter la vraie fonction d'inscription avec une base simulée.
const raw=readFileSync(new URL('../supabase/functions/notifications/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const source=stripTypeScriptTypes(raw,{mode:'strip'});
async function preferenceScenario({type='associe',authenticated=true}={}){
  const writes=[];let handler,stored=null,selected='';
  const db={auth:{async getUser(){return {data:{user:{id:'member'}},error:null};}},from(table){
    let operation='select',values;const filters=[];
    const query={select(fields){selected=fields;return query;},eq(key,value){filters.push([key,value]);return query;},
      maybeSingle(){return query;},update(v){operation='update';values=v;return query;},
      insert(v){operation='insert';values=v;return query;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        if(table==='associes')return {data:{actif:true,type_compte:type},error:null};
        if(table==='ei_lancement_pilotes')return {data:{user_id:'member'},error:null};
        if(table==='ei_push_subscriptions'){
          if(operation!=='select'){
            writes.push(values);
            if(values.endpoint)stored={id:'current-subscription',...values};
            else if(stored)stored={...stored,...values};
            return {error:null};
          }
          const matches=stored&&filters.every(([key,value])=>stored[key]===value);
          return {data:matches?Object.fromEntries(selected.split(',').map(key=>[key,stored[key]])):null,error:null};
        }
        throw Error('Table inattendue '+table);
      }).then(resolve,reject);},
    };return query;
  }};
  class ClockDate extends Date{constructor(value){super(value??'2026-12-01T10:00:00Z');}static now(){return Date.parse('2026-12-01T10:00:00Z');}}
  vm.runInNewContext(source,{Date:ClockDate,Intl,Request,Response,URL,Uint8Array,TextEncoder,crypto,atob,btoa,console,
    Deno:{env:{get(){return '';}},serve(fn){handler=fn;}},createClient(){return db;},
    sendPushNotification(){throw Error('Envoi réel interdit');},
  });
  const body={action:'subscribe',deviceToken:'a'.repeat(64),
    subscription:{endpoint:'https://fcm.googleapis.com/test-device',keys:{p256dh:'b'.repeat(20),auth:'c'.repeat(20)}},
    preferences:{scope:'all',confirmed:true,daily:true,before15:true,results:true,withdrawn:true,
      private_news:true,general_news:true,public_news:false}};
  const request=payload=>new Request('https://example.test/notifications',{method:'POST',
    headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer test-session'}:{})},body:JSON.stringify(payload)});
  const response=await handler(request(body));
  assert.equal(response.status,200);
  const saved=writes.find(row=>row.endpoint);
  assert.equal(saved.public_news,false,'Le refus des annonces publiques doit être enregistré');
  assert.equal(saved.before15,true,'Le rappel explicitement choisi doit être enregistré');
  assert.equal(saved.private_news,authenticated&&type==='associe','Les visiteurs ne reçoivent pas les publications privées');
  const status=await (await handler(request({action:'status',endpoint:body.subscription.endpoint,deviceToken:body.deviceToken}))).json();
  assert.equal(status.preferences.public_news,false,'Le refus doit être restitué au rechargement');
  const beforeHeartbeat=writes.length;
  const heartbeat=await handler(request({action:'heartbeat',endpoint:body.subscription.endpoint,deviceToken:body.deviceToken,
    clientInfo:{standalone:true,permission:'granted',workerVersion:'test-worker-v17'}}));
  assert.equal(heartbeat.status,200);
  const recorded=writes.slice(beforeHeartbeat);
  assert.equal(recorded.length,1);
  assert.ok(recorded[0].last_seen_at);
  assert.equal(recorded[0].client_info.worker_version,'test-worker-v17');
  assert.equal(stored.public_news,false,'Le contrôle de l’appareil ne doit pas modifier les choix de notification');
  const beforeInvalid=writes.length;
  const invalid=await (await handler(request({action:'heartbeat',endpoint:body.subscription.endpoint,deviceToken:'d'.repeat(64)}))).json();
  assert.equal(invalid.active,false);
  assert.equal(writes.length,beforeInvalid,'Un mauvais jeton d’appareil ne peut pas modifier le diagnostic');
}
await preferenceScenario();
await preferenceScenario({type:'exterieur'});
await preferenceScenario({authenticated:false});
console.log('[OK] Préférences conservées après rechargement, rappel des membres extérieurs et droits privés respectés');
