// Écurie Initial — moteur Push. Exécution CRON toutes les minutes (Europe/Paris).
// Aucun envoi sans abonnement volontaire ; aucune notification de simple engagement.
// Résultat officiel : exige "officiel": true sur la performance vérifiée.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushNotification } from "npm:@mmmike/web-push/send";

const env = (k: string) => Deno.env.get(k) || "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const APP = "https://fiches.ecurie-initial.com";
const PILOT_LAUNCH_AT = Date.parse("2026-11-30T23:00:00Z");
// Les commits de GitHub Actions ne déclenchent pas toujours une reconstruction Pages.
// La source brute garantit au moteur Push la dernière performance vérifiée.
const editorialUrl = "https://raw.githubusercontent.com/rodolphamon/ecurie-initial-trot/main/docs/chevaux/data/editorial.json";
const horsesUrl = APP + "/chevaux/data/chevaux.json";
const NON_PARTANT = new Set(["non-partant", "np"]);
const CONFIRMED = new Set(["partant", "declare"]);
type Event = { date: string; hippodrome?: string; heure?: string; statut?: string; prix?: string; course?: string };
type Race = { event_key: string; cheval_slug: string; cheval_nom: string; date_course: string; hippodrome: string; course: string|null; statut: string; depart: string|null };
type Alert = { id: string; categorie: string; cheval_slug: string|null; payload: Record<string, unknown>; expires_at: string };
function parisNow(d: Date) {
  const fmt=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts=Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]));
  return { date: parts.year+"-"+parts.month+"-"+parts.day, hour:Number(parts.hour), minute:Number(parts.minute) };
}
function parisDeparture(date: string, heure?: string): string|null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(heure||"")) return null;
  const dt = new Date(date+"T12:00:00Z");
  const tz = new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Paris",timeZoneName:"shortOffset"}).formatToParts(dt).find(x=>x.type==="timeZoneName")?.value||"GMT+1";
  const match=tz.match(/GMT([+-])(\d{1,2})/);
  const off=match ? (match[1]==="+"?1:-1)*Number(match[2]):1;
  return new Date(Date.parse(date+"T"+heure+":00Z")-off*3600000).toISOString();
}
const esc=(s:unknown)=>String(s||"").slice(0,240);
// Annonce lisible, en reprenant exclusivement l'hippodrome et l'heure déclarés.
function annonceCourse(nom:unknown, hippodrome:unknown, heure:unknown, jour:string):string {
  const horse=esc(nom).trim();
  const venue=esc(hippodrome).trim();
  const hour=esc(heure).trim();
  const m=hour.match(/^(\d{1,2}):(\d{2})$/);
  const quand=m?" à "+Number(m[1])+"h"+m[2]:"";
  const ou=venue && venue!=="Hippodrome à confirmer"?" à "+venue:"";
  return horse+" court "+jour+quand+ou+".";
}
function jourCourse(date:unknown, aujourdHui:string):string {
  const course=esc(date);
  if(course===aujourdHui)return "aujourd’hui";
  const demain=new Date(Date.parse(aujourdHui+"T00:00:00Z")+86400000).toISOString().slice(0,10);
  if(course===demain)return "demain";
  return /^\d{4}-\d{2}-\d{2}$/.test(course)
    ? "le "+course.slice(8,10)+"/"+course.slice(5,7)+"/"+course.slice(0,4)
    : "à une date à confirmer";
}
function resumePartants(partants:{nom:string;hippodrome?:string;heure?:string}[]):string {
  const annonces=partants.map(p=>annonceCourse(p.nom,p.hippodrome,p.heure,"aujourd’hui"));
  let texte="";
  for(let i=0;i<annonces.length;i++){
    const encore=annonces.length-i-1;
    const nouvelle=texte+(texte?" ":"")+annonces[i];
    const suffixe=encore>0?" Et "+encore+" autre"+(encore>1?"s":"")+" partant"+(encore>1?"s":"")+".":"";
    if(nouvelle.length+suffixe.length>220 && texte)return texte+suffixe;
    texte=nouvelle;
  }
  return texte;
}
const key=(slug:string,e:Event)=>[slug,e.date,esc(e.hippodrome).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()].join("|");
async function saveAlert(row: Alert) {
  const {error}=await sb.from("ei_push_alerts").upsert(row,{onConflict:"id",ignoreDuplicates:true});
  if(error)throw error;
}
async function getJSON(url:string) {
  const r=await fetch(url,{headers:{"Cache-Control":"no-cache"},cache:"no-store"});
  if(!r.ok)throw Error("Source JSON indisponible ("+r.status+")");
  return r.json();
}
const iso=(n:number)=>new Date(n).toISOString();
// Secours temps réel : GitHub Actions peut décaler ses cron de plus de 30 min.
// Le cron Supabase (chaque minute) recherche indépendamment les arrivées PMU
// définitives à partir de H+12 min, uniquement pour les chevaux/n°/courses
// déclarés. Aucune place non classée n'est déduite.
const PMU_PROGRAM = "https://online.turfinfo.api.pmu.fr/rest/client/1";
const pmuText=(s:unknown)=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
const pmuNumber=(value:unknown)=> {
  if(typeof value==="number" && Number.isInteger(value) && value>0)return value;
  if(typeof value==="string" && /^\d{1,3}$/.test(value.trim()))return Number(value.trim());
  return null;
};
async function pmuJSON(url:string) {
  const response=await fetch(url,{
    cache:"no-store",signal:AbortSignal.timeout(3500),
    headers:{"Accept":"application/json","Origin":"https://www.pmu.fr",
      "User-Agent":"EcurieInitial-PushOfficialResults/1.0 (contact@ecurie-initial.com)"},
  });
  if(!response.ok)throw Error("PMU HTTP "+response.status);
  return response.json();
}
async function pmuOfficialAlerts(
  editorial:Record<string,any>, horseNames:Record<string,string>, now:number,
):Promise<number> {
  const targets: {slug:string;event:Event & {numero?:unknown};depart:number;bib:number;reunion:number;course:number;id:string}[]=[];
  for(const [slug,entries] of Object.entries(editorial.engagements||{})){
    if(!Array.isArray(entries) || !horseNames[slug])continue;
    for(const event of entries as (Event & {numero?:unknown})[]){
      if(!event || !CONFIRMED.has(String(event.statut||"").toLowerCase()))continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date||""))continue;
      const m=String(event.course||"").match(/^R(\d+)C(\d+)$/i);
      const bib=pmuNumber(event.numero),departure=parisDeparture(event.date,event.heure);
      if(!m || !bib || !departure || !event.hippodrome)continue;
      const depart=Date.parse(departure),age=now-depart;
      if(age<12*60000 || age>3*3600000)continue;
      // Les résultats déjà publiés par GitHub sont traités ci-dessous.
      const already=(editorial.performances?.[slug]||[]).some((p:Record<string,unknown>)=>
        p.date===event.date&&pmuText(p.hippodrome)===pmuText(event.hippodrome)
        &&(p.officiel===true||p.statut==="officiel"));
      if(already)continue;
      targets.push({slug,event,depart,bib,reunion:Number(m[1]),course:Number(m[2]),
        id:"results:"+slug+"|"+event.date+"|"+esc(event.hippodrome).toLowerCase()});
    }
  }
  // Les plus récentes d'abord, pour ne pas laisser une course non classée
  // monopoliser les requêtes. Les autres sont reprises à la minute suivante.
  targets.sort((a,b)=>b.depart-a.depart);
  const programmeCache=new Map<string,any>();
  let added=0;
  for(const item of targets.slice(0,4)){
    try{
      const {data:exists,error:existsError}=await sb.from("ei_push_alerts")
        .select("id").eq("id",item.id).maybeSingle();
      if(existsError)throw existsError;
      if(exists)continue;
      const day=item.event.date;
      let payload=programmeCache.get(day);
      if(!payload){
        const ymd=day.slice(8,10)+day.slice(5,7)+day.slice(0,4);
        payload=await pmuJSON(PMU_PROGRAM+"/programme/"+ymd);
        programmeCache.set(day,payload);
      }
      const meetings=payload?.programme?.reunions??payload?.reunions;
      if(!Array.isArray(meetings))continue;
      const meeting=meetings.find((m:any)=>
        pmuNumber(m?.numOfficiel??m?.numReunion??m?.numOrdre)===item.reunion);
      if(!meeting)continue;
      const hippodrome=meeting.hippodrome;
      const officialVenue=typeof hippodrome==="string"?hippodrome:
        hippodrome?.libelleCourt||hippodrome?.libelleLong||hippodrome?.libelle||hippodrome?.nom;
      if(pmuText(officialVenue)!==pmuText(item.event.hippodrome))continue;
      const race=(meeting.courses||[]).find((c:any)=>
        pmuNumber(c?.numOrdre??c?.numCourse)===item.course);
      if(!race || race.arriveeDefinitive!==true || !Array.isArray(race.ordreArrivee))continue;
      let rank=0,offset=0,valid=true;
      for(const group of race.ordreArrivee){
        const entries=Array.isArray(group)?group:[group];
        const numbers=entries.map(pmuNumber);
        if(!numbers.length||numbers.some(n=>n===null)){valid=false;break}
        if(numbers.includes(item.bib)){rank=offset+1;break}
        offset+=numbers.length;
      }
      if(!valid||rank<1)continue;
      const ymd=day.slice(8,10)+day.slice(5,7)+day.slice(0,4);
      const participants=await pmuJSON(PMU_PROGRAM+"/programme/"+ymd+
        "/R"+item.reunion+"/C"+item.course+"/participants");
      if(!Array.isArray(participants?.participants))continue;
      const horseMatches=participants.participants.filter((p:any)=>
        pmuNumber(p?.numPmu)===item.bib);
      if(horseMatches.length!==1 ||
         pmuText(horseMatches[0].nom)!==pmuText(horseNames[item.slug]))continue;
      await saveAlert({id:item.id,categorie:"results",cheval_slug:item.slug,payload:{
        nom:horseNames[item.slug],hippodrome:item.event.hippodrome,
        date:day,rang:rank===1?"1er":rank+"e",official:true,pilotTest:false,
        source:"PMU - arrivée définitive",
      },expires_at:iso(now+36*3600_000)});
      console.log("[PMU-PUSH] Arrivée officielle vérifiée : "+item.slug+
        " R"+item.reunion+"C"+item.course+" n°"+item.bib+" "+rank+"e");
      added++;
    }catch(error){
      console.warn("[PMU-PUSH] Vérification différée : "+item.slug+" "+
        (error instanceof Error?error.name:"erreur de source"));
    }
  }
  return added;
}

