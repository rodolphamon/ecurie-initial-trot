// Tests isolés : aucune requête réseau et aucun envoi Push.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const filename=new URL('../supabase/functions/push-dispatch/index.ts',import.meta.url);
const source=readFileSync(filename,'utf8').replace(/^import .*;\n/gm,'');
const javascript=stripTypeScriptTypes(source,{mode:'strip'});
const own={nom:'MOONDANCE OKINA',numPmu:12,statut:'NON_PARTANT'};
const event={date:'2026-11-26',hippodrome:'Mauquenchy',heure:'18:50',course:'R4C4',numero:12,statut:'partant'};
const start=Date.parse('2026-11-26T17:50:00Z');
const before=Date.parse('2026-11-26T17:45:00Z');
const names={'moondance-okina':'MOONDANCE OKINA'};

function runtime({entries=[own],conflict=false,ambiguous=false}={}){
  const writes=[],alerts=[],requests=[];
  const programme={reunions:[{numOfficiel:4,hippodrome:{libelleCourt:'MAUQUENCHY'},courses:[
    {numOrdre:4,heureDepart:start},...(ambiguous?[{numOrdre:5,heureDepart:start}]:[])
  ]}]};
  const db={from(table){
    assert.ok(['ei_contributions_engagements','ei_push_alerts'].includes(table),'Table inattendue : '+table);
    let values,operation;const filters=[];
    const query={
      update(row){values=row;operation='update';return query;},
      eq(key,value){filters.push([key,value]);return query;},
      select(){
        if(!operation)return query;
        if(conflict)return {data:[],error:null};
        writes.push({values,operation,filters});
        return {data:[{updated_at:'2026-11-26T17:45:00Z'}],error:null};
      },
      async maybeSingle(){return {data:{cheval_slug:'moondance-okina',engagements:[{...event,prix:'Saisie récente'}],updated_at:'2026-11-26T17:44:59Z'},error:null};},
      async insert(row){writes.push({values:row,operation:'insert'});return {error:null};},
      async upsert(row){alerts.push(row);return {error:null};},
    };return query;
  }};
  const context={Date,Intl,Map,Set,URL,TextEncoder,Uint8Array,AbortSignal,Response,
    console:{log(){},warn(){},error(){}},
    Deno:{env:{get(){return '';}},serve(){}},
    createClient(){return db;},
    async sendPushNotification(){throw Error('Tout envoi réel est interdit dans ce test');},
    async fetch(url){
      assert.ok(url.startsWith('https://online.turfinfo.api.pmu.fr/'),'Réseau non simulé : '+url);
      requests.push(url);
      return {ok:true,status:200,async json(){return url.endsWith('/participants')?{participants:entries}:programme;}};
    },
  };
  vm.createContext(context);
  vm.runInContext(javascript+'\nthis.testHooks={pmuPreflight,withdrawalOwner,withdrawalAlertId,key,isSilentPeriodParis};',context);
  return {hooks:context.testHooks,writes,alerts,requests};
}

function fixture(){
  const entries=[{...event},{date:'2026-12-09',hippodrome:'Lyon',statut:'engage',prix:'À conserver'}];
  return {editorial:{engagements:{'moondance-okina':structuredClone(entries)}},
    overrides:[{cheval_slug:'moondance-okina',engagements:structuredClone(entries),updated_at:'2026-11-26T10:00:00Z'}]};
}

