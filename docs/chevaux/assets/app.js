(function(){
'use strict';
const $=sel=>document.querySelector(sel),formatEuro=new Intl.NumberFormat('fr-FR'),base=['fiche','resultats'].includes(document.body.dataset.page)?'../':'./';
const esc=v=>String(v===undefined||v===null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const absoluteUrl=u=>{try{let v=new URL(u);return v.protocol==='https:'?v.href:''}catch{return ''}};
const dateFR=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return s||'';let [y,m,d]=s.split('-');return d+'/'+m+'/'+y};
const money=n=>Number.isFinite(n)?formatEuro.format(n)+' €':'—';
const formatValue=n=>Number.isFinite(n)?String(n).replace('.',','):'—';
const currentParis=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
// En courses françaises, l'âge hippique avance le 1er janvier, sans attendre la date anniversaire.
const horseAge=p=>{const born=Number(p.birth_year),now=Number(currentParis().slice(0,4));return Number.isInteger(born)&&born>=1990&&born<=now?now-born:null};
// Affichage du classement : chiffres 1 à 9, puis 0 au-delà ; codes hippiques conservés.
const displayRank=v=>{const raw=String(v||'').trim(),clean=normalizeSearch(raw),m=raw.match(/^(\d+)\s*(?:er|re|e|eme|ème)?$/i);if(m)return Number(m[1])>9?'0':String(Number(m[1]));if(/^(?:np|nc|non placee?|non classee?)$/.test(clean))return '0';if(/^(?:dai|disqualifiee?)$/.test(clean))return 'DAI';if(/^(?:arr|arretee?)$/.test(clean))return 'ARR';if(/^(?:t|tombee?)$/.test(clean))return 'T';return raw;};
const horseSex=p=>['F','H','M'].includes(p.sex)?p.sex:null;
// Statuts des engagements : toujours afficher le statut enregistré, sans l'inférer.
function engagementStatus(entry,sex){
  const raw=normalizeSearch(entry?.statut||entry?.status||'').replace(/\s+/g,'');
  const kind=({engage:'engage',engagee:'engage',declare:'declare',declaree:'declare',partant:'partant',partante:'partant',forfait:'forfait'})[raw];
  if(!kind)return null;
  const feminine=sex==='F';
  const label=kind==='forfait'?'Forfait':kind==='engage'?(feminine?'Engagée':'Engagé'):kind==='declare'?(feminine?'Déclarée':'Déclaré'):(feminine?'Partante':'Partant');
  return {kind,label};
}
const sexNames={F:'Femelle',H:'Hongre',M:'Mâle'};
const silkName=p=>p.casaque==='galop'?'casaque-galop.svg':p.casaque==='orange'?'casaque-orange.svg':'casaque-blanche.svg';
const silk=p=>base+'../assets/'+silkName(p);
function photoMarkup(p,style){let img=p.photoUrl||base+'photos/'+p.id+'.jpg?v='+encodeURIComponent(p.photoVersion||'1');return '<div class="'+(style==='hero'?'hero-photo':'horse-card-photo')+'">'+(style==='card'?'<span class="kind">'+esc(p.discipline)+'</span>':'')+'<img class="photo" src="'+img+'" alt="Photo de '+esc(p.name)+'" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false;this.parentNode.classList.add(\'no-photo\')" /><img class="silk" hidden src="'+silk(p)+'" alt="Casaque de l’Écurie Initial"/>'+(style==='hero'?'<span class="placeholder-tag" hidden>Photographie à venir</span>':'')+'</div>'}

// Une copie GitHub encore en cache ne doit pas effacer les montes déjà vérifiées.
function mergeArrivalDetails(previous,incoming){
  if(!previous||previous.officiel!==true||incoming.officiel===false
    ||previous.date!==incoming.date
    ||normalizeSearch(previous.hippodrome)!==normalizeSearch(incoming.hippodrome)
    ||displayRank(previous.rang)!==displayRank(incoming.rang)
    ||previous.course&&incoming.course&&previous.course.toUpperCase()!==incoming.course.toUpperCase()
    ||previous.numero&&incoming.numero&&Number(previous.numero)!==Number(incoming.numero)
    ||!Array.isArray(previous.arrivee))return incoming;
  const key=row=>JSON.stringify([row.rang,row.numero,normalizeSearch(row.cheval)]);
  const known=new Map(previous.arrivee.map(row=>[key(row),row]));
  return {...previous,...incoming,arrivee:Array.isArray(incoming.arrivee)&&incoming.arrivee.length
    ?incoming.arrivee.map(row=>({...known.get(key(row)),...row})):previous.arrivee};
}

// Résultats officiels déjà enregistrés par le moteur push, sans attendre GitHub Pages.
async function freshPerformances(editor){
  const merged={...(editor.performances||{})};
  try{
    const response=await fetch('https://raw.githubusercontent.com/rodolphamon/ecurie-initial-trot/main/docs/chevaux/data/editorial.json?v='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(4500)});
    if(response.ok){
      const data=await response.json();
      for(const [slug,rows] of Object.entries(data.performances||{})){
        if(!Array.isArray(rows))continue;
        const previous=merged[slug]||[];
        merged[slug]=rows.map(row=>mergeArrivalDetails(previous.find(p=>p.date===row.date
          &&normalizeSearch(p.hippodrome)===normalizeSearch(row.hippodrome)),row));
        for(const row of previous)if(!merged[slug].some(p=>p.date===row.date
          &&normalizeSearch(p.hippodrome)===normalizeSearch(row.hippodrome)))merged[slug].push(row);
      }
    }
  }catch(e){console.info('Source GitHub directe indisponible',e)}
  try{
    const response=await fetch('https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/public-race-results',{cache:'no-store',signal:AbortSignal.timeout(4500)});
    if(!response.ok)throw Error('Résultats directs indisponibles');
    const data=await response.json();
    for(const [slug,rows] of Object.entries(data.performances||{})){
      if(!Array.isArray(rows))continue;
      const list=[...(merged[slug]||[])];
      for(const row of rows){
        const index=list.findIndex(p=>p.date===row.date&&normalizeSearch(p.hippodrome)===normalizeSearch(row.hippodrome));
        if(index<0)list.push(row);
        else if(list[index].officiel!==true&&list[index].statut!=='officiel')list[index]={...list[index],...row};
        else list[index]=mergeArrivalDetails(row,list[index]);
      }
      merged[slug]=list.sort((a,b)=>b.date.localeCompare(a.date));
    }
  }catch(e){console.info('Résultats directs indisponibles, historique conservé',e)}
  return merged;
}
async function loadCourseFields(){
  const local=base+'data/partants-courses.json';
  const remote='https://raw.githubusercontent.com/rodolphamon/ecurie-initial-trot/main/docs/chevaux/data/partants-courses.json';
  for(const url of [remote,local]){
    try{
      const response=await fetch(url+'?v='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(4500)});
      if(response.ok){const data=await response.json();if(Array.isArray(data.courses))return data.courses;}
    }catch(error){console.info('Liste des partants temporairement indisponible',error);}
  }
  return [];
}
function loadCourseFieldAssets(){
  if(window.EICourseField)return Promise.resolve();
  const css=document.createElement('link');
  css.rel='stylesheet';css.href=base+'assets/course-field.css?v=20261126partants2';document.head.appendChild(css);
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src=base+'assets/course-field.js?v=20261127partants3';
    script.onload=resolve;script.onerror=reject;document.head.appendChild(script);
  });
}
async function load(){let paths=[base+'data/chevaux.json',base+'data/editorial.json',base+'../data/effectif-trot.json',base+'../data/effectif-galop.json'];let requests=await Promise.all(paths.map(async p=>{let r=await fetch(p+(p.endsWith('/data/editorial.json')?'?v='+Date.now():''),{cache:'no-store'});if(!r.ok)throw Error('Impossible de charger '+p);return r.json()}));let [all,editor,trot,galop]=requests;editor.performances=await freshPerformances(editor);
if(document.body.dataset.page==='fiche'){
  editor.courseFields=await loadCourseFields();
  try{await loadCourseFieldAssets();}catch(error){console.warn('Affichage de la liste des partants indisponible',error);}
}
try{const q=await fetch(base+'data/qualifications.json',{cache:'no-store'});if(q.ok){let videos=await q.json();editor.qualifications={...(editor.qualifications||{}),...(videos.qualifications||{})};}}catch(e){console.warn('Vidéos de qualification temporairement indisponibles',e)}let gallop=new Map((galop.horses||[]).map(h=>{
  if(/obstacle/i.test(h.discipline||'')){
    return [h.id,{...h,value_historique_non_ventilee:h.value??null,value_plat:h.value_plat??null,value_obstacle:h.value_obstacle??null}];
  }
  return [h.id,h];
}));const replayIndex=Object.create(null);
try{
 const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
 const client=createClient('https://yeecwaaizmvrhwobukfa.supabase.co','sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3');
 const [en,ga,va,re,st,ef,ph]=await Promise.all([
   client.from('ei_contributions_engagements').select('cheval_slug,engagements'),
   client.from('ei_contributions_gains').select('cheval_slug,gains'),
   client.from('ei_contributions_valeurs').select('cheval_slug,discipline_valeur,valeur'),
   client.from('ei_contributions_records').select('cheval_slug,chrono'),
   client.from('ei_statuts_chevaux').select('cheval_slug,au_repos'),
   client.from('ei_effectif_gestion').select('cheval_slug,nom,discipline,casaque,entraineur,lien_officiel,nouveau,actif,date_sortie,annee_naissance,sexe,pere,mere,pere_de_mere'),
   client.from('ei_photos_chevaux').select('cheval_slug,photo_url')
 ]);
 if(en.error||ga.error||va.error||re.error||st.error||ef.error||ph.error)throw Error('Source des contributions indisponible');
 const valid=new Set((all.horses||[]).map(h=>h.id));
 const restStatuses=Object.fromEntries((st.data||[]).filter(row=>valid.has(row.cheval_slug)).map(row=>[row.cheval_slug,row.au_repos]));
 for(const p of all.horses||[])if(Object.hasOwn(restStatuses,p.id)){p.status=restStatuses[p.id]?'au repos':'';if(gallop.has(p.id))gallop.set(p.id,{...gallop.get(p.id),status:p.status});}
 editor.engagements=editor.engagements||{};
 for(const row of en.data||[])if(valid.has(row.cheval_slug)&&Array.isArray(row.engagements))
   editor.engagements[row.cheval_slug]=row.engagements;
 for(const row of ga.data||[]){
   if(!valid.has(row.cheval_slug)||!Number.isSafeInteger(Number(row.gains)))continue;
   if(gallop.has(row.cheval_slug))gallop.set(row.cheval_slug,{...gallop.get(row.cheval_slug),gains:Number(row.gains)});
   else if(trot.horses?.[row.cheval_slug])trot.horses[row.cheval_slug].gains=Number(row.gains);
 }
 for(const row of va.data||[]){
   const n=Number(row.valeur);
   if(!valid.has(row.cheval_slug)||!gallop.has(row.cheval_slug)||!Number.isFinite(n))continue;
   const h=gallop.get(row.cheval_slug);
   if(/obstacle/i.test(h.discipline||'')){
     if(row.discipline_valeur==='plat')gallop.set(row.cheval_slug,{...h,value_plat:n,value_historique_non_ventilee:null});
     if(row.discipline_valeur==='obstacle')gallop.set(row.cheval_slug,{...h,value_obstacle:n,value_historique_non_ventilee:null});
   }else if(row.discipline_valeur==='plat'){
     gallop.set(row.cheval_slug,{...h,value:n});
   }
 }
 // Changements d'effectif : la base historique conserve les chevaux vendus.
 // Les achats récents sont des profils dynamiques, et les entraîneurs sont actualisés ici.
 const known=new Map((all.horses||[]).map(h=>[h.id,h]));
 for(const row of ef.data||[]){
   const old=known.get(row.cheval_slug);
   const update={
     id:row.cheval_slug,name:row.nom,discipline:row.discipline,
     trainer:row.entraineur,casaque:row.casaque,
     horseLink:row.lien_officiel||old?.horseLink||null,
     active:row.actif, newHorse:row.nouveau,dateSortie:row.date_sortie,
     birth_year:row.annee_naissance??old?.birth_year??null,
     sex:row.sexe||old?.sex||gallop.get(row.cheval_slug)?.sex||null,
     origines:(row.pere||row.mere||row.pere_de_mere||old?.origines)?{
       pere:row.pere??old?.origines?.pere??'',mere:row.mere??old?.origines?.mere??'',
       pere_de_mere:row.pere_de_mere??old?.origines?.pere_de_mere??''}:null
   };
   const current={...old,...update};
   known.set(row.cheval_slug,current);
   valid.add(row.cheval_slug);
   if(row.casaque==='galop'){
     const previous=gallop.get(row.cheval_slug)||{};
     gallop.set(row.cheval_slug,{...previous,trainer:row.entraineur,discipline:row.discipline,birth_year:current.birth_year,origines:current.origines});
   }else if(!trot.horses?.[row.cheval_slug]){
     trot.horses=trot.horses||{};
     trot.horses[row.cheval_slug]={};
   }
   if(!row.actif)editor.engagements[row.cheval_slug]=[];
 }
 for(const row of ph.data||[]){
   const p=known.get(row.cheval_slug);if(p)known.set(row.cheval_slug,{...p,photoUrl:row.photo_url});
 }
 all.horses=[...known.values()];
 for(const row of re.data||[]){
   if(!valid.has(row.cheval_slug)||!trot.horses?.[row.cheval_slug]||!/^\d{1,2}'[0-5]\d"\d$/.test(row.chrono||''))continue;
   trot.horses[row.cheval_slug].record=row.chrono;
 }
}catch(error){console.warn('Contributions en direct indisponibles, affichage des données de référence',error)}
try{let response=await fetch(base+'../palmares/replays.json',{cache:'no-store'});if(response.ok){let data=await response.json();for(const replay of data.replays||[]){let url=absoluteUrl(replay.url);
let sourceLetrot=absoluteUrl(replay.lien_replay_original);
let resultatLetrot=absoluteUrl(replay.lien_letrot_precedent);
if(url&&replay.date&&replay.cheval){
  const direct=/\/video\//i.test(url)&&/dailymotion\.com|youtube\.com/i.test(url);
  const replayLetrot=/letrot\.com\/.*replay-courses\//i.test(sourceLetrot||url);
  const ficheLetrot=/letrot\.com\/courses\/\d{4}-\d\d-\d\d\//i.test(resultatLetrot||'');
  replayIndex[replay.date+'|'+normalizeSearch(replay.cheval)]={
    url:direct?url:replayLetrot?(sourceLetrot||url):ficheLetrot?resultatLetrot:url,
    kind:direct?'video':replayLetrot?'letrot':ficheLetrot?'letrot_result':replay.verification_replay_2026_11_16?.statut==='page_course_avec_rubrique_replay'?'replay_page':/equidia\.fr/i.test(url)?'equidia':'course'
  };
}}}}catch(error){console.warn('Liens vidéo temporairement indisponibles',error)}return {profiles:all.horses.map(p=>({...p,...(gallop.get(p.id)||{}),trainer:p.trainer,sex:p.sex||gallop.get(p.id)?.sex||null,active:p.active,newHorse:p.newHorse,dateSortie:p.dateSortie})),editor,trot:trot.horses||{},gallop,replayIndex,updates:{trot:trot.updated_at,galop:galop.updated_at}}}
const installedApp = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if(installedApp) document.documentElement.classList.add('ei-app-installed');
function header(){return '<header class="top"><div class="shell top-inner"><a class="wordmark" href="'+base+'index.html"><img class="wordmark-logo" src="'+base+'assets/embleme-ei.png?v=20261112h" alt="Écurie Initial" width="46" height="46"><span class="wordmark-copy"><span class="wordmark-title">ÉCURIE <span class="wordmark-initial"><span class="wordmark-initial-i">'+(installedApp?'ı':'I')+'</span>NITIAL</span></span><small>PARTAGEONS NOTRE PASSION DEPUIS 2011</small></span></a>'+(installedApp?'<span class="wordmark-slogan"><span class="wordmark-slogan-line">PARTAGEONS NOTRE PASSION</span><span class="wordmark-slogan-date">DEPUIS 2011</span></span>':'<nav class="top-nav"><a href="'+base+'index.html">Nos chevaux</a><a href="'+base+'entraineurs.html">Nos entraîneurs</a><a href="https://www.ecurie-initial.com/nos-chevaux/trotteurs/" target="_blank" rel="noopener noreferrer">Trot</a><a href="https://www.ecurie-initial.com/nos-chevaux/galopeurs/" target="_blank" rel="noopener noreferrer">Galop</a><a href="https://www.ecurie-initial.com/" target="_blank" rel="noopener noreferrer">Site officiel</a></nav>')+'</div></header>'}
function footer(){return '<footer class="footer"><div class="shell">© Écurie Initial · Des chevaux, des associés, une passion commune.</div></footer>'}
function metric(p,data){
 if(p.casaque!=='galop')return data.record||'—';
 if(/obstacle/i.test(p.discipline||''))return 'Plat '+formatValue(data.value_plat)+' / Obstacle '+formatValue(data.value_obstacle);
 return formatValue(data.value);
}
function currentData(p,s){return p.casaque==='galop'?p:(s.trot[p.id]||{})}

/* Recherche souple : accents, fautes de frappe et lettres inversées.
   Les correspondances exactes restent prioritaires. */
function normalizeSearch(value){
 return String(value||'').toLocaleLowerCase('fr').normalize('NFD')
 .replace(/[\u0300-\u036f]/g,'').replace(/œ/g,'oe').replace(/æ/g,'ae')
 .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
function searchDistance(a,b){
 if(a===b)return 0;
 const n=a.length,m=b.length;
 if(!n)return m;
 if(!m)return n;
 let priorPrior=[],prior=Array.from({length:m+1},(_,j)=>j);
 for(let i=1;i<=n;i++){
  const current=[i];
  for(let j=1;j<=m;j++){
   const substitution=a[i-1]===b[j-1]?0:1;
   let cost=Math.min(prior[j]+1,current[j-1]+1,prior[j-1]+substitution);
   if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])cost=Math.min(cost,priorPrior[j-2]+1);
   current.push(cost);
  }
  priorPrior=prior;prior=current;
 }
 return prior[m];
}
function searchScore(p,query){
 if(!query)return 0;
 const fields=[normalizeSearch(p.name),normalizeSearch(p.trainer)];
 if(fields.some(field=>field.includes(query)))return 0;
 const allowance=query.length>=6?2:query.length>=4?1:0;
 if(!allowance)return Infinity;
 const words=query.split(' ');
 let best=Infinity;
 for(const field of fields){
  const tokens=field.split(' ');
  for(let i=0;i+words.length<=tokens.length;i++){
   const candidate=tokens.slice(i,i+words.length).join(' ');
   if(Math.abs(candidate.length-query.length)>allowance)continue;
   best=Math.min(best,searchDistance(query,candidate));
  }
 }
 return best<=allowance?best:Infinity;
}

