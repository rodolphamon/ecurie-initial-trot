/* Navigation permanente de l'application Écurie Initial.
 * Base calculée à partir de l'URL de ce fichier : compatible avec GitHub Pages et le domaine personnalisé.
 * Masquée si la page est intégrée en iframe au site public.
 */
(function () {
  "use strict";
  if (window.self !== window.top || document.getElementById("ei-app-nav")) return;
  const script = document.currentScript;
  if (!script) return;
  const applicationBase = new URL("./", script.src);
  // En-tête Écurie Initial partagé par toutes les rubriques et fiches.
  const headerScript = document.createElement("script");
  headerScript.src = new URL("header.js?v=20261118etoile-affinee3", applicationBase).href;
  document.body.appendChild(headerScript);
  const siteBase = new URL("../", applicationBase);
  const currentPath = window.location.pathname;
  const chevauxBase = new URL("chevaux/", siteBase);
  const coursesBase = new URL("engagements/", siteBase);
  const podiumsBase = new URL("palmares/", siteBase);
  const associesBase = new URL("?espace=associes", applicationBase);
  const contactBase = new URL("contact/", applicationBase);
  const teamBase = new URL("team-initial/", applicationBase);
  const devenirBase = new URL("devenir-associe/", applicationBase);
  const notificationsBase = new URL("notifications/", applicationBase);
  const isContact = currentPath.startsWith(contactBase.pathname) || currentPath.startsWith(devenirBase.pathname) || currentPath.startsWith(teamBase.pathname);
  const onPrivate = currentPath.startsWith(applicationBase.pathname) &&
    (currentPath !== applicationBase.pathname || new URLSearchParams(location.search).get("espace") === "associes") &&
    !isContact && !currentPath.startsWith(notificationsBase.pathname) && !currentPath.startsWith(new URL("actualites/",applicationBase).pathname);

  const installed = !!(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true);
  const beforeOpening = Date.now() < Date.parse("2026-11-30T23:00:00Z");
  const isAppHome = currentPath === applicationBase.pathname || currentPath === applicationBase.pathname + "index.html";
  const connexionPath = new URL("connexion/", applicationBase).pathname;
  const isConnexion = currentPath === connexionPath || currentPath === connexionPath + "index.html";
  const actualitesPath = new URL("actualites/", applicationBase).pathname;
  const isPublicNews = currentPath === actualitesPath || currentPath === actualitesPath + "index.html";

  // Avant le lancement, chacun doit pouvoir ouvrir la connexion pour accepter
  // son invitation et définir son mot de passe, même depuis la PWA installée.
  // Les autres rubriques restent soumises au contrôle de préouverture.
  if (installed && beforeOpening && (isConnexion || isPublicNews)) return;

  // La fermeture s'applique à la PWA installée, pas aux pages du site public.
  async function canAccessInstalledApp() {
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      const db = createClient(
        "https://yeecwaaizmvrhwobukfa.supabase.co",
        "sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3"
      );
      const { data: { user }, error: authError } = await db.auth.getUser();
      if (authError || !user) return false;
      const { data: state, error } = await db.rpc("ei_etat_lancement");
      return !error && state?.autorise === true;
    } catch (_) {
      return false;
    }
  }

  function mountNavigation() {
  const tabs = [
    { label: "🏁 Résultats", href: chevauxBase.href, active: currentPath.startsWith(chevauxBase.pathname) },
    { label: "📅 Partants", href: coursesBase.href, active: currentPath.startsWith(coursesBase.pathname) },
    { label: "🏆 Podiums", href: podiumsBase.href, active: currentPath.startsWith(podiumsBase.pathname) },
    { label: "🔒 Associés", href: associesBase.href, active: onPrivate },
    { label: "✉️ Contact", href: contactBase.href, active: isContact }
  ];
  const css = document.createElement("style");
  css.id = "ei-app-nav-css";
  css.textContent = `
    body { padding-bottom: calc(86px + env(safe-area-inset-bottom, 0px)) !important; }
    #ei-app-nav {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
      display: flex; align-items: stretch; justify-content: space-around;
      padding: 5px 5px calc(5px + env(safe-area-inset-bottom, 0px));
      background: #171717; box-shadow: 0 -3px 15px rgba(0,0,0,.18);
      width: 100%; max-width: none; box-sizing: border-box;
      margin: 0 !important; /* Annule les marges génériques « nav » des pages, notamment en administration. */
    }
    #ei-app-nav a {
      display: flex; flex: 1 1 25%; min-width: 0; min-height: 48px;
      align-items: center; justify-content: center; text-align: center;
      padding: 7px 3px; margin: 0; border-radius: 8px;
      color: #fff !important; text-decoration: none !important;
      font: 500 11px/1.2 Arial,Helvetica,sans-serif !important;
      white-space: nowrap; letter-spacing: -.1px;
      touch-action: manipulation; -webkit-tap-highlight-color: rgba(244,119,33,.3);
    }
    #ei-app-nav a[aria-current="page"] { background: #37302b; color: #ffa568 !important; font-weight: 700 !important; }
    #ei-app-nav a:focus-visible { outline: 2px solid #f47721; outline-offset: -2px; }
    #ei-app-nav a:active { background: #4b362a; }
    @media (max-width: 370px) { #ei-app-nav a { font-size: 10px !important; letter-spacing: -.2px; padding-left: 0; padding-right: 0; } }
    @media (min-width: 760px) { #ei-app-nav { max-width: none; } #ei-app-nav a { font-size: 14px !important; } }
  `;
  document.head.appendChild(css);
  const nav = document.createElement("nav");
  nav.id = "ei-app-nav";
  nav.setAttribute("aria-label", "Navigation principale de l’application");
  for (const tab of tabs) {
    const link = document.createElement("a");
    link.href = tab.href;
    link.textContent = tab.label;
    if (tab.active) link.setAttribute("aria-current", "page");
    nav.appendChild(link);
  }

  document.body.appendChild(nav);
  }

  // Les pages Contact, Devenir associé et Team Initial sont publiques avant le lancement.
  // Le contrôle strict des pages privées reste inchangé.
  if (installed && beforeOpening && isContact) {
    mountNavigation();
    return;
  }

  if (installed && beforeOpening) {
    const gateCss = document.createElement("style");
    gateCss.textContent = "html.ei-checking-prelaunch body{visibility:hidden!important}";
    document.head.appendChild(gateCss);
    document.documentElement.classList.add("ei-checking-prelaunch");
    const reject = () => {
      if (!isAppHome) {
        window.location.replace(applicationBase.href);
      } else {
        document.body.classList.add("ei-prelaunch");
        document.documentElement.classList.remove("ei-checking-prelaunch");
      }
    };
    canAccessInstalledApp().then(allowed => {
      if (!allowed) return reject();
      document.documentElement.classList.remove("ei-checking-prelaunch");
      mountNavigation();
    }).catch(reject);
    return;
  }
  mountNavigation();
})();