{
  const r=runtime(),f=fixture();
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,before);
  assert.equal(r.writes.length,1);
  assert.equal(f.editorial.engagements['moondance-okina'][0].statut,'non-partant');
  assert.match(f.editorial.engagements['moondance-okina'][0].non_partant_source,/R4\/C4\/participants$/);
  assert.equal(f.editorial.engagements['moondance-okina'][1].prix,'À conserver');
  assert.ok(r.writes[0].filters.some(([key])=>key==='updated_at'));
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,before);
  assert.equal(r.writes.length,1,'Le retrait ne doit être traité qu’une fois');
  console.log('[OK] Non-partant PMU à H-5, statut actualisé, autres engagements conservés et second passage sans doublon');
}
for(const entries of [
  [{...own,statut:'PARTANT'},{nom:'AUTRE CHEVAL',numPmu:5,statut:'NON_PARTANT'}],
  [{...own,nom:'AUTRE CHEVAL'}],
]){
  const r=runtime({entries}),f=fixture();
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,before);
  assert.equal(r.writes.length,0);
  assert.equal(f.editorial.engagements['moondance-okina'][0].statut,'partant');
}
for(const options of [{ambiguous:true},{conflict:true}]){
  const r=runtime(options),f=fixture();
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,before);
  assert.equal(r.writes.length,0);
  assert.equal(f.editorial.engagements['moondance-okina'][0].statut,'partant');
  if(options.conflict)assert.equal(f.editorial.engagements['moondance-okina'][0].prix,'Saisie récente');
}
{
  const r=runtime(),f=fixture();
  await r.hooks.pmuPreflight(f.editorial,names,[],before);
  assert.equal(r.writes[0].operation,'insert');
  assert.equal(f.editorial.engagements['moondance-okina'][0].statut,'non-partant');
}
{
  const r=runtime(),f=fixture();
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,Date.parse('2026-11-26T18:00:00Z'));
  assert.equal(r.writes.length,1,'Un retrait confirmé à H+10 doit rester détectable');
}
{
  const r=runtime(),f=fixture();f.editorial.engagements['moondance-okina'][0].reunion_annulee=true;
  await r.hooks.pmuPreflight(f.editorial,names,f.overrides,before);
  assert.equal(r.requests.length,0);
}
console.log('[OK] Aucun faux retrait : autre cheval, partant maintenu, course ambiguë, saisie concurrente et réunion annulée');
{
  const {hooks:h}=runtime(),holdings=new Set(['moondance-okina']);
  assert.equal(h.withdrawalOwner(true,true,holdings,'moondance-okina'),true);
  assert.equal(h.withdrawalOwner(true,true,holdings,'nostalgie-dairpet'),false);
  assert.equal(h.withdrawalOwner(true,false,holdings,'moondance-okina'),false);
  assert.equal(h.withdrawalOwner(false,true,holdings,'moondance-okina'),false);
  const id=h.withdrawalAlertId(h.key('moondance-okina',event));
  assert.equal(id,h.withdrawalAlertId(h.key('moondance-okina',{...event,statut:'np'})));
  assert.equal(h.isSilentPeriodParis(new Date('2026-11-26T21:29:00Z')),false);
  assert.equal(h.isSilentPeriodParis(new Date('2026-11-26T21:30:00Z')),true);
  assert.equal(h.isSilentPeriodParis(new Date('2026-11-27T06:59:00Z')),true);
  assert.equal(h.isSilentPeriodParis(new Date('2026-11-27T07:00:00Z')),false);
}
console.log('[OK] Détenteurs associés uniquement, identifiant unique par course et silence 22h30–08h00');

