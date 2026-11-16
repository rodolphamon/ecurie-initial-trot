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
async function hash(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
async function memberId(request: Request): Promise<string | null> {
  const jwt = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!jwt) return null;
  const { data: auth, error } = await db.auth.getUser(jwt);
  if (error || !auth.user) return null;
  const { data: associe } = await db.from("associes")
    .select("actif").eq("user_id", auth.user.id).maybeSingle();
  return associe?.actif === true ? auth.user.id : null;
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
        console.error("Push test failed", e instanceof Error ? e.message : e);
        return respond({ error: "Envoi test impossible. Consulter les journaux Supabase de la fonction notifications." }, 502, origin);
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
