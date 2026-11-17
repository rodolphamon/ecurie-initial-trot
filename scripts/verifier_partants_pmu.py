#!/usr/bin/env python3
"""Précontrôle de tous les partants confirmés sur le programme officiel PMU.

Vérifie avant le départ : date, hippodrome, réunion/course, n° et identité.
Si des codes RnCm ou des numéros manquent / sont incorrects, ne les remplace
que lorsqu'UNE SEULE course PMU contient le bon cheval, au bon hippodrome,
à l'heure attendue. Sinon : alerte GitHub, aucune supposition.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

from monitor_pmu_results import (
    ROOT, DATA, HORSES, PARIS, STATUSES,
    fetch_programme, fetch_participants, meetings,
    normalize, number, label,
)

EARLY = timedelta(hours=48)
LATE = timedelta(minutes=10)


def official_time(race):
    """Heure théorique PMU en Europe/Paris, si elle est fournie en millisecondes."""
    for field in ("heureDepart", "heureDepartTheorique", "heureDepartInitiale"):
        value = race.get(field)
        if isinstance(value, (float, int)) and 1_500_000_000_000 < value < 2_500_000_000_000:
            return datetime.fromtimestamp(value / 1000, tz=PARIS)
    return None


def race_candidates(programme, day, venue, hour):
    expected = datetime.fromisoformat(day + "T" + hour).replace(tzinfo=PARIS)
    for meeting in meetings(programme):
        if not isinstance(meeting, dict):
            continue
        num_r = number(meeting.get("numOfficiel") or meeting.get("numReunion") or meeting.get("numOrdre"))
        if not num_r or normalize(label(meeting.get("hippodrome"))) != normalize(venue):
            continue
        for race in meeting.get("courses", []):
            if not isinstance(race, dict):
                continue
            num_c = number(race.get("numOrdre") or race.get("numCourse"))
            if not num_c:
                continue
            when = official_time(race)
            # Ne pas associer un cheval à la mauvaise course de la réunion.
            if when is not None and abs((when - expected).total_seconds()) > 15 * 60:
                continue
            yield f"R{num_r}C{num_c}", race, when


def propose(day, venue, hour, horse_name, programme, fetch=fetch_participants):
    matches = []
    checked = []
    for code, race, when in race_candidates(programme, day, venue, hour):
        checked.append(code)
        try:
            entries = fetch(day, code)
        except Exception as exc:
            print(f"::warning title=Précontrôle PMU::{horse_name}: partants de {code} indisponibles ({type(exc).__name__})")
            continue
        exact = [p for p in entries if isinstance(p, dict)
                 and normalize(p.get("nom")) == normalize(horse_name) and number(p.get("numPmu"))]
        if len(exact) == 1:
            matches.append((code, number(exact[0]["numPmu"]), when))
    return matches, checked


def check(data, profiles, current, fetch_program=fetch_programme, fetch=fetch_participants):
    names = {p["id"]:p["name"] for p in profiles.get("horses", [])
             if isinstance(p, dict) and p.get("id") and p.get("name")}
    changes = []
    problems = []
    checked = 0
    cache = {}
    for slug, evs in data.get("engagements", {}).items():
        if not isinstance(evs, list) or slug not in names:
            continue
        for event in evs:
            if not isinstance(event, dict) or str(event.get("statut", "")).lower() not in STATUSES:
                continue
            day, hour, venue = event.get("date", ""), event.get("heure", ""), event.get("hippodrome", "")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not re.fullmatch(r"\d{2}:\d{2}", hour) or not venue:
                problems.append((slug, "Date, heure ou hippodrome incomplets"))
                continue
            departure = datetime.fromisoformat(day+"T"+hour).replace(tzinfo=PARIS)
            if not -LATE <= departure - current <= EARLY:
                continue
            if day not in cache:
                try:
                    cache[day], _ = fetch_program(day)
                except Exception as exc:
                    cache[day] = None
                    print(f"::warning title=Précontrôle PMU::Programme du {day} indisponible ({type(exc).__name__})")
            if cache[day] is None:
                problems.append((slug, "Programme PMU indisponible"))
                continue
            matches, codes_examined = propose(day, venue, hour, names[slug], cache[day], fetch)
            if len(matches) != 1:
                note = ("Cheval introuvable" if not matches else "Cheval présent dans plusieurs courses")
                problems.append((slug, f"{note}, {day} {venue} {hour} (candidates: {','.join(codes_examined)})"))
                continue
            new_code, new_bib, when = matches[0]
            old_code, old_bib = event.get("course", ""), number(event.get("numero"))
            if when is not None and abs((when-departure).total_seconds())>5*60:
                problems.append((slug, f"Heure à vérifier : {hour}, PMU {when.strftime('%H:%M')}"))
                continue
            checked += 1
            if new_code != old_code or new_bib != old_bib:
                event["course"] = new_code
                event["numero"] = new_bib
                changes.append((slug, day, old_code, old_bib, new_code, new_bib))
                print(f"[AVANT-COURSE] CORRECTION {slug} {day}: {old_code or '-'} n°{old_bib or '-'} -> {new_code} n°{new_bib} (identité PMU vérifiée)")
            else:
                print(f"[AVANT-COURSE] OK {slug} {day} {hour} {venue} {new_code} n°{new_bib}")
    for slug, reason in problems:
        print(f"::warning title=Partant à vérifier::{slug} : {reason}",file=sys.stderr)
    return changes, problems, checked


def self_test():
    programme = {"reunions":[{"numOfficiel":4,"hippodrome":{"libelleCourt":"AMIENS"},
        "courses":[
            {"numOrdre":3,"heureDepart":1795011300000},
            {"numOrdre":7,"heureDepart":1795019700000},
        ]}]}
    # Dates ci-dessus sont indépendantes de l'identité : seul le n° de course
    # du programme de 20:15 est retenu par la sélection.
    # Utiliser un programme de test à heures calculées, pour toute timezone.
    depart = datetime(2026,11,18,20,15,tzinfo=PARIS)
    programme["reunions"][0]["courses"][0]["heureDepart"] = int((depart-timedelta(hours=2)).timestamp()*1000)
    programme["reunions"][0]["courses"][1]["heureDepart"] = int(depart.timestamp()*1000)
    def fetch(day,code):
        return ([{"nom":"AUTRE CHEVAL","numPmu":4}] if code=="R4C3"
                else [{"nom":"ANDRESY","numPmu":4}])
    entries = {"engagements":{"andresy":[{
        "date":"2026-11-18","heure":"20:15","hippodrome":"Amiens",
        "statut":"partant","course":"C3","numero":4
    }]}}
    profiles = {"horses":[{"id":"andresy","name":"ANDRESY"}]}
    def fake_program(day):
        return programme, "pmu://test"
    changed,problems,count=check(entries,profiles,depart-timedelta(hours=3),fake_program,fetch)
    assert len(changed)==1 and not problems and count==1, (changed,problems)
    assert entries["engagements"]["andresy"][0]["course"]=="R4C7"
    changed,problems,count=check(entries,profiles,depart-timedelta(hours=3),fake_program,fetch)
    assert not changed and not problems and count==1
    bad = lambda day,code:[{"nom":"AUTRE CHEVAL","numPmu":4}]
    changed,problems,count=check(entries,profiles,depart-timedelta(hours=3),fake_program,bad)
    assert not changed and len(problems)==1 and count==0
    print("[OK] Précontrôle : C3 -> R4C7 seulement après vérification PMU unique")
    print("[OK] Aucune correction en cas d'identité absente ou ambiguë")


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--self-test",action="store_true")
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    if args.self_test:
        self_test()
        if not args.apply:return
    data=json.loads(DATA.read_text(encoding="utf-8"))
    profiles=json.loads(HORSES.read_text(encoding="utf-8"))
    now=datetime.now(PARIS)
    corrections,problems,checked=check(data,profiles,now)
    print(f"[AVANT-COURSE] {checked} vérification(s) confirmée(s), {len(corrections)} correction(s), {len(problems)} à vérifier")
    if corrections and args.apply:
        data["updated_at"]=now.date().isoformat()
        DATA.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    elif corrections:
        print("[AVANT-COURSE] Simulation, aucune écriture")
    if problems:
        print("::warning title=Contrôle incomplet::Un ou plusieurs partants nécessitent une vérification avant le départ")

if __name__ == "__main__":
    main()
