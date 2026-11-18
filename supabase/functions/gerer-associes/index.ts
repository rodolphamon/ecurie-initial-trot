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

    // Répertoire interne de référence : fiches préexistantes, sans création de compte ni e-mail.
    // Accessible uniquement après vérification du JWT et du rôle administrateur ci-dessus.
    if (body.action === "list_registry") {
      const { data: links, error } = await admin.from("affectations_proprietaires")
        .select("nom_associe,cheval_slug,cheval_nom").order("nom_associe").limit(1000);
      if (error) return reply(500, { error: "Impossible de charger le registre des associés." });
      const normalize = (value: string) => value.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
      const owners = new Map<string, { nom: string; horses: Array<{ cheval_slug: string; cheval_nom: string }> }>();
      for (const entry of links || []) {
        const raw = String(entry.nom_associe || "").trim();
        const original = normalize(raw);
        if (!raw || original === "ECURIE INITIAL") continue; // La société n'est pas un invité.
        // Correspondances confirmées par le gérant : éviter plusieurs invitations pour la même personne.
        const nom = original.includes("FRANXICANA") ? "Gilles MONINOT"
          : original.includes("DEFRANCE") ? "Nicolas DEFRANCE" : raw;
        const key = normalize(nom);
        const slug = String(entry.cheval_slug || "").trim();
        const horseName = String(entry.cheval_nom || "").trim();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !horseName) continue;
        let row = owners.get(key);
        if (!row) { row = { nom, horses: [] }; owners.set(key, row); }
        if (!row.horses.some(h => h.cheval_slug === slug)) {
          row.horses.push({ cheval_slug: slug, cheval_nom: horseName });
        }
      }
      const result = [...owners.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
      return reply(200, { ok: true, owners: result });
    }
    if (body.action === "invite") {
      // Aucune invitation avant la mise en place des règles RLS de préouverture.
      const { data: launchReady, error: launchError } = await admin.rpc("ei_lancement_pret");
      if (launchError || launchReady !== true) {
        return reply(503, { error: "Les inscriptions sont en préparation : vérification de la sécurité de préouverture nécessaire avant les invitations." });
      }
      const email = String(body.email || "").trim().toLowerCase();
      const nom = String(body.nom || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || nom.length < 2 || nom.length > 100) return reply(400, { error: "Nom ou e-mail invalide." });
      const accountType = String(body.type_compte || "associe");
      if (!["associe", "exterieur"].includes(accountType)) return reply(400, { error: "Type de compte invalide." });
      // Les chevaux sélectionnés sont attachés au compte créé ; ils ne vont jamais dans le dépôt public.
      const requested = body.horses ?? [];
      if (!Array.isArray(requested) || requested.length > 40) return reply(400, { error: "Sélection de chevaux invalide." });
      const horses: Array<{ cheval_slug: string; cheval_nom: string }> = [];
      const seen = new Set<string>();
      for (const h of requested) {
        if (!h || typeof h !== "object") return reply(400, { error: "Cheval invalide." });
        const slug = String(h.cheval_slug || "").trim();
        const name = String(h.cheval_nom || "").trim();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 110 || !name || name.length > 120 || seen.has(slug)) {
          return reply(400, { error: "La liste des participations contient une erreur ou un doublon." });
        }
        seen.add(slug);
        horses.push({ cheval_slug: slug, cheval_nom: name });
      }
      if (accountType === "exterieur" && horses.length) return reply(400, { error: "Un membre extérieur ne peut pas recevoir de participations aux chevaux." });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: "https://fiches.ecurie-initial.com/application/connexion/" });
      if (error || !data.user) return reply(400, { error: error?.message || "Invitation impossible." });
      const { error: saveError } = await admin.from("associes").insert({ user_id: data.user.id, nom_affiche: nom, actif: true, administrateur: false, type_compte: accountType });
      if (saveError) return reply(500, { error: "L'invitation a été envoyée, mais l'accès n'a pas pu être activé. Vérifiez ce compte dans Supabase ; ne réinvitez pas automatiquement." });
      if (horses.length) {
        const rows = horses.map((h) => ({ ...h, user_id: data.user.id }));
        const { error: attachError } = await admin.from("participations_chevaux").insert(rows);
        if (attachError) {
          return reply(500, { error: "L'invitation et le compte sont créés, mais les chevaux n'ont pas pu être rattachés. Utilisez le bouton « Chevaux » pour terminer, sans nouvelle invitation." });
        }
      }
      return reply(200, { ok: true, message: "Invitation envoyée au " + (accountType === "exterieur" ? "membre extérieur" : "compte associé") + ". Mot de passe activable maintenant ; ouverture le 1er décembre 2026. " + horses.length + " cheval(aux) rattaché(s).", chevaux_rattaches: horses.length });
    }
    if (body.action === "set_member_type") {
      const id = String(body.user_id || "");
      const accountType = String(body.type_compte || "");
      if (!/^[0-9a-f-]{36}$/i.test(id) || !["associe","exterieur"].includes(accountType))
        return reply(400, { error: "Type de compte invalide." });
      const {data:target,error:targetError}=await admin.from("associes")
        .select("administrateur").eq("user_id",id).maybeSingle();
      if(targetError || !target || target.administrateur)
        return reply(403,{error:"Le statut de ce compte ne peut pas être modifié."});
      if(accountType==="exterieur"){
        const {count,error:partsError}=await admin.from("participations_chevaux")
          .select("id",{count:"exact",head:true}).eq("user_id",id);
        if(partsError)return reply(500,{error:"Impossible de vérifier les participations."});
        if((count||0)>0)return reply(409,{error:"Ce compte possède des chevaux : retirez d'abord ses rattachements, après vérification."});
      }
      const {error}=await admin.from("associes").update({type_compte:accountType}).eq("user_id",id);
      if(error)return reply(500,{error:"Modification du type de compte impossible."});
      // Aucun nouvel envoi privé ne doit viser un ancien appareil enregistré.
      if(accountType==="exterieur"){
        const {error:pushError}=await admin.from("ei_push_subscriptions").update({
          audience:"visitor",scope:"all",confirmed:false,before15:false,
          withdrawn:false,private_news:false,general_news:false
        }).eq("user_id",id);
        if(pushError)return reply(500,{error:"Statut modifié, mais abonnements à vérifier : "+pushError.code});
      }else{
        const {error:pushError}=await admin.from("ei_push_subscriptions")
          .update({audience:"associate",private_news:false,general_news:false}).eq("user_id",id);
        if(pushError)return reply(500,{error:"Statut modifié, mais abonnements à vérifier : "+pushError.code});
      }
      return reply(200,{ok:true,message:"Statut du compte mis à jour."});
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

    // Rattachements individuels : seul l'administrateur peut lire ou modifier les participations.
    const memberActions = new Set(["get_member_horses", "add_member_horse", "remove_member_horse", "update_email", "send_access_email"]);
    if (memberActions.has(body.action)) {
      const id = String(body.user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply(400, { error: "Identifiant de compte invalide." });
      }
      const { data: member, error: memberError } = await admin.from("associes")
        .select("user_id,nom_affiche,actif,type_compte").eq("user_id", id).maybeSingle();
      if (memberError || !member) return reply(404, { error: "Compte associé introuvable." });
      if (body.action === "send_access_email") {
        if (!member.actif) return reply(403, { error: "Réactivez d'abord le compte de cet associé." });
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(id);
        const recipient = account?.user?.email;
        if (accountError || !recipient) return reply(404, { error: "Adresse de connexion introuvable." });
        // Un compte existant ne doit jamais être recréé pour renvoyer un accès.
        const { error } = await auth.auth.resetPasswordForEmail(recipient, {
          redirectTo: "https://fiches.ecurie-initial.com/application/connexion/",
        });
        if (error) return reply(429, { error: "Lien non envoyé : " + error.message + ". Vérifiez le SMTP et les limites d'envoi." });
        return reply(200, { ok: true, message: "Lien de définition ou réinitialisation du mot de passe demandé pour ce compte existant." });
      }
      if (body.action === "get_member_horses") {
        const { data, error } = await admin.from("participations_chevaux")
          .select("cheval_slug,cheval_nom").eq("user_id", id).order("cheval_nom");
        if (error) {
          console.error("get_member_horses", { code: error.code, message: error.message });
          return reply(500, { error: "Impossible de consulter les chevaux de ce compte (code " + (error.code || "inconnu") + ")." });
        }
        return reply(200, { ok: true, nom: member.nom_affiche, horses: data || [] });
      }
      if (body.action === "update_email") {
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          return reply(400, { error: "Adresse e-mail invalide." });
        }
        // Ne crée pas de nouveau compte et ne touche pas aux participations.
        const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (error) return reply(400, { error: error.message || "Adresse e-mail non modifiée." });
        return reply(200, { ok: true, message: "Adresse de connexion mise à jour sans invitation." });
      }
      const slug = String(body.cheval_slug || "").trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 110) {
        return reply(400, { error: "Identifiant de cheval invalide." });
      }
      if (body.action === "add_member_horse") {
        if(member.type_compte==="exterieur")return reply(403,{error:"Un membre extérieur ne peut pas recevoir de cheval. Changez d’abord son statut."});
        const name = String(body.cheval_nom || "").trim();
        if (!name || name.length > 120) return reply(400, { error: "Nom de cheval invalide." });
        const { error } = await admin.from("participations_chevaux")
          .insert({ user_id: id, cheval_slug: slug, cheval_nom: name });
        if (error?.code === "23505") return reply(409, { error: "Ce cheval est déjà rattaché à cet associé." });
        if (error) return reply(500, { error: "Impossible d'ajouter cette participation." });
        return reply(200, { ok: true, message: "Cheval rattaché à ce compte." });
      }
      if (body.action === "remove_member_horse") {
        const { data, error } = await admin.from("participations_chevaux")
          .delete().eq("user_id", id).eq("cheval_slug", slug).select("cheval_slug");
        if (error) return reply(500, { error: "Impossible de retirer ce rattachement." });
        if (!data?.length) return reply(404, { error: "Rattachement introuvable." });
        return reply(200, { ok: true, message: "Rattachement supprimé." });
      }
    }
    return reply(400, { error: "Action inconnue." });
  } catch { return reply(400, { error: "Requête invalide." }); }
});
