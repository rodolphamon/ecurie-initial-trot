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
const editorialUrl = APP + "/chevaux/data/editorial.json";
const horsesUrl = APP + "/chevaux/data/chevaux.json";
const WITHDRAWN = new Set(["non-partant", "forfait", "elimine", "np"]);
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
        if(WITHDRAWN.has(row.statut)&&!WITHDRAWN.has(old?.statut||"")) {
          await saveAlert({id:"withdrawn:"+row.event_key,categorie:"withdrawn",cheval_slug:slug,payload:detail,expires_at:iso(now+6*3600_000)});counts.alerts++;
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
    for(const m of members||[])if(launchOpen||pilots.has(m.user_id))active.add(m.user_id);
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
    for(const sub of subs||[]){
      if(Date.parse(sub.created_at)>Date.parse(alert.created_at))continue;
      const member=sub.audience==="associate" && !!sub.user_id && active.has(sub.user_id);
      if(sub.audience==="associate"&&!member)continue;
      // Jusqu’au 1er décembre, aucune alerte n’est adressée aux visiteurs ou aux non-testeurs.
      if(prelaunch&&!member)continue;
      if(!sub[alert.categorie])continue;
      const owned=member ? holdings.get(sub.user_id)||new Set<string>() : new Set<string>();
      if(alert.categorie==="private_news"){
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
      if(alert.categorie==="daily"){
        const ps=(Array.isArray(p.partants)?p.partants:[]) as {slug:string;nom:string;heure:string}[];
        const chosen=member&&sub.scope==="mine"?ps.filter(x=>owned.has(x.slug)):ps;
        if(!chosen.length)continue;
        message={title:"🐎 Partants du jour · Écurie Initial",
          body:chosen.map(x=>x.nom+(x.heure?" "+x.heure:"")).join(" · ").slice(0,190),
          url:APP+"/engagements/"};
      }else if(alert.categorie==="confirmed"){
        message={title:"✅ Partant confirmé · "+esc(p.nom),body:esc(p.hippodrome)+" · "+esc(p.date)+(p.heure?" à "+esc(p.heure):""),url:APP+"/chevaux/"+alert.cheval_slug+"/"};
      }else if(alert.categorie==="withdrawn"){
        message={title:"🚫 Non-partant · "+esc(p.nom),body:"Le départ prévu à "+esc(p.hippodrome)+" est annulé.",url:APP+"/engagements/"};
      }else if(alert.categorie==="before15"){
        message={title:"⏰ Départ imminent · "+esc(p.nom),body:esc(p.hippodrome)+" · environ "+esc(p.diff)+" min avant le départ.",url:APP+"/engagements/"};
      }else if(alert.categorie==="results"){
        message={title:(p.official===true?"🏆 Résultat officiel · ":"🏆 Résultat de l’écurie · ")+esc(p.nom),body:esc(p.rang)+" à "+esc(p.hippodrome),url:APP+"/chevaux/"+alert.cheval_slug+"/"};
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
        const delivered=await sendPushNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},message,vapid);
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
