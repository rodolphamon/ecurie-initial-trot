(function(){
'use strict';
const $=sel=>document.querySelector(sel),formatEuro=new Intl.NumberFormat('fr-FR'),base=document.body.dataset.page==='fiche'?'../':'./';
const esc=v=>String(v===undefined||v===null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const absoluteUrl=u=>{try{let v=new URL(u);return v.protocol==='https:'?v.href:''}catch{return ''}};
const dateFR=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return s||'';let [y,m,d]=s.split('-');return d+'/'+m+'/'+y};
const money=n=>Number.isFinite(n)?formatEuro.format(n)+' €':'—';
const formatValue=n=>Number.isFinite(n)?String(n).replace('.',','):'—';
const currentParis=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
const silkName=p=>p.casaque==='galop'?'casaque-galop.svg':p.casaque==='orange'?'casaque-orange.svg':'casaque-blanche.svg';
const silk=p=>base+'../assets/'+silkName(p);
function photoMarkup(p,style){let img=base+'photos/'+p.id+'.jpg?v='+encodeURIComponent(p.photoVersion||'1');return '<div class="'+(style==='hero'?'hero-photo':'horse-card-photo')+'">'+(style==='card'?'<span class="kind">'+esc(p.discipline)+'</span>':'')+'<img class="photo" src="'+img+'" alt="Photo de '+esc(p.name)+'" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false;this.parentNode.classList.add(\'no-photo\')" /><img class="silk" hidden src="'+silk(p)+'" alt="Casaque de l’Écurie Initial"/>'+(style==='hero'?'<span class="placeholder-tag" hidden>Photographie à venir</span>':'')+'</div>'}
async function load(){let paths=[base+'data/chevaux.json',base+'data/editorial.json',base+'../data/effectif-trot.json',base+'../data/effectif-galop.json'];let requests=await Promise.all(paths.map(async p=>{let r=await fetch(p,{cache:'no-store'});if(!r.ok)throw Error('Impossible de charger '+p);return r.json()}));let [all,editor,trot,galop]=requests;let gallop=new Map((galop.horses||[]).map(h=>[h.id,h]));return {profiles:all.horses.map(p=>({...p,...(gallop.get(p.id)||{})})),editor,trot:trot.horses||{},gallop,updates:{trot:trot.updated_at,galop:galop.updated_at}}}
function header(){return '<header class="top"><div class="shell top-inner"><a class="wordmark" href="'+base+'index.html"><span class="wordmark-emblem">EI</span><span>ÉCURIE INITIAL<small>PASSION HIPPIQUE DEPUIS 2011</small></span></a><nav class="top-nav"><a href="'+base+'index.html">Nos chevaux</a><a href="https://www.ecurie-initial.com/nos-chevaux/trot/">Trot</a><a href="https://www.ecurie-initial.com/nos-chevaux/galop/">Galop</a><a href="https://www.ecurie-initial.com/">Site officiel</a></nav></div></header>'}
function footer(){return '<footer class="footer"><div class="shell">© Écurie Initial · Des chevaux, des associés, une passion commune.</div></footer>'}
function metric(p,data){return p.casaque==='galop'?formatValue(data.value):(data.record||'—')}
function currentData(p,s){return p.casaque==='galop'?p:(s.trot[p.id]||{})}
function catalog(s){let host=$('#app');host.innerHTML=header()+'<main class="shell"><div class="breadcrumb"><a href="https://www.ecurie-initial.com/">Accueil</a> / Nos chevaux</div><span class="eyebrow">Effectif de l’Écurie Initial</span><h1 class="page-title">Nos chevaux</h1><div class="orange-line"></div><p class="lead">Découvrez les chevaux de l’écurie, leurs performances, leurs gains et leurs prochains engagements.</p><div class="filter-strip"><input type="search" aria-label="Rechercher un cheval" id="q" placeholder="Rechercher un cheval ou un entraîneur..."><div class="filter-buttons"><button data-filter="Tous" aria-pressed="true">Tous les chevaux</button><button data-filter="Trot" aria-pressed="false">Trot</button><button data-filter="Galop" aria-pressed="false">Galop et obstacle</button></div></div><p id="resultCount" class="notice" role="status"></p><div class="grid" id="cards"></div></main>'+footer();let filter='Tous',input=$('#q'),buttons=[...document.querySelectorAll('[data-filter]')];function redraw(){let q=input.value.toLocaleLowerCase('fr').trim();let shown=s.profiles.filter(p=>(filter==='Tous'||(filter==='Trot'?p.casaque!=='galop':p.casaque==='galop'))&&(p.name+' '+p.trainer).toLocaleLowerCase('fr').includes(q));$('#resultCount').textContent=shown.length+' cheval'+(shown.length>1?'x':'')+' affiché'+(shown.length>1?'s':'');$('#cards').innerHTML=shown.map(p=>{let d=currentData(p,s),key=p.casaque==='galop'?'Valeur':'Record';return '<a class="horse-card" href="'+encodeURIComponent(p.id)+'/">'+photoMarkup(p,'card')+'<div class="horse-card-body"><h2>'+esc(p.name)+'</h2><p>'+esc(p.trainer||'Entraîneur non renseigné')+'</p><div class="card-bottom"><span>'+key+' : <b>'+esc(metric(p,d))+'</b></span><span>Découvrir la fiche →</span></div></div></a>'}).join('')||'<p class="empty">Aucun cheval ne correspond à cette recherche.</p>'}input.addEventListener('input',redraw);buttons.forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;buttons.forEach(x=>x.setAttribute('aria-pressed',String(x===b)));redraw()}));redraw()}
function info(label,value){return '<div class="info-item"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>'}
function stats(label,value){return '<div class="summary-card"><span>'+esc(label)+'</span><strong>'+esc(value||'—')+'</strong></div>'}
function horse(s){
  const id=document.body.dataset.horse;
  const p=s.profiles.find(x=>x.id===id);
  if(!p)throw Error('Ce cheval ne figure pas dans l’effectif.');
  const isGalop=p.casaque==='galop';
  const d=currentData(p,s);
  const isRest=p.status==='au repos';
  const value=metric(p,d);
  const valueLabel=isGalop?'Valeur handicap':'Record';
  const gains=money(d.gains);
  const perf=(s.editor.performances[id]||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
  const eng=(s.editor.engagements[id]||[]).filter(x=>x.date+'T'+(x.heure||'00:00')>=currentParis()).sort((a,b)=>(a.date+a.heure).localeCompare(b.date+b.heure));
  const tr=perf.length
    ?'<div class="table-wrap"><table class="perf-table"><thead><tr><th>Date</th><th>Hippodrome</th><th>Classement</th><th>Driver / Jockey</th></tr></thead><tbody>'+perf.map(x=>'<tr><td>'+esc(dateFR(x.date))+'</td><td>'+esc(x.hippodrome)+'</td><td><span class="rank">'+esc(x.rang||'—')+'</span></td><td>'+esc(x.driver||x.jockey||'—')+'</td></tr>').join('')+'</tbody></table></div>'
    :'<div class="empty">Aucune performance détaillée renseignée pour le moment.</div>';
  const te=eng.length
    ?'<div class="table-wrap"><table class="perf-table"><thead><tr><th>Date</th><th>Hippodrome</th><th>Heure</th><th>Épreuve</th></tr></thead><tbody>'+eng.map(x=>'<tr><td>'+esc(dateFR(x.date))+'</td><td>'+esc(x.hippodrome)+'</td><td><span class="rank">'+esc(x.heure||'—')+'</span></td><td>'+esc(x.type||'Course')+'</td></tr>').join('')+'</tbody></table></div>'
    :'<div class="empty">Aucun prochain engagement renseigné.</div>';
  document.title=p.name+' | Écurie Initial';
  $('#app').innerHTML=header()
    +'<main class="shell">'
      +'<div class="breadcrumb"><a href="'+base+'index.html">Nos chevaux</a> / '+esc(p.name)+'</div>'
      +'<div class="hero">'
        +photoMarkup(p,'hero')
        +'<div class="hero-info">'
          +'<span class="eyebrow">Écurie Initial · Fiche cheval</span>'
          +'<h1>'+esc(p.name)+'</h1>'
          +'<div class="orange-line"></div>'
          +'<span class="tag">'+esc(p.discipline)+'</span> '
          +(isRest?'<span class="tag rest">Au repos</span>':'')
          +'<p class="driver">Entraîneur : '+esc(p.trainer||'—')+'</p>'
        +'</div>'
      +'</div>'
      +'<div class="summary">'+stats(valueLabel,value)+stats('Gains en carrière',gains)+'</div>'
      +'<section class="section">'
        +'<h2 class="section-title">Dernières performances</h2>'
        +'<div class="paper">'+tr+'</div>'
      +'</section>'
      +'<section class="section">'
        +'<h2 class="section-title">Prochains engagements</h2>'
        +'<div class="paper">'+te+'</div>'
      +'</section>'
      +'<div class="bottom-actions">'
        +'<a class="action primary" href="'+base+'index.html">← Tous nos chevaux</a>'
        +'<a class="action secondary" href="https://www.ecurie-initial.com/">Site de l’Écurie Initial</a>'
      +'</div>'
    +'</main>'+footer();
}

load().then(s=>{if(document.body.dataset.page==='fiche')horse(s);else catalog(s)}).catch(err=>{console.error(err);$('#app').innerHTML=header()+'<main class="shell"><div class="error"><h1>Informations temporairement indisponibles</h1><p>Le catalogue n’a pas pu être chargé. Réessayez en actualisant la page.</p><p><a href="https://www.ecurie-initial.com/">Retour au site officiel</a></p></div></main>'+footer()});
})();