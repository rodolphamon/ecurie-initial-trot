// Interactions privées : les droits sont contrôlés par Supabase, jamais par le navigateur seul.
export function attachPrivateNewsReactions(host,db,{column,postId,userId,admin=false}){
 const table='ei_private_news_reactions';
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
 const wrap=make('section',undefined,'ei-news-reactions');
 const actions=make('div',undefined,'ei-news-reaction-actions');
 const heart=make('button','♡ J’aime');heart.type='button';heart.disabled=true;heart.setAttribute('aria-pressed','false');
 const toggle=make('button','💬 Commenter');toggle.type='button';toggle.setAttribute('aria-expanded','false');
 const status=make('p','','ei-news-reaction-status');status.setAttribute('role','status');
 const panel=make('div');panel.hidden=true;
 const list=make('div',undefined,'ei-news-comments');
 const form=make('form',undefined,'ei-news-comment-form');
 const field=make('textarea');field.rows=2;field.maxLength=1500;field.required=true;field.placeholder='Écrire un petit mot…';field.setAttribute('aria-label','Écrire un commentaire');
 const send=make('button','Envoyer');send.type='submit';send.disabled=true;
 form.append(field,send);panel.append(list,form);actions.append(heart,toggle);wrap.append(actions,status,panel);host.append(wrap);
 let rows=[],ready=false,busy=false;
 function draw(){
  const likes=rows.filter(r=>r.type==='heart'),comments=rows.filter(r=>r.type==='comment'),mine=likes.some(r=>r.auteur_id===userId);
  heart.textContent=(mine?'❤️':'♡')+' J’aime'+(likes.length?' ('+likes.length+')':'');
  heart.setAttribute('aria-pressed',String(mine));
  toggle.textContent='💬 Commenter'+(comments.length?' ('+comments.length+')':'');
  list.replaceChildren();
  if(!comments.length)list.append(make('p','Soyez le premier à laisser un petit mot.','ei-news-reaction-status'));
  for(const c of comments){
   const item=make('div',undefined,'ei-news-comment');
   item.append(make('strong',c.auteur_nom),make('small',' · '+new Date(c.created_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})),make('p',c.contenu));
   if(c.auteur_id===userId||admin){
    const del=make('button','Supprimer');del.type='button';del.className='ei-news-comment-delete';
    del.onclick=async()=>{if(busy||!confirm('Supprimer ce commentaire ?'))return;await change(async()=>db.from(table).delete().eq('id',c.id).eq(column,postId));};
    item.append(del);
   }
   list.append(item);
  }
 }
 async function load(){
  const all=[];let start=0;
  for(;;){
   const {data,error}=await db.from(table).select('id,auteur_id,auteur_nom,type,contenu,created_at').eq(column,postId).order('created_at').order('id').range(start,start+499);
   if(error)throw error;
   all.push(...data);if(data.length<500)break;start+=500;
  }
  rows=all;ready=true;draw();
 }
 function lock(value){busy=value;heart.disabled=value||!ready;send.disabled=value||!ready;}
 async function refresh(){if(busy)return;lock(true);try{await load();status.textContent='';}catch(e){status.textContent='Commentaires momentanément indisponibles. Réessayez.';}finally{lock(false);}}
 async function change(action,onSuccess){
  if(busy||!ready)return;lock(true);status.textContent='';
  try{const {error}=await action();if(error)throw error;if(onSuccess)onSuccess();try{await load();}catch(e){status.textContent='Action enregistrée. Actualisez pour voir les échanges.';}}
  catch(e){status.textContent='Action impossible. Réessayez.';}finally{lock(false);}
 }
 heart.onclick=()=>{const own=rows.find(r=>r.type==='heart'&&r.auteur_id===userId);return change(()=>own?db.from(table).delete().eq('id',own.id).eq(column,postId):db.from(table).insert({[column]:postId,type:'heart'}));};
 toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)refresh();};
 form.onsubmit=e=>{e.preventDefault();const content=field.value.trim();if(!content)return;change(()=>db.from(table).insert({[column]:postId,type:'comment',contenu:content}),()=>{field.value='';});};
 if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();refresh();}},{rootMargin:'150px'});observer.observe(wrap);}else refresh();
}
const style=document.createElement('style');
style.textContent='.ei-news-reactions{border-top:1px solid #e6ded6;margin:12px 0 4px;padding-top:10px;white-space:normal}.ei-news-reaction-actions{display:flex;gap:8px;flex-wrap:wrap}.ei-news-reactions button{border:1px solid #e4d8cc;border-radius:9px;background:#fff;color:#3a3029;padding:8px 11px;font:600 13px Arial,sans-serif;cursor:pointer;margin:0}.ei-news-reactions button[aria-pressed=true]{color:#a52533;background:#fff2f2}.ei-news-reactions button:disabled{opacity:.5;cursor:default}.ei-news-reaction-status{font-size:12px;color:#69615a;margin:5px 0}.ei-news-reaction-status:empty{display:none}.ei-news-comment{background:#fff;border-radius:9px;margin:8px 0;padding:9px;overflow-wrap:anywhere}.ei-news-comment p{white-space:pre-wrap;margin:4px 0}.ei-news-comment small{color:#777;font-size:11px}.ei-news-comment-form{display:flex;gap:8px;align-items:center;margin-top:8px}.ei-news-comment-form textarea{box-sizing:border-box;width:100%;min-width:0;flex:1;border:1px solid #ddd;border-radius:9px;padding:8px;font:inherit;resize:vertical;background:white;color:#222}.ei-news-comment-form button{background:#171717;color:white;border-color:#171717}.ei-news-reactions .ei-news-comment-delete{font-size:11px;padding:4px 7px;color:#9a2521}.ei-news-reactions [hidden]{display:none!important}';
document.head.append(style);
