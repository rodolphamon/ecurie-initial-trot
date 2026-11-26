#!/usr/bin/env python3
"""Complète les anciennes performances depuis les arrivées définitives PMU.

Lecture seule par défaut. --apply publie uniquement des courses dont la date,
l'hippodrome, le cheval et le classement ont été recoupés.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import tempfile
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import monitor_pmu_results as pmu


def venue_key(value):
    value = pmu.normalize(value)
    return {"PARISLONGCHAMP": "LONGCHAMP", "PARIS LONGCHAMP": "LONGCHAMP",
            "DEAUVILLE CLAIREFONTAINE": "CLAIREFONTAINE",
            "ROYAN ATLANTIQUE": "ROYAN LA PALMYRE"}.get(value, value)


def excluded(row):
    return pmu.normalize(row.get("rang")).startswith(("QUALIF", "NON PARTANT", "FORFAIT"))


def cached(cache, name, fetch):
    path = cache / (name + ".json")
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    value = fetch()
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    return value


def rank_matches(row, race, bib):
    actual, _ = pmu.rank_in_arrival(race, bib)
    expected = pmu.normalize(row.get("rang"))
    digits = re.fullmatch(r"(\d+)\s*(?:ER|RE|E|EME)?", expected)
    if digits:
        return actual == int(digits[1]), actual
    if expected.startswith("NON PLACE") or expected in ("NP", "NC", "0"):
        return actual is not None and actual > 7, actual
    incidents = [pmu.normalize(i.get("type")) for i in race.get("incidents", [])
                 if bib in i.get("numeroParticipants", [])]
    prefix = {"DAI": "DISQUALIF", "ARR": "ARRET", "ARRETE": "ARRET", "T": "TOMB"}.get(expected)
    return bool(prefix and any(i.startswith(prefix) for i in incidents)), actual


def examine_day(day, items, names, cache):
    try:
        payload = cached(cache, day, lambda: pmu.fetch_programme(day)[0])
        meetings = pmu.meetings(payload)
    except (OSError, ValueError) as exc:
        return [(s, p, None, "programme_indisponible", str(exc)) for s, p in items]
    results = []
    for slug, original in items:
        row = copy.deepcopy(original)
        candidates = []
        for meeting in meetings:
            if venue_key(pmu.label(meeting.get("hippodrome"))) != venue_key(row["hippodrome"]):
                continue
            reunion = pmu.number(meeting.get("numOfficiel"))
            for race in meeting.get("courses", []):
                course = pmu.number(race.get("numOrdre"))
                if reunion and course and race.get("arriveeDefinitive") is True:
                    candidates.append((f"R{reunion}C{course}", race))
        hint = row.get("course", "")
        if not hint:
            match = re.search(r"[Rr](\d+)/?[Cc](\d+)", " ".join(str(row.get(k) or "") for k in ("course_url", "source_url")))
            if match:
                hint = "R" + match[1] + "C" + match[2]
        candidates.sort(key=lambda item: item[0] != hint)
        found = None
        errors = []
        for code, race in candidates:
            try:
                participants = cached(cache, day + "-" + code, lambda: pmu.fetch_participants(day, code))
            except (OSError, ValueError) as exc:
                errors.append(type(exc).__name__)
                continue
            matches = [p for p in participants if pmu.normalize(p.get("nom")) == pmu.normalize(names[slug])]
            if len(matches) == 1:
                found = (code, race, participants, matches[0])
                break
        if not found:
            reason = "hippodrome_absent" if not candidates else "cheval_introuvable"
            results.append((slug, original, None, reason, ",".join(errors)))
            continue
        code, race, participants, runner = found
        bib = pmu.number(runner.get("numPmu"))
        valid, actual_rank = rank_matches(row, race, bib)
        if not valid:
            results.append((slug, original, None, "classement_a_verifier", f"{code}, rang PMU={actual_rank}, saisi={row.get('rang')}"))
            continue
        runner = {**runner, "_participants": participants}
        pmu.add_official_details(row, race, runner, actual_rank or 0)
        if not row.get("arrivee"):
            results.append((slug, original, None, "arrivee_incomplete", code))
            continue
        row.setdefault("course", code)
        row.setdefault("numero", bib)
        row["officiel"] = True
        row["statut"] = "officiel"
        row["details_source_api"] = f"{pmu.PMU}/programme/{day[8:10]}{day[5:7]}{day[:4]}/R{code.split('C')[0][1:]}/C{code.split('C')[1]}/participants"
        row.setdefault("course_url", pmu.equidia_course_url(day, code))
        results.append((slug, original, row, "verifie", code))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--cache-dir", type=Path, default=Path(tempfile.gettempdir()) / "ei-arrivees-historiques")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(pmu.DATA.read_text(encoding="utf-8"))
    names = {h["id"]: h["name"] for h in json.loads(pmu.HORSES.read_text(encoding="utf-8"))["horses"]}
    items = [(s, p) for s, rows in data["performances"].items() if s in names
             for p in rows if not excluded(p)]
    # Inclure également les résultats publics récents reçus avant leur copie GitHub.
    try:
        with urllib.request.urlopen("https://yeecwaaizmvrhwobukfa.supabase.co/functions/v1/public-race-results", timeout=15) as response:
            live = json.load(response).get("performances", {})
        for slug, rows in live.items():
            if slug not in names:
                continue
            for row in rows:
                if not excluded(row) and not any(s == slug and p["date"] == row["date"]
                    and venue_key(p["hippodrome"]) == venue_key(row["hippodrome"]) for s, p in items):
                    items.append((slug, row))
    except (OSError, ValueError):
        pass
    by_day = defaultdict(list)
    for slug, row in items:
        by_day[row["date"]].append((slug, row))
    results = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(examine_day, day, rows, names, args.cache_dir) for day, rows in by_day.items()]
        for future in as_completed(futures):
            results.extend(future.result())
            print(f"[HISTORIQUE] {len(results)}/{len(items)} contrôlés ; {sum(r[3]=='verifie' for r in results)} vérifiés", flush=True)
    report = [{"cheval": s, "date": p["date"], "hippodrome": p["hippodrome"], "statut": status, "detail": detail}
              for s, p, updated, status, detail in results]
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    changed = 0
    for slug, original, updated, status, detail in results:
        if updated is None or updated == original:
            continue
        changed += 1
        if args.apply:
            rows = data["performances"].setdefault(slug, [])
            if original in rows:
                rows[rows.index(original)] = updated
            else:
                rows.append(updated)
    if args.apply and changed:
        data["updated_at"] = datetime.now(pmu.PARIS).date().isoformat()
        pmu.DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"controlees": len(items), "verifiees": sum(r[3]=='verifie' for r in results),
                      "completees": changed, "ecriture": args.apply}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
