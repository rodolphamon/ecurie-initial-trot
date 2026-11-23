(function(){
'use strict';
const $=sel=>document.querySelector(sel),formatEuro=new Intl.NumberFormat('fr-FR'),base=document.body.dataset.page==='fiche'?'../':'./';
const esc=v=>String(v===undefined||v===null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const absoluteUrl=u=>{try{let v=new URL(u);return v.protocol==='https:'?v.href:''}catch{return ''}};
const dateFR=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return s||'';let [y,m,d]=s.split('-');return d+'/'+m+'/'+y};
const money=n=>Number.isFinite(n)?formatEuro.format(n)+' €':'—';
const formatValue=n=>Number.isFinite(n)?String(n).replace('.',','):'—';
const currentParis=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
// En courses françaises, l'âge hippique avance le 1er janvier, sans attendre la date anniversaire.
const horseAge=p=>{const born=Number(p.birth_year),now=Number(currentParis().slice(0,4));return Number.isInteger(born)&&born>=1990&&born<=now?now-born:null};
// Affichage du classement : de 1re à 7e, puis NP = non placé.
const displayRank=v=>{const raw=String(v||'').trim(),clean=normalizeSearch(raw),m=raw.match(/^(\d+)\s*(?:er|re|e|eme|ème)?$/i);return (m&&Number(m[1])>7)||clean==='non place'||clean==='non placee'?'NP':raw;};
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
async function load(){let paths=[base+'data/chevaux.json',base+'data/editorial.json',base+'../data/effectif-trot.json',base+'../data/effectif-galop.json'];let requests=await Promise.all(paths.map(async p=>{let r=await fetch(p+(p.endsWith('/data/editorial.json')?'?v='+Date.now():''),{cache:'no-store'});if(!r.ok)throw Error('Impossible de charger '+p);return r.json()}));let [all,editor,trot,galop]=requests;
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
function header(){return '<header class="top"><div class="shell top-inner"><a class="wordmark" href="'+base+'index.html"><img class="wordmark-logo" src="'+base+'assets/embleme-ei.png?v=20261112h" alt="Écurie Initial" width="46" height="46"><span class="wordmark-copy"><span class="wordmark-title">ÉCURIE <span class="wordmark-initial"><span class="wordmark-initial-i">'+(installedApp?'ı':'I')+'</span>NITIAL</span></span><small>PARTAGEONS NOTRE PASSION DEPUIS 2011</small></span></a>'+(installedApp?'<span class="wordmark-slogan"><span class="wordmark-slogan-line">PARTAGEONS NOTRE PASSION</span><span class="wordmark-slogan-date">DEPUIS 2011</span></span>':'<nav class="top-nav"><a href="'+base+'index.html">Nos chevaux</a><a href="https://www.ecurie-initial.com/trotteurs/" target="_blank" rel="noopener noreferrer">Trot</a><a href="https://www.ecurie-initial.com/galopeurs/" target="_blank" rel="noopener noreferrer">Galop</a><a href="https://www.ecurie-initial.com/" target="_blank" rel="noopener noreferrer">Site officiel</a></nav>')+'</div></header>'}
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
function latestResults(s){
  const today=currentParis().slice(0,10);
  const performances=[];
  for(const p of s.profiles){
    for(const result of s.editor.performances?.[p.id]||[]){
      if(!result||!/^\d{4}-\d{2}-\d{2}$/.test(result.date||'')||result.date>today)continue;
      const rang=normalizeSearch(result.rang);
      // Les non-partants, annulations et qualifications ne sont pas des courses disputées.
      if(!rang||/^(?:np\b|non partant|annul|report|qualifi)/.test(rang))continue;
      performances.push({p,result});
    }
  }
  performances.sort((a,b)=>
    (b.result.date+(b.result.heure||'')).localeCompare(a.result.date+(a.result.heure||''))||
    a.p.name.localeCompare(b.p.name,'fr',{sensitivity:'base'}));
  const rows=performances.slice(0,20).map(({p,result})=>{
    const rank=displayRank(result.rang);
    const medal=/^1(?:er|re|ère)?\b/i.test(rank)?' gold':/^2e\b/i.test(rank)?' silver':/^3e\b/i.test(rank)?' bronze':'';
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
      +'<div class="recent-content"><a class="recent-horse'+(p.name.length>=17?' recent-horse-long':'')+'" href="'+encodeURIComponent(p.id)+'/">'+esc(p.name)+'</a>'
      +'<div class="recent-meta"><time datetime="'+esc(result.date)+'" title="'+esc(dateFR(result.date))+'">'+esc(dateFR(result.date).slice(0,6)+dateFR(result.date).slice(-2))+'</time> · '+esc(result.hippodrome||'Hippodrome non renseigné')+'</div></div>'
      +'<img class="recent-silk" src="'+esc(silk(p))+'" alt="Casaque de '+esc(p.name)+'" width="42" height="50" loading="lazy" decoding="async">'
      +'<div class="recent-side"><span class="recent-rank'+medal+(rank.length>4?' recent-rank-long':'')+'">'+esc(rank)+'</span>'+link+'</div>'
      +'</li>';
  }).join('');
  return '<section class="recent-results" aria-labelledby="recent-results-title">'
    +'<div class="recent-heading"><h2 id="recent-results-title">🏁 Nos derniers résultats</h2>'+(performances.length>5?'<button type="button" id="recent-scroll-next" class="recent-scroll-hint" aria-controls="recent-scroll-list" aria-label="Faire défiler les résultats vers le bas"><span class="recent-scroll-arrow" aria-hidden="true">↓</span><span class="recent-scroll-label">Défiler</span></button>':'')+'</div>'
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
  const perf=(s.editor.performances[id]||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
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
    ?'<div class="table-wrap"><table class="perf-table perf-results"><thead><tr><th>Date</th><th>Hippodrome</th><th>Rang</th><th>Driver / Jockey</th><th>Replay</th></tr></thead><tbody>'+perf.map(x=>{
      const replay=s.replayIndex[x.date+'|'+normalizeSearch(p.name)];
      const course=absoluteUrl(x.course_url);
      const direct=absoluteUrl(x.video_url);
      const isNonPartant=/non.partant|^np\b/i.test(String(x.rang||''));
      // La fiche Equidia du résultat automatique est disponible comme destination
      // dès l'officialisation, même quand le replay n'est pas encore publié.
      // Ce lien prime sur les anciens liens de palmarès pour cette performance.
      const autoEquidia=x.video_source==='equidia_course'
        && /^https:\/\/www\.equidia\.fr\/courses\/\d{4}-\d{2}-\d{2}\/R\d+\/C\d+\/?$/i.test(direct)
        ?{url:direct,kind:'equidia_auto'}:null;
      const link=isNonPartant?null:(autoEquidia||replay||(direct?{url:direct,kind:/dailymotion\.com|youtube\.com/i.test(direct)?'video':'course'}:null));
      // Libellé et style identiques pour toutes les courses (vidéo directe ou page
      // où le replay sera publié ultérieurement), sans changer la destination.
      const video=link
        ?'<a class="ei-video-link" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Replay de '+p.name+' du '+dateFR(x.date)+' — ouvre la page de course, vidéo selon disponibilité')+'">▶ Replay</a>'
        :course&&!isNonPartant
          ?'<a class="ei-video-link" href="'+esc(course)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc('Replay de '+p.name+' du '+dateFR(x.date)+' — page de course')+'">▶ Replay</a>'
          :'<span class="ei-no-video" aria-label="Aucun lien de course disponible">—</span>';
      return '<tr><td>'+esc(dateFR(x.date))+'</td><td>'+esc(x.hippodrome)+'</td><td><span class="rank" title="'+esc(displayRank(x.rang)==='NP'?'Non placé':'Classement')+'">'+esc(displayRank(x.rang)||'—')+'</span></td><td>'+esc(x.driver||x.jockey||'—')+'</td><td>'+video+'</td></tr>';
    }).join('')+'</tbody></table></div>'
    :'<div class="empty">Aucune performance détaillée renseignée pour le moment.</div>';
  // La date et le statut partagent la première colonne : lisible même sur téléphone.
  const hasDeclared=eng.some(x=>['declare','partant'].includes(engagementStatus(x,sex)?.kind));
  const te=eng.length
    ?'<div class="table-wrap"><table class="perf-table perf-engagements"><thead><tr><th>Date / Statut</th><th>Hippodrome</th>'+(hasDeclared?'<th>Heure</th>':'')+'<th>Épreuve</th>'+(hasDeclared?'<th>Monte</th>':'')+'</tr></thead><tbody>'+eng.map(x=>{
      const status=engagementStatus(x,sex);
      const declared=status?.kind==='declare'||status?.kind==='partant';
      const cancelled=x.reunion_annulee||(id==='andresy'&&x.date==='2026-11-18'&&/amiens/i.test(x.hippodrome||''));
      const badge=status?'<span class="ei-engagement-status ei-engagement-status-'+status.kind+'" aria-label="'+esc('Statut : '+status.label)+'">'+esc(status.label)+'</span>':'';
      return '<tr><td class="ei-engagement-date-cell"><span class="ei-engagement-date">'+esc(dateFR(x.date))+'</span>'+badge+'</td><td>'+esc(x.hippodrome)+'</td>'
        +(hasDeclared?'<td><span class="rank">'+esc(declared?(x.heure||'—'):'—')+'</span></td>':'')
        +'<td>'+(cancelled?'<strong style="color:#b42318">RÉUNION ANNULÉE</strong> · ':'')+esc([x.course,x.prix||x.type,x.type_course,x.surface].filter(Boolean).join(' · ')||'Course')+'</td>'
        +(hasDeclared?'<td>'+esc(declared?(x.driver||x.jockey||x.monte||'—'):'—')+'</td>':'')+'</tr>';
    }).join('')+'</tbody></table></div>'
    :'<div class="empty">Aucun prochain engagement renseigné.</div>';
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
      +'<section class="section">'
        +'<h2 class="section-title">Dernières performances</h2>'
        +'<div class="paper">'+tr+'</div>'
      +'</section>'
      +(s.editor.qualifications&&s.editor.qualifications[id]&&absoluteUrl(s.editor.qualifications[id].url)
        ?'<section class="section"><h2 class="section-title">Qualification</h2><div class="paper ei-qualification"><span class="ei-qualification-label">'+esc(s.editor.qualifications[id].hippodrome)+' · '+esc(dateFR(s.editor.qualifications[id].date))+' · lot n°'+esc(s.editor.qualifications[id].lot)+(s.editor.qualifications[id].chrono?' · '+esc(s.editor.qualifications[id].chrono):'')+'</span><a class="ei-video-link" href="'+esc(absoluteUrl(s.editor.qualifications[id].url))+'" target="_blank" rel="noopener noreferrer" aria-label="Voir la qualification de '+esc(p.name)+'">▶ Replay</a></div></section>'
        :'')
      +'<section class="section">'
        +'<h2 class="section-title">'+(eng.length===1?'Prochain engagement':'Prochains engagements')+'</h2>'
        +'<div class="paper">'+te+'</div>'
      +'</section>'
      +'<div class="bottom-actions">'
        +'<a class="action primary" href="'+base+'index.html">← Tous nos chevaux</a>'
        +'<a class="action secondary" href="https://www.ecurie-initial.com/">Site de l’Écurie Initial</a>'
      +'</div>'
    +'</main>'+footer();
}


/* Barre commune, conservée dans le catalogue et les fiches de tous les chevaux. */
const eiNavScript=document.createElement('script');
eiNavScript.src=base+'../application/nav.js?v=20261118resultatschevaux1';
document.body.appendChild(eiNavScript);

// En PWA, un écran conservé en mémoire ne doit pas garder les anciens résultats.
function watchFreshResults(state){
  const initialResults=JSON.stringify(state.editor.performances||{});
  let checking=false,lastChecked=Date.now();
  async function check(force=false){
    if(document.hidden||checking||(!force&&Date.now()-lastChecked<45000))return;
    checking=true;lastChecked=Date.now();
    try{
      const response=await fetch(base+'data/editorial.json?v='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw Error('Contrôle des résultats indisponible');
      const fresh=await response.json();
      if(JSON.stringify(fresh.performances||{})!==initialResults)location.reload();
    }catch(error){console.info('Vérification des derniers résultats différée',error)}
    finally{checking=false}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check(true)});
  window.addEventListener('pageshow',event=>{if(event.persisted)void check(true)});
  window.addEventListener('focus',()=>{void check()});
  window.addEventListener('online',()=>{void check(true)});
  setInterval(()=>{void check()},60000);
}
load().then(s=>{if(document.body.dataset.page==='fiche')horse(s);else catalog(s);watchFreshResults(s)}).catch(err=>{console.error(err);$('#app').innerHTML=header()+'<main class="shell"><div class="error"><h1>Informations temporairement indisponibles</h1><p>Le catalogue n’a pas pu être chargé. Réessayez en actualisant la page.</p><p><a href="https://www.ecurie-initial.com/">Retour au site officiel</a></p></div></main>'+footer()});
})();