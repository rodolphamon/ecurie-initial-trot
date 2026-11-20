#!/usr/bin/env python3
"""Contrôles de non-régression de l'application Écurie Initial.

Lecture seule, aucune requête réseau, aucune donnée privée consultée.
Exécution : python scripts/verifier_application.py
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
problems = []
checked_scripts = 0


def check(condition: bool, message: str):
    if not condition:
        problems.append(message)


def read(path: str) -> str:
    target = ROOT / path
    check(target.is_file(), f"Fichier manquant : {path}")
    return target.read_text(encoding="utf-8") if target.is_file() else ""


admin = read("docs/application/administration/index.html")
edge = read("supabase/functions/gerer-associes/index.ts")
home = read("docs/application/index.html")
login = read("docs/application/connexion/index.html")
horses_page = read("docs/application/mes-chevaux/index.html")
tribune = read("docs/application/tribune/index.html")
notifications = read("docs/application/notifications/index.html")

# Les actions appelées par le formulaire d'administration doivent toutes exister
# dans la fonction déployable : cette régression a déjà masqué les statistiques.
called = set(re.findall(r"action\s*:\s*['\"]([a-z_]+)['\"]", admin))
handled = set(re.findall(r"body\.action\s*===\s*['\"]([a-z_]+)['\"]", edge))
member_block = re.search(r"const memberActions\s*=\s*new Set\(\[([\s\S]*?)\]\)", edge)
if member_block:
    handled.update(re.findall(r"['\"]([a-z_]+)['\"]", member_block.group(1)))
check(bool(called), "Aucune action d'administration reconnue")
check(not (called - handled), "Commandes sans gestionnaire Supabase : " + ", ".join(sorted(called - handled)))
check("list_registration_status" in called and "list_registration_status" in handled, "Suivi d'inscriptions absent")
check("ei_lancement_pret" in edge and "inviteUserByEmail" in edge, "Protection de préouverture / invitation absente")
check("!me.administrateur" in edge, "Contrôle du rôle administrateur absent")

# Le rôle Presse est public uniquement. Ne pas l'assimiler à un associé.
check("type_compte==='presse'" in login, "Rôle Presse absent de la connexion")
check("press?.actif&&press.type_compte==='presse'" in login, "Le parcours Presse avant lancement a disparu")
check("type_compte==='presse'" in home, "Rôle Presse absent de l'accueil")
check("['associe','observateur'].includes(member.type_compte)" in horses_page, "Mes chevaux : contrôle des rôles fragilisé")
check("['associe','exterieur','observateur'].includes(member.type_compte)" in tribune, "Tribune : contrôle des rôles fragilisé")
check("['associe','observateur'].includes(a.type_compte)" in notifications, "Notifications : rôle Presse assimilé à un associé")

# Les pages principales ne doivent pas être supprimées.
for page in (
    "docs/application/index.html",
    "docs/application/connexion/index.html",
    "docs/application/inscription/index.html",
    "docs/application/administration/index.html",
    "docs/application/notifications/index.html",
    "docs/application/mes-chevaux/index.html",
    "docs/application/tribune/index.html",
    "docs/application/team-initial/index.html",
    "docs/application/contact/index.html",
    "docs/application/contribution/index.html",
    "docs/application/actualites/index.html",
    "docs/application/sw.js",
):
    check((ROOT / page).is_file(), "Écran ou ressource disparu : " + page)

# Vérifier la syntaxe de chaque script JavaScript présent dans les pages HTML.
for path in sorted((ROOT / "docs/application").rglob("*.html")):
    text = path.read_text(encoding="utf-8")
    for index, match in enumerate(re.finditer(r"<script\b([^>]*)>([\s\S]*?)</script\s*>", text, flags=re.I)):
        attrs, code = match.groups()
        if not code.strip() or re.search(r'type=["\']application/(?:json|ld\+json)["\']', attrs, flags=re.I):
            continue
        with tempfile.TemporaryDirectory() as tmp:
            filename = Path(tmp) / "check.mjs"
            filename.write_text(code, encoding="utf-8")
            result = subprocess.run(["node", "--check", str(filename)], capture_output=True, text=True)
            checked_scripts += 1
            check(result.returncode == 0, f"JavaScript invalide : {path.relative_to(ROOT)} script {index + 1} — {result.stderr.strip()[:260]}")

# Vérifier les sources éditoriales sans imposer un nombre fixe de chevaux.
for path in (
    "docs/chevaux/data/chevaux.json",
    "docs/chevaux/data/editorial.json",
    "docs/chevaux/data/qualifications.json",
):
    try:
        data = json.loads(read(path))
        check(isinstance(data, dict), f"JSON inattendu : {path}")
        if path.endswith("chevaux.json"):
            entries = data.get("horses", []) if isinstance(data, dict) else []
            check(isinstance(entries, list) and bool(entries), "Effectif vide ou invalide")
            slugs = [h.get("id") for h in entries if isinstance(h, dict)]
            check(len(slugs) == len(set(slugs)), "Doublon d'identifiant cheval")
    except (ValueError, TypeError) as exc:
        problems.append(f"JSON invalide : {path} ({exc})")

if problems:
    print("❌ Contrôles Écurie Initial :")
    for problem in problems:
        print(" - " + problem)
    sys.exit(1)

print(f"✅ Contrôles réussis : {len(called)} commandes d'administration, {checked_scripts} scripts JS et données chevaux valides.")
