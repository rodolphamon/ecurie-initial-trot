#!/usr/bin/env python3
"""Contrôle automatique des gains de carrière sur les fiches publiques LeTROT.

Ne recalcule JAMAIS les gains à partir des allocations ou des places : seul le
cumul « Gains Totaux » de la fiche officielle du bon cheval fait foi.
- Si le cumul LeTROT est supérieur : actualiser site et application.
- Si le cumul est inférieur, absent, ambigu ou inaccessible : ne rien écraser,
  signaler le contrôle à effectuer, puis réessayer au prochain passage.
- --recent : lors de la publication d'un nouveau résultat (14 jours).
- --all : chaque jour, y compris les non-classés et les fiches sans résultat.
Toutes les lectures réseau et tous les cas d'erreur sont non destructifs.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
EFFECTIF = ROOT / "docs/data/effectif-trot.json"
PROFILS = ROOT / "docs/chevaux/data/chevaux.json"
EDITORIAL = ROOT / "docs/chevaux/data/editorial.json"
PARIS = ZoneInfo("Europe/Paris")
RECENT_DAYS = 14
MAX_GAINS = 20_000_000


def normalized(value):
    s = unicodedata.normalize("NFD", str(value or "").upper())
    return re.sub(r"[^A-Z0-9]+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


class VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.headers = []
        self.suppress = 0
        self.in_heading = False
        self.heading = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.suppress += 1
        if tag == "h1" and not self.suppress:
            self.in_heading = True
            self.heading = []

    def handle_endtag(self, tag):
        if tag == "h1" and self.in_heading:
            self.headers.append(" ".join(self.heading).strip())
            self.in_heading = False
        if tag in ("script", "style", "noscript") and self.suppress:
            self.suppress -= 1

    def handle_data(self, data):
        if not self.suppress:
            self.parts.append(data)
            if self.in_heading:
                self.heading.append(data)


def parse_gains_totaux(html, expected_name):
    """Retourne le cumul entier uniquement si l'identité de la fiche est exacte."""
    parser = VisibleText()
    parser.feed(html)
    expected = normalized(expected_name)
    names = [normalized(x) for x in parser.headers if normalized(x)]
    if not expected or names.count(expected) != 1:
        raise ValueError("Identité LeTROT absente, différente ou ambiguë")
    text = " ".join(parser.parts)
    text = re.sub(r"\s+", " ", text.replace("\u202f", " ").replace("\xa0", " "))
    figures = re.findall(
        r"Gains\s+Totaux\s*:?\s*([0-9][0-9\s.,]{0,19})(?=\D|$)",
        text,
        flags=re.I,
    )
    if len(figures) != 1:
        raise ValueError("Rubrique « Gains Totaux » absente ou ambiguë")
    raw = figures[0].strip()
    # LeTROT publie un entier en euros (espaces de milliers admis).
    if not re.fullmatch(r"\d{1,3}(?:[ .]\d{3})*|\d{1,8}", raw):
        raise ValueError("Montant LeTROT non entier ou mal formé")
    amount = int(raw.replace(" ", "").replace(".", ""))
    if not 0 <= amount <= MAX_GAINS:
        raise ValueError("Montant LeTROT hors limites")
    return amount


def official_url(horse):
    url = str(horse.get("horseLink") or "").strip()
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    if (u.scheme != "https" or u.hostname not in ("www.letrot.com", "letrot.com")
            or u.username or u.password or u.port or u.query or u.fragment
            or not re.fullmatch(r"/(?:index\.php/)?stats/chevaux/[^/]+/[^/]+/courses/?", u.path, re.I)):
        return None
    return url