// Exécuter aussi le vrai moteur complet avec une base et un fournisseur Push
// entièrement simulés, pour contrôler le filtrage et la réservation anti-doublon.
async function dispatchScenario({quiet=false,diagnostic=false,resultsEnabled=true,malformed=false}={}){
  let clock=Date.parse(quiet?'2026-12-01T21:30:00Z':'2026-12-01T10:01:00Z');
  const date=quiet?'2026-12-02':'2026-12-01';
  const editorial={engagements:{'moondance-okina':[{...event,date,statut:diagnostic?'engage':'non-partant'}]},performances:{}};
  const alerts=new Map(),races=new Map(),deliveries=new Set(),sent=[];
  const ownerUser='11111111-1111-4111-8111-111111111111';
  const userId=id=>id==='owner'?ownerUser:id;
  if(diagnostic)alerts.set('admin-test:11111111-1111-4111-8111-111111111111',{
    id:'admin-test:11111111-1111-4111-8111-111111111111',categorie:'results',cheval_slug:null,
    created_at:new Date(clock).toISOString(),expires_at:new Date(clock+360000).toISOString(),
    payload:{diagnostic_target_user_id:malformed?'':ownerUser,not_before:new Date(clock+90000).toISOString()},
  });
  const ids=['owner','other','observer','visitor'];
  const subscriptions=ids.map(id=>({id,user_id:userId(id),audience:id==='visitor'?'visitor':'associate',
    scope:'all',withdrawn:true,results:resultsEnabled,created_at:'2026-11-01T00:00:00Z',endpoint:'https://push.example/'+id}));
  const members=ids.map(id=>({user_id:userId(id),type_compte:id==='observer'?'observateur':id==='visitor'?'exterieur':'associe'}));
  const participations=ids.map(id=>({user_id:userId(id),cheval_slug:id==='other'?'nostalgie-dairpet':'moondance-okina'}));
  class ClockDate extends Date{constructor(value){super(value??clock);}static now(){return clock;}}
  function from(table){
    let operation='select',value,head=false,one=false;const filters=[];
    const query={
      select(_fields,options){head=options?.head===true;return query;},
      eq(k,v){filters.push([k,v]);return query;},
      in(){return query;},gt(){return query;},order(){return query;},limit(){return query;},
      maybeSingle(){one=true;return query;},single(){one=true;return query;},
      upsert(v){operation='upsert';value=v;return query;},
      insert(v){operation='insert';value=v;return query;},
      update(v){operation='update';value=v;return query;},
      delete(){operation='delete';return query;},
      then(resolve,reject){return Promise.resolve().then(execute).then(resolve,reject);},
    };
    function execute(){
      if(table==='ei_contributions_engagements')return {data:[],error:null};
      if(table==='ei_push_races'){
        if(operation==='upsert'){races.set(value.event_key,value);return {error:null};}
        if(head)return {count:1,error:null};
        const eventKey=filters.find(([k])=>k==='event_key')?.[1];
        return {data:races.get(eventKey)||{statut:'partant'},error:null};
      }
      if(table==='ei_push_alerts'){
        if(operation==='upsert'){
          if(!alerts.has(value.id))alerts.set(value.id,{...value,created_at:new Date(clock).toISOString()});
          return {error:null};
        }
        return {data:[...alerts.values()].filter(a=>Date.parse(a.expires_at)>clock),error:null};
      }
      if(table==='ei_push_subscriptions')return {data:subscriptions,error:null};
      if(table==='associes')return {data:members,error:null};
      if(table==='participations_chevaux')return {data:participations,error:null};
      if(table==='ei_push_deliveries'){
        if(operation==='insert'){
          const id=value.alert_id+'|'+value.subscription_id;
          if(deliveries.has(id))return {error:{code:'23505'}};
          deliveries.add(id);
        }
        return {data:null,error:null};
      }
      if(table==='ei_push_receipts')return {data:one?{id:'00000000-0000-4000-8000-000000000001'}:null,error:null};
      throw Error('Accès base non simulé : '+table);
    }
    return query;
  }
  const context={Date:ClockDate,Intl,Map,Set,URL,TextEncoder,Uint8Array,AbortSignal,Response,
    console:{log(){},warn(){},error(){}},
    Deno:{env:{get:key=>key.includes('VAPID')?'test-only':''},serve(){}},
    createClient:()=>({from}),
    sendPushNotification:async(sub,message,_vapid,options)=>{sent.push({sub,message,options});return true;},
    fetch:async(url)=>{
      if(url.includes('editorial.json'))return {ok:true,json:async()=>structuredClone(editorial)};
      if(url.includes('chevaux.json'))return {ok:true,json:async()=>({horses:[{id:'moondance-okina',name:'MOONDANCE OKINA'}]})};
      throw Error('Aucun accès réseau réel autorisé : '+url);
    },
  };
  vm.createContext(context);vm.runInContext(javascript+'\nthis.dispatch=run;',context);
  await context.dispatch();
  assert.equal(alerts.size,1);
  if(diagnostic){
    assert.equal(sent.length,0,'Le test attend au moins 90 secondes');
    clock+=120000;
    await context.dispatch();
    assert.equal(sent.length,resultsEnabled&&!malformed?1:0,'Préférence désactivée et ciblage invalide ne doivent rien envoyer');
    if(sent.length){
      assert.equal(sent[0].sub.endpoint,'https://push.example/owner','Un seul compte doit recevoir le test');
      assert.match(sent[0].message.title,/Test automatique/);
      assert.equal(sent[0].options.urgency,'high');
      await context.dispatch();assert.equal(sent.length,1,'Le cron suivant ne doit pas renvoyer le test');
    }
    return;
  }
  if(quiet){
    assert.equal(sent.length,0,'Aucun envoi pendant la plage de silence');
    clock=Date.parse('2026-12-02T07:00:00Z');
    await context.dispatch();
  }
  assert.equal(sent.length,1);
  assert.equal(sent[0].sub.endpoint,'https://push.example/owner','Seul le détenteur associé doit recevoir le Push');
  assert.match(sent[0].message.title,/Non-partant/);
  assert.match(sent[0].message.url,/cheval=moondance-okina.*statut=non-partant/);
  assert.equal(sent[0].options.urgency,'high');
  assert.equal(sent[0].message.tag,[...alerts.values()][0].id);
  assert.equal(sent[0].options.ttl,Math.floor((Date.parse([...alerts.values()][0].expires_at)-clock)/1000),
    'La notification doit expirer chez le fournisseur en même temps que l’alerte');
  await context.dispatch();
  assert.equal(sent.length,1,'Le même appareil ne doit pas recevoir de doublon');
}
await dispatchScenario();
await dispatchScenario({quiet:true});
console.log('[OK] Moteur complet : 1 détenteur livré, autres associés et observateurs exclus, report à 8h et aucun doublon');
await dispatchScenario({diagnostic:true});
await dispatchScenario({diagnostic:true,resultsEnabled:false});
await dispatchScenario({diagnostic:true,malformed:true});
console.log('[OK] Test par le vrai moteur : délai de 90 secondes, ciblage d’un seul compte, préférence respectée et aucun doublon');
