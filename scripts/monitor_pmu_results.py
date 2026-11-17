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
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/chevaux/data/editorial.json"
HORSES = ROOT / "docs/chevaux/data/chevaux.json"
PMU = "https://online.turfinfo.api.pmu.fr/rest/client/1"
STATUSES = {"partant", "declare"}
PARIS = ZoneInfo("Europe/Paris")
RESULT_DELAY = timedelta(minutes=12)
FAST_WINDOW = timedelta(minutes=90)
MAX_LOOKBACK = timedelta(hours=12)


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


def fetch_participants(day, code):
    digits = datetime.strptime(day, "%Y-%m-%d").strftime("%d%m%Y")
    code_match = re.fullmatch(r"R(\d+)C(\d+)", str(code), re.I)
    if not code_match:
        raise ValueError("Code réunion/course PMU invalide")
    n_reunion, n_course = code_match.groups()
    url = f"{PMU}/programme/{digits}/R{n_reunion}/C{n_course}/participants"
    req = urllib.request.Request(url, headers={
        "User-Agent": "EcurieInitial-ResultMonitor/1.0 (contact@ecurie-initial.com)",
        "Accept": "application/json",
        "Origin": "https://www.pmu.fr",
    })
    with urllib.request.urlopen(req, timeout=18) as response:
        data = json.load(response)
    if not isinstance(data, dict) or not isinstance(data.get("participants"), list):
        raise ValueError("Liste de partants PMU introuvable")
    return data["participants"]


def verify_identity(day, code, bib, expected_name):
    runners = fetch_participants(day, code)
    matches = [runner for runner in runners
               if isinstance(runner, dict) and number(runner.get("numPmu")) == bib]
    if len(matches) != 1:
        return False, "N° de programme introuvable ou ambigu"
    remote = normalize(matches[0].get("nom", ""))
    expected = normalize(expected_name)
    # La correspondance du nom est impérative : ne jamais déduire l'identité du seul dossard.
    if not remote or remote != expected:
        return False, f"Nom différent pour le n° {bib} : PMU={remote}; écurie={expected}"
    return True, None


def equidia_course_url(day, code):
    """Page de résultat Equidia (le replay peut ne pas être encore publié).

    URL fondée exclusivement sur la date et le code PMU RnCm vérifiés.
    Ne prétend pas que la vidéo est déjà disponible.
    """
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day or "")):
        raise ValueError("Date de course invalide pour Equidia")
    match = re.fullmatch(r"R(\d+)C(\d+)", str(code or ""), re.I)
    if not match:
        raise ValueError("Réunion/course PMU invalide pour Equidia")
    reunion, course = map(int, match.groups())
    return f"https://www.equidia.fr/courses/{day}/R{reunion}/C{course}"


def local_time(day, hour):
    if not isinstance(hour, str) or not re.fullmatch(r"\d{2}:\d{2}", hour):
        return None
    return datetime.fromisoformat(day + "T" + hour).replace(tzinfo=PARIS)


def due_events(data, current, early_minutes=0):
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
            if depart is None or not RESULT_DELAY - timedelta(minutes=early_minutes) <= current - depart <= MAX_LOOKBACK:
                continue
            # Ne jamais dupliquer ou remplacer un résultat saisi par l'écurie.
            existing = data.get("performances", {}).get(slug, [])
            if any(isinstance(p, dict) and p.get("date") == day
                   and normalize(p.get("hippodrome")) == normalize(evt.get("hippodrome")) for p in existing):
                continue
            result.append((slug, evt, bib))
    return result


def apply(data, current, is_dry_run=False, probe=False, finalized=None):
    horses = json.loads(HORSES.read_text(encoding='utf-8')).get('horses', [])
    horse_names = {h['id']: h['name'] for h in horses if isinstance(h, dict) and h.get('id') and h.get('name')}
    events = due_events(data, current)
    days = sorted({evt["date"] for _, evt, _ in events})
    if probe and not days:
        days = [current.date().isoformat(), (current.date() + timedelta(days=1)).isoformat()]
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
    if probe:
        tomorrow = (current.date() + timedelta(days=1)).isoformat()
        if tomorrow in cache:
            future_payload, _ = cache[tomorrow]
            for slug, entries in data.get("engagements", {}).items():
                for e in entries if isinstance(entries, list) else []:
                    if not isinstance(e, dict) or e.get("date") != tomorrow or str(e.get("statut", "")).lower() not in STATUSES:
                        continue
                    bib = number(e.get("numero"))
                    if not bib:
                        continue
                    race, race_error = find_race(future_payload, e.get("course", ""), e.get("hippodrome", ""))
                    if race_error:
                        print(f"[PMU] Vérification demain {slug} : {race_error}")
                        continue
                    expected = horse_names.get(slug, "")
                    try:
                        valid, error = verify_identity(tomorrow, e["course"], bib, expected)
                        print(f"[PMU] Vérification demain {slug}, {e['course']}, n°{bib} : "
                              + ("NOM ET COURSE CONFIRMÉS" if valid else f"NON CONFIRMÉ : {error}"))
                    except (ValueError, OSError, urllib.error.URLError, TimeoutError) as exc:
                        print(f"[PMU] Vérification demain {slug} : participants indisponibles ({type(exc).__name__})", file=sys.stderr)
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
            if race.get("arriveeDefinitive") is True and finalized is not None:
                # Fin de surveillance rapide après officialisation, même si le
                # cheval n'est pas classé (ne jamais en inventer le rang).
                finalized.add((slug, day, evt["course"], bib))
            rank, err = rank_in_arrival(race, bib)
            if err:
                print(f"[PMU] {slug} : {err}")
                continue
            expected_name = horse_names.get(slug)
            if not expected_name:
                print(f"[PMU] {slug} : nom de cheval non présent dans notre effectif")
                continue
            try:
                valid, error = verify_identity(day, evt["course"], bib, expected_name)
            except (ValueError, OSError, urllib.error.URLError, TimeoutError) as exc:
                print(f"[PMU] {slug} : identité non vérifiable : {type(exc).__name__} {str(exc)[:140]}", file=sys.stderr)
                continue
            if not valid:
                print(f"[PMU] {slug} : {error}")
                continue
            val = ("1er" if rank == 1 else f"{rank}e")
            # Lien créé au même instant que la performance officielle ;
            # le replay Equidia peut apparaître sur cette page plus tard.
            equidia_url = equidia_course_url(day, evt["course"])
            perf = {
                "date": day, "hippodrome": evt["hippodrome"],
                "rang": val, "officiel": True, "statut": "officiel",
                "source_description": f"PMU : arrivée définitive {evt['course']}, cheval n°{bib}",
                "source_url": "https://www.pmu.fr/turf/",
                "source_api": url, "course": evt["course"], "numero": bib,
                "video_url": equidia_url,
                "course_url": equidia_url,
                "video_source": "equidia_course",
            }
            # Le jockey/driver est déjà renseigné lors de la déclaration
            # du partant. Conserver son nom sur la performance officielle
            # dont date + réunion/course + numéro + identité ont été contrôlés.
            # Pas de nom inventé si la déclaration ne l'indique pas.
            for rider_field in ("jockey", "driver"):
                rider_name = evt.get(rider_field)
                if isinstance(rider_name, str) and rider_name.strip():
                    perf[rider_field] = rider_name.strip()
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


