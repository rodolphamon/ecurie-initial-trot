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
  if (!pilotError) return !!pilot;
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
    if (action === "send_andresy_test") {
      // Bouton de démonstration réservé à l'administrateur connecté.
      // Trois destinataires NOMMÉS, aucune publication dans la file générale
      // et aucun ciblage par 'tous les chevaux' : zéro envoi aux autres associés.
      if (body.confirm !== true)
        return respond({ error: "Confirmation explicite nécessaire." }, 400, origin);
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
            const sent = await sendPushNotification(
              { endpoint: device.endpoint,
                keys: { p256dh: device.p256dh, auth: device.auth_secret } },
              {
                title: "✅ ANDRESY · Partant confirmé",
                body: "Mercredi 18/11 à 20h15 · Amiens · Plat 1 650 m · corde 6 (test)",
                url: "https://fiches.ecurie-initial.com/chevaux/andresy/",
              },
              vapid,
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
        .select("audience,scope,confirmed,daily,before15,results,withdrawn,private_news")
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
      lastTests.set(sub.endpoint, now);
      try {
        const delivered = await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
          {
            title: "🔔 Test Écurie Initial",
            body: "Vous recevez bien les notifications de l'écurie !",
            url: "https://fiches.ecurie-initial.com/application/notifications/",
          },
          vapid,
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
      audience: member ? "associate" : "visitor",
      scope: member && p.scope === "mine" ? "mine" : "all",
      confirmed: member && p.confirmed !== false,
      daily: p.daily !== false,
      before15: member && p.before15 !== false,
      results: p.results !== false,
      withdrawn: member && p.withdrawn !== false,
      // Une actualité privée reste strictement limitée aux propriétaires.
      private_news: member && p.private_news === true,
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
    return respond({ ok: true, audience: values.audience }, 200, origin);
  } catch (e) {
    console.error("Push inscription error", e instanceof Error ? e.message : e);
    return respond({ error: "Enregistrement indisponible." }, 500, origin);
  }
});
