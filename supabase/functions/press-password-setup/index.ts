// Activation du mot de passe d'un compte Presse via un jeton personnel haché.
// Aucun secret n'est exposé dans la page, et aucune lecture ou modification
// d'autres comptes n'est possible sans un jeton aléatoire valide à usage unique.
import { createClient } from "npm:@supabase/supabase-js@2.78.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ALLOWED_ORIGIN = "https://fiches.ecurie-initial.com";
const HEX64 = /^[a-f0-9]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{48,128}$/;
const decoder = new TextEncoder();
const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Referrer-Policy": "no-referrer",
};
const respond = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {status, headers});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {status: 204, headers});
  if (req.method !== "POST") return respond(405, {error: "Méthode non autorisée."});
  if (req.headers.get("Origin") !== ALLOWED_ORIGIN)
    return respond(403, {error: "Origine non autorisée."});
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY)
    return respond(503, {error: "Service indisponible."});

  try {
    if (Number(req.headers.get("content-length") || 0) > 4096)
      return respond(413, {error: "Données trop volumineuses."});
    const raw = await req.text();
    if (raw.length > 4096) return respond(413, {error: "Données trop volumineuses."});
    const body = JSON.parse(raw);
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!TOKEN.test(token) || password.length < 12 || password.length > 128)
      return respond(400, {error: "Lien ou mot de passe invalide (12 caractères minimum)."});

    const buffer = await crypto.subtle.digest("SHA-256", decoder.encode(token));
    const hash = toHex(new Uint8Array(buffer));
    if (!HEX64.test(hash)) return respond(400, {error: "Lien invalide."});
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: {persistSession: false, autoRefreshToken: false},
    });
    const {data:challenge, error:findError} = await db
      .from("ei_press_password_setup")
      .select("id,user_id,expires_at,consumed_at")
      .eq("token_sha256", hash)
      .maybeSingle();

    if (findError) throw findError;
    if (!challenge || challenge.consumed_at || Date.parse(challenge.expires_at) <= Date.now())
      return respond(403, {error: "Ce lien a expiré ou a déjà été utilisé."});

    // Le rôle Presse, l'activation et le rattachement du jeton sont vérifiés
    // sur le serveur avant toute modification de l'authentification.
    const {data:member,error:memberError} = await db.from("associes")
      .select("user_id,actif,type_compte,administrateur")
      .eq("user_id",challenge.user_id).maybeSingle();
    if (memberError) throw memberError;
    if (!member || !member.actif || member.type_compte !== "presse" || member.administrateur)
      return respond(403, {error: "Activation non autorisée."});

    // Attribution atomique du jeton : même si deux requêtes arrivent ensemble,
    // une seule peut changer le mot de passe.
    const now = new Date().toISOString();
    const {data:claimed,error:claimError} = await db.from("ei_press_password_setup")
      .update({consumed_at: now})
      .eq("id",challenge.id)
      .is("consumed_at",null)
      .gt("expires_at",now)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return respond(403, {error: "Ce lien a déjà été utilisé."});

    const {error:passwordError} = await db.auth.admin.updateUserById(challenge.user_id,{password});
    if (passwordError) {
      // Ne jamais redonner accès au jeton après un échec côté Auth ;
      // l'administrateur pourra créer un nouveau lien personnel si nécessaire.
      console.error("Échec Auth press-password-setup", passwordError.name);
      return respond(503, {error: "Impossible d'enregistrer le mot de passe. Contactez l'Écurie Initial."});
    }
    return respond(200, {ok:true, message:"Mot de passe enregistré. Connectez-vous avec votre adresse et ce mot de passe."});
  } catch (e) {
    console.error("Échec press-password-setup", e instanceof Error ? e.name : "error");
    return respond(500,{error:"Service temporairement indisponible. Réessayez."});
  }
});
