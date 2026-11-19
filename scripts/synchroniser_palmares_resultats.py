#!/usr/bin/env python3
"""Propage les podiums PMU definitifs des fiches chevaux vers le palmares.

Seules les performances du moniteur PMU, apres la base historique validee,
peuvent creer une entree. La casaque/identite de l'effectif et les declarations
de course sont recoupees pour eviter d'attribuer un succes d'un tiers.
L'operation est idempotente : les entrees deja publiees ne sont jamais dupliquees.
"""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDITORIAL = ROOT / "docs/chevaux/data/editorial.json"
HORSES = ROOT / "docs/chevaux/data/chevaux.json"
WINS = ROOT / "docs/palmares/victoires-a-ajouter.json"
PODIUMS = ROOT / "docs/palmares/podiums.json"
PMU_SOURCE = "https://online.turfinfo.api.pmu.fr/rest/client/1/programme/"


def normalized(value):
    value = unicodedata.normalize("NFD", str(value or "").upper())
    return re.sub(r"[^A-Z0-9]+", " ", "".join(
        char for char in value if not unicodedata.combining(char))).strip()


def entry_key(value):
    return (value.get("date", ""), normalized(value.get("cheval")),
            normalized(value.get("hippodrome")))


def rank(value):
    value = normalized(value).replace(" ", "")
    return {"1ER": 1, "1E": 1, "2E": 2, "2EME": 2,
            "3E": 3, "3EME": 3}.get(value)


def racing_type(horse, engagement):
    stated = normalized(engagement.get("type"))
    discipline = normalized(horse.get("discipline"))
    if discipline == "TROT":
        return "monte" if "MONTE" in stated else "attele"
    if discipline == "OBSTACLE" or any(
        value in stated for value in ("HAIES", "STEEPLE", "CROSS", "OBSTACLE")
    ):
        return "obstacle"
    if discipline == "PLAT":
        return "galop"
    return None


def ownership(horse, engagement, discipline):
    """The declared owner (when supplied) always overrides the current silks."""
    casaque = normalized(horse.get("casaque"))
    if discipline in ("galop", "obstacle"):
        if casaque != "GALOP":
            return None
        fallback = "Écurie Initial"
        allowed = {"ECURIE INITIAL", "EURL ECURIE INITIAL",
                   "RODOLPHE HAMON", "HAMON RODOLPHE"}
    else:
        if casaque == "BLANCHE":
            fallback = "Écurie Initial"
        elif casaque in ("ORANGE", "NATHALIE"):
            fallback = "Nathalie HAMON"
        else:
            return None
        allowed = {"ECURIE INITIAL", "EURL ECURIE INITIAL",
                   "RODOLPHE HAMON", "HAMON RODOLPHE",
                   "NATHALIE HAMON", "HAMON NATHALIE"}
    actual = str(engagement.get("proprietaire", "")).strip()
    if actual and normalized(actual) not in allowed:
        return None
    return actual or fallback


def valid_engagement(data, slug, performance):
    for event in data.get("engagements", {}).get(slug, []):
        if not isinstance(event, dict):
            continue
        if (event.get("date") == performance.get("date")
                and normalized(event.get("hippodrome")) == normalized(performance.get("hippodrome"))
                and normalized(event.get("course")) == normalized(performance.get("course"))
                and str(event.get("numero", "")) == str(performance.get("numero", ""))):
            return event
    return None