def fetch_page(url):
    request = urllib.request.Request(url, headers={
        "User-Agent": "EcurieInitial-GainsAudit/1.0 (contact@ecurie-initial.com)",
        "Accept": "text/html",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        final_url = urlsplit(response.geturl())
        if final_url.hostname not in ("www.letrot.com", "letrot.com"):
            raise ValueError("Redirection hors du site officiel LeTROT")
        if response.status != 200:
            raise ValueError("LeTROT HTTP " + str(response.status))
        if "text/html" not in response.headers.get("content-type", "").lower():
            raise ValueError("Réponse non HTML")
        # Evite qu'une réponse anormale ou énorme consomme toute la mémoire.
        raw = response.read(1_500_001)
        if len(raw) > 1_500_000:
            raise ValueError("Réponse LeTROT anormalement grande")
        return raw.decode("utf-8", errors="replace")


def recently_ran(slug, editorial, today):
    oldest = today - timedelta(days=RECENT_DAYS)
    for kind in ("performances", "engagements"):
        events = editorial.get(kind, {}).get(slug, [])
        for item in events if isinstance(events, list) else []:
            if not isinstance(item, dict):
                continue
            s = item.get("date")
            if not isinstance(s, str):
                continue
            try:
                d = date.fromisoformat(s)
            except ValueError:
                continue
            if oldest <= d <= today:
                return True
    return False


def reconcile(effectif, profiles, editorial, today, scope, fetch=fetch_page):
    """Modifie uniquement l'objet en mémoire. Retourne (changed, summary)."""
    horses = effectif.get("horses", {})
    names = {p["id"]: p for p in profiles.get("horses", [])
             if isinstance(p, dict) and p.get("id") and p.get("discipline") == "Trot"}
    report = {"checked": 0, "updated": [], "unchanged": [], "pending": [], "ignored": []}
    changed = False
    for slug, info in horses.items():
        if not isinstance(info, dict):
            continue
        if scope == "recent" and not recently_ran(slug, editorial, today):
            continue
        profile = names.get(slug)
        if profile is None:
            report["ignored"].append(slug)
            continue
        label = profile["name"]
        url = official_url(profile)
        if not url:
            report["pending"].append((slug, "Fiche publique LeTROT non renseignée"))
            print(f"::warning title=Gains non vérifiés::{slug} : lien officiel LeTROT manquant")
            continue
        try:
            html = fetch(url)
            official = parse_gains_totaux(html, label)
        except (ValueError, OSError, UnicodeError, TimeoutError, urllib.error.URLError) as exc:
            report["pending"].append((slug, type(exc).__name__))
            print(f"::warning title=Gains non vérifiés::{slug} : LeTROT inaccessible ou non exploitable ({type(exc).__name__})")
            continue
        report["checked"] += 1
        current = info.get("gains")
        if current is not None and (isinstance(current, bool) or not isinstance(current, int) or current < 0):
            report["pending"].append((slug, "Montant local invalide"))
            print(f"::warning title=Gains non vérifiés::{slug} : montant local non numérique")
            continue
        if current is not None and official < current:
            report["pending"].append((slug, "Source inférieure à la valeur conservée"))
            print(f"::warning title=Gains à recouper::{slug} : LeTROT indique {official} € contre {current} € enregistrés ; aucune baisse automatique")
            continue
        if current == official:
            report["unchanged"].append(slug)
            print(f"[GAINS] {slug}: cumul LeTROT inchangé ({official} €)")
            continue
        info["gains"] = official
        info["gains_source_url"] = url
        info["gains_verified_at"] = today.isoformat()
        info["gains_source"] = "LeTROT - Gains Totaux"
        changed = True
        report["updated"].append((slug, current, official))
        print(f"[GAINS] CONFIRMÉ {slug}: {current!r} -> {official} € ({url})")
    return changed, report


def tests():
    html = '<html><h1>LUCKY DES GAUDINES</h1><div>Gains Totaux</div><strong>43 285</strong><div>Record absolu</div></html>'
    assert parse_gains_totaux(html, "LUCKY DES GAUDINES") == 43285
    for sample, name in (
        (html, "MYRTILLE MARBOULA"),
        ('<h1>LUCKY DES GAUDINES</h1><div>Record</div><b>43285</b>', "LUCKY DES GAUDINES"),
        ('<h1>LUCKY DES GAUDINES</h1><b>Gains Totaux 43285</b><b>Gains Totaux 43285</b>', "LUCKY DES GAUDINES"),
        ('<h1>LUCKY DES GAUDINES</h1><b>Gains Totaux 43,285</b>', "LUCKY DES GAUDINES"),
    ):
        try:
            parse_gains_totaux(sample, name)
            raise AssertionError("Page ambiguë acceptée")
        except ValueError:
            pass
    profiles = {"horses": [
        {"id": "lucky", "name": "LUCKY DES GAUDINES", "discipline": "Trot",
         "horseLink": "https://www.letrot.com/stats/chevaux/LUCKY-DES-GAUDINES/ZmN8ZwMFAwoF/courses"},
        {"id": "myrtille", "name": "MYRTILLE MARBOULA", "discipline": "Trot",
         "horseLink": "https://www.letrot.com/stats/chevaux/myrtille-marboula/ZmBbYgAAAwQV/courses"},
        {"id": "mona", "name": "MONA LISA STARDUST", "discipline": "Trot", "horseLink": None},
    ]}
    editorial = {"performances": {"lucky": [{"date": "2026-11-16"}],
                                 "mona": [{"date": "2026-11-15"}]}}
    rows = {"horses": {"lucky": {"gains": 34600},
                      "myrtille": {"gains": 72115}, "mona": {"gains": 21040}}}
    page = {
        "lucky": html,
        "myrtille": '<h1>MYRTILLE MARBOULA</h1> Gains Totaux <b>43 315</b>',
    }
    def mock_fetch(url):
        return page["lucky" if "LUCKY" in url else "myrtille"]
    changed, rep = reconcile(rows, profiles, editorial, date(2026, 11, 17), "recent", mock_fetch)
    assert changed and rep["updated"] == [("lucky", 34600, 43285)]
    assert rows["horses"]["myrtille"]["gains"] == 72115
    assert len(rep["pending"]) == 1 and rep["pending"][0][0] == "mona"
    changed, rep = reconcile(rows, profiles, editorial, date(2026, 11, 17), "all", mock_fetch)
    assert not changed and rows["horses"]["lucky"]["gains"] == 43285
    assert any(slug == "myrtille" for slug, _ in rep["pending"])
    assert official_url({"horseLink": "https://evil.test/stats/chevaux/a/b/courses"}) is None
    assert official_url({"horseLink": "https://www.letrot.com.evil.test/stats/chevaux/a/b/courses"}) is None
    assert official_url({"horseLink": "https://www.letrot.com/stats/chevaux/a/b/courses?redirect=evil"}) is None
    print("[OK] Gains LeTROT : identité, cumul unique, valeurs aberrantes, URL officielle")
    print("[OK] Mise à jour hausse seulement ; pas de baisse ; liens manquants signalés")
    print("[OK] Contrôle récent + contrôle quotidien ; aucun accès réseau ni écriture pendant les tests")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Appliquer uniquement les hausses LeTROT vérifiées")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--recent", action="store_true", help="Après une course : résultats des 14 derniers jours")
    group.add_argument("--all", action="store_true", help="Vérifier tous les trotteurs, dont les non-classés")
    args = parser.parse_args()
    if args.self_test:
        tests()
        if not (args.apply or args.recent or args.all):
            return
    if not EFFECTIF.is_file() or not PROFILS.is_file() or not EDITORIAL.is_file():
        sys.exit("Fichier source des chevaux manquant")
    effectif = json.loads(EFFECTIF.read_text(encoding="utf-8"))
    profiles = json.loads(PROFILS.read_text(encoding="utf-8"))
    editorial = json.loads(EDITORIAL.read_text(encoding="utf-8"))
    today = datetime.now(PARIS).date()
    changed, report = reconcile(effectif, profiles, editorial, today,
                                "all" if args.all or not args.recent else "recent")
    print(f"[GAINS] Bilan : {report['checked']} fiches lues, "
          f"{len(report['updated'])} hausse(s), {len(report['pending'])} en attente")
    if report["pending"]:
        print("[GAINS] À vérifier : " + ", ".join(name for name, _ in report["pending"]))
    if changed and args.apply:
        effectif["updated_at"] = today.isoformat()
        EFFECTIF.write_text(json.dumps(effectif, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("[GAINS] Cumuls officiels mis à jour : site et application après déploiement Pages")
    elif changed:
        print("[GAINS] Simulation : hausses détectées mais aucune modification")
    else:
        print("[GAINS] Aucun nouveau cumul supérieur vérifié ; données conservées")


if __name__ == "__main__":
    main()
