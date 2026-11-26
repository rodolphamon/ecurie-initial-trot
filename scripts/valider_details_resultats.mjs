// Régression : le secours PMU publie le détail avant le départ de la notification.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
async function load(path){
  const source=stripTypeScriptTypes(readFileSync(new URL(path,import.meta.url),'utf8'));
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {pmuPerformance}=await load('../supabase/functions/push-dispatch/pmu-performance.ts');
const {publicPerformance}=await load('../supabase/functions/public-race-results/projection.ts');
const event={date:'2026-11-26',hippodrome:'Mauquenchy',course:'R4C4',driver:'Sébastien OLIVIER',ferrure:'F4',surface:'Sable',type_course:'Course E'};
const race={arriveeDefinitive:true,ordreArrivee:[[14],[13],[12]],discipline:'ATTELE',distance:2850,
  libelle:'Prix de test',nombreDeclaresPartants:15,montantTotalOffert:21000,montantOffert3eme:2940};
const runners=[{numPmu:14,nom:'PREMIERE',driver:'A. DRIVER'},{numPmu:13,nom:'DEUXIEME',driver:'B. DRIVER'},
  {numPmu:12,nom:'MOONDANCE OKINA',driver:'S. OLIVIER',entraineur:'B. MARIE',handicapDistance:2875,reductionKilometrique:77400}];
const performance=pmuPerformance(event,race,runners,12,'MOONDANCE OKINA');
assert.equal(performance.rang,'3');
assert.equal(performance.distance,2875,'Distance propre au cheval, avec recul');
assert.equal(performance.reduction_km,'1′17″4');
assert.equal(performance.allocation,21000);
assert.equal(performance.allocation_place,2940);
assert.equal(performance.driver,'Sébastien OLIVIER');
assert.equal(performance.arrivee[2].driver,'Sébastien OLIVIER');
const payload={date:event.date,hippodrome:event.hippodrome,rang:'3',performance,private_email:'secret',user_id:'secret'};
const projected=publicPerformance(payload);
assert.equal(projected.arrivee.length,3);
assert.equal(projected.partants,15);
assert.equal(projected.ferrure,'F4');
assert.equal(projected.course_url,'https://www.equidia.fr/courses/2026-11-26/R4/C4');
assert.equal(projected.private_email,undefined);
assert.equal(projected.user_id,undefined);
assert.equal(publicPerformance({...payload,performance:{...performance,date:'2026-11-25'}}).arrivee,undefined);
assert.equal(publicPerformance({...payload,rang:'2'}).arrivee,undefined,'Pas de détail attaché à un autre classement');
assert.equal(pmuPerformance(event,{...race,arriveeDefinitive:false},runners,12,'MOONDANCE OKINA'),null);
assert.equal(pmuPerformance(event,race,runners,12,'AUTRE CHEVAL'),null);
assert.equal(pmuPerformance(event,race,runners.slice(1),12,'MOONDANCE OKINA'),null,'Aucune arrivée inventée si un participant manque');
const tied=pmuPerformance(event,{...race,ordreArrivee:[[12,14],[13]]},runners,12,'MOONDANCE OKINA');
assert.deepEqual(tied.arrivee.map(r=>r.rang),[1,1,3]);
assert.equal(tied.allocation_place,undefined,'Pas de barème individuel appliqué aux ex aequo');
console.log('[OK] Détails PMU, identité, recul, ex aequo, projection publique sans donnée privée');

const app=readFileSync(new URL('../docs/chevaux/assets/app.js',import.meta.url),'utf8');
const context={console,URL,AbortSignal,fetch:async url=>({ok:true,json:async()=>url.includes('raw.githubusercontent')
  ?{performances:{test:[{date:event.date,hippodrome:event.hippodrome,rang:'3e',officiel:true,driver:'Monte déjà vérifiée'}]}}
  :{performances:{test:[projected]}}})};
const normalize=app.slice(app.indexOf('function normalizeSearch('),app.indexOf('function searchDistance('));
const display=app.slice(app.indexOf('const displayRank='),app.indexOf('const horseSex='));
const fresh=app.slice(app.indexOf('function mergeArrivalDetails('),app.indexOf('async function loadCourseFields('));
vm.runInNewContext(normalize+display+fresh+';globalThis.fresh=freshPerformances;',context);
const merged=await context.fresh({performances:{}});
assert.equal(merged.test.length,1);
assert.equal(merged.test[0].driver,'Monte déjà vérifiée','Préserver les valeurs déjà vérifiées');
assert.equal(merged.test[0].arrivee.length,3,'Compléter aussi un résultat déjà officiel');
console.log('[OK] Arrivée enrichie malgré une copie GitHub déjà officielle ou en cache');

// Vérifier l'intégration des deux producteurs et l'ordre avant sauvegarde/livraison.
const dispatch=readFileSync(new URL('../supabase/functions/push-dispatch/index.ts',import.meta.url),'utf8');
const pmu=dispatch.slice(dispatch.indexOf('async function pmuOfficialAlerts('),dispatch.indexOf('// Précontrôle avant les départs.'));
assert.ok(pmu.indexOf('pmuPerformance(')<pmu.indexOf('else await saveAlert(alert)'));
assert.ok(pmu.includes('source:"PMU - arrivée définitive",performance'));
assert.ok(dispatch.includes('performance:official?p:undefined'));
assert.ok(pmu.includes('.update({payload:alert.payload})'),'Rattrapage sans nouvelle alerte');
console.log('[OK] Les deux circuits joignent les détails au résultat et conservent le même identifiant');