def synchronize(editorial, horses, wins, podiums):
    by_id = {item.get("id"): item for item in horses.get("horses", [])
             if isinstance(item, dict) and item.get("id") and item.get("name")}
    base_day = wins.get("date_reference", "")
    win_rows = wins.setdefault("victoires", [])
    podium_rows = podiums.setdefault("podiums", [])
    existing = {entry_key(v) for v in win_rows + podium_rows}
    changed_wins = 0
    changed_podiums = 0

    for slug, performances in editorial.get("performances", {}).items():
        horse = by_id.get(slug)
        if not horse or not isinstance(performances, list):
            continue
        for performance in performances:
            if not isinstance(performance, dict):
                continue
            day = performance.get("date", "")
            placing = rank(performance.get("rang"))
            if (not isinstance(day, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day)
                    or day <= base_day or placing is None
                    or performance.get("officiel") is not True
                    or not str(performance.get("source_api", "")).startswith(PMU_SOURCE)):
                continue
            event = valid_engagement(editorial, slug, performance)
            if not event:
                continue
            discipline = racing_type(horse, event)
            if not discipline:
                continue
            owner = ownership(horse, event, discipline)
            if not owner:
                continue
            key = (day, normalized(horse["name"]), normalized(performance.get("hippodrome")))
            if key in existing:
                continue
            jockey = (performance.get("jockey") or performance.get("driver")
                      or event.get("jockey") or event.get("driver") or "")
            trainer = event.get("entraineur") or horse.get("trainer") or ""
            casaque = ("galop" if discipline in ("galop", "obstacle")
                       else "nathalie" if normalized(horse.get("casaque")) in ("ORANGE", "NATHALIE")
                       else "blanche")
            row = {
                "date": day, "cheval": horse["name"],
                "hippodrome": normalized(performance.get("hippodrome")),
                "discipline": discipline,
                "jockey": str(jockey).strip(),
                "entraineur": str(trainer).strip(),
                "proprietaire": owner,
                "casaque": casaque,
                "compteInitial": True,
            }
            official_link = performance.get("course_url") or performance.get("video_url")
            if isinstance(official_link, str) and official_link.startswith(
                    "https://www.equidia.fr/courses/" + day + "/"):
                row["source_officielle"] = official_link
            if placing == 1:
                win_rows.append(row)
                changed_wins += 1
            else:
                row["classement"] = placing
                podium_rows.insert(0, row)
                changed_podiums += 1
            existing.add(key)
    podium_rows.sort(key=lambda p: p.get("date", ""), reverse=True)
    return changed_wins, changed_podiums


def tests():
    horses = {"horses": [
        {"id": "alpha", "name": "ALPHA", "discipline": "Plat",
         "casaque": "galop", "trainer": "Gilles PANNIER"},
        {"id": "beta", "name": "BETA", "discipline": "Trot",
         "casaque": "orange", "trainer": "Mathieu TEST"},
    ]}
    def make(slug, placing, owner=None, day="2026-11-20"):
        e = {"date": day, "heure": "12:00", "hippodrome": "Saint-Cloud",
             "course": "R1C6", "numero": 7, "type": "Plat"}
        if owner:
            e["proprietaire"] = owner
        p = {"date": day, "hippodrome": "Saint Cloud", "course": "R1C6",
             "numero": 7, "rang": placing, "officiel": True,
             "source_api": PMU_SOURCE + "20112026",
             "video_url": "https://www.equidia.fr/courses/" + day + "/R1/C6"}
        return e, p
    event, performance = make("alpha", "1er")
    data = {"engagements": {"alpha": [event]}, "performances": {"alpha": [performance]}}
    wins = {"date_reference": "2026-11-13", "victoires": []}
    podiums = {"podiums": []}
    assert synchronize(data, horses, wins, podiums) == (1, 0)
    assert wins["victoires"][0]["proprietaire"] == "Écurie Initial"
    assert synchronize(data, horses, wins, podiums) == (0, 0)  # no duplicates
    event2, perf2 = make("beta", "2e")
    event2["type"] = "Trot attelé"
    data["engagements"]["beta"] = [event2]
    data["performances"]["beta"] = [perf2]
    assert synchronize(data, horses, wins, podiums) == (0, 1)
    assert podiums["podiums"][0]["proprietaire"] == "Nathalie HAMON"
    assert podiums["podiums"][0]["casaque"] == "nathalie"
    event2["proprietaire"] = "Arnaud PUSKAS"   # unallowed owner, never count
    perf2["date"] = "2026-11-21"
    event2["date"] = "2026-11-21"
    assert synchronize(data, horses, wins, podiums) == (0, 0)
    event2["proprietaire"] = "Nathalie HAMON"
    perf2["rang"] = "3e"
    perf2["officiel"] = False
    assert synchronize(data, horses, wins, podiums) == (0, 0)
    perf2["officiel"] = True
    assert synchronize(data, horses, wins, podiums) == (0, 1)
    assert podiums["podiums"][0]["classement"] == 3
    print("[OK] Palmarès : victoires, podiums, propriétaire tiers, officiels et doublons")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        tests()
    if not args.apply:
        if not args.self_test:
            parser.error("Choisir --apply ou --self-test")
        return
    paths = (EDITORIAL, HORSES, WINS, PODIUMS)
    editorial, horses, wins, podiums = [
        json.loads(path.read_text(encoding="utf-8")) for path in paths]
    w, p = synchronize(editorial, horses, wins, podiums)
    if w:
        WINS.write_text(json.dumps(wins, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if p:
        PODIUMS.write_text(json.dumps(podiums, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[PALMARÈS] {w} nouvelle(s) victoire(s), {p} nouveau(x) podium(s) ; doublons ignorés")


if __name__ == "__main__":
    main()
