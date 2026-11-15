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
  const siteBase = new URL("../", applicationBase);
  const currentPath = window.location.pathname;
  const chevauxBase = new URL("chevaux/", siteBase);
  const coursesBase = new URL("engagements/", siteBase);
  const podiumsBase = new URL("palmares/", siteBase);
  const associesBase = new URL("?espace=associes", applicationBase);
  const onPrivate = currentPath.startsWith(applicationBase.pathname) &&
    (currentPath !== applicationBase.pathname || new URLSearchParams(location.search).get("espace") === "associes");
  const tabs = [
    { label: "🐎 Chevaux", href: chevauxBase.href, active: currentPath.startsWith(chevauxBase.pathname) },
    { label: "📅 Courses", href: coursesBase.href, active: currentPath.startsWith(coursesBase.pathname) },
    { label: "🏆 Podiums", href: podiumsBase.href, active: currentPath.startsWith(podiumsBase.pathname) },
    { label: "🔒 Associés", href: associesBase.href, active: onPrivate }
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
    }
    #ei-app-nav a {
      display: flex; flex: 1 1 25%; min-width: 0; min-height: 48px;
      align-items: center; justify-content: center; text-align: center;
      padding: 7px 3px; margin: 0; border-radius: 8px;
      color: #fff !important; text-decoration: none !important;
      font: 500 12px/1.2 Arial,Helvetica,sans-serif !important;
      touch-action: manipulation; -webkit-tap-highlight-color: rgba(244,119,33,.3);
    }
    #ei-app-nav a[aria-current="page"] { background: #37302b; color: #ffa568 !important; font-weight: 700 !important; }
    #ei-app-nav a:focus-visible { outline: 2px solid #f47721; outline-offset: -2px; }
    #ei-app-nav a:active { background: #4b362a; }
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
})();
