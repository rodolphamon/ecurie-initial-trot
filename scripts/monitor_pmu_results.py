#!/usr/bin/env python3
"""Surveille uniquement les arrivées définitives PMU de partants connus de l'Écurie Initial.

Lecture : docs/chevaux/data/editorial.json
Écriture : même fichier, seulement si le n° du cheval est dans l'ordre d'arrivée
d'une course explicitement marquée arriveeDefinitive=true par le PMU.
Aucune publication de non-classé/disqualifié par déduction.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/chevaux/data/editorial.json"
PMU = "https://online.turfinfo.api.pmu.fr/rest/client/1"
STATUSES = {"partant", "declare"}
PARIS = ZoneInfo("Europe/Paris")


def normalize(value):
    text = unicodedata.normalize("NFD", str(value or "").upper())
    return re.sub(r"[^A-Z0-9]+", " ", "".join(ch for ch in text if not unicodedata.combining(ch))).strip()


def number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str) and re.fullmatch(r"\s*\d{1,3}\s*", value):
        n = int(value)
        return n if n > 0 else None
    return None


def label(value):
    if isinstance(value, dict):
        return str(value.get("libelleCourt") or value.get("libelleLong") or value.get("libelle") or value.get("nom") or "")
    return str(value or "")


def meetings(raw):
    # PMU renvoie généralement {"reunions":[...]}; reconnaître aussi l'enveloppe "programme".
    if not isinstance(raw, dict):
        raise ValueError("Format PMU inattendu : racine")
    outer = raw.get("programme", raw)
    if isinstance(outer, dict):
        items = outer.get("reunions")
    else:
        items = outer if isinstance(outer, list) else None
    if not isinstance(items, list):
        raise ValueError("Format PMU inattendu : réunions absentes")
    return items


def find_race(payload, code, venue):
    m = re.fullmatch(r"R(\d+)C(\d+)", str(code or "").upper().replace(" ", ""))
    if not m:
        return None, "Code PMU RnCm absent"
    r_num, c_num = map(int, m.groups())
    for meeting in meetings(payload):
        if not isinstance(meeting, dict):
            continue
        num_r = number(meeting.get("numOfficiel") or meeting.get("numReunion") or meeting.get("numOrdre"))
        if num_r != r_num:
            continue
        actual_venue = label(meeting.get("hippodrome"))
        if normalize(venue) != normalize(actual_venue):
            return None, "Hippodrome différent (PMU : " + actual_venue + ")"
        for race in meeting.get("courses", []):
            if not isinstance(race, dict):
                continue
            num_c = number(race.get("numOrdre") or race.get("numCourse"))
            if num_c == c_num:
                return race, None
    return None, "Course absente du programme PMU"


def rank_in_arrival(race, target):
    if race.get("arriveeDefinitive") is not True:
        return None, "Arrivée pas encore définitive"
    arrival = race.get("ordreArrivee")
    if not isinstance(arrival, list) or not arrival:
        return None, "Ordre d'arrivée absent"
    places = 0
    for group in arrival:
        if not isinstance(group, list):
            group = [group]
        group_nums = [number(v) for v in group]
        if any(v is None for v in group_nums):
            return None, "Groupe d'arrivée non numérique"
        if target in group_nums:
            return places + 1, None
        places += len(group_nums)
    return None, "Cheval absent des chevaux classés, aucune déduction"


def fetch_programme(day):
    digits = datetime.strptime(day, "%Y-%m-%d").strftime("%d%m%Y")
    url = f"{PMU}/programme/{digits}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "EcurieInitial-ResultMonitor/1.0 (contact@ecurie-initial.com)",
        "Accept": "application/json",
        "Origin": "https://www.pmu.fr",
    })
    with urllib.request.urlopen(req, timeout=18) as resp:
        if resp.status != 200:
            raise OSError(f"PMU HTTP {resp.status}")
        return json.load(resp), url


def local_time(day, hour):
    if not isinstance(hour, str) or not re.fullmatch(r"\d{2}:\d{2}", hour):
        return None
    return datetime.fromisoformat(day + "T" + hour).replace(tzinfo=PARIS)


def due_events(data, current):
    result = []
    for slug, events in data.get("engagements", {}).items():
        if not isinstance(events, list):
            continue
        for evt in events:
            if not isinstance(evt, dict) or evt.get("statut", "").lower() not in STATUSES:
                continue
            day, hour = evt.get("date", ""), evt.get("heure", "")
            code, bib = evt.get("course", ""), number(evt.get("numero"))
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not re.fullmatch(r"R\d+C\d+", str(code), re.I) or not bib:
                continue
            depart = local_time(day, hour)
            if depart is None or not timedelta(minutes=2) <= current - depart <= timedelta(hours=12):
                continue
            # Ne jamais dupliquer ou remplacer un résultat saisi par l'écurie.
            existing = data.get("performances", {}).get(slug, [])
            if any(isinstance(p, dict) and p.get("date") == day
                   and normalize(p.get("hippodrome")) == normalize(evt.get("hippodrome")) for p in existing):
                continue
            result.append((slug, evt, bib))
    return result


def apply(data, current, is_dry_run=False, probe=False):
    events = due_events(data, current)
    days = sorted({evt["date"] for _, evt, _ in events})
    if probe and not days:
        days = [current.date().isoformat()]
    print(f"[PMU] Date Paris : {current.isoformat(timespec='minutes')} ; {len(events)} partant(s) à examiner")
    cache = {}
    updates = []
    for day in days:
        try:
            payload, url = fetch_programme(day)
            groups = meetings(payload)
            cache[day] = (payload, url)
            print(f"[PMU] Source HTTP OK : {day} ; {len(groups)} réunion(s)")
        except (ValueError, OSError, urllib.error.URLError, TimeoutError) as exc:
            print(f"[PMU] Source indisponible pour {day} : {type(exc).__name__} {str(exc)[:180]}", file=sys.stderr)
            continue
    for slug, evt, bib in events:
        day = evt["date"]
        if day not in cache:
            continue
        payload, url = cache[day]
        try:
            race, err = find_race(payload, evt["course"], evt["hippodrome"])
            if err:
                print(f"[PMU] {slug} : {err}")
                continue
            rank, err = rank_in_arrival(race, bib)
            if err:
                print(f"[PMU] {slug} : {err}")
                continue
            val = ("1er" if rank == 1 else f"{rank}e")
            perf = {
                "date": day, "hippodrome": evt["hippodrome"],
                "rang": val, "officiel": True, "statut": "officiel",
                "source_description": f"PMU : arrivée définitive {evt['course']}, cheval n°{bib}",
                "source_url": "https://www.pmu.fr/turf/",
                "source_api": url, "course": evt["course"], "numero": bib,
            }
            updates.append((slug, perf))
            print(f"[PMU] CONFIRMÉ : {slug}, {evt['course']}, n°{bib}, {val}")
        except (ValueError, TypeError, KeyError) as exc:
            print(f"[PMU] {slug} : donnée non exploitable : {str(exc)[:180]}", file=sys.stderr)
    if is_dry_run:
        print(f"[PMU] Essai à blanc : {len(updates)} performance(s) repérée(s), aucune écriture")
        return False
    if not updates:
        print("[PMU] Aucune modification")
        return False
    # Ne pas modifier d'autres données : insertion uniquement de performances vérifiées.
    for slug, perf in updates:
        data.setdefault("performances", {}).setdefault(slug, []).insert(0, perf)
    data["updated_at"] = current.date().isoformat()
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[PMU] {len(updates)} résultat(s) définitif(s) ajouté(s) à {DATA}")
    return True


def self_test():
    fixture = {"reunions": [{"numOfficiel": 1, "hippodrome": {"libelleCourt": "CHANTILLY"},
                             "courses": [{"numOrdre": 7, "arriveeDefinitive": True,
                                          "ordreArrivee": [[3], [5, 8], [9]]}]}]}
    race, err = find_race(fixture, "R1C7", "Chantilly")
    assert err is None and race
    assert rank_in_arrival(race, 5) == (2, None)
    assert rank_in_arrival(race, 9) == (4, None)
    assert rank_in_arrival(race, 4)[0] is None
    race["arriveeDefinitive"] = False
    assert rank_in_arrival(race, 5)[0] is None
    assert find_race(fixture, "R1C7", "Deauville")[0] is None
    print("[PMU] Tests internes réussis : ex aequo, provisoire, lieu et non classé")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Active l'ajout des résultats définitifs")
    parser.add_argument("--probe", action="store_true", help="Teste aussi l'accès PMU sans course")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if not DATA.is_file():
        sys.exit("editorial.json absent")
    original = json.loads(DATA.read_text(encoding="utf-8"))
    changed = apply(original, datetime.now(PARIS), is_dry_run=not args.apply, probe=args.probe)
    if changed:
        print("[PMU] Changement prêt pour commit et publication GitHub Pages")
