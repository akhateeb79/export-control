"""Concurrent six-party screening performance check."""

from __future__ import annotations

import concurrent.futures
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from services.matching.service import MatchingConfig, ScreeningService
from services.matching.tests.support import matching_fixture


PARTIES = (
    "Abdul Rahman",
    "Mohammed",
    "Al-Hassan",
    "Gulf Trading LLC",
    "Abu Dhabi",
    "Sheikh Mohammed Al-Hassan",
)


class PerformanceTests(unittest.TestCase):
    def test_six_party_screening_stays_under_three_seconds(self):
        with matching_fixture(noise_count=10_000):
            service = ScreeningService(
                MatchingConfig(minimum_similarity=0.3, maximum_candidates=50, minimum_score=0.0)
            )
            started_at = time.perf_counter()
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                results = list(executor.map(lambda name: service.screen(name, "latin", "AE"), PARTIES))
            elapsed = time.perf_counter() - started_at
        self.assertEqual(len(results), 6)
        self.assertLess(elapsed, 3.0, f"Six simultaneous screens took {elapsed:.3f}s")
        print(f"Six-party screening against 10,010 indexed names elapsed: {elapsed:.3f}s")


if __name__ == "__main__":
    unittest.main(verbosity=2)