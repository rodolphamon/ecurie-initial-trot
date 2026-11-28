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

    // Team Initial : liste privée strictement réservée au gérant administrateur.
    // Les invitations autorisées sont définies par ei_invitations_lecture, jamais par le client.
    if (body.action === "list_team_initial") {
      const { data: invites, error: inviteError } = await admin.from("ei_invitations_lecture")
        .select("email,nom_affiche").eq("actif", true).order("nom_affiche").limit(150);
      if (inviteError) return reply(500, { error: "Impossible de charger la liste de la Team Initial." });
      const users: Array<{ id: string; email?: string; last_sign_in_at?: string; email_confirmed_at?: string; confirmed_at?: string; invited_at?: string }> = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return reply(500, { error: "Impossible de vérifier les comptes Team Initial." });
        const batch = data?.users || [];
        users.push(...batch);
        if (batch.length < 1000) break;
      }
      const usersByEmail = new Map(users.filter(u => u.email).map(u => [u.email!.toLowerCase(), u]));
      const ids = (invites || []).map(i => usersByEmail.get(i.email)?.id).filter((id): id is string => Boolean(id));
      const { data: links, error: linkError } = ids.length
        ? await admin.from("associes").select("user_id,actif,type_compte").in("user_id", ids)
        : { data: [], error: null };
      if (linkError) return reply(500, { error: "Impossible de vérifier les droits de la Team Initial." });
      const accessById = new Map((links || []).map(a => [a.user_id, a]));
      const membres = (invites || []).map(i => {
        const account = usersByEmail.get(i.email);
        const access = account ? accessById.get(account.id) : null;
        const etat = !account ? "pret_a_inviter"
          : !access ? "compte_incomplet"
          : !access.actif ? "suspendu"
          : account.last_sign_in_at ? "connecte"
          : (account.email_confirmed_at || account.confirmed_at) ? "confirme"
          : "invitation_envoyee";
        return {
          nom_affiche: i.nom_affiche, email: i.email, user_id: account?.id || null,
          type_compte: access?.type_compte || (account ? "non_rattache" : null),
          etat,
        };
      });
      return reply(200, { ok: true, membres });
    }

    if (body.action === "invite_team_initial") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        return reply(400, { error: "Adresse d'invitation invalide." });
      const { data: invitation, error: invitationError } = await admin.from("ei_invitations_lecture")
        .select("email,nom_affiche").eq("email", email).eq("actif", true).maybeSingle();
      if (invitationError || !invitation)
        return reply(403, { error: "Personne non autorisée dans la liste Team Initial." });
      const { data: launchReady, error: launchError } = await admin.rpc("ei_lancement_pret");
      if (launchError || launchReady !== true)
        return reply(503, { error: "Invitations suspendues pendant la vérification de la sécurité." });
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return reply(500, { error: "Impossible de vérifier les comptes existants." });
        const batch = data?.users || [];
        if (batch.some(u => u.email?.toLowerCase() === email))
          return reply(409, { error: "Ce compte existe déjà. Utilisez la relance sécurisée de l'administration si nécessaire." });
        if (batch.length < 1000) break;
      }
      const { data: created, error: creationError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: "https://fiches.ecurie-initial.com/application/connexion/",
      });
      if (creationError || !created.user)
        return reply(502, { error: "Envoi de l'invitation refusé par le service de messagerie." });
      const { error: saveError } = await admin.from("associes").insert({
        user_id: created.user.id, nom_affiche: invitation.nom_affiche, actif: true,
        administrateur: false, type_compte: "observateur",
      });
      if (saveError)
        return reply(500, { error: "Invitation envoyée, mais droits non enregistrés. Vérifiez ce compte avant toute nouvelle invitation." });
      return reply(200, { ok: true, message: "Invitation Team Initial envoyée : accès en lecture seule." });
    }


    // Administration ciblée des accès Team Initial : 3 collaborateurs nommément autorisés.
    // L'administrateur est déjà vérifié plus haut ; aucune action de ce bloc ne permet de modifier son propre compte.
    if (body.action === "get_team_rights" || body.action === "set_team_rights") {
      const id = String(body.user_id || "");
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) || id === user.id)
        return reply(400, { error: "Compte Team Initial invalide." });
      const { data: target, error: targetError } = await admin.from("associes")
        .select("user_id,nom_affiche,actif,administrateur,type_compte").eq("user_id", id).maybeSingle();
      const normalized = String(target?.nom_affiche || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toUpperCase().trim();
      if (targetError || !target || target.administrateur ||
          !new Set(["ARNAUD PUSKAS", "NICOLAS BARRE", "EMILIE MARECHAL"]).has(normalized))
        return reply(403, { error: "Modification limitée aux trois membres de la Team Initial." });

      const loadRights = async () => {
        const [sport, fiches] = await Promise.all([
          admin.from("ei_contributeurs")
            .select("actif,engagements,gains,valeurs,records").eq("user_id", id).maybeSingle(),
          admin.from("ei_droits_photos_chevaux").select("user_id").eq("user_id", id).maybeSingle(),
        ]);
        if (sport.error || fiches.error) throw new Error("Lecture des autorisations impossible.");
        return {
          account_active: target.actif,
          engagements: Boolean(sport.data?.actif && sport.data.engagements),
          gains: Boolean(sport.data?.actif && sport.data.gains),
          valeurs: Boolean(sport.data?.actif && sport.data.valeurs),
          records: Boolean(sport.data?.actif && sport.data.records),
          fiches: Boolean(fiches.data),
        };
      };
      if (body.action === "get_team_rights") {
        try { return reply(200, { ok: true, nom: target.nom_affiche, rights: await loadRights() }); }
        catch { return reply(500, { error: "Impossible de consulter les droits de ce membre." }); }
      }

      const keys = ["account_active", "engagements", "gains", "valeurs", "records", "fiches"] as const;
      if (keys.some(key => typeof body[key] !== "boolean"))
        return reply(400, { error: "Sélection des autorisations invalide." });
      const sportsEnabled = Boolean(body.engagements || body.gains || body.valeurs || body.records);
      const { data: existingSport, error: sportLookupError } = await admin.from("ei_contributeurs")
        .select("user_id").eq("user_id", id).maybeSingle();
      if (sportLookupError) return reply(500, { error: "Droits sportifs indisponibles." });
      if (existingSport || sportsEnabled) {
        const sports = {
          user_id: id, actif: sportsEnabled, engagements: body.engagements,
          gains: body.gains, valeurs: body.valeurs, records: body.records,
        };
        const writeSport = existingSport
          ? await admin.from("ei_contributeurs").update(sports).eq("user_id", id).select("user_id").single()
          : await admin.from("ei_contributeurs").insert({ ...sports, acces_avant_ouverture: false }).select("user_id").single();
        if (writeSport.error) {
          console.error("Team Initial sports", writeSport.error.code);
          return reply(500, { error: "Impossible d'enregistrer les droits sportifs." });
        }
      }
      const { data: existingFiches, error: photoLookupError } = await admin.from("ei_droits_photos_chevaux")
        .select("user_id").eq("user_id", id).maybeSingle();
      if (photoLookupError) return reply(500, { error: "Droits fiches indisponibles, vérifiez les autorisations sportives." });
      if (body.fiches && !existingFiches) {
        const { error } = await admin.from("ei_droits_photos_chevaux").insert({ user_id: id });
        if (error) return reply(500, { error: "Impossible d'accorder l'accès aux fiches." });
      } else if (!body.fiches && existingFiches) {
        const { error } = await admin.from("ei_droits_photos_chevaux").delete().eq("user_id", id);
        if (error) return reply(500, { error: "Impossible de retirer l'accès aux fiches." });
      }
      if (target.actif !== body.account_active) {
        const { error } = await admin.from("associes").update({ actif: body.account_active }).eq("user_id", id);
        if (error) return reply(500, { error: "Impossible de modifier l'état du compte." });
      }
      try {
        const rights = await loadRights();
        rights.account_active = body.account_active;
        return reply(200, { ok: true, rights, message: "Autorisations enregistrées." });
      } catch {
        return reply(500, { error: "Autorisations modifiées mais vérification impossible. Rechargez la page." });
      }
    }

    // Répertoire interne de référence : fiches préexistantes, sans création de compte ni e-mail.
    // Accessible uniquement après vérification du JWT et du rôle administrateur ci-dessus.
    // Statistiques privées des inscriptions et ouvertures, réservées à l'administrateur authentifié.
    if (body.action === "list_registration_status") {
      const users: Array<{ id: string; created_at?: string; invited_at?: string; email_confirmed_at?: string; confirmed_at?: string; last_sign_in_at?: string }> = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) {
          console.error("list_registration_status.auth", error.message);
          return reply(500, { error: "Impossible de charger les inscriptions." });
        }
        const batch = data?.users || [];
        users.push(...batch);
        if (batch.length < 1000) break;
      }
      // Historique conservé intégralement : le compteur ne retient qu'une
      // ouverture par membre et par fenêtre glissante de cinq minutes.
      // Comparer à la DERNIÈRE ouverture retenue (pas au dernier doublon).
      // La base empêche désormais aussi les nouvelles insertions rapprochées.
      const minOpeningGapMs = 5 * 60 * 1000;
      const openingStats = new Map<string, { count: number; first: string; last: string; lastMs: number }>();
      for (let start = 0; start < 100000; start += 1000) {
        const { data, error } = await admin.from("ei_ouvertures_application")
          .select("user_id,ouvert_le")
          .order("ouvert_le", { ascending: true })
          .order("id", { ascending: true })
          .range(start, start + 999);
        if (error) {
          console.error("list_registration_status.openings", { code: error.code, message: error.message });
          return reply(500, { error: "Impossible de charger les ouvertures." });
        }
        const batch = data || [];
        for (const opening of batch) {
          if (!opening.user_id || !opening.ouvert_le) continue;
          const openedMs = Date.parse(opening.ouvert_le);
          if (!Number.isFinite(openedMs)) continue;
          const prev = openingStats.get(opening.user_id);
          if (!prev) {
            openingStats.set(opening.user_id, {
              count: 1, first: opening.ouvert_le, last: opening.ouvert_le, lastMs: openedMs,
            });
          } else if (openedMs - prev.lastMs >= minOpeningGapMs) {
            prev.count++;
            prev.last = opening.ouvert_le;
            prev.lastMs = openedMs;
          }
        }
        if (batch.length < 1000) break;
      }
      const inscriptions = users.map(u => {
        const stats = openingStats.get(u.id);
        const confirmed = u.email_confirmed_at || u.confirmed_at || null;
        return {
          user_id: u.id,
          etat: u.last_sign_in_at ? "connecte" : confirmed ? "email_confirme" : "invitation_en_attente",
          inscription_le: u.created_at || null,
          invitation_le: u.invited_at || null,
          confirmation_le: confirmed,
          derniere_connexion: u.last_sign_in_at || null,
          nombre_ouvertures: stats?.count || 0,
          premiere_ouverture: stats?.first || null,
          derniere_ouverture: stats?.last || null,
        };
      });
      return reply(200, { ok: true, inscriptions });
    }

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
      const requestedType = String(body.type_compte || "associe");
      const isTrainer = requestedType === "entraineur";
      const accountType = isTrainer ? "exterieur" : requestedType;
      const trainerName = String(body.entraineur_nom || "").trim();
      const caller = createClient(url, anon, {global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
      if (isTrainer) {
        const {data:trainer,error:trainerError}=await caller.from("ei_entraineurs_repertoire").select("entraineur_nom,compte_user_id").eq("entraineur_nom",trainerName).maybeSingle();
        if (trainerError) { console.error("invite.trainer_lookup", {code:trainerError.code,message:trainerError.message}); return reply(503,{error:"Répertoire professionnel inaccessible. Aucun e-mail envoyé."}); }
        if (!trainer) return reply(404,{error:"Fiche professionnelle inconnue. Aucun e-mail envoyé."});
        // Une fiche peut accueillir plusieurs comptes professionnels distincts.
      }
      if (!["associe", "exterieur", "presse"].includes(accountType)) return reply(400, { error: "Type de compte invalide." });
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
      if (accountType !== "associe" && horses.length) return reply(400, { error: "Un membre extérieur ne peut pas recevoir de participations aux chevaux." });
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: "https://fiches.ecurie-initial.com/application/connexion/" });
      if (error || !data.user) return reply(400, { error: error?.message || "Invitation impossible." });
      const { error: saveError } = await admin.from("associes").insert({ user_id: data.user.id, nom_affiche: nom, actif: true, administrateur: false, type_compte: accountType });
      if (saveError) return reply(500, { error: "L'invitation a été envoyée, mais l'accès n'a pas pu être activé. Vérifiez ce compte dans Supabase ; ne réinvitez pas automatiquement." });
      if (isTrainer) {
        // Le compte reste extérieur : aucun droit de propriétaire. Le RPC vérifie l’administrateur et le rattachement.
        const {error:linkError}=await caller.rpc("ei_rattacher_compte_entraineur",{p_entraineur_nom:trainerName,p_user_id:data.user.id});
        if (linkError) { console.error("invite.trainer_link",{code:linkError.code,message:linkError.message}); return reply(409,{error:"Invitation envoyée, mais rattachement professionnel refusé. Utilisez la gestion des entraîneurs sans renvoyer d’invitation."}); }
        const {error:pilotError}=await admin.from("ei_lancement_pilotes").upsert({user_id:data.user.id},{onConflict:"user_id",ignoreDuplicates:true});
        if (pilotError) return reply(500,{error:"Compte entraîneur rattaché ; accès anticipé non enregistré. Vérifiez les autorisations sans réinviter."});
        return reply(200,{ok:true,message:"Invitation entraîneur envoyée : "+trainerName+". Chevaux rattachés depuis le répertoire et accès anticipé activé."});
      }
      if (horses.length) {
        const rows = horses.map((h) => ({ ...h, user_id: data.user.id }));
        const { error: attachError } = await admin.from("participations_chevaux").insert(rows);
        if (attachError) {
          return reply(500, { error: "L'invitation et le compte sont créés, mais les chevaux n'ont pas pu être rattachés. Utilisez le bouton « Chevaux » pour terminer, sans nouvelle invitation." });
        }
      }
      return reply(200, { ok: true, message: "Invitation envoyée au " + (accountType === "presse" ? "journaliste (accès presse)" : accountType === "exterieur" ? "membre extérieur" : "compte associé") + ". Mot de passe activable maintenant ; ouverture le 1er décembre 2026. " + horses.length + " cheval(aux) rattaché(s).", chevaux_rattaches: horses.length });
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
        // CAPTCHA Cloudflare obligatoire pour CHAQUE envoi ; jamais de contournement.
        const captchaToken = typeof body.captcha_token === "string" ? body.captcha_token.trim() : "";
        if (captchaToken.length < 30 || captchaToken.length > 4096) {
          return reply(400, { error: "Validez d'abord la vérification anti-robots avant d'envoyer un e-mail." });
        }
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(id);
        const recipient = account?.user?.email;
        if (accountError || !recipient) return reply(404, { error: "Adresse de connexion introuvable." });
        if (body.only_if_never_connected === true && account.user?.last_sign_in_at) {
          return reply(409, { error: "Ce membre s'est déjà connecté : aucune relance nécessaire." });
        }
        // Le token CAPTCHA est vérifié par Supabase Auth au moment de l'envoi.
        // Un compte existant n'est jamais recréé ; les participations restent intactes.
        const { error } = await auth.auth.resetPasswordForEmail(recipient, {
          redirectTo: "https://fiches.ecurie-initial.com/application/connexion/",
          captchaToken,
        });
        if (error) {
          const detail = error.message || "Envoi refusé";
          const isCaptcha = /captcha|challenge|turnstile/i.test(detail);
          const isRate = error.status === 429 || /rate limit|too many/i.test(detail);
          return reply(isCaptcha ? 400 : isRate ? 429 : 502, {
            error: isCaptcha ? "La vérification anti-robots est expirée ou invalide. Réessayez." :
              isRate ? "La limite d'envoi d'e-mails est atteinte. Réessayez plus tard." :
              "Envoi refusé par la messagerie. Vérifiez la configuration SMTP.",
          });
        }
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
