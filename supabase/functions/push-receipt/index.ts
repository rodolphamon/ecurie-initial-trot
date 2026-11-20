import { createClient } from "npm:@supabase/supabase-js@2";
const sb=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{persistSession:false,autoRefreshToken:false}});
const allowed=new Set(["https://fiches.ecurie-initial.com","https://rodolphamon.github.io"]);
const headers=(origin:string|null)=>({
 "Access-Control-Allow-Origin":allowed.has(origin||"")?origin!:"https://fiches.ecurie-initial.com",
 "Access-Control-Allow-Methods":"POST,OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type",
 "Vary":"Origin",
 "Cache-Control":"no-store",
});
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:headers(origin)});
 if(req.method!=="POST" || (origin && !allowed.has(origin)))return Response.json({error:"Non autorisé"},{status:403,headers:headers(origin)});
 try{
   const {id,status,at,error}=await req.json();
   if(typeof id!=="string"|| !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
     ||!["received","shown","error"].includes(status))return Response.json({error:"Données invalides"},{status:400,headers:headers(origin)});
   // Un client ne peut modifier que les horodatages d'un accusé existant.
   // Les notifications périmées n'acceptent plus de télémétrie.
   const {data:receipt,error:readError}=await sb.from("ei_push_receipts")
     .select("id,created_at,received_at,shown_at,display_error").eq("id",id).maybeSingle();
   if(readError)throw readError;
   if(!receipt || Date.now()-Date.parse(receipt.created_at)>7*86400000)return Response.json({ok:false},{status:404,headers:headers(origin)});
   const measuredAt=(typeof at==="string" && Math.abs(Date.parse(at)-Date.now())<10*60*1000)
     ?new Date(at).toISOString():new Date().toISOString();
   const changes:Record<string,unknown>={};
   if(status==="received"&&!receipt.received_at)changes.received_at=measuredAt;
   if(status==="shown"&&!receipt.shown_at)changes.shown_at=measuredAt;
   if(status==="error"&&!receipt.display_error)changes.display_error=String(error||"Erreur affichage").slice(0,90);
   if(Object.keys(changes).length){
     const {error:updateError}=await sb.from("ei_push_receipts").update(changes).eq("id",id);
     if(updateError)throw updateError;
   }
   return Response.json({ok:true},{headers:headers(origin)});
 }catch(e){
   console.error("Push receipt",e instanceof Error?e.name:"unknown");
   return Response.json({error:"Enregistrement indisponible"},{status:500,headers:headers(origin)});
 }
});