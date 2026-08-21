"""Ephemeral PostgreSQL data used by deterministic matching integration tests."""

from __future__ import annotations

import hashlib
import os
import uuid
from contextlib import contextmanager

import psycopg

SOURCE_CODE = "TEST_MATCHING"
VERSION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"

PRIMARY_NAMES = (
    "Abdul Rahman",
    "Mohammed",
    "Al Hassan",
    "Gulf",
    "Abu Dhabi",
    "Sheikh Mohammed Al Hassan",
    "Abu",
    "Ali",
    "Alh",
    "Mdd",
)


def _connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for matching integration tests")
    return psycopg.connect(database_url)


def _cleanup(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM sanctions_entries WHERE source_code = %s", [SOURCE_CODE])
        cursor.execute("DELETE FROM list_versions WHERE source_code = %s", [SOURCE_CODE])
        cursor.execute("DELETE FROM list_sources WHERE code = %s", [SOURCE_CODE])


@contextmanager
def matching_fixture(noise_count: int = 60):
    """Create and remove an indexed source fixture with generated noise names."""

    with _connection() as connection:
        _cleanup(connection)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO list_sources (
                  code, authority, name, source_url, format, is_blocking, sync_cron, is_active
                ) VALUES (%s, 'TEST', 'Matching test fixture', 'https://example.invalid/test.csv',
                          'CSV', FALSE, '0 0 * * *', TRUE)
                """,
                [SOURCE_CODE],
            )
            cursor.execute(
                """
                INSERT INTO list_versions (id, source_code, fetched_at, content_hash, entry_count, status)
                VALUES (%s, %s, now(), %s, %s, 'ACTIVE')
                """,
                [
                    VERSION_ID,
                    SOURCE_CODE,
                    hashlib.sha256(SOURCE_CODE.encode()).hexdigest(),
                    len(PRIMARY_NAMES) + noise_count,
                ],
            )
            for index, name in enumerate(PRIMARY_NAMES):
                entry_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{SOURCE_CODE}:{index}"))
                normalized = name.lower()
                cursor.execute(
                    """
                    INSERT INTO sanctions_entries (
                      id, source_code, source_ref, entity_type, programs, country_code,
                      first_seen_version, last_seen_version, is_current
                    ) VALUES (%s, %s, %s, 'INDIVIDUAL', ARRAY['TEST'], 'AE', %s, %s, TRUE)
                    """,
                    [entry_id, SOURCE_CODE, f"fixture-{index}", VERSION_ID, VERSION_ID],
                )
                cursor.execute(
                    """
                    INSERT INTO sanctions_entry_names (
                      entry_id, name_type, script, raw_name, normalised_name, name_tokens
                    ) VALUES (%s, 'PRIMARY', 'LATIN', %s, %s, string_to_array(%s, ' '))
                    """,
                    [entry_id, name, normalized, normalized],
                )
            if noise_count:
                cursor.execute(
                    """
                    INSERT INTO sanctions_entries (
                      id, source_code, source_ref, entity_type, programs, country_code,
                      first_seen_version, last_seen_version, is_current
                    )
                    SELECT
                      uuid_generate_v5(uuid_ns_url(), %s || ':noise:' || sequence::text),
                      %s, 'noise-' || sequence::text, 'INDIVIDUAL', ARRAY['TEST'], 'AE',
                      %s, %s, TRUE
                    FROM generate_series(1, %s) AS sequence
                    """,
                    [SOURCE_CODE, SOURCE_CODE, VERSION_ID, VERSION_ID, noise_count],
                )
                cursor.execute(
                    """
                    INSERT INTO sanctions_entry_names (
                      entry_id, name_type, script, raw_name, normalised_name, name_tokens
                    )
                    SELECT
                      uuid_generate_v5(uuid_ns_url(), %s || ':noise:' || sequence::text),
                      'PRIMARY', 'LATIN', 'Mohammed Candidate ' || sequence::text,
                      'mohammed candidate ' || sequence::text,
                      ARRAY['mohammed', 'candidate', sequence::text]
                    FROM generate_series(1, %s) AS sequence
                    """,
                    [SOURCE_CODE, noise_count],
                )
        connection.commit()
        try:
            yield
        finally:
            _cleanup(connection)
            connection.commit()