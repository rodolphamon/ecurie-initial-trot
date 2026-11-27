/* Invitation Push : uniquement sur un appareil sans abonnement local,
   après validation de l'accès à l'application. Aucun envoi de test. */
const API='https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/notifications';
const KEY='sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3';
const TOKEN='ei-push-device-token-v1';
const CHOICE='ei-push-onboarding-choice-v1';
const base=new URL('./',import.meta.url);
const read=key=>{try{return localStorage.getItem(key)}catch(_){return null}};
const write=(key,value)=>{try{localStorage.setItem(key,value)}catch(_){}};
const keyBytes=str=>Uint8Array.from(atob((str+'='.repeat((4-str.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let checking=false,displayed=false;
export async function offerPushOnboarding(db){
 if(checking||displayed||document.hidden||window.self!==window.top)return;
 if(read(CHOICE)==='off'||Number(read(CHOICE))>Date.now())return;
 checking=true;
 try{
  const {data:{session},error}=await db.auth.getSession();
  if(error||!session?.user)return;
  const {data:member,error:memberError}=await db.from('associes').select('actif,type_compte,notification_scope').eq('user_id',session.user.id).maybeSingle();
  if(memberError||!member?.actif||!['associe','observateur','exterieur','presse'].includes(member.type_compte))return;
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=!!(window.matchMedia?.('(display-mode: standalone)')?.matches||navigator.standalone===true);
  const supported='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  if(!supported&&!(ios&&!installed))return;
  if(supported&&Notification.permission==='denied')return;
  let registration=null,publicKey=null;
  if(supported&&!(ios&&!installed)){
   registration=await navigator.serviceWorker.register(new URL('sw.js',base).href,{scope:base.href,updateViaCache:'none'});
   if(!registration.active)registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service indisponible')),5000))]);
   // Ne jamais écraser les préférences d'un abonnement existant.
   if(await registration.pushManager.getSubscription())return;
   const response=await fetch(API,{headers:{apikey:KEY},cache:'no-store'});
   const config=await response.json();
   if(!response.ok||!config.publicKey)return;
   publicKey=config.publicKey;
  }
  if(document.hidden||document.body.classList.contains('ei-prelaunch'))return;
  const isMember=['associe','observateur'].includes(member.type_compte);
  const dialog=document.createElement('section');
  dialog.setAttribute('aria-labelledby','ei-push-offer-title');
  dialog.style.cssText='background:#fff;border:2px solid #f47721;border-radius:14px;padding:17px;margin:10px 0 15px;color:#222;text-align:center;box-shadow:0 2px 8px #0000000d';
  dialog.innerHTML='<h2 id="ei-push-offer-title" style="font-size:20px;margin:0 0 8px">🔔 Ne manquez rien de l’Écurie Initial !</h2><p style="margin:0 0 12px;font-size:14px;line-height:1.45">Recevez les prochains partants, les rappels avant les courses, les résultats et les actualités'+(isMember?' de vos chevaux':' de l’Écurie')+'.</p><button type="button" data-enable style="display:block;width:100%;background:#f47721;border:0;border-radius:9px;padding:13px;font-size:16px;font-weight:800;color:#171717;cursor:pointer">Activer mes notifications</button><p data-info role="status" style="font-size:13px;margin:8px 0"></p><div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap"><button type="button" data-later style="background:none;border:0;color:#555;font-size:13px;text-decoration:underline;padding:8px;cursor:pointer">Plus tard</button><button type="button" data-no style="background:none;border:0;color:#555;font-size:13px;text-decoration:underline;padding:8px;cursor:pointer">Non merci</button></div><p style="font-size:12px;color:#666;margin:7px 0 0">Vous pourrez modifier vos choix à tout moment dans Notifications.</p>';
  const enable=dialog.querySelector('[data-enable]'),info=dialog.querySelector('[data-info]'),later=dialog.querySelector('[data-later]'),no=dialog.querySelector('[data-no]');
  const dismiss=value=>{write(CHOICE,value);dialog.remove();};
  later.onclick=()=>dismiss(String(Date.now()+3*86400000));
  no.onclick=()=>dismiss(String(Date.now()+30*86400000));
  if(ios&&!installed){
   enable.textContent='Installer l’application';
   info.textContent='Sur iPhone, les notifications nécessitent l’application ajoutée à l’écran d’accueil.';
   enable.onclick=()=>{location.href=new URL('installation/',base).href;};
  }else{
   let pending=null;
   enable.onclick=async()=>{
    enable.disabled=true;later.disabled=true;no.disabled=true;info.textContent='';
    try{
     // Demande système directement liée au clic de l'utilisateur.
     if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted'){
      if(Notification.permission==='denied'){dismiss('off');return;}
      info.textContent='Autorisation non accordée. Vous pourrez réessayer.';return;
     }
     const {data:{session:current}}=await db.auth.getSession();
     if(current?.user?.id!==session.user.id||!current.access_token)throw Error('Reconnectez-vous avant d’activer les notifications.');
     const existing=await registration.pushManager.getSubscription();
     if(existing&&!pending){dialog.remove();return;}
     pending=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
     let token=read(TOKEN);
     if(!token){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(TOKEN,token);}
     const {data:fresh,error:roleError}=await db.from('associes').select('actif,type_compte,notification_scope').eq('user_id',current.user.id).maybeSingle();
     if(roleError||!fresh?.actif||fresh.type_compte!==member.type_compte)throw Error('Votre compte a changé. Rechargez l’application.');
     const preferences={scope:isMember?(fresh.notification_scope==='all'?'all':'mine'):'all',confirmed:isMember,daily:true,before15:true,results:true,withdrawn:isMember,private_news:isMember,general_news:isMember,public_news:true};
     const res=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',apikey:KEY,Authorization:'Bearer '+current.access_token},body:JSON.stringify({action:'subscribe',deviceToken:token,subscription:pending.toJSON(),preferences}),cache:'no-store'});
     const result=await res.json().catch(()=>({}));
     if(!res.ok||!result.ok)throw Error(result.error||'Activation impossible pour le moment.');
     try{localStorage.removeItem(CHOICE)}catch(_){}
     enable.hidden=true;later.hidden=true;no.hidden=true;info.textContent='✓ Vos notifications sont activées sur cet appareil.';
     window.dispatchEvent(new Event('ei-push-device-changed'));
    }catch(e){info.textContent=e.message||'Activation impossible. Réessayez ou ouvrez Notifications.';}
    finally{enable.disabled=false;later.disabled=false;no.disabled=false;}
   };
  }
  const host=document.getElementById('appContent');
  if(host&&!host.hidden){host.insertBefore(dialog,host.firstChild);displayed=true;}
 }catch(_){/* Ne pas bloquer l'accueil en cas de problème réseau. */}
 finally{checking=false;}
}
