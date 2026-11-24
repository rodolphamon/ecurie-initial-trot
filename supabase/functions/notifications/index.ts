// Écurie Initial — inscription et préférences Web Push.
// Déployer dans Supabase Edge Functions avec verify_jwt = false.
// Toutes les écritures utilisent service_role côté serveur uniquement.
// La clef privée VAPID ne doit JAMAIS être dans GitHub ou dans la PWA.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushNotification } from "npm:@mmmike/web-push/send";

const ORIGINS = new Set([
  "https://fiches.ecurie-initial.com",
  "https://rodolphamon.github.io",
]);
const headers = (origin: string | null) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(origin || "") ? origin! : "https://fiches.ecurie-initial.com",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,apikey",
  "Vary": "Origin",
  "Cache-Control": "no-store",
});
const respond = (data: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8" },
  });
const env = (key: string) => Deno.env.get(key) || "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Limite les tests répétés pour un même appareil (sur une instance de fonction).
const lastTests = new Map<string, number>();

function validEndpoint(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 2048) return false;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    // Protège l'Edge Function de requêtes Push vers des hôtes arbitraires.
    return /(^|\.)(googleapis\.com|mozilla\.com|apple\.com|windows\.com)$/.test(u.hostname);
  } catch { return false }
}
const validKey = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 12 && s.length < 260 &&
  /^[\w+\/=\-]+$/.test(s);
const validToken = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

