import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const allowed = new Set(["https://rodolphamon.github.io", "https://app.ecurie-initial.com", "https://fiches.ecurie-initial.com"]);
serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": allowed.has(origin) ? origin : "https://rodolphamon.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST" || !allowed.has(origin)) return reply(403, { error: "Origine non autorisée." });
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return reply(401, { error: "Connexion requise." });
    const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: userError } = await auth.auth.getUser(token);
    if (userError || !user) return reply(401, { error: "Session invalide." });
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: me, error: roleError } = await admin.from("associes").select("actif,administrateur").eq("user_id", user.id).single();
    if (roleError || !me?.actif || !me.administrateur) return reply(403, { error: "Accès administrateur requis." });
    const body = await req.json();
    if (body.action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const nom = String(body.nom || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || nom.length < 2 || nom.length > 100) return reply(400, { error: "Nom ou e-mail invalide." });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: "https://rodolphamon.github.io/ecurie-initial-trot/application/connexion/" });
      if (error || !data.user) return reply(400, { error: error?.message || "Invitation impossible." });
      const { error: saveError } = await admin.from("associes").insert({ user_id: data.user.id, nom_affiche: nom, actif: true, administrateur: false });
      if (saveError) return reply(500, { error: "Compte invité, mais activation incomplète. Vérifiez dans Supabase." });
      return reply(200, { ok: true, message: "Invitation envoyée." });
    }
    if (body.action === "set_active") {
      const id = String(body.user_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || id === user.id || typeof body.actif !== "boolean") return reply(400, { error: "Modification non autorisée." });
      const { data: target, error: targetError } = await admin.from("associes").select("administrateur").eq("user_id", id).single();
      if (targetError || !target || target.administrateur) return reply(403, { error: "Un administrateur ne peut pas être suspendu ici." });
      const { error } = await admin.from("associes").update({ actif: body.actif }).eq("user_id", id);
      if (error) return reply(500, { error: "Mise à jour impossible." });
      return reply(200, { ok: true });
    }
    return reply(400, { error: "Action inconnue." });
  } catch { return reply(400, { error: "Requête invalide." }); }
});