// Précontrôle avant les départs. Une fois toutes les 15 min : retrouver
// l'unique cheval dans les participants du programme PMU, et non déduire
// le code RnCm du seul numéro de course. Les corrections sont appliquées
// aux engagements Supabase (source prioritaire dans ce moteur).
function pmuRaceStart(race:Record<string,unknown>):number|null {
  for(const field of ["heureDepart","heureDepartTheorique","heureDepartInitiale"]){
    const t=race[field];
    if(typeof t==="number" && t>1_500_000_000_000 && t<2_500_000_000_000)return t;
  }
  return null;
}
async function pmuPreflight(
  editorial:Record<string,any>,horseNames:Record<string,string>,
  overrides:Record<string,any>[],now:number,
):Promise<number>{
  // Le cron tourne chaque minute, mais les fiches et listes PMU sont lues
  // seulement toutes les 15 min jusqu'à 36 h avant la course.
  if(new Date(now).getUTCMinutes()%15!==0)return 0;
  const targets:{slug:string;evt:Event & {numero?:unknown};departure:number;index:number}[]=[];
  for(const [slug,rows] of Object.entries(editorial.engagements||{})){
    if(!horseNames[slug]||!Array.isArray(rows))continue;
    for(let index=0;index<rows.length;index++){
      const evt=rows[index] as Event & {numero?:unknown};
      if(!evt || !CONFIRMED.has(String(evt.statut||"").toLowerCase())
        || !/^\d{4}-\d{2}-\d{2}$/.test(evt.date||"") || !evt.hippodrome)continue;
      const departureString=parisDeparture(evt.date,evt.heure);
      if(!departureString)continue;
      const departure=Date.parse(departureString),before=departure-now;
      if(before<10*60000 || before>36*3600000)continue;
      targets.push({slug,evt,departure,index});
    }
  }
  const cache=new Map<string,any>();
  let confirmed=0;
  for(const item of targets.sort((a,b)=>a.departure-b.departure).slice(0,8)){
    const {slug,evt,departure,index}=item;
    const targetName=pmuText(horseNames[slug]);
    const expectedCode=String(evt.course||"").toUpperCase();
    const expectedBib=pmuNumber(evt.numero);
    const remainingMinutes=(departure-now)/60000;
    try{
      const day=evt.date,ymd=day.slice(8,10)+day.slice(5,7)+day.slice(0,4);
      let programme=cache.get(day);
      if(!programme){
        programme=await pmuJSON(PMU_PROGRAM+"/programme/"+ymd);
        cache.set(day,programme);
      }
      const meetings=programme?.programme?.reunions??programme?.reunions;
      if(!Array.isArray(meetings))continue;
      const matches:{code:string;bib:number;start:number|null}[]=[];
      const races:{code:string;race:Record<string,unknown>;start:number|null}[]=[];
      for(const meeting of meetings){
        const reunion=pmuNumber(meeting?.numOfficiel??meeting?.numReunion??meeting?.numOrdre);
        const place=meeting?.hippodrome;
        const venue=typeof place==="string"?place:
          place?.libelleCourt||place?.libelleLong||place?.libelle||place?.nom;
        if(!reunion || pmuText(venue)!==pmuText(evt.hippodrome))continue;
        for(const race of meeting?.courses||[]){
          const number=pmuNumber(race?.numOrdre??race?.numCourse);
          if(!number)continue;
          const start=pmuRaceStart(race);
          // Une course à une autre heure ne peut pas servir de correspondance.
          if(start!==null && Math.abs(start-departure)>15*60000)continue;
          races.push({code:"R"+reunion+"C"+number,race,start});
        }
      }
      // Quand l'heure n'est pas connue dans la réponse PMU, privilégier
      // le code complet déclaré ; sinon ne sonder que quelques courses.
      races.sort((a,b)=>{
        const aMatch=a.code===expectedCode?0:1,bMatch=b.code===expectedCode?0:1;
        if(aMatch!==bMatch)return aMatch-bMatch;
        return (a.start===null?3600000:Math.abs(a.start-departure))
             -(b.start===null?3600000:Math.abs(b.start-departure));
      });
      for(const candidate of races.slice(0,7)){
        try{
          const participants=await pmuJSON(PMU_PROGRAM+"/programme/"+ymd+"/"
            +candidate.code.slice(0,candidate.code.indexOf("C"))+"/"
            +candidate.code.slice(candidate.code.indexOf("C"))+"/participants");
          if(!Array.isArray(participants?.participants))continue;
          const same=participants.participants.filter((p:any)=>
            pmuText(p?.nom)===targetName && pmuNumber(p?.numPmu)!==null);
          if(same.length===1)matches.push({
            code:candidate.code,bib:pmuNumber(same[0].numPmu)!,start:candidate.start,
          });
        }catch(err){
          console.warn("[AVANT-COURSE] Partants indisponibles "+slug+" "+candidate.code+" "
            +(err instanceof Error?err.name:"PMU"));
        }
      }
      if(matches.length!==1){
        if(remainingMinutes<=90){
          await saveAlert({id:"preflight:"+slug+"|"+day+"|"+pmuText(evt.hippodrome),
            categorie:"preflight_warning",cheval_slug:slug,
            payload:{nom:horseNames[slug],hippodrome:evt.hippodrome,date:day,
              heure:evt.heure,detail:matches.length===0
                ?"Course ou numéro non vérifié sur PMU"
                :"Correspondance multiple sur PMU"},
            expires_at:iso(departure)});
        }
        console.warn("[AVANT-COURSE] À vérifier "+slug+" "+day+" "
          +(matches.length===0?"absent":"ambigu"));
        continue;
      }
      const match=matches[0];
      if(match.start!==null && Math.abs(match.start-departure)>5*60000){
        console.warn("[AVANT-COURSE] Heure différente "+slug+" "+evt.heure);
        continue;
      }
      confirmed++;
      if(match.code===expectedCode && match.bib===expectedBib)continue;
      const override=overrides.find((x:any)=>x.cheval_slug===slug);
      if(override && Array.isArray(override.engagements)){
        // Ne modifier que le partant précis et conserver tous les autres
        // champs ou participations saisis par le contributeur.
        const updated=override.engagements.map((e:any,i:number)=>{
          if(i!==index || e.date!==evt.date || e.heure!==evt.heure ||
              pmuText(e.hippodrome)!==pmuText(evt.hippodrome))return e;
          return {...e,course:match.code,numero:match.bib};
        });
        const {error}=await sb.from("ei_contributions_engagements")
          .update({engagements:updated}).eq("cheval_slug",slug);
        if(error)throw error;
        override.engagements=updated;
        editorial.engagements[slug]=updated;
        console.log("[AVANT-COURSE] CORRIGÉ Supabase "+slug+" "+
          (expectedCode||"-")+" n°"+(expectedBib||"-")+" -> "+
          match.code+" n°"+match.bib);
      }else{
        // Le fichier GitHub sera corrigé par le précontrôle horaire.
        // Dans ce cycle, l'alerte officielle peut déjà utiliser le bon code.
        evt.course=match.code;
        evt.numero=match.bib;
        console.log("[AVANT-COURSE] Correspondance mémoire "+slug+" "+
          match.code+" n°"+match.bib);
      }
    }catch(err){
      console.warn("[AVANT-COURSE] Source provisoirement indisponible "+
        slug+" "+(err instanceof Error?err.name:"erreur PMU"));
    }
  }
  return confirmed;
}