// Vérifie localement que la clé privée signe un message validé par la clé
// publique. Aucun octet privé ne quitte Supabase ni ne paraît dans les logs.
function decodeBase64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
}
function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function vapidPairMatches(): Promise<boolean> {
  try {
    const pub = decodeBase64url(env("PUSH_VAPID_PUBLIC_KEY"));
    const priv = decodeBase64url(env("PUSH_VAPID_PRIVATE_KEY"));
    if (pub.length !== 65 || pub[0] !== 0x04 || priv.length !== 32) return false;
    const verifyingKey = await crypto.subtle.importKey(
      "raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signingKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256",
        x: encodeBase64url(pub.slice(1, 33)),
        y: encodeBase64url(pub.slice(33)),
        d: encodeBase64url(priv) },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const sample = new TextEncoder().encode("EI Push VAPID pair check v1");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, sample);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyingKey, signature, sample);
  } catch {
    return false;
  }
}
async function hash(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
// Aucun Push, y compris les tests, entre 22 h 30 et 8 h (Europe/Paris).
function isSilentPeriodParis(date: Date = new Date()): boolean {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Paris",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date).map(p=>[p.type,p.value]));
  const hour=Number(parts.hour),minute=Number(parts.minute);
  return hour < 8 || hour > 22 || (hour === 22 && minute >= 30);
}
const silentPeriodError = "Notifications suspendues de 22h30 à 08h00 (heure de Paris). Réessayez à partir de 8h00.";
const launchOpen = () => Date.now() >= Date.parse("2026-11-30T23:00:00Z");
const normalizePilotName = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
async function allowedMember(id: string): Promise<boolean> {
  const { data: a, error } = await db.from("associes")
    .select("actif,administrateur,nom_affiche").eq("user_id", id).maybeSingle();
  if (error || !a?.actif) return false;
  if (launchOpen()) return true;
  const { data: pilot, error: pilotError } = await db.from("ei_lancement_pilotes")
    .select("user_id").eq("user_id", id).maybeSingle();
  if (!pilotError) {
    if (pilot) return true;
    // Les contributeurs actifs ayant un accès anticipé à l'application
    // peuvent aussi choisir leurs notifications avant le 1er décembre.
    const { data: contributor, error: contributorError } = await db.from("ei_contributeurs")
      .select("actif,acces_avant_ouverture").eq("user_id", id).maybeSingle();
    if (contributorError) return false;
    return contributor?.actif === true && contributor?.acces_avant_ouverture === true;
  }
  // Transition avant installation SQL : ne laisser que les quatre testeurs déjà connus.
  if (pilotError.code !== "42P01" && pilotError.code !== "PGRST205") return false;
  return a.administrateur === true ||
    ["adrien delgery", "eric schott", "nicolas barre"].includes(normalizePilotName(a.nom_affiche || ""));
}
async function memberId(request: Request): Promise<string | null> {
  const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) return null;
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return null;
  return (await allowedMember(auth.user.id)) ? auth.user.id : null;
}
Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (origin && !ORIGINS.has(origin)) return respond({ error: "Origine non autorisée." }, 403, origin);
  if (request.method === "GET") {
    const key = env("PUSH_VAPID_PUBLIC_KEY");
    return key && env("PUSH_VAPID_PRIVATE_KEY")
      ? respond({ publicKey: key }, 200, origin)
      : respond({ error: "Service non configuré." }, 503, origin);
  }
  if (request.method !== "POST") return respond({ error: "Méthode non autorisée." }, 405, origin);
  try {
    const body = await request.json();
    const { action, deviceToken } = body || {};
    if (action === "admin_test_recipients" || action === "admin_send_test" || action === "admin_test_status") {
      const adminId = await memberId(request);
      if (!adminId) return respond({error:"Connexion administrateur requise."},403,origin);
      const {data:admin,error:adminError}=await db.from("associes")
        .select("actif,administrateur").eq("user_id",adminId).maybeSingle();
      if(adminError || !admin?.actif || !admin.administrateur)
        return respond({error:"Réservé à l’administration."},403,origin);
      if(action==="admin_test_recipients"){
        const {data:subs,error:subError}=await db.from("ei_push_subscriptions")
          .select("user_id").eq("audience","associate").not("user_id","is",null).limit(1000);
        if(subError)throw subError;
        const counts=new Map<string,number>();
        for(const s of subs||[])counts.set(s.user_id,(counts.get(s.user_id)||0)+1);
        if(!counts.size)return respond({recipients:[]},200,origin);
        const {data:members,error:memError}=await db.from("associes")
          .select("user_id,nom_affiche").eq("actif",true).in("type_compte",["associe","observateur"])
          .in("user_id",[...counts.keys()]).order("nom_affiche");
        if(memError)throw memError;
        const recipients=[];
        for(const m of members||[]){
          if(await allowedMember(m.user_id))
            recipients.push({id:m.user_id,name:m.nom_affiche,devices:counts.get(m.user_id)});
        }
        return respond({recipients},200,origin);
      }
      if(action==="admin_test_status"){
        if(typeof body.testId!=="string" || !/^admin-test:[0-9a-f-]{36}$/.test(body.testId))
          return respond({error:"Identifiant de test invalide."},400,origin);
        const {data:rows,error}=await db.from("ei_push_receipts")
          .select("accepted_at,received_at,shown_at,display_error").eq("alert_id",body.testId)
          .eq("category","admin_test");
        if(error)throw error;
        return respond({devices:rows?.length||0,accepted:rows?.filter(r=>r.accepted_at).length||0,
          received:rows?.filter(r=>r.received_at).length||0,shown:rows?.filter(r=>r.shown_at).length||0,
          displayErrors:rows?.filter(r=>r.display_error).length||0},200,origin);
      }
      if(body.confirm!==true)return respond({error:"Confirmation nécessaire."},400,origin);
      if(isSilentPeriodParis())return respond({error:silentPeriodError},409,origin);
      const target=body.userId;
      if(typeof target!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target))
        return respond({error:"Choisissez un seul destinataire."},400,origin);
      const {data:member,error:memberError}=await db.from("associes")
        .select("user_id,nom_affiche,actif,type_compte").eq("user_id",target).maybeSingle();
      if(memberError || !member?.actif || !["associe","observateur"].includes(member.type_compte) || !(await allowedMember(target)))
        return respond({error:"Destinataire non autorisé."},403,origin);
      const {data:devices,error:deviceError}=await db.from("ei_push_subscriptions")
        .select("id,endpoint,p256dh,auth_secret").eq("user_id",target).eq("audience","associate").limit(50);
      if(deviceError)throw deviceError;
      const valid=(devices||[]).filter(d=>validEndpoint(d.endpoint));
      if(!valid.length)return respond({error:"Aucun appareil inscrit aux notifications."},409,origin);
      const now=Date.now();
      if(valid.some(d=>now-(lastTests.get(d.endpoint)||0)<120000))
        return respond({error:"Attendez deux minutes entre deux tests."},429,origin);
      const {data:recent,error:recentError}=await db.from("ei_push_receipts").select("id")
        .eq("category","admin_test").in("subscription_id",valid.map(d=>d.id))
        .gte("created_at",new Date(now-120000).toISOString()).limit(1);
      if(recentError)throw recentError;
      if(recent?.length)return respond({error:"Attendez deux minutes entre deux tests."},429,origin);
      if(!(await vapidPairMatches()))return respond({error:"Clés Push incompatibles. Aucun envoi."},503,origin);
      for(const d of valid)lastTests.set(d.endpoint,now);
      const testId="admin-test:"+crypto.randomUUID();
      const vapid={publicKey:env("PUSH_VAPID_PUBLIC_KEY"),privateKey:env("PUSH_VAPID_PRIVATE_KEY"),subject:"mailto:contact@ecurie-initial.com"};
      let accepted=0,failed=0;
      for(const d of valid){
        if(isSilentPeriodParis())break;
        const {data:receipt,error:receiptError}=await db.from("ei_push_receipts")
          .insert({subscription_id:d.id,alert_id:testId,category:"admin_test"}).select("id").single();
        if(receiptError){failed++;continue}
        if(isSilentPeriodParis())break;
        try{
          const sent=await sendPushNotification({endpoint:d.endpoint,keys:{p256dh:d.p256dh,auth:d.auth_secret}},
            {title:"🔔 Test Écurie Initial",body:"Notification test. Confirmez sa réception à l’administration.",
             url:"https://fiches.ecurie-initial.com/application/",receipt_id:receipt.id},
            vapid,{urgency:"high",ttl:120});
          if(sent){
            accepted++;
            await db.from("ei_push_receipts").update({accepted_at:new Date().toISOString()}).eq("id",receipt.id);
          }else failed++;
        }catch(e){failed++;console.warn("Test administrateur : échec Push",e instanceof Error?e.name:"inconnu")}
      }
      return respond({name:member.nom_affiche,testId,devices:valid.length,accepted,failed},200,origin);
    }
    if (action === "send_andresy_test") {
      // Bouton de démonstration réservé à l'administrateur connecté.
      // Trois destinataires NOMMÉS, aucune publication dans la file générale
      // et aucun ciblage par 'tous les chevaux' : zéro envoi aux autres associés.
      if (body.confirm !== true)
        return respond({ error: "Confirmation explicite nécessaire." }, 400, origin);
      if (isSilentPeriodParis())
        return respond({ error: silentPeriodError }, 409, origin);
      const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!jwt) return respond({ error: "Connexion administrateur requise." }, 403, origin);
      const { data: identity, error: authError } = await db.auth.getUser(jwt);
      if (authError || !identity.user)
        return respond({ error: "Connexion administrateur invalide." }, 403, origin);
      const { data: adminAccount, error: adminError } = await db.from("associes")
        .select("actif,administrateur").eq("user_id", identity.user.id).maybeSingle();
      if (adminError || !adminAccount?.actif || !adminAccount?.administrateur ||
          !(await allowedMember(identity.user.id)))
        return respond({ error: "Action réservée à l'administrateur pilote." }, 403, origin);

      const targets = [
        { first: "adrien", last: "delgery", label: "Adrien Delgery" },
        { first: "eric", last: "schott", label: "Éric Schott" },
        { first: "nicolas", last: "barre", label: "Nicolas Barré" },
      ];
      const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z]+/g, " ").trim().split(/\s+/);
      const { data: members, error: membersError } = await db.from("associes")
        .select("user_id,nom_affiche,actif").eq("actif", true);
      if (membersError) throw membersError;
      const accounts = targets.map(target => {
        const matches = (members || []).filter(m => {
          const words = normalize(m.nom_affiche || "");
          return words.includes(target.first) && words.includes(target.last);
        });
        return { ...target, matches };
      });
      if (accounts.some(x => x.matches.length > 1)) {
        return respond({
          error: "Plusieurs comptes correspondent à un même testeur : envoi annulé pour éviter tout destinataire erroné."
        }, 409, origin);
      }
      const userIds = accounts.flatMap(x => x.matches.map(m => m.user_id));
      const { data: subscriptions, error: subscriptionsError } = userIds.length
        ? await db.from("ei_push_subscriptions")
            .select("endpoint,p256dh,auth_secret,user_id,audience")
            .eq("audience", "associate").in("user_id", userIds).limit(50)
        : { data: [], error: null };
      if (subscriptionsError) throw subscriptionsError;
      if (!(await vapidPairMatches())) {
        return respond({ error: "Les clés VAPID ne correspondent plus. Envoi annulé." }, 503, origin);
      }
      const vapid = {
        publicKey: env("PUSH_VAPID_PUBLIC_KEY"),
        privateKey: env("PUSH_VAPID_PRIVATE_KEY"),
        subject: "mailto:contact@ecurie-initial.com",
      };
      const results = [];
      for (const account of accounts) {
        const userId = account.matches[0]?.user_id;
        const devices = (subscriptions || []).filter(sub =>
          sub.user_id === userId && validEndpoint(sub.endpoint));
        let accepted = 0;
        let failed = 0;
        for (const device of devices) {
          try {
            if (isSilentPeriodParis())
              return respond({ error: silentPeriodError, results }, 409, origin);
            const sent = await sendPushNotification(
              { endpoint: device.endpoint,
                keys: { p256dh: device.p256dh, auth: device.auth_secret } },
              {
                title: "✅ ANDRESY · Partant confirmé",
                body: "Mercredi 18/11 à 20h15 · Amiens · Plat 1 650 m · corde 6 (test)",
                url: "https://fiches.ecurie-initial.com/chevaux/andresy/",
              },
              vapid,
              // Même priorité haute que les rappels urgents, y compris écran verrouillé.
              { urgency: "high", ttl: 300 },
            );
            if (sent) accepted++;
            else failed++;
          } catch (e) {
            failed++;
            const code = (e as { statusCode?: unknown })?.statusCode;
            console.error("ANDRESY test Push", {
              recipient: account.label,
              code: typeof code === "number" ? code : "inconnu",
              type: e instanceof Error ? e.name : "inconnu",
            });
          }
        }
        results.push({ name: account.label, accountFound: !!userId,
          devices: devices.length, accepted, failed });
      }
      return respond({ ok: true, results,
        note: "Accepté signifie que le service Push a reçu l'envoi, pas que le téléphone l'a affiché." },
        200, origin);
    }
    if (!validToken(deviceToken)) return respond({ error: "Jeton d'appareil invalide." }, 400, origin);
    const tokenHash = await hash(deviceToken);
    if (action === "status") {
      if (!validEndpoint(body.endpoint)) return respond({ error: "Abonnement invalide." }, 400, origin);
      const { data, error } = await db.from("ei_push_subscriptions")
        .select("audience,scope,confirmed,daily,before15,results,withdrawn,private_news,general_news")
        .eq("endpoint", body.endpoint).eq("token_hash", tokenHash).maybeSingle();
      if (error) throw error;
      return respond({ ok: true, active: !!data, preferences: data }, 200, origin);
    }
    if (action === "test") {
      // Test individuel : JWT actif + abonnement appartenant au compte et à l'appareil.
      // N'insère aucune alerte globale en base : aucun autre appareil n'est contacté.
      if (!validEndpoint(body.endpoint)) return respond({ error: "Abonnement invalide." }, 400, origin);
      const user = await memberId(request);
      if (!user) return respond({ error: "Connectez-vous à votre compte associé avant le test." }, 403, origin);
      const { data: sub, error } = await db.from("ei_push_subscriptions")
        .select("endpoint,p256dh,auth_secret,user_id,audience")
        .eq("endpoint", body.endpoint).eq("token_hash", tokenHash).maybeSingle();
      if (error) throw error;
      if (!sub || sub.user_id !== user || sub.audience !== "associate")
        return respond({ error: "Cet appareil n'est pas inscrit à votre compte. Enregistrez vos préférences." }, 404, origin);
      const now = Date.now();
      if (now - (lastTests.get(sub.endpoint) || 0) < 120000)
        return respond({ error: "Un essai a été demandé récemment sur cet appareil. Recommencez dans deux minutes." }, 429, origin);
      const vapid = {
        publicKey: env("PUSH_VAPID_PUBLIC_KEY"),
        privateKey: env("PUSH_VAPID_PRIVATE_KEY"),
        subject: "mailto:contact@ecurie-initial.com",
      };
      if (!vapid.publicKey || !vapid.privateKey)
        return respond({ error: "Les clés d'envoi des notifications manquent." }, 503, origin);
      if (!(await vapidPairMatches())) {
        console.error("Push VAPID diagnostic: public and private keys do not form a valid pair");
        return respond({
          error: "Les deux clés VAPID enregistrées dans Supabase ne correspondent pas. Réenregistrez la clé publique et la clé privée issues de la même génération."
        }, 503, origin);
      }
      if (isSilentPeriodParis())
        return respond({ error: silentPeriodError }, 409, origin);
      lastTests.set(sub.endpoint, now);
      try {
        if (isSilentPeriodParis()) {
          lastTests.delete(sub.endpoint);
          return respond({ error: silentPeriodError }, 409, origin);
        }
        const delivered = await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
          {
            title: "🔔 Test Écurie Initial",
            body: "Vous recevez bien les notifications de l'écurie !",
            url: "https://fiches.ecurie-initial.com/application/notifications/",
          },
          vapid,
          // Un test utilisateur doit être prioritaire comme les rappels imminents.
          // TTL court pour ne pas recevoir un ancien test hors contexte.
          { urgency: "high", ttl: 300 },
        );
        if (!delivered)
          return respond({ error: "L'abonnement du téléphone a expiré. Désactivez et réactivez les notifications." }, 410, origin);
        return respond({ ok: true, sent: true }, 200, origin);
      } catch (e) {
        lastTests.delete(sub.endpoint);
        // Ne pas journaliser la réponse brute: elle peut contenir des données
        // liées à l'abonnement. Garder seulement le statut et un code court.
        const statusCode = typeof (e as { statusCode?: unknown })?.statusCode === "number"
          ? (e as { statusCode: number }).statusCode : null;
        let reason = "";
        const body = (e as { body?: unknown })?.body;
        if (typeof body === "string" && body.length < 4096) {
          try {
            const p = JSON.parse(body);
            const candidate = p?.reason ?? p?.error?.status ?? p?.error?.code;
            if (typeof candidate === "string" && /^[a-zA-Z0-9_-]{1,55}$/.test(candidate))
              reason = candidate;
          } catch { /* Pas de code connu dans cette réponse. */ }
        }
        console.error("Push test failed", {
          status: statusCode || "inconnu", reason: reason || "indisponible",
          errorType: e instanceof Error ? e.name : "inconnu",
        });
        if (statusCode === 403) {
          return respond({ error: "Service Push : refus d'authentification (403)."
            + (reason ? " Code : " + reason + "." : "")
            + " La paire VAPID a été vérifiée côté serveur ; il faut diagnostiquer la réponse du service de notifications du téléphone." }, 502, origin);
        }
        return respond({ error: "Envoi test impossible"
          + (statusCode ? " (Push HTTP " + statusCode + ")" : "")
          + (reason ? " — " + reason : "")
          + ". Consultez les logs de la fonction notifications." }, 502, origin);
      }
    }
    if (action === "unsubscribe") {
      if (!validEndpoint(body.endpoint)) return respond({ error: "Abonnement invalide." }, 400, origin);
      const { error } = await db.from("ei_push_subscriptions").delete()
        .eq("endpoint", body.endpoint).eq("token_hash", tokenHash);
      if (error) throw error;
      return respond({ ok: true }, 200, origin);
    }
    if (action !== "subscribe") return respond({ error: "Action inconnue." }, 400, origin);
    const sub = body.subscription;
    if (!sub || !validEndpoint(sub.endpoint) || !validKey(sub.keys?.p256dh) || !validKey(sub.keys?.auth))
      return respond({ error: "Informations Push invalides." }, 400, origin);
    const user = await memberId(request);
    const member = !!user;
    const {data:account,error:accountError}=user
      ?await db.from("associes").select("type_compte").eq("user_id",user).maybeSingle()
      :{data:null,error:null};
    if(accountError)throw accountError;
    const isAssociate=member && account?.type_compte!=="exterieur";
    // Un invité connecté en préinscription ne peut pas contourner
    // la date d'ouverture en créant un abonnement de visiteur.
    if (!member) {
      const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (jwt) {
        const { data: auth } = await db.auth.getUser(jwt);
        if (auth.user) return respond({
          error: "Votre compte est inscrit. Les notifications seront disponibles à partir du 1er décembre 2026."
        }, 403, origin);
      }
    }
    const p = body.preferences || {};
    const values = {
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth_secret: sub.keys.auth,
      token_hash: tokenHash,
      user_id: user,
      audience: isAssociate ? "associate" : "visitor",
      scope: isAssociate && p.scope === "mine" ? "mine" : "all",
      confirmed: isAssociate && p.confirmed !== false,
      daily: p.daily !== false,
      before15: isAssociate && p.before15 !== false,
      results: p.results !== false,
      withdrawn: isAssociate && p.withdrawn !== false,
      // Une actualité privée reste strictement limitée aux propriétaires.
      private_news: isAssociate && p.private_news === true,
      general_news: isAssociate && p.general_news !== false,
      updated_at: new Date().toISOString(),
      last_error: null,
    };
    const { data: existing, error: readError } = await db.from("ei_push_subscriptions")
      .select("token_hash").eq("endpoint", sub.endpoint).maybeSingle();
    if (readError) throw readError;
    if (existing && existing.token_hash !== tokenHash)
      return respond({ error: "Cet appareil possède une ancienne inscription. Supprimez puis recréez l’autorisation Push." }, 409, origin);
    const query = existing ?
      db.from("ei_push_subscriptions").update(values)
        .eq("endpoint", sub.endpoint).eq("token_hash", tokenHash) :
      db.from("ei_push_subscriptions").insert(values);
    const { error } = await query;
    if (error) {
      if (error.code === "23505") return respond({ error: "L'appareil est déjà inscrit ; rechargez cette page." }, 409, origin);
      throw error;
    }
    if (isAssociate && user) {
      // Choix du périmètre lié au compte, et non à un navigateur ou un téléphone.
      // Ne touche à aucune autre préférence des appareils.
      const { error: accountError } = await db.from("associes")
        .update({ notification_scope: values.scope }).eq("user_id", user);
      if (accountError) throw accountError;
      const { error: syncError } = await db.from("ei_push_subscriptions")
        .update({ scope: values.scope })
        .eq("user_id", user).eq("audience", "associate");
      if (syncError) throw syncError;
    }
    return respond({ ok: true, audience: values.audience, scope: values.scope }, 200, origin);
  } catch (e) {
    console.error("Push inscription error", e instanceof Error ? e.message : e);
    return respond({ error: "Enregistrement indisponible." }, 500, origin);
  }
});
