#!/usr/bin/env python3
"""Validation ISOLÉE des résultats définitifs PMU : aucune écriture, aucun Push.

Exécution : python scripts/valider_resultats_pmu.py [--live]
--live vérifie, sur la source PMU, deux courses du 16 novembre 2026.
Ce diagnostic n'importe ni le moteur des notifications ni Supabase.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import io
import json
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import monitor_pmu_results as pmu


def fixture():
    return {
        "engagements": {
            "master-pat": [{
                "date": "2026-11-17", "heure": "15:40",
                "hippodrome": "Chantilly", "statut": "partant",
                "course": "R1C7", "numero": 5
            }]
        },
        "performances": {}
    }


def programme(definitive=True, arrival=None, venue="CHANTILLY"):
    if arrival is None:
        arrival = [[2], [5, 8], [9]]
    return {
        "reunions": [{
            "numOfficiel": 1, "hippodrome": {"libelleCourt": venue},
            "courses": [{
                "numOrdre": 7, "arriveeDefinitive": definitive,
                "ordreArrivee": arrival
            }]
        }]
    }


def check_case(name, *, definitive=True, arrival=None, venue="CHANTILLY",
               remote_name="MASTER PAT", status="partant", existing=False,
               expected=False, expected_rank="2e"):
    data = fixture()
    data["engagements"]["master-pat"][0]["statut"] = status
    if existing:
        data["performances"]["master-pat"] = [{
            "date": "2026-11-17", "hippodrome": "Chantilly",
            "rang": "Saisie manuelle"
        }]
    source = programme(definitive, arrival, venue)
    participants = [{"numPmu": 5, "nom": remote_name}]
    now = datetime(2026, 11, 17, 16, 0, tzinfo=pmu.PARIS)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        horses = root / "chevaux.json"
        output = root / "editorial.json"
        horses.write_text(json.dumps({"horses": [
            {"id": "master-pat", "name": "MASTER PAT"}
        ]}), encoding="utf-8")
        original = copy.deepcopy(data)
        with patch.object(pmu, "HORSES", horses), patch.object(pmu, "DATA", output), \
             patch.object(pmu, "fetch_programme", return_value=(source, "https://example.invalid/source")), \
             patch.object(pmu, "fetch_participants", return_value=participants), \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            # Le mode à blanc NE DOIT ni modifier les données en mémoire,
            # ni créer de fichier, même lorsqu'un résultat est confirmé.
            assert pmu.apply(data, now, is_dry_run=True) is False, name
            assert data == original and not output.exists(), name + " : essai à blanc modifiant les données"

            changed = pmu.apply(data, now, is_dry_run=False)
            assert changed is expected, name + " : état d'écriture inattendu"
            if expected:
                saved = json.loads(output.read_text(encoding="utf-8"))
                entry = saved["performances"]["master-pat"][0]
                assert entry["rang"] == expected_rank, name
                assert entry["officiel"] is True and entry["statut"] == "officiel", name
                assert entry["numero"] == 5 and entry["course"] == "R1C7", name
                assert entry["video_url"] == "https://www.equidia.fr/courses/2026-11-17/R1/C7", name
                assert entry["course_url"] == entry["video_url"], name
                assert entry["video_source"] == "equidia_course", name
                # Deuxième passage : aucune insertion supplémentaire.
                assert pmu.apply(data, now, is_dry_run=False) is False, name + " : doublon"
            else:
                assert not output.exists() and data == original, name
    print("[OK] " + name)


def test_offline():
    check_case("Arrivée définitive, nom confirmé, 2e ex æquo : insertion", expected=True)
    check_case("Arrivée provisoire : refus", definitive=False)
    check_case("Nom du cheval différent : refus", remote_name="AUTRE CHEVAL")
    check_case("Hippodrome différent : refus", venue="DEAUVILLE")
    check_case("Cheval hors de l'arrivée publiée : aucune déduction",
               arrival=[[2], [3], [7]])
    check_case("Résultat déjà saisi : aucune écriture", existing=True)
    check_case("Simple engagement : aucune recherche", status="engage")
    # Validation des rangs en présence d'ex æquo et du rejet hors classement.
    race = programme()["reunions"][0]["courses"][0]
    assert pmu.rank_in_arrival(race, 8) == (2, None)
    assert pmu.rank_in_arrival(race, 9) == (4, None)
    assert pmu.rank_in_arrival(race, 17)[0] is None
    assert pmu.equidia_course_url("2026-11-17", "R1C7") == (
        "https://www.equidia.fr/courses/2026-11-17/R1/C7")
    try:
        pmu.equidia_course_url("2026-11-17", "C7")
        raise AssertionError("Lien Equidia produit sans numéro de réunion")
    except ValueError:
        pass
    print("[OK] Lien Equidia construit depuis la course vérifiée (vidéo non présumée en ligne)")
    print("[OK] Rangs et ex æquo")
    print("[OK] TESTS ISOLÉS TERMINÉS : aucune fiche ni notification modifiée")


def test_polling_timing():
    """Simulation accélérée : H+12, passages à 45 s et arrêt à l'officialisation."""
    start = datetime(2026, 11, 17, 15, 50, tzinfo=pmu.PARIS)
    threshold = datetime(2026, 11, 17, 15, 52, tzinfo=pmu.PARIS)
    data = fixture()
    assert pmu.due_events(data, start) == [], "Recherche déclenchée avant H+12"
    assert len(pmu.due_events(data, threshold - timedelta(seconds=1))) == 0
    assert len(pmu.due_events(data, threshold)) == 1
    assert len(pmu.due_events(data, start, early_minutes=5)) == 1, (
        "Le moteur doit se préparer quelques minutes avant H+12"
    )
    clock = [start]
    checks = []
    sleeps = []

    class SimulatedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    def monotonic():
        return (clock[0] - start).total_seconds()

    def sleep(seconds):
        assert seconds > 0
        sleeps.append(seconds)
        clock[0] += timedelta(seconds=seconds)

    def programme_at_time(day):
        checks.append(clock[0])
        assert clock[0] >= threshold, "PMU consulté AVANT H+12"
        is_final = clock[0] >= datetime(2026, 11, 17, 15, 53, tzinfo=pmu.PARIS)
        return programme(definitive=is_final), "https://example.invalid/source"

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        horse_file = root / "chevaux.json"
        out_file = root / "editorial.json"
        horse_file.write_text(json.dumps({"horses": [
            {"id": "master-pat", "name": "MASTER PAT"}
        ]}), encoding="utf-8")
        with patch.object(pmu, "HORSES", horse_file), \
             patch.object(pmu, "DATA", out_file), \
             patch.object(pmu, "datetime", SimulatedDatetime), \
             patch.object(pmu.time, "monotonic", side_effect=monotonic), \
             patch.object(pmu.time, "sleep", side_effect=sleep), \
             patch.object(pmu, "fetch_programme", side_effect=programme_at_time), \
             patch.object(pmu, "fetch_participants",
                          return_value=[{"numPmu": 5, "nom": "MASTER PAT"}]), \
             contextlib.redirect_stdout(io.StringIO()):
            assert pmu.poll_results(data, poll_seconds=240, interval_seconds=45)
        official = json.loads(out_file.read_text(encoding="utf-8"))
        assert official["performances"]["master-pat"][0]["rang"] == "2e"
        assert len(checks) >= 2
        assert all(t >= threshold for t in checks)
        assert all(0 < seconds <= 45 for seconds in sleeps)
        assert clock[0] < datetime(2026, 11, 17, 15, 54, tzinfo=pmu.PARIS), (
            "La recherche continue après officialisation"
        )
    print("[OK] Démarrage H+12 min, interrogations à 45 s, arrêt dès arrivée définitive")


