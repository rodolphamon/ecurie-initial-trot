// Service Worker de l'application Écurie Initial.
// Cache minimal ; aucun contenu privé conservé volontairement en cache.
const CACHE='ei-app-shell-v18';
const WORKER_VERSION='20261127-push-v18';
// Le cache facultatif ne doit pas laisser une mise à jour en installation
// ou en activation indéfiniment si le stockage du navigateur se bloque.
function optionalWork(work,ms=3000){
  let timer;
  return Promise.race([Promise.resolve().then(work).catch(()=>{}),
    new Promise(resolve=>{timer=setTimeout(resolve,ms)})]).finally(()=>clearTimeout(timer));
}
self.addEventListener('message',event=>{
  if(event.data?.type==='ei-push-worker-info'&&event.ports?.[0])
    event.ports[0].postMessage({version:WORKER_VERSION});
});
self.addEventListener('install',event=>{
  // Un échec du cache hors ligne ou d'une icône ne doit pas empêcher
  // l'installation du correctif de réception Push.
  event.waitUntil(Promise.all([self.skipWaiting(),optionalWork(async()=>{
      const cache=await caches.open(CACHE);
      await Promise.allSettled(['./','manifest.webmanifest','icon-ei-192.png','notification-ei-badge.png','notification-transparent-192.png'].map(url=>cache.add(url)));
  })]));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([optionalWork(()=>self.clients.claim()),optionalWork(async()=>{
    for(const k of await caches.keys())if(k.startsWith('ei-app-')&&k!==CACHE)await caches.delete(k);
  })]));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  // Pas de cache des comptes privés, des requêtes Supabase ou des paramètres.
  const url=new URL(event.request.url);
  if(url.pathname.includes('/application/connexion/')||url.pathname.includes('/application/administration/')||
     url.pathname.includes('/application/mes-chevaux/')||url.pathname.includes('/application/tribune/')||
     url.pathname.includes('/application/notifications/'))return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
// Diagnostic limité à ce navigateur : horodatage et résultat d'affichage seulement.
function recordPushStatus(status,error,details){
  return new Promise(resolve=>{
    try{
      const open=indexedDB.open('ei-push-debug-v1',1);
      open.onupgradeneeded=()=>{
        if(!open.result.objectStoreNames.contains('events'))open.result.createObjectStore('events');
      };
      open.onerror=()=>resolve();
      open.onblocked=()=>resolve();
      open.onsuccess=()=>{
        const db=open.result;
        const tx=db.transaction('events','readwrite');
        const entry={at:new Date().toISOString(),status,error:error||null,...(details||{})};
        const store=tx.objectStore('events');
        store.put(entry,'last');
        if(status==='received')store.put(entry,'last_received');
        if(status==='shown'||status==='error')store.put(entry,'last_display');
        if(status==='click-opened'||status==='click-failed')store.put(entry,'last_click');
        tx.oncomplete=()=>{db.close();resolve()};
        tx.onerror=()=>{db.close();resolve()};
        tx.onabort=()=>{db.close();resolve()};
      };
    }catch(_){resolve()}
  });
}
// Accusés de réception facultatifs : un serveur indisponible ne doit jamais
// empêcher l'affichage d'une notification.
// Durable outbox: each receipt is independent, including received and shown.
function receiptStore(mode, action){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open('ei-push-outbox-v1',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('receipts',{keyPath:'key'});
  req.onerror=()=>reject(req.error); req.onblocked=()=>reject(new Error('blocked'));
  req.onsuccess=()=>{
   const db=req.result; let tx;
   try{tx=db.transaction('receipts',mode); const op=action(tx.objectStore('receipts'));
    tx.oncomplete=()=>{db.close();resolve(op.result)};
    tx.onerror=tx.onabort=()=>{db.close();reject(tx.error)};
   }catch(e){db.close();reject(e)}
  };
 });
}
async function transmitReceipt(entry){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch('https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/push-receipt',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({id:entry.id,status:entry.status,at:entry.at,error:entry.error}),
   cache:'no-store',signal:controller.signal
  });
  if(response.ok)await optionalWork(()=>receiptStore('readwrite',s=>s.delete(entry.key)),1000);
 }catch(_){}finally{clearTimeout(timer)}
}
async function reportPushReceipt(id,status,at,error){
 if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return;
 const entry={key:id+':'+status,id,status,at,error:error||null};
 await optionalWork(()=>receiptStore('readwrite',s=>s.put(entry)),800);
 await transmitReceipt(entry);
}
async function flushReceipts(){
 let entries=[];
 await optionalWork(async()=>{entries=await receiptStore('readonly',s=>s.getAll())},800);
 const cutoff=Date.now()-7*86400000;
 const expired=entries.filter(e=>Date.parse(e.at)<cutoff);
 await optionalWork(()=>Promise.all(expired.map(e=>receiptStore('readwrite',s=>s.delete(e.key)))),800);
 await Promise.allSettled(entries.filter(e=>Date.parse(e.at)>=cutoff).slice(0,12).map(transmitReceipt));
}
self.addEventListener('message',event=>{
 if(event.data?.type==='ei-push-worker-info')event.waitUntil(optionalWork(flushReceipts,6500));
});
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload={};
    try{payload=event.data?event.data.json():{}}catch{payload={}}
    const title=typeof payload.title==='string'?payload.title:'Écurie Initial';
    const body=typeof payload.body==='string'?payload.body:'Une nouvelle information est disponible.';
    let url='/application/';
    try{
      const target=new URL(payload.url||url,self.location.origin);
      if(target.origin===self.location.origin)url=target.href;
    }catch{}
    const receiptId=typeof payload.receipt_id==='string'?payload.receipt_id:null;
    const receivedAt=new Date().toISOString();
    // Afficher en priorité : aucun accès au stockage ni au réseau avant showNotification.
    let displayTask;
    try{
      displayTask=Promise.resolve(self.registration.showNotification(title,{
        body,
        icon:'/application/notification-transparent-192.png', // L'icône système officielle reste à gauche, pas de second logo à droite.
        badge:'/application/notification-ei-badge.png',
        tag:typeof payload.tag==='string'?payload.tag:undefined,
        data:{url},renotify:false
      }));
    }catch(e){displayTask=Promise.reject(e)}
    // Ne pas attendre la résolution de showNotification pour constater la
    // réception : l'affichage peut lui-même rester bloqué dans le système.
    const receivedReport=reportPushReceipt(receiptId,'received',receivedAt);
    const localReceived=recordPushStatus('received',null,{at:receivedAt,version:WORKER_VERSION});
    let displayStatus='shown',displayError=null;
    let displayTimer;
    try{await Promise.race([displayTask,new Promise((_,reject)=>{displayTimer=setTimeout(()=>reject(new Error('display-timeout')),12000)})])}catch(e){
      displayStatus='error';displayError=e?.message==='display-timeout'?'display-timeout':e instanceof Error?e.name:'erreur d’affichage';
    }finally{clearTimeout(displayTimer)}
    const displayAt=new Date().toISOString();
    const local=recordPushStatus(displayStatus,displayError,{at:displayAt,version:WORKER_VERSION});
    let timer;
    try{
      await Promise.race([Promise.allSettled([localReceived,local,receivedReport,
        reportPushReceipt(receiptId,displayStatus,displayAt,displayError),flushReceipts()]),
        new Promise(resolve=>{timer=setTimeout(resolve,7500)})]);
    }finally{clearTimeout(timer);}
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    // Conserver le chemin, le ?info=... et l'ancre #nouvelles-privees.
    // Refuser les domaines extérieurs, pour qu'une notification ne puisse
    // jamais rediriger vers un site arbitraire.
    const fallback=new URL('/application/',self.location.origin);
    let target=fallback;
    try{
      const candidate=new URL(event.notification.data?.url||fallback.href,self.location.origin);
      if(candidate.origin===self.location.origin&&/^https?:$/.test(candidate.protocol))target=candidate;
    }catch(_){}
    const route=target.pathname+target.search+target.hash;
    let lastError='Aucune fenêtre disponible';
    let windows=[];
    try{windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});}
    catch(error){lastError=String(error?.message||error);}
    const sameOrigin=windows.filter(client=>{
      try{return new URL(client.url).origin===self.location.origin}catch(_){return false}
    });
    // Préférer une fenêtre de l'application, pas un onglet quelconque du site.
    const candidates=[
      ...sameOrigin.filter(client=>client.url.startsWith(self.location.origin+'/application/')),
      ...sameOrigin.filter(client=>!client.url.startsWith(self.location.origin+'/application/'))
    ];
    for(const client of candidates){
      try{
        if(client.url===target.href){
          await client.focus();
          await recordPushStatus('click-opened',null,{route,method:'focus'});
          return;
        }
        if(typeof client.navigate==='function'){
          const navigated=await client.navigate(target.href);
          if(navigated){
            await navigated.focus();
            await recordPushStatus('click-opened',null,{route,method:'navigate'});
            return;
          }
          lastError='Navigation refusée par le navigateur';
        }
      }catch(error){lastError=String(error?.message||error)}
    }
    // Repli indispensable sur iOS et si navigate() échoue dans une PWA.
    try{
      const opened=await self.clients.openWindow(target.href);
      if(opened){
        await opened.focus();
        await recordPushStatus('click-opened',null,{route,method:'openWindow'});
        return;
      }
      lastError='Ouverture refusée par le téléphone';
    }catch(error){lastError=String(error?.message||error)}
    await recordPushStatus('click-failed',lastError,{route,method:'none'});
  })());
});
