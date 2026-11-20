import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushNotification } from "npm:@mmmike/web-push/send";

const ORIGINS = new Set(["https://fiches.ecurie-initial.com", "https://www.ecurie-initial.com"]);
const url = Deno.env.get("SUPABASE_URL") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(url, serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function respond(payload: unknown, status:number, origin:string|null){
 const headers:Record<string,string>={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Vary":"Origin"};
 if(origin&&ORIGINS.has(origin)){headers["Access-Control-Allow-Origin"]=origin;headers["Access-Control-Allow-Headers"]="authorization,content-type,apikey,x-client-info";headers["Access-Control-Allow-Methods"]="GET,POST,OPTIONS";}
 return new Response(JSON.stringify(payload),{status,headers});
}
function clean(x:unknown,max:number){return typeof x==="string"?x.trim().slice(0,max+1):"";}
async function digest(x:string){
 const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serviceKey+"|"+x));
 return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function currentUser(req:Request){
 const jwt=req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
 if(!jwt)return null;
 const {data,error}=await admin.auth.getUser(jwt);
 return error?null:(data?.user||null);
}
async function notifyUser(userId:string){
 try{
  const publicKey=Deno.env.get("PUSH_VAPID_PUBLIC_KEY")||"";
  const privateKey=Deno.env.get("PUSH_VAPID_PRIVATE_KEY")||"";
  if(!publicKey||!privateKey)return;
  const {data:subs,error}=await admin.from("ei_push_subscriptions").select("endpoint,p256dh,auth_secret").eq("user_id",userId).eq("confirmed",true).limit(15);
  if(error||!subs?.length)return;
  await Promise.allSettled(subs.map(s=>sendPushNotification(
   {endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth_secret}},
   {title:"✉️ Team Initial · Message privé",body:"Vous avez reçu un nouveau message dans votre boîte privée.",url:"https://fiches.ecurie-initial.com/application/team-initial/"},
   {publicKey,privateKey,subject:"mailto:contact@ecurie-initial.com"},
   {urgency:"normal",ttl:3600}
  )));
 }catch(e){console.warn("Notification Team Initial indisponible");}
}
async function findThread(id:string,userId:string){
 const {data,error}=await admin.from("ei_team_messages")
  .select("id,sender_user_id,recipient_user_id").eq("id",id).maybeSingle();
 if(error)throw error;
 if(!data||!(data.recipient_user_id===userId||data.sender_user_id===userId))return null;
 return data;
}
Deno.serve(async req=>{
 const origin=req.headers.get("Origin");
 if(req.method==="OPTIONS"){
  const headers=new Headers({"Access-Control-Allow-Headers":"authorization,content-type,apikey,x-client-info",
   "Access-Control-Allow-Methods":"GET,POST,OPTIONS","Vary":"Origin"});
  if(origin&&ORIGINS.has(origin))headers.set("Access-Control-Allow-Origin",origin);
  return new Response(null,{status:204,headers});
 }
 if(origin&&!ORIGINS.has(origin))return respond({error:"Origine refusée."},403,origin);
 if(!serviceKey||!url)return respond({error:"Service indisponible."},503,origin);
 try{
  const user=await currentUser(req);
  if(!user||!user.email||!user.email_confirmed_at)
   return respond({error:"Connectez-vous avec un compte confirmé pour utiliser la messagerie privée."},401,origin);
  if(req.method==="GET"){
   if(new URL(req.url).searchParams.get("action")!=="inbox")
    return respond({error:"Action inconnue."},404,origin);
   const {data:threads,error:threadError}=await admin.from("ei_team_messages")
    .select("id,sender_name,message,created_at,read_at,sender_user_id,recipient_user_id")
    .or("recipient_user_id.eq."+user.id+",sender_user_id.eq."+user.id)
    .order("created_at",{ascending:false}).limit(100);
   if(threadError)throw threadError;
   const ids=(threads||[]).map(x=>x.id);
   let replies:Array<{id:string;message_id:string;author_user_id:string;body:string;created_at:string;read_at:string|null}>=[];
   if(ids.length){
    const {data,error}=await admin.from("ei_team_message_replies")
     .select("id,message_id,author_user_id,body,created_at,read_at")
     .in("message_id",ids).order("created_at",{ascending:true}).limit(1000);
    if(error)throw error;
    replies=data||[];
   }
   const {data:people,error:peopleError}=await admin.from("ei_team_recipients")
    .select("user_id,display_name").eq("active",true);
   if(peopleError)throw peopleError;
   const names=new Map((people||[]).map(x=>[x.user_id,x.display_name]));
   const result=(threads||[]).map(t=>{
    const direction=t.recipient_user_id===user.id?"received":"sent";
    const list=replies.filter(x=>x.message_id===t.id);
    const unread=(direction==="received"&&!t.read_at)
      ||list.some(x=>x.author_user_id!==user.id&&!x.read_at);
    const peerId=direction==="received"?t.sender_user_id:t.recipient_user_id;
    return {id:t.id,direction,peer_id:peerId||t.id,
      sender_name:direction==="received"?t.sender_name:"Vous",
      correspondent:names.get(peerId)|| (direction==="received"?t.sender_name:"Team Initial"),
      message:t.message,created_at:t.created_at,unread:Boolean(unread),
      replies:list.map(x=>({id:x.id,by_me:x.author_user_id===user.id,body:x.body,created_at:x.created_at}))};
   });
   result.sort((a,b)=>new Date((b.replies.at(-1)?.created_at)||b.created_at).getTime()-new Date((a.replies.at(-1)?.created_at)||a.created_at).getTime());
   return respond({ok:true,messages:result},200,origin);
  }
  if(req.method!=="POST")return respond({error:"Méthode non autorisée."},405,origin);
  if(Number(req.headers.get("content-length")||0)>9000)return respond({error:"Message trop long."},413,origin);
  let payload:Record<string,unknown>;
  try{payload=await req.json()}catch{return respond({error:"Données invalides."},400,origin);}
  if(payload.action==="mark_read"){
   const id=clean(payload.id,40);
   if(!UUID.test(id))return respond({error:"Conversation invalide."},400,origin);
   const thread=await findThread(id,user.id);
   if(!thread)return respond({error:"Conversation non autorisée."},403,origin);
   const timestamp=new Date().toISOString();
   if(thread.recipient_user_id===user.id){
    const {error}=await admin.from("ei_team_messages").update({read_at:timestamp}).eq("id",id).eq("recipient_user_id",user.id);
    if(error)throw error;
   }
   const {error:replyError}=await admin.from("ei_team_message_replies")
    .update({read_at:timestamp}).eq("message_id",id)
    .neq("author_user_id",user.id).is("read_at",null);
   if(replyError)throw replyError;
   return respond({ok:true},200,origin);
  }
  if(payload.action==="reply"){
   const id=clean(payload.id,40);
   const body=clean(payload.message,3000);
   if(!UUID.test(id)||body.length<1||body.length>3000)
    return respond({error:"Rédigez une réponse de 1 à 3 000 caractères."},400,origin);
   const thread=await findThread(id,user.id);
   if(!thread)return respond({error:"Conversation non autorisée."},403,origin);
   const tenMinutesAgo=new Date(Date.now()-10*60*1000).toISOString();
   const {count,error:rateError}=await admin.from("ei_team_message_replies")
    .select("id",{count:"exact",head:true}).eq("author_user_id",user.id).gte("created_at",tenMinutesAgo);
   if(rateError)throw rateError;
   if((count||0)>=10)return respond({error:"Trop de réponses rapprochées. Réessayez dans quelques minutes."},429,origin);
   const {data:reply,error}=await admin.from("ei_team_message_replies")
    .insert({message_id:id,author_user_id:user.id,body}).select("id,body,created_at").single();
   if(error||!reply)throw error||new Error("Insertion impossible");
   const other=thread.recipient_user_id===user.id?thread.sender_user_id:thread.recipient_user_id;
   if(other&&other!==user.id)await notifyUser(other);
   return respond({ok:true,reply:{...reply,by_me:true},message:"Réponse envoyée dans la messagerie privée."},200,origin);
  }
  if(payload.action!=="send")return respond({error:"Action inconnue."},400,origin);
  if(clean(payload.website,200))return respond({error:"Formulaire invalide."},400,origin);
  const key=clean(payload.recipient,30);
  const name=clean(payload.name,100);
  const message=clean(payload.message,3000);
  if(!/^(rodolphe|arnaud|nicolas|emilie)$/.test(key)||name.length<2||name.length>100||message.length<5||message.length>3000)
   return respond({error:"Indiquez votre nom et votre message (5 caractères minimum)."},400,origin);
  const {data:target,error:targetError}=await admin.from("ei_team_recipients")
   .select("user_id,display_name").eq("recipient_key",key).eq("active",true).maybeSingle();
  if(targetError||!target)return respond({error:"Destinataire temporairement indisponible."},503,origin);
  if(user.id===target.user_id)return respond({error:"Vous ne pouvez pas vous écrire à vous-même."},400,origin);
  const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-real-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]||"unknown").trim().slice(0,120);
  const [ipHash,emailHash]=await Promise.all([digest("ip:"+ip),digest("email:"+user.email.toLowerCase())]);
  const hourAgo=new Date(Date.now()-60*60*1000).toISOString();
  const dayAgo=new Date(Date.now()-24*60*60*1000).toISOString();
  const [rateIp,rateEmail]=await Promise.all([
   admin.from("ei_team_messages").select("id",{count:"exact",head:true}).eq("sender_ip_hash",ipHash).gte("created_at",hourAgo),
   admin.from("ei_team_messages").select("id",{count:"exact",head:true}).eq("sender_email_hash",emailHash).gte("created_at",dayAgo)
  ]);
  if(rateIp.error||rateEmail.error)throw (rateIp.error||rateEmail.error);
  if((rateIp.count||0)>=3||(rateEmail.count||0)>=5)
   return respond({error:"Trop de messages récents. Réessayez plus tard."},429,origin);
  const {data:msg,error:saveError}=await admin.from("ei_team_messages")
   .insert({recipient_user_id:target.user_id,sender_user_id:user.id,sender_name:name,
     sender_email:user.email,sender_ip_hash:ipHash,sender_email_hash:emailHash,message})
   .select("id").single();
  if(saveError||!msg)throw saveError||new Error("Écriture impossible");
  await notifyUser(target.user_id);
  return respond({ok:true,message:"Message transmis à "+target.display_name+". Vous retrouverez sa réponse dans « Mes messages »."},200,origin);
 }catch(error){console.error("Team private messages",error instanceof Error?error.name:"error");return respond({error:"Messagerie momentanément indisponible. Réessayez."},500,origin);}
});