def test_live():
    # Ces classements ont été saisis par le gérant le 16/11/2026 :
    # la vérification externe sert ici à contrôler la chaîne source -> identité -> rang.
    day = "2026-11-16"
    payload, url = pmu.fetch_programme(day)
    pmu.meetings(payload)  # impose un format exploitable
    for code, venue, horse, expected in [
        ("R3C6", "Le Mans", "ZARTOP", 2),
        ("R3C8", "Le Mans", "ON LOCKDOWN", 5),
    ]:
        race, error = pmu.find_race(payload, code, venue)
        assert error is None and race, f"{code}: {error}"
        participants = pmu.fetch_participants(day, code)
        numbers = [
            pmu.number(p.get("numPmu"))
            for p in participants if isinstance(p, dict)
            and pmu.normalize(p.get("nom")) == pmu.normalize(horse)
        ]
        numbers = [n for n in numbers if n is not None]
        assert len(numbers) == 1, f"{code}: identité du cheval introuvable ou ambiguë"
        valid, error = pmu.verify_identity(day, code, numbers[0], horse)
        assert valid, f"{code}: {error}"
        rank, error = pmu.rank_in_arrival(race, numbers[0])
        assert error is None and rank == expected, (
            f"{code} {horse}: rang attendu {expected}, lu {rank}, erreur {error}"
        )
        print(f"[OK] PMU réel {day} {code} : {horse} n°{numbers[0]}, {rank}e, définitif")
    print("[OK] SOURCE PMU VÉRIFIÉE : " + url)

    # Contrôle de bout en bout : le vrai moteur ajoute les deux performances
    # depuis le PMU dans un FICHIER TEMPORAIRE, jamais sur le site de l'écurie.
    isolated = {
        "engagements": {
            "zartop": [{"date": day, "heure": "15:00", "hippodrome": "Le Mans",
                        "statut": "partant", "course": "R3C6", "numero": 3}],
            "on-lockdown": [{"date": day, "heure": "16:00", "hippodrome": "Le Mans",
                             "statut": "partant", "course": "R3C8", "numero": 4}]
        },
        "performances": {}
    }
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        horses = root / "chevaux.json"
        output = root / "editorial.json"
        horses.write_text(json.dumps({"horses": [
            {"id": "zartop", "name": "ZARTOP"},
            {"id": "on-lockdown", "name": "ON LOCKDOWN"}
        ]}), encoding="utf-8")
        with patch.object(pmu, "HORSES", horses), patch.object(pmu, "DATA", output):
            assert pmu.apply(isolated, datetime(2026, 11, 16, 18, 0, tzinfo=pmu.PARIS),
                             is_dry_run=False), "Moteur réel : aucun résultat inséré"
        saved = json.loads(output.read_text(encoding="utf-8"))
        for slug, expected_rank in [("zartop", "2e"), ("on-lockdown", "5e")]:
            entries = saved["performances"].get(slug, [])
            assert len(entries) == 1, slug + " : nombre de performances incorrect"
            assert entries[0]["rang"] == expected_rank, slug + " : mauvais rang"
            assert entries[0]["officiel"] is True, slug + " : non officialisé"
            expected_course = "C6" if slug == "zartop" else "C8"
            expected_url = "https://www.equidia.fr/courses/2026-11-16/R3/" + expected_course
            assert entries[0]["video_url"] == expected_url, slug + " : mauvaise course Equidia"
            assert entries[0]["video_source"] == "equidia_course", slug
        print("[OK] Chaîne PMU -> classement -> JSON : 2 résultats dans un fichier temporaire")
    print("[OK] Fichier temporaire effacé ; site, application et notifications inchangés")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true",
                        help="Contrôle strict du flux PMU réel sur les courses du 16/11/2026")
    args = parser.parse_args()
    test_offline()
    test_polling_timing()
    if args.live:
        test_live()
