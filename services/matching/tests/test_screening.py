"""Deterministic name-group and output-evidence tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from services.matching.service import MatchingConfig, ScreeningService
from services.matching.normalise import (
    HONORIFICS,
    LEGAL_SUFFIXES,
    PARTICLE_ALIASES,
    generate_name_variants,
    normalise_name,
)
from services.matching.tests.support import matching_fixture
from services.matching.variants import generate_variants


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, *_args):
        return None

    def fetchall(self):
        return self.rows


class FakeConnection:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self, **_kwargs):
        return FakeCursor(self.rows)


def service_for(matched_name: str) -> ScreeningService:
    rows = [
        {
            "sanctions_entry_id": "11111111-1111-1111-1111-111111111111",
            "matched_name": matched_name,
            "source_list": "TEST_LIST",
            "retrieval_score": 0.95,
        }
    ]
    return ScreeningService(
        MatchingConfig(minimum_similarity=0.3, maximum_candidates=50, minimum_score=0.0),
        connection_factory=lambda: FakeConnection(rows),
    )


GROUPS = {
    "Group 1": ("Abdul Rahman", "Abdulrahman", "Abd al-Rahman", "Abdel Rahman"),
    "Group 2": ("Mohammed", "Mohammad", "Muhammad", "Mohamed"),
    "Group 3": ("Al-Hassan", "Alhassan", "El Hassan", "Hassan"),
    "Group 4": ("Gulf Trading LLC", "Gulf Trading L.L.C.", "Gulf Trading FZE", "Gulf Trading"),
    "Group 5": ("Abu Dhabi", "Abou Dhabi", "Abo Dhabi"),
}


class ScreeningTests(unittest.TestCase):
    def test_normalisation_matches_slice_two_rules(self):
        self.assertEqual(
            LEGAL_SUFFIXES,
            sorted(
                [
                    "f z l l c", "f z c o", "fz llc", "fzllc", "fzco", "fze", "dmcc", "establishment", "est",
                    "international", "limited", "trading", "company",
                    "gesellschaft mit beschrankter haftung", "gmbh", "holding",
                    "group", "gen trdg", "intl", "pjsc", "psc", "wll", "spc", "s a",
                    "b v", "sa", "bv", "llc", "l l c", "ltd", "corp", "inc", "co",
                ],
                key=len,
                reverse=True,
            ),
        )
        self.assertEqual(
            HONORIFICS,
            sorted(
                ["sheikh", "sh", "al haj", "haji", "dr", "eng", "mr", "mrs",
                 "sayed", "sayyid", "prof", "h e"],
                key=len,
                reverse=True,
            ),
        )
        self.assertEqual(
            PARTICLE_ALIASES,
            [
                ("bin", "ben", "ibn", "bn", "b"),
                ("abu", "abo", "abou", "aboo"),
                ("abd", "abdul", "abdel", "abdal", "abd al", "abd el"),
                ("umm", "om"),
            ],
        )
        self.assertEqual(normalise_name("Dr. Gulf Trading L.L.C."), "gulf")
        self.assertEqual(normalise_name("Gulf FZCO"), "gulf")
        self.assertEqual(normalise_name("Gulf FZ-LLC"), "gulf")
        self.assertEqual(normalise_name("Gulf EST"), "gulf")
        self.assertEqual(normalise_name("Gulf PSC"), "gulf")
        self.assertIn("abd rahman", generate_name_variants("Abdel Rahman"))

    def test_all_required_name_groups_score_above_eighty(self):
        for group_name, names in GROUPS.items():
            scores = []
            for input_name in names:
                for matched_name in names:
                    response = service_for(matched_name).screen(input_name, "latin")
                    score = response["max_score"]
                    scores.append(score)
                    self.assertGreater(
                        score,
                        80.0,
                        f"{group_name}: {input_name!r} did not match {matched_name!r} above 80",
                    )
            print(f"{group_name}: min={min(scores):.2f}, max={max(scores):.2f}")

    def test_result_includes_required_compliance_evidence(self):
        result = service_for("Abdul Rahman").screen("Abdel Rahman", "latin")
        candidate = result["candidates"][0]
        self.assertEqual(
            set(candidate),
            {
                "sanctions_entry_id",
                "score",
                "triggering_variant",
                "triggering_algorithm",
                "matched_name",
                "source_list",
            },
        )
        self.assertIn(candidate["triggering_variant"], generate_variants("Abdel Rahman", "latin"))
        self.assertIn(
            candidate["triggering_algorithm"],
            {"token_set_ratio", "token_sort_ratio", "jaro_winkler"},
        )

    def test_postgres_retrieval_is_globally_capped(self):
        with matching_fixture():
            service = ScreeningService(
                MatchingConfig(minimum_similarity=0.3, maximum_candidates=3, minimum_score=0.0)
            )
            result = service.screen("Mohammed", "latin", "AE")
        self.assertGreaterEqual(len(result["candidates"]), 1)
        self.assertLessEqual(len(result["candidates"]), 3)

    def test_arabic_transliteration_retrieves_evidenced_candidates(self):
        cases = (
            ("أبو", "Abu"),  # hamza plus particle
            ("علي", "Ali"),  # ain
            ("الح", "Alh"),  # definite article
            ("مدّ", "Mdd"),  # shadda
        )
        with matching_fixture():
            service = ScreeningService(
                MatchingConfig(minimum_similarity=0.3, maximum_candidates=50, minimum_score=0.0)
            )
            for input_name, expected_name in cases:
                result = service.screen(input_name, "arabic", "AE")
                matched = next(
                    candidate
                    for candidate in result["candidates"]
                    if candidate["matched_name"] == expected_name.lower()
                )
                self.assertGreater(matched["score"], 80.0)
                self.assertTrue(matched["triggering_variant"])
                self.assertIn(
                    matched["triggering_algorithm"],
                    {"token_set_ratio", "token_sort_ratio", "jaro_winkler"},
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)