// Tests de réception et de préférences : aucun réseau ni envoi Push réel.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const workerSource=readFileSync(new URL('../docs/application/sw.js',import.meta.url),'utf8');
function worker({displayFails=false,cacheFails=false}={}){
  const handlers={},shown=[],reports=[],timers=new Map();
  let sequence=0,skipped=false;
  const context={URL,Date,AbortController,Promise,console,
    setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    indexedDB:{open(){return {}; /* Simule un stockage bloqué sans événement. */}},
    fetch(_url,options){reports.push(JSON.parse(options.body));return new Promise(()=>{});},
    caches:{async open(){if(cacheFails)throw Error('Cache indisponible');return {async add(){throw Error('Icône indisponible');}};}},
    self:{location:{origin:'https://fiches.ecurie-initial.com'},
      addEventListener(name,handler){handlers[name]=handler;},
      async skipWaiting(){skipped=true;},
      registration:{async showNotification(title,options){
        shown.push({title,options});if(displayFails)throw new TypeError('Affichage refusé');
      }},
    },
  };
  vm.runInNewContext(workerSource,context);
  return {handlers,shown,reports,timers,get skipped(){return skipped;}};
}
for(const displayFails of [false,true]){
  const r=worker({displayFails});let completion;
  r.handlers.push({data:{json(){return {title:'Course',receipt_id:'12345678-1234-4234-8234-123456789abc'};}},
    waitUntil(promise){completion=promise;}});
  // showNotification est appelé avant les premières opérations de diagnostic.
  assert.equal(r.shown.length,1);
  assert.equal(r.reports.length,0);
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.ok(r.reports.some(p=>p.status===(displayFails?'error':'shown')));
  const deadline=[...r.timers.values()].find(timer=>timer.ms===6000);
  assert.ok(deadline,'Le traitement Push doit avoir une échéance');
  deadline.fn();
  await completion;
}
for(const cacheFails of [false,true]){
  const r=worker({cacheFails});let completion;
  r.handlers.install({waitUntil(promise){completion=promise;}});
  await completion;
  assert.equal(r.skipped,true,'Le cache ne doit pas empêcher le nouveau worker de prendre la relève');
}
console.log('[OK] Affichage immédiat avec stockage et télémétrie bloqués, erreur mesurée et installation possible sans cache');

// Le même code partagé doit actualiser le worker depuis une fiche hors scope.
const nav=readFileSync(new URL('../docs/application/nav.js',import.meta.url),'utf8');
const updateCode=nav.slice(nav.indexOf('  if ("serviceWorker" in navigator)'),nav.indexOf('  // En-tête Écurie Initial partagé'));
async function updateScenario({existing=true,path='/chevaux/moondance-okina/',failure=false}={}){
  const listeners={},calls=[];let clock=1000000;
  const context={URL,location:{pathname:path},Date:{now:()=>clock},
    applicationBase:new URL('https://fiches.ecurie-initial.com/application/'),
    document:{hidden:false,addEventListener(name,fn){listeners[name]=fn;}},
    window:{addEventListener(name,fn){listeners[name]=fn;}},
    navigator:{serviceWorker:{
      async getRegistration(url){assert.equal(url,'https://fiches.ecurie-initial.com/application/');return existing?{}:undefined;},
      async register(url,options){calls.push({url,options});if(failure)throw Error('Hors réseau');return {async update(){}};},
    }},
  };
  vm.runInNewContext(updateCode,context);
  for(let i=0;i<8;i++)await Promise.resolve();
  if(!existing&&!path.startsWith('/application/')){assert.equal(calls.length,0);return;}
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.updateViaCache,'none');
  assert.equal(calls[0].options.scope,'https://fiches.ecurie-initial.com/application/');
  await listeners.pageshow();
  assert.equal(calls.length,failure?2:1,'Les mises à jour réussies sont limitées, les échecs peuvent être retentés');
  const count=calls.length;
  clock+=61000;context.document.hidden=true;
  await listeners.visibilitychange();assert.equal(calls.length,count);
  context.document.hidden=false;
  await listeners.visibilitychange();assert.equal(calls.length,count+1,'Le retour au premier plan doit vérifier le correctif');
}
await updateScenario();
await updateScenario({existing:false});
await updateScenario({existing:false,path:'/application/mes-chevaux/'});
await updateScenario({failure:true});
console.log('[OK] Mise à jour depuis une fiche et au retour de veille, sans inscription de visiteur ni rechargement');

// Exécuter la vraie fonction d'inscription avec une base simulée.
const raw=readFileSync(new URL('../supabase/functions/notifications/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const source=stripTypeScriptTypes(raw,{mode:'strip'});
async function preferenceScenario({type='associe',authenticated=true}={}){
  const writes=[];let handler,stored=null,selected='';
  const db={auth:{async getUser(){return {data:{user:{id:'member'}},error:null};}},from(table){
    let operation='select',values;
    const query={select(fields){selected=fields;return query;},eq(){return query;},
      maybeSingle(){return query;},update(v){operation='update';values=v;return query;},
      insert(v){operation='insert';values=v;return query;},
      then(resolve,reject){return Promise.resolve().then(()=>{
        if(table==='associes')return {data:{actif:true,type_compte:type},error:null};
        if(table==='ei_lancement_pilotes')return {data:{user_id:'member'},error:null};
        if(table==='ei_push_subscriptions'){
          if(operation!=='select'){
            writes.push(values);
            if(values.endpoint)stored={...values};
            return {error:null};
          }
          return {data:stored?Object.fromEntries(selected.split(',').map(key=>[key,stored[key]])):null,error:null};
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
}
await preferenceScenario();
await preferenceScenario({type:'exterieur'});
await preferenceScenario({authenticated:false});
console.log('[OK] Préférences conservées après rechargement, rappel des membres extérieurs et droits privés respectés');