async function run() {
  const now=Date.now(), clock=parisNow(new Date(now)), nextHour=now+3600_000;
  const prelaunch = now < PILOT_LAUNCH_AT;
  const [ed,horses]=await Promise.all([getJSON(editorialUrl),getJSON(horsesUrl)]);
  const horseNames:Record<string,string>={};
  const src=horses.horses||horses;
  if(Array.isArray(src))for(const h of src){const slug=h.slug||h.id; if(slug)horseNames[slug]=h.name||h.nom||slug}
  else if(src&&typeof src==="object")for(const [slug,h] of Object.entries(src)){
    if(h&&typeof h==="object")horseNames[slug]=(h as any).name||(h as any).nom||slug;
  }
  // Les publications directes des contributeurs priment sur le relevé GitHub.
  // Un remplacement par [] retire les engagements de ce cheval du flux Push.
  const {data:overrides,error:overridesError}=await sb
    .from("ei_contributions_engagements").select("cheval_slug,engagements");
  if(overridesError)throw overridesError;
  ed.engagements=ed.engagements||{};
  for(const row of overrides||[]){
    if(Object.prototype.hasOwnProperty.call(horseNames,row.cheval_slug)&&Array.isArray(row.engagements))
      ed.engagements[row.cheval_slug]=row.engagements;
  }
  // Vérifier les inscriptions PMU avant l'heure du départ et corriger
  // leurs codes dans la source Supabase seulement après identité unique.
  await pmuPreflight(ed,horseNames,(overrides||[]) as Record<string,any>[],now);
  const counts={races:0,alerts:0,attempts:0,sent:0};
  const {count, error:countError}=await sb.from("ei_push_races").select("*",{head:true,count:"exact"});
  if(countError)throw countError;
  const bootstrap=(count||0)===0;
  const races:Race[]=[];
  for (const [slug,events] of Object.entries(ed.engagements||{})) {
    if (!Array.isArray(events)) continue;
    for (const evt of events) {
      const e=evt as Event;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date||""))continue;
      if(e.date<clock.date && Date.parse(e.date+"T23:59:00Z")<now-24*3600_000)continue;
      const row:Race={
        event_key:key(slug,e),cheval_slug:slug,cheval_nom:horseNames[slug]||slug.replace(/-/g," ").toUpperCase(),
        date_course:e.date,hippodrome:esc(e.hippodrome)||"Hippodrome à confirmer",
        course:esc(e.course||e.prix)||null,statut:esc(e.statut).toLowerCase()||"engage",
        depart:parisDeparture(e.date,e.heure)
      };
      races.push(row);
      const {data:old,error}=await sb.from("ei_push_races").select("statut,depart").eq("event_key",row.event_key).maybeSingle();
      if(error)throw error;
      const {error:saveError}=await sb.from("ei_push_races").upsert(row,{onConflict:"event_key"});
      if(saveError)throw saveError;
      counts.races++;
      if(!bootstrap&&(!old||old.statut!==row.statut)){
        const detail={nom:row.cheval_nom,hippodrome:row.hippodrome,date:row.date_course,heure:e.heure||"",course:row.course};
        if(CONFIRMED.has(row.statut)&&!CONFIRMED.has(old?.statut||"") && row.date_course>=clock.date) {
          await saveAlert({id:"confirmed:"+row.event_key,categorie:"confirmed",cheval_slug:slug,payload:detail,expires_at:iso(now+6*3600_000)});counts.alerts++;
        }
        // Seul le NON-PARTANT peut générer une notification de retrait.
        // Il faut une déclaration antérieure : "declare" ou "partant".
        // Les statuts "forfait" et "elimine" n'envoient AUCUNE notification.
        if(old && row.date_course>=clock.date &&
           CONFIRMED.has(old.statut) && NON_PARTANT.has(row.statut)){
          await saveAlert({
            id:"withdrawn:"+row.statut+":"+row.event_key,categorie:"withdrawn",
            cheval_slug:slug,
            payload:{...detail,statut:row.statut,event_key:row.event_key},
            expires_at:iso(now+6*3600_000)
          });
          counts.alerts++;
        }
      }
      if(CONFIRMED.has(row.statut)&&row.depart){
        const diff=(Date.parse(row.depart)-now)/60000;
        if(diff>=0&&diff<=15){
          await saveAlert({id:"before15:"+row.event_key,categorie:"before15",cheval_slug:slug,payload:{nom:row.cheval_nom,hippodrome:row.hippodrome,heure:e.heure,diff:Math.ceil(diff)},expires_at:row.depart});counts.alerts++;
        }
      }
    }
  }
  // Le push ne dépend plus exclusivement des déclenchements GitHub Actions.
  // Ce contrôle ne modifie pas editorial.json et n'envoie que des classements
  // dont le PMU a confirmé l'arrivée définitive et l'identité du cheval.
  counts.alerts += await pmuOfficialAlerts(ed,horseNames,now);
  // Résultats : déclencher uniquement après vérification explicite et dans les 48 h.
  for(const [slug,rows] of Object.entries(ed.performances||{})){
    if(!Array.isArray(rows))continue;
    for(const perf of rows){
      const p=perf as Record<string,unknown>;
      const official=p.officiel===true||p.statut==="officiel";
      const pilotValidated=prelaunch && p.valide_ecurie===true && p.notif_testeurs===true;
      if(!official && !pilotValidated)continue;
      const date=esc(p.date);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Date.parse(date+"T00:00:00Z")<now-48*3600_000)continue;
      const pKey=[slug,date,esc(p.hippodrome).toLowerCase()].join("|");
      await saveAlert({id:"results:"+pKey,categorie:"results",cheval_slug:slug,payload:{
        nom:horseNames[slug]||slug.replace(/-/g," ").toUpperCase(),
        hippodrome:esc(p.hippodrome),rang:esc(p.rang||p.classement||"Résultat disponible"),date,
        official,pilotTest:pilotValidated
      },expires_at:iso(now+36*3600_000)});counts.alerts++;
    }
  }
  // Une seule synthèse de 10 h par appareil, seulement s'il existe des partants.
  if(clock.hour===10&&clock.minute<=12){
    const todays=races.filter(x=>x.date_course===clock.date&&CONFIRMED.has(x.statut));
    if(todays.length){
      await saveAlert({id:"daily:"+clock.date,categorie:"daily",cheval_slug:null,
        payload:{date:clock.date,partants:todays.map(x=>({slug:x.cheval_slug,nom:x.cheval_nom,hippodrome:x.hippodrome,heure:x.depart?new Intl.DateTimeFormat("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Europe/Paris"}).format(new Date(x.depart)):""}))},
        expires_at:iso(now+60*60000)});counts.alerts++;
    }
  }
  // Livraison : ne jamais envoyer à un appareil nouvellement abonné une vieille alerte.
  const {data:alerts,error:alertsErr}=await sb.from("ei_push_alerts").select("*")
    .gt("expires_at",iso(now)).order("created_at",{ascending:true}).limit(100);
  if(alertsErr)throw alertsErr;
  const {data:subs,error:subsErr}=await sb.from("ei_push_subscriptions").select("*").limit(1000);
  if(subsErr)throw subsErr;
  const userIds=[...new Set((subs||[]).map(s=>s.user_id).filter(Boolean))];
  const active=new Set<string>();
  const admins=new Set<string>();
  const holdings=new Map<string,Set<string>>();
  if(userIds.length){
    const {data:members,error:memErr}=await sb.from("associes")
      .select("user_id,nom_affiche,administrateur").eq("actif",true).in("user_id",userIds);
    if(memErr)throw memErr;
    const launchOpen=!prelaunch;
    const pilots=new Set<string>();
    if(!launchOpen){
      const {data:rows,error:pilotError}=await sb.from("ei_lancement_pilotes")
        .select("user_id").in("user_id",userIds);
      if(!pilotError){for(const x of rows||[])pilots.add(x.user_id)}
      else if(pilotError.code==="42P01"||pilotError.code==="PGRST205"){
        // Transition avant activation des règles SQL : seuls les comptes pilotes connus.
        const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .toLowerCase().trim().replace(/\s+/g," ");
        for(const m of members||[]){
          if(m.administrateur||["adrien delgery","eric schott","nicolas barre"].includes(norm(m.nom_affiche||"")))
            pilots.add(m.user_id);
        }
      }else throw pilotError;
    }
    for(const m of members||[]){
      if(launchOpen||pilots.has(m.user_id))active.add(m.user_id);
      if(m.administrateur===true)admins.add(m.user_id);
    }
    const {data:parts,error:partsErr}=await sb.from("participations_chevaux").select("user_id,cheval_slug").in("user_id",userIds).limit(10000);
    if(partsErr)throw partsErr;
    for(const p of parts||[]){if(!holdings.has(p.user_id))holdings.set(p.user_id,new Set());holdings.get(p.user_id)!.add(p.cheval_slug)}
  }
  const vapid={publicKey:env("PUSH_VAPID_PUBLIC_KEY"),privateKey:env("PUSH_VAPID_PRIVATE_KEY"),subject:"mailto:contact@ecurie-initial.com"};
  if(!vapid.publicKey||!vapid.privateKey)throw Error("VAPID absent");
  const currentRaceStates=new Map(races.map(x=>[x.event_key,x.statut]));
  for(const alert of alerts||[]){
    // Un forfait annule les rappels et confirmations encore dans la file d'envoi.
    if(alert.categorie==="confirmed"||alert.categorie==="before15"){
      const raceKey=alert.id.slice(alert.categorie.length+1);
      if(!CONFIRMED.has(currentRaceStates.get(raceKey)||""))continue;
    }
    if(alert.categorie==="withdrawn"){
      // Écarte les anciennes notifications incorrectes sans historique de statut
      // et les alertes devenues obsolètes après une nouvelle modification.
      const alertKey=String(alert.payload?.event_key||"");
      const expectedStatus=String(alert.payload?.statut||"");
      if(!alertKey||!NON_PARTANT.has(expectedStatus)||
         currentRaceStates.get(alertKey)!==expectedStatus)continue;
    }
    for(const sub of subs||[]){
      if(Date.parse(sub.created_at)>Date.parse(alert.created_at))continue;
      const member=sub.audience==="associate" && !!sub.user_id && active.has(sub.user_id);
      if(sub.audience==="associate"&&!member)continue;
      // Jusqu’au 1er décembre, aucune alerte n’est adressée aux visiteurs ou aux non-testeurs.
      if(prelaunch&&!member)continue;
      // Anomalies avant course : exclusivement l'administrateur,
      // jamais les associés ordinaires ou les visiteurs.
      const adminWarning=alert.categorie==="preflight_warning";
      if(adminWarning){
        if(!member || !admins.has(sub.user_id) || sub.results!==true)continue;
      }else if(alert.categorie==="general_news" ? sub.general_news!==true : !sub[alert.categorie])continue;
      const owned=member ? holdings.get(sub.user_id)||new Set<string>() : new Set<string>();
      if(adminWarning){
        // Une alerte technique d'administration ne dépend pas de la
        // propriété du cheval ni du filtre « mes chevaux ».
      }else if(alert.categorie==="general_news"){
        // Message privé destiné à tous les associés actifs, sans filtre cheval.
        if(!member)continue;
      }else if(alert.categorie==="private_news"){
        // Priorité absolue à la copropriété : aucune exception liée au choix "tous".
        // Ni visiteurs, ni associés d'un autre cheval ne doivent recevoir l'alerte.
        if(!member || !alert.cheval_slug || !owned.has(alert.cheval_slug))continue;
      }else{
        const pilotResult=prelaunch && alert.categorie==="results" && alert.payload?.pilotTest===true;
        if(alert.cheval_slug && member && sub.scope==="mine" && !owned.has(alert.cheval_slug) && !pilotResult)continue;
        if(alert.cheval_slug && !member && !["results"].includes(alert.categorie))continue;
      }
      let message:{title:string,body:string,url:string}|null=null;
      const p=alert.payload||{};
      if(alert.categorie==="preflight_warning"){
        message={title:"⚠️ Partant à vérifier · "+esc(p.nom),
          body:esc(p.detail)+" : "+esc(p.hippodrome)+" à "+esc(p.heure),
          url:APP+"/application/administration/"};
      }else if(alert.categorie==="daily"){
        const ps=(Array.isArray(p.partants)?p.partants:[]) as {slug:string;nom:string;hippodrome:string;heure:string}[];
        const chosen=member&&sub.scope==="mine"?ps.filter(x=>owned.has(x.slug)):ps;
        if(!chosen.length)continue;
        message={title:chosen.length===1?"🐎 Partant du jour · Écurie Initial":"🐎 Partants du jour · Écurie Initial",
          body:resumePartants(chosen),
          url:APP+"/engagements/"};
      }else if(alert.categorie==="confirmed"){
        message={title:"🐎 Prochain partant",
          body:annonceCourse(p.nom,p.hippodrome,p.heure,jourCourse(p.date,clock.date)),
          url:APP+"/chevaux/"+alert.cheval_slug+"/"};
      }else if(alert.categorie==="withdrawn"){
        const status=String(p.statut||"");
        const venue=esc(p.hippodrome);
        if(NON_PARTANT.has(status)){
          message={title:"🚫 Non-partant · "+esc(p.nom),
            body:esc(p.nom)+" ne prendra finalement pas le départ à "+venue+".",
            url:APP+"/engagements/"};
        }
      }else if(alert.categorie==="before15"){
        message={title:"⏰ Départ imminent · "+esc(p.nom),body:esc(p.hippodrome)+" · environ "+esc(p.diff)+" min avant le départ.",url:APP+"/engagements/"};
      }else if(alert.categorie==="results"){
        message={title:(p.official===true?"🏆 Résultat officiel · ":"🏆 Résultat de l’écurie · ")+esc(p.nom),body:esc(p.rang)+" à "+esc(p.hippodrome),url:APP+"/chevaux/"+alert.cheval_slug+"/"};
      }else if(alert.categorie==="general_news"){
        message={
          title:"📣 Nouveau message · Écurie Initial",
          body:"Un message de l’écurie est disponible dans votre espace associé.",
          url:APP+"/application/mes-chevaux/?general="+encodeURIComponent(esc(p.id))+"#nouvelles-privees"
        };
      }else if(alert.categorie==="private_news"){
        message={
          title:"🔒 Nouvelle information · "+esc(p.nom),
          body:"Une publication privée concernant ce cheval est disponible dans votre espace associé.",
          url:APP+"/application/mes-chevaux/?info="+encodeURIComponent(esc(p.id))+"#nouvelles-privees"
        };
      }
      if(!message)continue;
      const {data:prev,error:prevErr}=await sb.from("ei_push_deliveries")
        .select("state,attempts,updated_at").eq("alert_id",alert.id).eq("subscription_id",sub.id).maybeSingle();
      if(prevErr)throw prevErr;
      if(prev && (prev.state!=="failed"||prev.attempts>=3||Date.parse(prev.updated_at)>now-180000))continue;
      if(prev){
        const {error:e}=await sb.from("ei_push_deliveries").update({state:"sending",attempts:prev.attempts+1,updated_at:iso(now)})
          .eq("alert_id",alert.id).eq("subscription_id",sub.id).eq("state","failed");
        if(e)throw e;
      }else{
        const {error:e}=await sb.from("ei_push_deliveries").insert({alert_id:alert.id,subscription_id:sub.id,state:"sending"});
        if(e){if(e.code==="23505")continue;throw e}
      }
      counts.attempts++;
      try{
        // Les rappels imminents exigent une livraison prioritaire sur les appareils en veille.
        // Une durée de rétention limitée évite les rappels périmés bien après le départ.
        const pushOptions=alert.categorie==="before15"?{urgency:"high" as const,ttl:900}:
          ["private_news","general_news"].includes(alert.categorie)?{urgency:"high" as const}:{};
        const delivered=await sendPushNotification(
          {endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},
          message,vapid,pushOptions
        );
        if(!delivered){
          await sb.from("ei_push_subscriptions").delete().eq("id",sub.id);
        }else counts.sent++;
        await sb.from("ei_push_deliveries").update({state:delivered?"sent":"gone",updated_at:iso(Date.now())}).eq("alert_id",alert.id).eq("subscription_id",sub.id);
      }catch(e){
        const err=e instanceof Error?e.message:"Erreur Web Push";
        console.error("Push failed",sub.id,err);
        await sb.from("ei_push_deliveries").update({state:"failed",updated_at:iso(Date.now())}).eq("alert_id",alert.id).eq("subscription_id",sub.id);
        await sb.from("ei_push_subscriptions").update({last_error:err.slice(0,500)}).eq("id",sub.id);
      }
    }
  }
  return counts;
}
// Vérification du secret de pg_cron, conservé chiffré dans Supabase Vault.
// Seule son empreinte SHA-256 est conservée dans le code (secret aléatoire 256 bits).
// En cas de rotation du secret Vault, actualiser son empreinte avant de relancer le cron.
const JOB_SECRET_HASH = "b8f2b6f0fb720da44ff95398f5feeef97cc56bfb4b5b29474c2b202a802845cc";
async function authorizedCron(req: Request): Promise<boolean> {
  if(req.method!=="POST")return false;
  const token = req.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if(!token)return false;
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)));
  let mismatch=0;
  for(let i=0;i<digest.length;i++)mismatch|=digest[i]^parseInt(JOB_SECRET_HASH.slice(2*i,2*i+2),16);
  return mismatch===0;
}
Deno.serve(async req=>{
  if(!(await authorizedCron(req)))
    return Response.json({error:"Non autorisé"},{status:401});
  try{return Response.json({ok:true,...await run()})}
  catch(e){console.error("Push dispatch error",e);return Response.json({error:"Traitement impossible"},{status:500})}
});
