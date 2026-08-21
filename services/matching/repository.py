"""PostgreSQL trigram candidate retrieval for name screening."""

from __future__ import annotations

from collections.abc import Iterable

from psycopg.rows import dict_row


def retrieve_candidates(
    connection,
    variants: Iterable[str],
    country: str | None,
    minimum_similarity: float,
    maximum_candidates: int,
) -> list[dict]:
    """Retrieve no more than the configured number of unique candidate names."""

    country_clause = "AND (se.country_code = %s OR se.country_code IS NULL)" if country else ""
    query = f"""
        WITH input_variants AS (
          SELECT DISTINCT variant
          FROM unnest(%s::text[]) AS variant
        ),
        matches AS (
          SELECT
            se.id::text AS sanctions_entry_id,
            sen.normalised_name AS matched_name,
            se.source_code AS source_list,
            similarity(sen.normalised_name, input_variants.variant) AS retrieval_score
          FROM input_variants
          JOIN sanctions_entry_names sen
            ON sen.normalised_name %% input_variants.variant
          JOIN sanctions_entries se ON se.id = sen.entry_id
          WHERE se.is_current = TRUE
            {country_clause}
        ),
        deduplicated AS (
          SELECT DISTINCT ON (sanctions_entry_id, matched_name)
            sanctions_entry_id, matched_name, source_list, retrieval_score
          FROM matches
          ORDER BY sanctions_entry_id, matched_name, retrieval_score DESC
        )
        SELECT sanctions_entry_id, matched_name, source_list, retrieval_score
        FROM deduplicated
        ORDER BY retrieval_score DESC, sanctions_entry_id, matched_name
        LIMIT %s
    """

    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("SELECT set_limit(%s::real)", [minimum_similarity])
        parameters: list[object] = [list(variants)]
        if country:
            parameters.append(country)
        parameters.append(maximum_candidates)
        cursor.execute(query, parameters)
        return [dict(row) for row in cursor.fetchall()]