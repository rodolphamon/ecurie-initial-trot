// Recréer uniquement la connexion de ce navigateur, en conservant ses choix.
export async function repairPushConnection({registration,subscription,applicationServerKey,deviceToken,callServer,state=null}){
  let repair=state;
  if(!repair){
    if(!subscription)throw Error('Aucune connexion de notification à réparer sur ce téléphone.');
    const current=await callServer({action:'status',deviceToken,endpoint:subscription.endpoint});
    if(!current.active||!current.preferences)
      throw Error('Cette connexion n’est plus enregistrée. Rechargez la page des notifications.');
    repair={oldEndpoint:subscription.endpoint,preferences:{...current.preferences},subscription:null};
  }
  try{
    if(!repair.subscription){
      await subscription.unsubscribe();
      repair.subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
    }
    const saved=await callServer({action:'subscribe',deviceToken,
      subscription:repair.subscription.toJSON(),preferences:repair.preferences});
    if(repair.preferences.audience==='associate'&&saved.audience!=='associate')
      throw Error('Reconnectez-vous à votre compte pour terminer la réparation.');
    // Conserver l'ancienne inscription serveur tant que la nouvelle n'est pas
    // enregistrée. Les autres navigateurs et les autres appareils restent intacts.
    if(repair.oldEndpoint!==repair.subscription.endpoint){
      try{await callServer({action:'unsubscribe',deviceToken,endpoint:repair.oldEndpoint});}
      catch(_){/* L'ancien endpoint est déjà révoqué localement et expirera côté Push. */}
    }
    return {subscription:repair.subscription,preferences:repair.preferences,scope:saved.scope};
  }catch(error){
    const failure=new Error(error?.message||'Réparation momentanément indisponible.');
    // Une nouvelle tentative reprend l'enregistrement et conserve les choix,
    // sans recréer en boucle une connexion déjà obtenue auprès du navigateur.
    failure.repairState=repair;
    throw failure;
  }
}