/* Sept dernières courses, toutes disciplines confondues. Source unique :
   le même editorial.json que les fiches chevaux et l'application. */
// Compléter le résultat depuis la déclaration de la même course, sans écraser les données validées.
function resultDetails(s,slug,row){
  const candidates=(s.editor.engagements?.[slug]||[]).filter(e=>
    e&&e.date===row.date&&normalizeSearch(e.hippodrome)===normalizeSearch(row.hippodrome)
    &&['engage','partant','declare'].includes(String(e.statut||'').toLowerCase())
    &&(!row.course||!e.course||String(row.course).toUpperCase()===String(e.course).toUpperCase())
    &&(!row.numero||!e.numero||Number(row.numero)===Number(e.numero)));
  if(candidates.length!==1)return row;
  const e=candidates[0],out={...row};
  for(const key of ['prix','type','type_course','distance','allocation','entraineur','ferrure','surface'])
    if(!out[key]&&e[key])out[key]=e[key];
  if(['partant','declare'].includes(String(e.statut||'').toLowerCase())&&!out.driver&&!out.jockey){
    if(e.driver)out.driver=e.driver;
    else if(e.jockey)out.jockey=e.jockey;
    else if(e.monte)out.driver=e.monte;
  }
  const code=String(out.course||e.course||'').toUpperCase();
  if(!out.video_url&&/^R\d+C\d+$/.test(code)){
    out.course_url=out.course_url||'https://www.equidia.fr/courses/'+out.date+'/'+code.replace('C','/C');
    out.video_url=out.course_url;
    out.video_source='equidia_course';
  }
  return out;
}
function latestResults(s,expanded=false){
  const today=currentParis().slice(0,10);
  const performances=[];
  for(const p of s.profiles){
    for(const result of s.editor.performances?.[p.id]||[]){
      if(!result||!/^\d{4}-\d{2}-\d{2}$/.test(result.date||'')||result.date>today)continue;
      const rang=normalizeSearch(result.rang);
      // Les non-partants, annulations et qualifications ne sont pas des courses disputées.
      if(!rang||/^(?:non\s*partant|forfait|annul|report|qualifi)/.test(rang))continue;
      performances.push({p,result:resultDetails(s,p.id,result)});
    }
  }
  performances.sort((a,b)=>
    (b.result.date+(b.result.heure||'')).localeCompare(a.result.date+(a.result.heure||''))||
    a.p.name.localeCompare(b.p.name,'fr',{sensitivity:'base'}));
  const rows=performances.slice(0,20).map(({p,result})=>{
    const rank=displayRank(result.rang);
    const medal=rank==='1'?' gold':rank==='2'?' silver':rank==='3'?' bronze':'';
    const direct=absoluteUrl(result.video_url);
    const course=absoluteUrl(result.course_url);
    const source=absoluteUrl(result.source_url);
    const indexed=s.replayIndex[result.date+'|'+normalizeSearch(p.name)];
    const autoEquidia=result.video_source==='equidia_course' &&
      /^https:\/\/www\.equidia\.fr\/courses\/\d{4}-\d{2}-\d{2}\/R\d+\/C\d+\/?$/i.test(direct);
    // La page Equidia de la course est disponible immédiatement ;
    // ne pas prétendre que la vidéo elle-même est déjà publiée.
    const video=autoEquidia?direct:
      indexed&&indexed.kind!=='course'?indexed.url:
      direct||'';
    const resultUrl=!video?(course||
      (indexed&&indexed.kind==='course'?indexed.url:'')||
      (/\/(?:course|courses|arrivees|arrivee-rapports|rapports)\//i.test(source)?source:'')):'';
    const link=video
      ?'<a class="recent-action" href="'+esc(video)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Page vidéo de '+p.name+' du '+dateFR(result.date)+' ; replay selon disponibilité')+'">▶ Vidéo</a>'
      :resultUrl
        ?'<a class="recent-action recent-action-result" href="'+esc(resultUrl)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Résultat de '+p.name+' du '+dateFR(result.date))+'">Résultat</a>'
        :'';
    return '<li class="recent-item">'
      +'<div class="recent-content"><a class="recent-horse'+(p.name.length>=17?' recent-horse-long':'')+'" href="'+base+(p.newHorse?'fiche/?cheval='+encodeURIComponent(p.id):encodeURIComponent(p.id)+'/')+'#performances">'+esc(p.name)+'</a>'
      +'<div class="recent-meta"><time datetime="'+esc(result.date)+'" title="'+esc(dateFR(result.date))+'">'+esc(dateFR(result.date).slice(0,6)+dateFR(result.date).slice(-2))+'</time> · '+esc(result.hippodrome||'Hippodrome non renseigné')+'</div></div>'
      +'<img class="recent-silk" src="'+esc(silk(p))+'" alt="Casaque de '+esc(p.name)+'" width="42" height="50" loading="lazy" decoding="async">'
      +'<div class="recent-side"><span class="recent-rank'+medal+(rank.length>4?' recent-rank-long':'')+'">'+esc(rank)+'</span>'+link+'</div>'
      +'</li>';
  }).join('');
  return '<section class="recent-results" aria-labelledby="recent-results-title">'
    +'<div class="recent-heading"><h2 id="recent-results-title">🏁 Nos derniers résultats</h2>' +(!expanded&&performances.length>5?'<button type="button" id="recent-scroll-next" class="recent-scroll-hint" aria-controls="recent-scroll-list" aria-label="Faire défiler les résultats vers le bas"><span class="recent-scroll-arrow" aria-hidden="true">↓</span><span class="recent-scroll-label">Défiler</span></button>':'')+'</div>'
    +(rows?'<ol id="recent-scroll-list" class="recent-list" aria-label="Les 20 dernières performances, faire défiler pour les suivantes" tabindex="0">'+rows+'</ol>':'<p class="recent-empty">Aucun résultat récent enregistré pour le moment.</p>')
    +'</section>';
}

// Adapter chaque nom à la largeur réelle de sa carte, sans couper de lettres.
function fitCatalogueHorseNames(){
  const cards=document.querySelector('#cards');
  if(!cards)return;
  cards.querySelectorAll('.horse-card-line-main h2').forEach(heading=>{
    const name=heading.querySelector('.horse-card-name');
    const icon=heading.querySelector('.card-emoji');
    if(!name||!icon)return;
    heading.style.fontSize='';
    name.style.transform='';
    name.style.transformOrigin='';
    const styles=getComputedStyle(heading);
    const fontSize=parseFloat(styles.fontSize)||14;
    const gap=parseFloat(styles.columnGap)||0;
    const available=heading.clientWidth-icon.getBoundingClientRect().width-gap-2;
    if(available<=0)return;
    const range=document.createRange();
    range.selectNodeContents(name);
    let textWidth=range.getBoundingClientRect().width;
    if(textWidth<=available)return;
    // Réduire uniquement les noms longs ; les noms courts gardent leur taille.
    const fittedSize=Math.max(9,Math.min(fontSize,Math.floor(fontSize*available/textWidth*10)/10));
    heading.style.fontSize=fittedSize+'px';
    textWidth=range.getBoundingClientRect().width;
    // Cas extrême : conserver la ligne entière même sur un téléphone très étroit.
    if(textWidth>available){
      name.style.transformOrigin='left center';
      name.style.transform='scaleX('+Math.min(1,available/textWidth*0.99).toFixed(3)+')';
    }
  });
}
function resultsPage(s){
  const host=$('#app');
  const embedded=window.self!==window.top;
  host.innerHTML=(embedded?'':header())+
    '<main class="shell results-page">'+
      (embedded?'':'<div class="breadcrumb"><a href="https://www.ecurie-initial.com/">Accueil</a> / Derniers résultats</div>')+
      '<h1>Derniers résultats</h1><p class="results-intro">Les 20 dernières performances de l’Écurie Initial, au trot et au galop.</p>'+
      latestResults(s,true)+'</main>'+(embedded?'':footer());
  if(embedded){
    // Les fiches s’ouvrent en dehors du cadre du site, sans imbriquer les pages.
    host.querySelectorAll('.recent-horse').forEach(a=>{a.target='_blank';a.rel='noopener noreferrer'});
  }
}
function catalog(s){
  const host=$('#app');
  const alphabetical=[...s.profiles].filter(p=>p.active!==false).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
  // Une seule option par entraîneur, même si plusieurs chevaux sont entraînés par lui.
  const trainers=[...new Set(alphabetical.map(p=>p.trainer).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
  const horseOptions='<option value="">Tous les chevaux</option>'+
    alphabetical.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  const trainerOptions='<option value="">Tous les entraîneurs</option>'+
    trainers.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');
  host.innerHTML=header()+
    '<main class="shell">'+
      '<div class="breadcrumb"><a href="https://www.ecurie-initial.com/">Accueil</a> / Nos chevaux</div>'+
      latestResults(s)+
      '<h2 id="catalog-horses-title" class="catalog-horses-title">🐎 Nos chevaux</h2>'+
      '<div class="filter-strip" role="group" aria-label="Filtrer les chevaux">'+
        '<select id="filter-horse" aria-label="Choisir un cheval">'+horseOptions+'</select>'+
        '<select id="filter-trainer" aria-label="Choisir un entraîneur">'+trainerOptions+'</select>'+
      '</div>'+
      '<div class="grid" id="cards"></div>'+
    '</main>'+footer();
  // L'indicateur avance de trois performances par clic sans augmenter
  // la hauteur du bloc. Le défilement tactile reste actif.
  const recentScroll=$('#recent-scroll-list'),scrollButton=$('#recent-scroll-next');
  if(recentScroll&&scrollButton){
    const arrow=scrollButton.querySelector('.recent-scroll-arrow');
    const label=scrollButton.querySelector('.recent-scroll-label');
    const refreshScrollHint=()=>{
      const atEnd=recentScroll.scrollTop>=recentScroll.scrollHeight-recentScroll.clientHeight-3;
      arrow.textContent=atEnd?'↑':'↓';
      label.textContent=atEnd?'Retour':'Défiler';
      scrollButton.setAttribute('aria-label',atEnd?'Revenir aux premiers résultats':'Faire défiler les résultats par groupes de trois');
    };
    scrollButton.addEventListener('click',()=>{
      const atEnd=recentScroll.scrollTop>=recentScroll.scrollHeight-recentScroll.clientHeight-3;
      if(atEnd)recentScroll.scrollTo({top:0,behavior:'smooth'});
      else {
        const rowHeight=recentScroll.querySelector('.recent-item')?.getBoundingClientRect().height || recentScroll.clientHeight/5;
        recentScroll.scrollBy({top:3*rowHeight,behavior:'smooth'});
      }
    });
    recentScroll.addEventListener('scroll',refreshScrollHint,{passive:true});
    refreshScrollHint();
  }
  const horseSelect=$('#filter-horse'),trainerSelect=$('#filter-trainer');
  function redraw(){
    const selectedHorse=horseSelect.value,selectedTrainer=trainerSelect.value;
    const shown=alphabetical.filter(p=>
      (!selectedHorse||p.id===selectedHorse)&&
      (!selectedTrainer||p.trainer===selectedTrainer));
    $('#cards').innerHTML=shown.map(p=>{
      const d=currentData(p,s);
      const key=p.casaque==='galop'?(/obstacle/i.test(p.discipline||'')?'Valeurs':'Valeur'):'Record';
      const value=metric(p,d);
      return '<a class="horse-card" href="'+(p.newHorse?'fiche/?cheval='+encodeURIComponent(p.id):encodeURIComponent(p.id)+'/')+'" aria-label="'+esc('Voir la fiche de '+p.name)+'">'+photoMarkup(p,'card')+
        '<div class="horse-card-body">'+
          '<div class="horse-card-line horse-card-line-main">'+
            '<h2 title="'+esc(p.name)+'"><span class="card-emoji" aria-hidden="true">🐎</span><span class="horse-card-name">'+esc(p.name)+'</span></h2>'+
          '</div>'+
          '<div class="horse-card-line horse-card-line-secondary">'+
            '<span class="horse-card-trainer" title="'+esc('Entraîneur : '+(p.trainer||'Non renseigné'))+'"><span class="card-emoji" aria-hidden="true">🎩</span><span class="horse-card-trainer-name">'+esc(p.trainer||'—')+'</span></span>'+
            '<span class="horse-card-metric" title="'+esc(key+' : '+value)+'" aria-label="'+esc(key+' : '+value)+'">'+esc(value)+'</span>'+
          '</div>'+
        '</div></a>';
    }).join('')||'<p class="empty">Aucun cheval ne correspond à ces critères.</p>';
    requestAnimationFrame(fitCatalogueHorseNames);
  }
  window.addEventListener('resize',()=>requestAnimationFrame(fitCatalogueHorseNames));
  horseSelect.addEventListener('change',redraw);
  trainerSelect.addEventListener('change',redraw);
  redraw();
}
function info(label,value){return '<div class="info-item"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>'}
function stats(label,value){return '<div class="summary-card"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>'}
function horse(s){
  const id=document.body.dataset.horse||new URLSearchParams(location.search).get('cheval');
  const p=s.profiles.find(x=>x.id===id);
  if(!p)throw Error('Ce cheval ne figure pas dans l’effectif.');
  const isGalop=p.casaque==='galop';
  const d=currentData(p,s);
  const isRest=p.status==='au repos';
  const age=horseAge(p),ageLabel=age===null?'':age+' '+(age===1?'an':'ans');
  const sex=horseSex(p),identityLabel=[ageLabel,sex].filter(Boolean).join(' · ');
  const identityTitle=[age!==null?'Âge hippique : '+ageLabel:'',sex?'Sexe : '+sexNames[sex]:''].filter(Boolean).join(' · ');
  if(p.active===false)document.title=p.name+' · Ancien cheval de l’Écurie Initial';
  const value=metric(p,d);
  const valueLabel=isGalop?(/obstacle/i.test(p.discipline||'')?'Valeurs handicap plat / obstacle':'Valeur handicap'):'Record';
  const gains=money(d.gains);
  const perf=(s.editor.performances[id]||[]).filter(x=>x&&!/^(?:non\s*partant|forfait)/.test(normalizeSearch(x.rang))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(x=>resultDetails(s,id,x));
  // Les forfaits restent visibles jusqu'à J-3, puis disparaissent dès J-2.
  const today=currentParis().slice(0,10);
  const limit=new Date(today+'T00:00:00Z');
  limit.setUTCDate(limit.getUTCDate()+2);
  const twoDaysAhead=limit.toISOString().slice(0,10);
  const eng=(s.editor.engagements[id]||[]).filter(x=>
    x?.date && x.date+'T'+(x.heure||'23:59')>=currentParis()
    && (engagementStatus(x,sex)?.kind!=='forfait'||x.date>twoDaysAhead)
  ).sort((a,b)=>(a.date+(a.heure||'23:59')).localeCompare(b.date+(b.heure||'23:59')));
  const tr=perf.length
    ?'<ul class="ei-result-list">'+perf.map((x,index)=>{
      const replay=s.replayIndex[x.date+'|'+normalizeSearch(p.name)];
      const course=absoluteUrl(x.course_url);
      const direct=absoluteUrl(x.video_url);
      const isNonPartant=/^(?:non\s*partant|forfait)/.test(normalizeSearch(x.rang));
      // La fiche Equidia du résultat automatique est disponible comme destination
      // dès l'officialisation, même quand le replay n'est pas encore publié.
      // Ce lien prime sur les anciens liens de palmarès pour cette performance.
      const autoEquidia=x.video_source==='equidia_course'
        && /^https:\/\/www\.equidia\.fr\/courses\/\d{4}-\d{2}-\d{2}\/R\d+\/C\d+\/?$/i.test(direct)
        ?{url:direct,kind:'equidia_auto'}:null;
      const link=isNonPartant?null:(autoEquidia||replay||(direct?{url:direct,kind:/dailymotion\.com|youtube\.com/i.test(direct)?'video':'course'}:null));
      // Libellé et style identiques pour toutes les courses (vidéo directe ou page
      // où le replay sera publié ultérieurement), sans changer la destination.
      const replayAvailable=Boolean(link||course&&!isNonPartant);
      const video=link
        ?'<a class="ei-video-link" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Replay de '+p.name+' du '+dateFR(x.date)+' — ouvre la page de course, vidéo selon disponibilité')+'">▶ Replay</a>'
        :course&&!isNonPartant
          ?'<a class="ei-video-link" href="'+esc(course)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Replay de '+p.name+' du '+dateFR(x.date)+' — page de course')+'">▶ Replay</a>'
          :'<span class="ei-no-video" aria-label="Aucun lien de course disponible">—</span>';
      const rank=displayRank(x.rang);
      const rankText=/^[1-9]$/.test(rank)?rank+(rank==='1'?(p.sex==='F'?'re':'er'):'e'):rank;
      const starters=/^[1-9]$/.test(rank)&&Number.isInteger(x.partants)&&x.partants>=Number(rank)
        ?' <small>sur '+esc(x.partants)+' partants</small>':'';
      const distance=Number.isFinite(x.distance)?formatEuro.format(x.distance)+' m':x.distance;
      const specs=[x.type,distance,x.type_course,x.surface].filter(Boolean).join(' · ');
      const people=[['Monte',x.driver||x.jockey],['Entraîneur',x.entraineur]];
      const details=[
        ['Réduction kilométrique',!isGalop&&x.reduction_km],
        [isGalop?'Gains obtenus (hors primes)':'Gains obtenus',Number.isFinite(x.allocation_place)&&money(x.allocation_place)],
        ['Ferrure',!isGalop&&x.ferrure],
        ['Allocation de la course',Number.isFinite(x.allocation)&&money(x.allocation)]
      ];
      const fields=items=>items.filter(([,value])=>value).map(([label,value])=>
        '<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('');
      const peopleMarkup=fields(people),detailMarkup=fields(details);
      const arrival=Array.isArray(x.arrivee)&&x.arrivee.length
        ?'<details class="ei-result-details"><summary>Arrivée officielle</summary><p class="ei-result-meta">Chevaux classés</p><div class="ei-arrival-view"><div class="ei-arrival-scroll" id="ei-arrival-scroll-'+index+'" role="region" aria-label="Arrivée officielle, défilement horizontal" tabindex="0"><ol class="ei-arrival-list">'+x.arrivee.map(row=>
          '<li'+(row.numero===x.numero?' class="ei-arrival-current"':'')+'><span>'+esc(row.rang)+(row.rang===1?'er':'e')+'</span><span class="ei-arrival-horse">'+esc(row.cheval)+'</span><span class="ei-arrival-monte">'+esc(row.driver||row.jockey||row.monte||(row.numero===x.numero&&(x.driver||x.jockey))||'—')+'</span></li>').join('')+'</ol></div><input class="ei-arrival-slider" type="range" min="0" max="100" step="any" value="0" aria-label="Faire défiler l’arrivée vers la droite ou la gauche" aria-controls="ei-arrival-scroll-'+index+'" hidden></div></details>':'';
      return '<li class="ei-result-card"><div class="ei-result-top"><span class="ei-result-date">'+esc([dateFR(x.date),x.hippodrome].filter(Boolean).join(' · '))+'</span>'
        +'<span class="ei-result-rank"'+(rank==='0'?' title="Au-delà de la 9e place ou rang exact non renseigné"':'')+'>'+esc(rankText||'—')+starters+'</span></div>'
        +(x.prix?'<div class="ei-result-race">'+esc(x.prix)+'</div>':'')
        +(specs?'<div class="ei-result-meta">'+esc(specs)+'</div>':'')
        +(peopleMarkup?'<dl class="ei-result-fields">'+peopleMarkup+'</dl>':'')
        +(detailMarkup?'<details class="ei-result-details"'+(index===0?' open':'')+'><summary>Détails de la course</summary><dl class="ei-result-fields">'+detailMarkup+'</dl></details>':'')
        +arrival+(replayAvailable?'<div class="ei-result-actions">'+video+'</div>':'')
        +'</li>';
    }).join('')+'</ul>'
    :'<div class="empty">Aucune performance détaillée renseignée pour le moment.</div>';
  // La date et le statut partagent la première colonne : lisible même sur téléphone.
  const hasDeclared=eng.some(x=>['declare','partant'].includes(engagementStatus(x,sex)?.kind));
  const te=eng.length
    ?'<div class="table-wrap"><table class="perf-table perf-engagements"><thead><tr><th>Date / Statut</th><th>Hippodrome</th>'+(hasDeclared?'<th>Heure</th>':'')+'<th>Épreuve</th>'+(hasDeclared?'<th>Monte</th>':'')+'</tr></thead><tbody>'+eng.map(x=>{
      const status=engagementStatus(x,sex);
      const declared=status?.kind==='declare'||status?.kind==='partant';
       const ferrure=p.casaque!=='galop'&&declared&&/^(F4|PA|PP|P4|DA|DP|D4)$/.test(x.ferrure||'')?x.ferrure:'';
      const cancelled=x.reunion_annulee||(id==='andresy'&&x.date==='2026-11-18'&&/amiens/i.test(x.hippodrome||''));
      const badge=status?'<span class="ei-engagement-status ei-engagement-status-'+status.kind+'" aria-label="'+esc('Statut : '+status.label)+'">'+esc(status.label)+'</span>':'';
      return '<tr><td class="ei-engagement-date-cell"><span class="ei-engagement-date">'+esc(dateFR(x.date))+'</span>'+badge+'</td><td>'+esc(x.hippodrome)+'</td>'
        +(hasDeclared?'<td><span class="rank">'+esc(declared?(x.heure||'—'):'—')+'</span></td>':'')
        +'<td>'+(cancelled?'<strong style="color:#b42318">RÉUNION ANNULÉE</strong> · ':'')+esc([x.course,x.prix||x.type,x.type_course,x.surface,ferrure?'Ferrure : '+ferrure:''].filter(Boolean).join(' · ')||'Course')+'</td>'
        +(hasDeclared?'<td>'+esc(declared?(x.driver||x.jockey||x.monte||'—'):'—')+'</td>':'')+'</tr>';
    }).join('')+'</tbody></table></div>'
    :'<div class="empty">Aucun prochain engagement renseigné.</div>';
  const courseFields=eng.map((x,index)=>{
    if(!['declare','partant'].includes(engagementStatus(x,sex)?.kind)||x.reunion_annulee)return '';
    const markup=window.EICourseField?.markup(x,p,s.editor.courseFields||[],'horse-field-'+index);
    if(!markup)return '';
    const multiple=eng.filter(e=>['declare','partant'].includes(engagementStatus(e,sex)?.kind)&&!e.reunion_annulee).length>1;
    const label=[multiple?(x.prix||x.course||'Course '+(index+1)):'',x.numero?'N° '+x.numero:''].filter(Boolean).join(' · ');
    return '<div style="padding:10px 14px;border-top:1px solid #eadfd7">'+(label?'<strong>'+esc(label)+'</strong>':'')+markup+'</div>';
  }).join('');
  document.title=p.name+' | Écurie Initial';
  $('#app').innerHTML=header()
    +'<main class="shell">'
      +'<div class="breadcrumb"><a href="'+base+'index.html">Nos chevaux</a> / '+esc(p.name)+'</div>'
      +'<div class="hero">'
        +photoMarkup(p,'hero')
        +'<div class="hero-info">'
          +'<div class="hero-title-row">'
            +'<h1>'+esc(p.name)
            +(identityLabel?'<span class="hero-age" title="'+esc(identityTitle)+'" aria-label="'+esc(identityTitle)+'">'+esc(identityLabel)+'</span>':'')
            +'</h1>'
            +'<img class="hero-title-silk" src="'+esc(silk(p))+'" alt="Casaque de '+esc(p.name)+'" loading="lazy" decoding="async">'
          +'</div>'
          +'<div class="hero-meta">'
            +'<span class="orange-line hero-title-rule" aria-hidden="true"></span>'
            +'<span class="hero-trainer" title="'+esc('Entraîneur : '+(p.trainer||'—'))+'"><span aria-hidden="true">🎩</span> <span class="hero-trainer-name">'+esc(p.trainer||'—')+'</span></span>'

            +(isRest?'<span class="tag rest">Au repos</span>':'')
          +'</div>'
        +'</div>'
      +'</div>'
      +'<div class="summary">'+stats(valueLabel,value)+stats('Gains en carrière',gains)+'</div>'
      +(isGalop&&/obstacle/i.test(p.discipline||'')&&p.value_historique_non_ventilee!=null
        ?'<p style="font-size:12px;color:#76675d;margin-top:6px">Valeur historique non ventilée : '+esc(formatValue(p.value_historique_non_ventilee))+' (plat ou obstacle non précisé).</p>'
        :'')
      +(p.origines?'<section class="section"><h2 class="section-title">Origines</h2><div class="paper info-grid">'+(p.birth_year?info('Année de naissance',String(p.birth_year)):'')+info('Père',p.origines.pere)+info('Mère',p.origines.mere)+info('Père de mère',p.origines.pere_de_mere)+'</div></section>':'')
      +'<section class="section" id="performances">'
        +'<h2 class="section-title">Dernières performances</h2>'
        +'<div class="paper">'+tr+'</div>'
      +'</section>'
      +(s.editor.qualifications&&s.editor.qualifications[id]&&absoluteUrl(s.editor.qualifications[id].url)
        ?'<section class="section"><h2 class="section-title">Qualification</h2><div class="paper ei-qualification"><span class="ei-qualification-label">'+esc(s.editor.qualifications[id].hippodrome)+' · '+esc(dateFR(s.editor.qualifications[id].date))+' · lot n°'+esc(s.editor.qualifications[id].lot)+(s.editor.qualifications[id].chrono?' · '+esc(s.editor.qualifications[id].chrono):'')+'</span><a class="ei-video-link" href="'+esc(absoluteUrl(s.editor.qualifications[id].url))+'" target="_blank" rel="noopener noreferrer" aria-label="Voir la qualification de '+esc(p.name)+'">▶ Replay</a></div></section>'
        :'')
      +'<section class="section">'
        +'<h2 class="section-title">'+(eng.length===1?'Prochain engagement':'Prochains engagements')+'</h2>'
        +'<div class="paper">'+te+courseFields+'</div>'
      +'</section>'
      +'<div class="bottom-actions">'
        +'<a class="action primary" href="'+base+'index.html">← Tous nos chevaux</a>'
        +'<a class="action secondary" href="https://www.ecurie-initial.com/">Site de l’Écurie Initial</a>'
      +'</div>'
    +'</main>'+footer();
}

async function trainersPage(s){
 let published=[];try{const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');const db=createClient('https://yeecwaaizmvrhwobukfa.supabase.co','sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3');const {data}=await db.from('ei_fiches_entraineurs_publiques').select('entraineur_nom,contenu');published=data||[];}catch(e){console.warn(e)}
 const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:''}catch{return ''}};
 const imageUrl=v=>typeof v==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v)?v:safeUrl(v);
 const profile=n=>{const p=published.find(x=>x.entraineur_nom===n)?.contenu||{};return '<div class="paper" style="padding:16px">'+(imageUrl(p.portrait)?'<img style="max-width:220px;width:100%;border-radius:10px" src="'+esc(imageUrl(p.portrait))+'" alt="Portrait">':'')+['localisation','annee','presentation','collaborateurs'].map(k=>p[k]?'<p style="white-space:pre-wrap">'+esc(({localisation:'Localisation : ',annee:'Installé depuis : ',presentation:'',collaborateurs:'Collaborateurs : '})[k]+p[k])+'</p>':'').join('')+[p.site,...String(p.reseaux||'').split(/\\n/)].filter(safeUrl).map(u=>'<p><a href="'+esc(safeUrl(u))+'" rel="noopener noreferrer">'+esc(u)+'</a></p>').join('')+String(p.photos||'').split(/\\n/).filter(safeUrl).map(u=>'<img style="max-width:100%;width:300px" src="'+esc(imageUrl(u))+'" alt="Installations">').join('')+'</div>';};
 const groups=new Map();
 for(const p of s.profiles.filter(p=>p.active!==false&&p.trainer)){if(!groups.has(p.trainer))groups.set(p.trainer,[]);groups.get(p.trainer).push(p);}
 for(const row of published)if(!groups.has(row.entraineur_nom))groups.set(row.entraineur_nom,[]);
 const names=[...groups.keys()].sort((a,b)=>a.localeCompare(b,'fr'));
 const selected=new URLSearchParams(location.search).get('entraineur');
 const link=p=>base+(p.newHorse?'fiche/?cheval='+encodeURIComponent(p.id):encodeURIComponent(p.id)+'/');
 const trainerLink=n=>base+'entraineurs.html?entraineur='+encodeURIComponent(n);
 const cards=names.map(n=>'<a class="paper" style="display:block;padding:18px;color:inherit;text-decoration:none;border-left:4px solid #f58220" href="'+esc(trainerLink(n))+'"><strong>'+esc(n)+'</strong><p>'+esc([...new Set(groups.get(n).map(p=>p.discipline))].join(' · '))+' · '+groups.get(n).length+(groups.get(n).length===1?' cheval':' chevaux')+'</p></a>').join('');
 let detail='';
 if(groups.has(selected)){
 const horses=groups.get(selected).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
 const rows=(key)=>horses.flatMap(p=>(s.editor[key]?.[p.id]||[]).map(x=>({p,x})));
 const upcoming=rows('engagements').filter(({x})=>x.date>=currentParis().slice(0,10)&&!['forfait','elimine','eliminee','nonpartant'].includes(normalizeSearch(x.statut||x.status||'').replace(/\s+/g,''))).sort((a,b)=>a.x.date.localeCompare(b.x.date));
 const recent=rows('performances').filter(({x})=>x.entraineur&&normalizeSearch(x.entraineur)===normalizeSearch(selected)).sort((a,b)=>b.x.date.localeCompare(a.x.date)).slice(0,10);
 const raceRows=(items,result)=>items.length?items.map(({p,x})=>'<p style="padding:10px 14px;margin:0;border-bottom:1px solid #ddd"><a href="'+esc(link(p))+'"><strong>'+esc(p.name)+'</strong></a> · '+esc(dateFR(x.date))+' · '+esc(x.hippodrome)+' · '+esc(result?x.rang:(engagementStatus(x,p.sex)?.label||x.statut||''))+'</p>').join(''):'<p style="padding:14px">Aucune donnée vérifiée disponible.</p>';
 detail='<p><a href="'+base+'entraineurs.html">← Tous les entraîneurs</a></p><h1>'+esc(selected)+'</h1>'+profile(selected)+'<p>'+esc([...new Set(horses.map(p=>p.discipline))].join(' · '))+'</p><h2 class="section-title">Chevaux de l’Écurie Initial</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px">'+horses.map(p=>'<a class="horse-card" href="'+esc(link(p))+'">'+photoMarkup(p,'card')+'<div style="padding:12px"><strong>'+esc(p.name)+'</strong></div></a>').join('')+'</div><h2 class="section-title">Prochains engagements</h2><div class="paper">'+raceRows(upcoming,false)+'</div><h2 class="section-title">Derniers résultats attribués à cet entraîneur</h2><div class="paper">'+raceRows(recent,true)+'</div>';
 }
 $('#app').innerHTML=header()+'<main class="shell" style="padding-top:24px;padding-bottom:32px">'+(detail||'<h1>Nos entraîneurs</h1><p>Les professionnels qui accompagnent les chevaux de l’Écurie Initial.</p><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">'+cards+'</div>')+'</main>'+footer();
}

function initArrivalScroll(){
  for(const view of document.querySelectorAll('.ei-arrival-view')){
    const scroller=view.querySelector('.ei-arrival-scroll');
    const slider=view.querySelector('.ei-arrival-slider');
    const sync=()=>{
      const maximum=scroller.scrollWidth-scroller.clientWidth;
      slider.hidden=maximum<=1;
      slider.value=maximum>0?String(100*scroller.scrollLeft/maximum):'0';
    };
    scroller.addEventListener('scroll',sync,{passive:true});
    slider.addEventListener('input',()=>{
      scroller.scrollLeft=(scroller.scrollWidth-scroller.clientWidth)*Number(slider.value)/100;
    });
    view.closest('details')?.addEventListener('toggle',sync);
    new ResizeObserver(sync).observe(scroller);
    sync();
  }
}


/* Barre commune, conservée dans le catalogue et les fiches de tous les chevaux. */
const eiNavScript=document.createElement('script');
eiNavScript.src=base+'../application/nav.js?v=20261126push-device-v17';
document.body.appendChild(eiNavScript);

// En PWA, un écran conservé en mémoire ne doit pas garder les anciens résultats.
function watchFreshResults(state){
  const initialResults=JSON.stringify(state.editor.performances||{});
  const horseId=document.body.dataset.horse||new URLSearchParams(location.search).get('cheval');
  const initialEngagements=JSON.stringify(state.editor.engagements?.[horseId]||[]);
  const initialFields=JSON.stringify((state.editor.courseFields||[]).filter(c=>c.cheval_slug===horseId));
  let checking=false,lastChecked=Date.now();
  async function check(force=false){
    if(document.hidden||checking||(!force&&Date.now()-lastChecked<45000))return;
    checking=true;lastChecked=Date.now();
    try{
      const response=await fetch(base+'data/editorial.json?v='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('Contrôle des résultats indisponible');
      const fresh=await response.json();
      const latest=await freshPerformances(fresh);
      if(JSON.stringify(latest)!==initialResults){location.reload();return;}
      if(document.body.dataset.page==='fiche'&&horseId){
        const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
        const client=createClient('https://yeecwaaizmvrhwobukfa.supabase.co','sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3');
        const {data,error}=await client.from('ei_contributions_engagements').select('engagements').eq('cheval_slug',horseId).maybeSingle();
        if(!error&&JSON.stringify(data?.engagements||fresh.engagements?.[horseId]||[])!==initialEngagements){location.reload();return;}
        const fields=await loadCourseFields();
        if(fields.length&&JSON.stringify(fields.filter(c=>c.cheval_slug===horseId))!==initialFields)location.reload();
      }
    }catch(error){console.info('Vérification des derniers résultats différée',error)}
    finally{checking=false}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check(true)});
  window.addEventListener('pageshow',event=>{if(event.persisted)void check(true)});
  window.addEventListener('focus',()=>{void check()});
  window.addEventListener('online',()=>{void check(true)});
  setInterval(()=>{void check()},60000);
}
load().then(s=>{if(document.body.dataset.page==='fiche'){horse(s);initArrivalScroll();window.EICourseField?.init(document);if(location.hash==='#performances')$('#performances')?.scrollIntoView();}else if(document.body.dataset.page==='resultats')resultsPage(s);else if(document.body.dataset.page==='entraineurs')trainersPage(s);else catalog(s);watchFreshResults(s)}).catch(err=>{console.error(err);$('#app').innerHTML=header()+'<main class="shell"><div class="error"><h1>Informations temporairement indisponibles</h1><p>Le catalogue n’a pas pu être chargé. Réessayez en actualisant la page.</p><p><a href="https://www.ecurie-initial.com/">Retour au site officiel</a></p></div></main>'+footer()});
})();
