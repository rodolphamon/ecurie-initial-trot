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
from datetime import datetime
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
    print("[OK] Rangs et ex æquo")
    print("[OK] TESTS ISOLÉS TERMINÉS : aucune fiche ni notification modifiée")


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
    print("[OK] Aucun enregistrement, aucun envoi de notification")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true",
                        help="Contrôle strict du flux PMU réel sur les courses du 16/11/2026")
    args = parser.parse_args()
    test_offline()
    if args.live:
        test_live()
