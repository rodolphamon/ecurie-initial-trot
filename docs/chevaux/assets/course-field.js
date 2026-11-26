(function(){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const venue=value=>({'PARISLONGCHAMP':'LONGCHAMP','PARIS LONGCHAMP':'LONGCHAMP','DEAUVILLE CLAIREFONTAINE':'CLAIREFONTAINE','ROYAN ATLANTIQUE':'ROYAN LA PALMYRE'}[norm(value)]||norm(value));
function markup(event,horse,courses,id){
  if(!['declare','partant'].includes(event.statut)||event.reunion_annulee)return '';
  const matches=courses.filter(c=>c.cheval_slug===horse.id&&c.date===event.date
    &&venue(c.hippodrome)===venue(event.hippodrome)
    &&(!event.course||String(event.course).toUpperCase()===c.course)
    &&Array.isArray(c.partants)&&c.partants.some(p=>norm(p.cheval)===norm(horse.name)
      &&(!event.numero||Number(event.numero)===p.numero)));
  const course=matches.length===1?matches[0]:null;
  const rows=course?course.partants.map(p=>'<tr'+(norm(p.cheval)===norm(horse.name)?' class="ei-field-current"':p.non_partant?' class="ei-field-non-partant"':'')+'><td>'+esc(p.numero)+'</td><td>'+esc(p.cheval)+(p.non_partant?' · Non partant':'')+'</td><td>'+esc(p.driver||p.jockey||'—')+'</td></tr>').join(''):'';
  return '<details class="ei-course-field"><summary>Partants de la course</summary>'+(course
    ?'<div class="ei-field-scroll" id="'+esc(id)+'" role="region" aria-label="Liste des partants, défilement horizontal" tabindex="0"><table class="ei-field-table"><thead class="ei-field-head"><tr><th>Numéro</th><th>Cheval</th><th>Monte</th></tr></thead><tbody>'+rows+'</tbody></table></div><input class="ei-field-slider" type="range" min="0" max="100" step="any" value="0" aria-label="Faire défiler les partants vers la droite ou la gauche" aria-controls="'+esc(id)+'" hidden>'
    :'<p class="ei-field-waiting">Liste officielle à venir.</p>')+'</details>';
}
function init(root=document){
  for(const view of root.querySelectorAll('.ei-course-field')){
    if(view.dataset.initialized)continue;
    view.dataset.initialized='true';
    const scroller=view.querySelector('.ei-field-scroll'),slider=view.querySelector('.ei-field-slider');
    if(!scroller||!slider)continue;
    const sync=()=>{const max=scroller.scrollWidth-scroller.clientWidth;slider.hidden=max<=1;slider.value=max>0?String(100*scroller.scrollLeft/max):'0';};
    scroller.addEventListener('scroll',sync,{passive:true});
    slider.addEventListener('input',()=>{scroller.scrollLeft=(scroller.scrollWidth-scroller.clientWidth)*Number(slider.value)/100;});
    view.addEventListener('toggle',sync);
    new ResizeObserver(sync).observe(scroller);
    sync();
  }
}
window.EICourseField={markup,init};
})();
