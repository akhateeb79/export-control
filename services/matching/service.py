"""Five-stage deterministic name-screening pipeline."""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import psycopg
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

from services.matching.repository import retrieve_candidates
from services.matching.variants import generate_variants


@dataclass(frozen=True)
class MatchingConfig:
    minimum_similarity: float
    maximum_candidates: int
    minimum_score: float

    @classmethod
    def from_environment(cls) -> "MatchingConfig":
        return cls(
            minimum_similarity=float(os.getenv("MATCHING_MIN_SIMILARITY", "0.3")),
            maximum_candidates=int(os.getenv("MATCHING_MAX_CANDIDATES", "50")),
            minimum_score=float(os.getenv("MATCHING_MIN_SCORE", "0.0")),
        )


def connect_database():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for matching requests")
    return psycopg.connect(database_url)


def score_candidate(variants: list[str], matched_name: str) -> tuple[float, str, str]:
    """Score every deterministic variant and return reproducible winning evidence."""

    candidate_variants = generate_variants(matched_name, "latin")
    winning_score, winning_variant, winning_algorithm = -1.0, "", ""
    algorithms = (
        ("token_set_ratio", fuzz.token_set_ratio),
        ("token_sort_ratio", fuzz.token_sort_ratio),
        ("jaro_winkler", lambda left, right: JaroWinkler.normalized_similarity(left, right) * 100),
    )
    for variant in variants:
        for candidate_variant in candidate_variants:
            for algorithm_name, algorithm in algorithms:
                score = float(algorithm(variant, candidate_variant))
                evidence_variant = variant
                if (score, evidence_variant, algorithm_name) > (
                    winning_score,
                    winning_variant,
                    winning_algorithm,
                ):
                    winning_score = score
                    winning_variant = evidence_variant
                    winning_algorithm = algorithm_name
    return winning_score, winning_variant, winning_algorithm


class ScreeningService:
    def __init__(self, configuration: MatchingConfig | None = None, connection_factory=connect_database):
        self.configuration = configuration or MatchingConfig.from_environment()
        self.connection_factory = connection_factory

    def screen(self, name: str, script: str, country: str | None = None) -> dict:
        started_at = time.perf_counter()
        variants = generate_variants(name, script)
        with self.connection_factory() as connection:
            retrieved = retrieve_candidates(
                connection,
                variants,
                country,
                self.configuration.minimum_similarity,
                self.configuration.maximum_candidates,
            )

        candidates = []
        for candidate in retrieved:
            score, triggering_variant, triggering_algorithm = score_candidate(
                variants, candidate["matched_name"]
            )
            if score >= self.configuration.minimum_score:
                candidates.append(
                    {
                        "sanctions_entry_id": candidate["sanctions_entry_id"],
                        "score": round(score, 2),
                        "triggering_variant": triggering_variant,
                        "triggering_algorithm": triggering_algorithm,
                        "matched_name": candidate["matched_name"],
                        "source_list": candidate["source_list"],
                    }
                )

        candidates.sort(
            key=lambda candidate: (
                -candidate["score"],
                candidate["sanctions_entry_id"],
                candidate["matched_name"],
            )
        )
        return {
            "candidates": candidates,
            "max_score": candidates[0]["score"] if candidates else 0.0,
            "screening_duration_ms": int((time.perf_counter() - started_at) * 1000),
        }