import { createClient } from "npm:@supabase/supabase-js@2";
import { publicPerformance } from "./projection.ts";
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(["https://fiches.ecurie-initial.com","https://rodolphamon.github.io"]);
Deno.serve(async(req)=>{
 const origin=req.headers.get("origin");
 const headers={"Access-Control-Allow-Origin":origin&&origins.has(origin)?origin:"https://fiches.ecurie-initial.com","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type,apikey,Authorization","Vary":"Origin","Cache-Control":"no-store","Content-Type":"application/json"};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="GET")return reply({error:"Method not allowed"},405);
 const {data,error}=await db.from("ei_push_alerts").select("cheval_slug,payload,created_at").eq("categorie","results").filter("payload->>official","eq","true").filter("payload->>pilotTest","eq","false").order("created_at",{ascending:false}).limit(250);
 if(error)return reply({error:"Results unavailable"},503);
 const results:Record<string,unknown[]>={};
 for(const row of data||[]){
   const p=row.payload||{},slug=row.cheval_slug;
   if(typeof slug!=="string"||!/^[a-z0-9-]+$/.test(slug))continue;
   const result=publicPerformance(p);
   if(!result)continue;
   (results[slug]??=[]).push(result);
 }
 return reply({performances:results});
});
