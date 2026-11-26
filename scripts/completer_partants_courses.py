#!/usr/bin/env python3
"""Publie la liste PMU des courses des chevaux déclarés ou partants (J à J+3)."""
import argparse
import json
import urllib.request
from datetime import datetime, timedelta

import monitor_pmu_results as pmu
from completer_arrivees_historiques import venue_key

OUTPUT = pmu.ROOT / "docs/chevaux/data/partants-courses.json"


def roster(day, venue, slug, name, event, programme, fetch=pmu.fetch_participants):
    matches = []
    for meeting in pmu.meetings(programme):
        if venue_key(pmu.label(meeting.get("hippodrome"))) != venue_key(venue):
            continue
        for race in meeting.get("courses", []):
            code = f"R{pmu.number(meeting.get('numOfficiel'))}C{pmu.number(race.get('numOrdre'))}"
            if event.get("course") and str(event["course"]).upper() != code:
                continue
            entries = fetch(day, code)
            own = [p for p in entries if pmu.normalize(p.get("nom")) == pmu.normalize(name)]
            if len(own) != 1 or not pmu.number(own[0].get("numPmu")):
                continue
            if event.get("numero") and pmu.number(event["numero"]) != pmu.number(own[0]["numPmu"]):
                continue
            if own[0].get("statut") not in ("PARTANT",):
                continue
            key = "driver" if pmu.normalize(race.get("discipline")) == "ATTELE" else "jockey"
            rows = []
            for p in entries:
                if not pmu.number(p.get("numPmu")) or not p.get("nom"):
                    continue
                row = {"numero": pmu.number(p["numPmu"]), "cheval": p["nom"]}
                person = pmu.label(p.get("driver") or p.get("jockey")).strip()
                if person:
                    row[key] = person
                if p.get("statut") == "NON_PARTANT":
                    row["non_partant"] = True
                rows.append(row)
            expected = pmu.number(race.get("nombreDeclaresPartants"))
            if expected and len(rows) < expected:
                continue
            matches.append({"date": day, "hippodrome": venue, "course": code,
                            "cheval_slug": slug, "partants": sorted(rows, key=lambda p: p["numero"]),
                            "source_api": f"{pmu.PMU}/programme/{day[8:10]}{day[5:7]}{day[:4]}/{code.replace('C','/C')}/participants"})
    return matches[0] if len(matches) == 1 else None


def self_test():
    programme = {"reunions": [{"numOfficiel": 4, "hippodrome": {"libelleCourt": "MAUQUENCHY"},
                               "courses": [{"numOrdre": 4, "discipline": "ATTELE", "nombreDeclaresPartants": 2}]}]}
    entries = [{"numPmu": 12, "nom": "MOONDANCE OKINA", "driver": "S. OLIVIER", "statut": "PARTANT"},
               {"numPmu": 1, "nom": "AUTRE CHEVAL", "driver": "A. AUTRE", "statut": "NON_PARTANT"}]
    fake = lambda day, code: entries
    row = roster("2026-11-26", "Mauquenchy", "moondance-okina", "MOONDANCE OKINA", {"course": "R4C4", "numero": 12}, programme, fake)
    assert row and row["partants"][0]["non_partant"] and row["partants"][1]["driver"] == "S. OLIVIER"
    assert roster("2026-11-26", "Mauquenchy", "moondance-okina", "MAUVAIS NOM", {}, programme, fake) is None
    assert roster("2026-11-26", "Mauquenchy", "moondance-okina", "MOONDANCE OKINA", {"numero": 3}, programme, fake) is None
    assert roster("2026-11-26", "Autre hippodrome", "moondance-okina", "MOONDANCE OKINA", {}, programme, fake) is None
    assert roster("2026-11-26", "Mauquenchy", "moondance-okina", "MOONDANCE OKINA", {}, programme, lambda d,c: entries[:1]) is None
    print("[OK] Partants : identité, numéro, hippodrome, liste complète et non-partants vérifiés")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    data = json.loads(pmu.DATA.read_text(encoding="utf-8"))
    profiles = json.loads(pmu.HORSES.read_text(encoding="utf-8"))["horses"]
    names = {p["id"]: p["name"] for p in profiles}
    try:
        request = urllib.request.Request(
            "https://yeecwaaizmvrhwobukfa.supabase.co/rest/v1/ei_contributions_engagements?select=cheval_slug,engagements",
            headers={"apikey": "sb_publishable_xUy2EJA3u3cKWl8BB4GNPQ_qhV9Pes3"})
        with urllib.request.urlopen(request, timeout=15) as response:
            for row in json.load(response):
                if row["cheval_slug"] in names and isinstance(row.get("engagements"), list):
                    data["engagements"][row["cheval_slug"]] = row["engagements"]
    except (OSError, ValueError) as exc:
        print(f"[PARTANTS] Contributions indisponibles : {type(exc).__name__}")
    today = datetime.now(pmu.PARIS).date()
    limit = today + timedelta(days=3)
    previous = json.loads(OUTPUT.read_text(encoding="utf-8")) if OUTPUT.exists() else {"courses": []}
    courses, programmes = [], {}
    for slug, events in data["engagements"].items():
        if slug not in names:
            continue
        for event in events:
            day = event.get("date", "")
            if event.get("statut") not in pmu.STATUSES or not today.isoformat() <= day <= limit.isoformat():
                continue
            try:
                if day not in programmes:
                    programmes[day] = pmu.fetch_programme(day)[0]
                result = roster(day, event["hippodrome"], slug, names[slug], event, programmes[day])
                if result:
                    courses.append(result)
                    print(f"[PARTANTS] {slug} {day} {result['course']} : {len(result['partants'])} concurrents vérifiés")
                else:
                    print(f"[PARTANTS] {slug} {day} : liste officielle à venir")
            except (OSError, ValueError) as exc:
                print(f"[PARTANTS] {slug} : source indisponible ({type(exc).__name__})")
                courses.extend(c for c in previous["courses"] if c["cheval_slug"] == slug and c["date"] == day)
    courses.sort(key=lambda c: (c["date"], c["course"], c["cheval_slug"]))
    if courses != previous.get("courses") or not OUTPUT.exists():
        if args.apply:
            OUTPUT.write_text(json.dumps({"updated_at": today.isoformat(), "courses": courses}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"[PARTANTS] {len(courses)} listes {'enregistrées' if args.apply else 'prêtes à publier'}")


if __name__ == "__main__":
    main()
