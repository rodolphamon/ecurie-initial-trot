/* En-tête commun à toutes les rubriques Écurie Initial, hors iframe publique. */
(function(){
"use strict";
if(window.self!==window.top||document.getElementById("ei-unified-header"))return;
const script=document.currentScript;if(!script)return;
const root=new URL("./",script.src);
const style=document.createElement("style");style.id="ei-unified-header-css";
style.textContent=`
body.ei-unified-header-active > header:not(#ei-unified-header),
body.ei-unified-header-active[data-page] #app > header.top{display:none!important}
#ei-unified-header{display:block!important;box-sizing:border-box!important;position:relative!important;z-index:5!important;width:100%!important;max-width:none!important;margin:0!important;border:0!important;border-bottom:5px solid #f47721!important;border-radius:0!important;padding:16px clamp(12px,2vw,28px)!important;background:#fff!important;color:#171717!important;box-shadow:none!important;font-family:Arial,Helvetica,sans-serif!important}
#ei-unified-header *{box-sizing:border-box}
#ei-unified-header .ei-uh-inner{max-width:1420px;width:100%;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px}
#ei-unified-header .ei-uh-brand{display:flex;align-items:center;min-width:0;gap:clamp(10px,1.4vw,20px);flex-shrink:0;color:#171717!important;text-decoration:none!important}
#ei-unified-header .ei-uh-logo{display:block!important;flex:none;width:clamp(52px,6.4vw,88px)!important;height:clamp(52px,6.4vw,88px)!important;max-width:none!important;object-fit:contain!important;background:#fff!important;border:1px solid #f5e5d7!important;border-radius:16px!important;padding:3px!important}
#ei-unified-header .ei-uh-wordmark{display:block;color:#171717!important;font-weight:900!important;font-size:clamp(21px,2.65vw,40px)!important;line-height:1.1!important;letter-spacing:-.035em!important;white-space:nowrap!important;border-bottom:3px solid #f47721!important;padding:9px 0 11px!important}
#ei-unified-header .ei-uh-i{display:inline-block;position:relative;color:#f47721!important;font:inherit!important;line-height:1!important}
#ei-unified-header .ei-uh-star{position:absolute;left:50%;top:-.55em;transform:translateX(-50%);display:block;line-height:1;font-size:.55em;color:#f47721;-webkit-text-stroke:.8px #171717;paint-order:stroke fill;text-shadow:0 0 .3px #171717;pointer-events:none}
#ei-unified-header .ei-uh-motto{display:block;margin:0!important;flex:0 1 auto;min-width:0;color:#171717!important;text-align:center!important;font-size:clamp(13px,1.6vw,25px)!important;font-weight:850!important;letter-spacing:0!important;line-height:1.25!important}
#ei-unified-header .ei-uh-motto-line{display:block;color:#171717!important}
#ei-unified-header .ei-uh-date{display:block;color:#f47721!important;font-size:1.13em!important;margin-top:6px!important;font-weight:900!important;white-space:nowrap!important}
@media(max-width:750px){
#ei-unified-header{padding:11px 12px!important}
#ei-unified-header .ei-uh-inner{gap:9px}
#ei-unified-header .ei-uh-brand{gap:7px}
#ei-unified-header .ei-uh-logo{width:43px!important;height:43px!important;border-radius:10px!important;padding:2px!important}
#ei-unified-header .ei-uh-wordmark{font-size:clamp(15px,4.5vw,19px)!important;padding:8px 0 6px!important;border-bottom-width:2px!important;letter-spacing:-.045em!important}
#ei-unified-header .ei-uh-star{top:-.48em;font-size:.52em}
#ei-unified-header .ei-uh-motto{font-size:clamp(9px,2.65vw,12px)!important;line-height:1.2!important;flex:1 1 90px;max-width:46%}
#ei-unified-header .ei-uh-date{margin-top:3px!important}
}
@media(max-width:365px){
#ei-unified-header{padding:9px 8px!important}
#ei-unified-header .ei-uh-inner{gap:6px}
#ei-unified-header .ei-uh-logo{width:38px!important;height:38px!important}
#ei-unified-header .ei-uh-wordmark{font-size:15px!important}
#ei-unified-header .ei-uh-motto{font-size:9px!important}
}`;
document.head.appendChild(style);
const header=document.createElement("header");header.id="ei-unified-header";header.setAttribute("role","banner");
header.innerHTML='<div class="ei-uh-inner"><a class="ei-uh-brand" href="'+root.href+'" aria-label="Accueil de l’application Écurie Initial"><img class="ei-uh-logo" src="'+new URL("icon-ei-192.png",root).href+'" alt="Logo Écurie Initial" width="88" height="88"><span class="ei-uh-wordmark">ÉCURIE <span class="ei-uh-i">I<span class="ei-uh-star" aria-hidden="true">★</span></span>NITIAL</span></a><p class="ei-uh-motto"><span class="ei-uh-motto-line">PARTAGEONS NOTRE PASSION</span><span class="ei-uh-date">DEPUIS 2011</span></p></div>';
document.body.insertBefore(header,document.body.firstChild);
document.body.classList.add("ei-unified-header-active");
})();