def event_key(item):
    slug, evt, bib = item
    return slug, evt["date"], evt["course"], bib


def poll_results(data, poll_seconds=240, interval_seconds=45, early_minutes=5):
    """Poll toutes les ~45 s après H+12, sans tenir un job actif hors courses.

    L'ordonnanceur GitHub est limité à 5 min et peut démarrer en retard.
    Chaque déclenchement prévu toutes les 5 min couvre sa tranche avec des
    interrogations rapprochées ; un contrôle de rattrapage existe jusqu'à H+12h.
    """
    if poll_seconds < 0 or interval_seconds <= 0 or not 0 <= early_minutes <= 10:
        raise ValueError("Paramètres de surveillance invalides")
    deadline = time.monotonic() + poll_seconds
    finalized = set()
    changed_any = False
    cycles = 0
    while True:
        current = datetime.now(PARIS)
        candidates = due_events(data, current, early_minutes=early_minutes)
        fast = [
            item for item in candidates
            if event_key(item) not in finalized
            and current - local_time(item[1]["date"], item[1]["heure"]) <= FAST_WINDOW
        ]
        active = due_events(data, current)
        if not fast:
            # Un résultat officialisé tardivement reste contrôlé à chaque
            # exécution de 5 min, sans monopoliser le runner.
            if cycles == 0 and active:
                changed_any |= apply(data, current, finalized=finalized)
            print("[PMU] Aucun partant nécessitant une surveillance rapprochée")
            break
        if active:
            cycles += 1
            changed_any |= apply(data, current, finalized=finalized)
        else:
            print("[PMU] Partant identifié : début de recherche à H+12 min")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            print("[PMU] Fin de cette tranche de contrôle, reprise au prochain déclenchement")
            break
        pending = [
            item for item in due_events(data, current, early_minutes=early_minutes)
            if event_key(item) not in finalized
            and current - local_time(item[1]["date"], item[1]["heure"]) <= FAST_WINDOW
        ]
        if not pending:
            print("[PMU] Toutes les arrivées recherchées sont officielles ou déjà enregistrées")
            break
        # Pour les courses à venir, attendre exactement H+12 au maximum ;
        # jamais interroger une arrivée avant ce seuil.
        next_delay = min(max(0., (local_time(e["date"], e["heure"]) + RESULT_DELAY - current).total_seconds())
                         for _, e, _ in pending)
        pause = min(interval_seconds, remaining)
        if not active and next_delay > 0:
            pause = min(pause, next_delay)
        if pause > 0:
            print(f"[PMU] Nouvelle vérification dans {pause:.0f} secondes")
            time.sleep(pause)
    return changed_any


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
    assert normalize("Maître d'Or") == normalize("MAITRE D OR")
    print("[PMU] Tests internes réussis : ex aequo, provisoire, lieu et non classé")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Active l'ajout des résultats définitifs")
    parser.add_argument("--probe", action="store_true", help="Teste aussi l'accès PMU sans course")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--poll", action="store_true",
                        help="Interroge le PMU toutes les 45 s autour des arrivées")
    parser.add_argument("--poll-seconds", type=int, default=240)
    parser.add_argument("--interval-seconds", type=int, default=45)
    args = parser.parse_args()
    if args.self_test:
        self_test()
    if not DATA.is_file():
        sys.exit("editorial.json absent")
    original = json.loads(DATA.read_text(encoding="utf-8"))
    if args.poll and args.apply:
        changed = poll_results(original, poll_seconds=args.poll_seconds,
                               interval_seconds=args.interval_seconds)
    else:
        changed = apply(original, datetime.now(PARIS), is_dry_run=not args.apply, probe=args.probe)
    if changed:
        print("[PMU] Changement prêt pour commit et publication GitHub Pages")
