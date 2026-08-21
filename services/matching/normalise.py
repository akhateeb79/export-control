"""Shared deterministic name normalization rules."""

from __future__ import annotations

import re
import unicodedata

LEGAL_SUFFIXES = sorted(
    [
        "f z l l c",
        "f z c o",
        "fz llc",
        "fzllc",
        "fzco",
        "fze",
        "dmcc",
        "establishment",
        "est",
        "international",
        "limited",
        "trading",
        "company",
        "gesellschaft mit beschrankter haftung",
        "gmbh",
        "holding",
        "group",
        "gen trdg",
        "intl",
        "pjsc",
        "psc",
        "wll",
        "spc",
        "s a",
        "b v",
        "sa",
        "bv",
        "llc",
        "l l c",
        "ltd",
        "corp",
        "inc",
        "co",
    ],
    key=len,
    reverse=True,
)

HONORIFICS = sorted(
    [
        "sheikh",
        "sh",
        "al haj",
        "haji",
        "dr",
        "eng",
        "mr",
        "mrs",
        "sayed",
        "sayyid",
        "prof",
        "h e",
    ],
    key=len,
    reverse=True,
)

PARTICLE_ALIASES = [
    ("bin", "ben", "ibn", "bn", "b"),
    ("abu", "abo", "abou", "aboo"),
    ("abd", "abdul", "abdel", "abdal", "abd al", "abd el"),
    ("umm", "om"),
]


def fold_diacritics(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if unicodedata.category(character) != "Mn"
    )


def as_tokens(value: str) -> list[str]:
    return [token for token in value.split() if token]


def clean_text(value: str) -> str:
    output: list[str] = []
    for character in fold_diacritics(str(value or "")).lower():
        if character in "-'’`":
            output.append(" ")
        elif unicodedata.category(character)[0] in {"L", "N"}:
            output.append(character)
        else:
            output.append(" ")
    return " ".join(as_tokens("".join(output)))


def remove_whole_word_phrases(value: str, phrases: list[str]) -> str:
    output = value
    for phrase in phrases:
        pattern = r"\s+".join(re.escape(part) for part in phrase.split(" "))
        output = re.sub(rf"\b{pattern}\b", " ", output)
    return " ".join(as_tokens(output))


def normalise_name(raw_name: str) -> str:
    value = clean_text(raw_name)
    value = remove_whole_word_phrases(value, HONORIFICS)
    return remove_whole_word_phrases(value, LEGAL_SUFFIXES)


def replace_particle_aliases(tokens: list[str]) -> list[str]:
    output = tokens[:]
    for aliases in PARTICLE_ALIASES:
        alias_set = set(aliases)
        output = [aliases[0] if token in alias_set else token for token in output]
    return output


def generate_name_variants(raw_name: str) -> list[str]:
    base = normalise_name(raw_name)
    if not base:
        return []

    variants = {base}
    canonical_particles = replace_particle_aliases(as_tokens(base))
    variants.add(" ".join(canonical_particles))

    if canonical_particles and canonical_particles[0] in {"al", "el", "ul"}:
        variants.add(" ".join(canonical_particles[1:]))
        if len(canonical_particles) > 1:
            variants.add(f"{canonical_particles[0]}{''.join(canonical_particles[1:])}")

    first = canonical_particles[0] if canonical_particles else ""
    if first in {"abd", "abdul", "abdel", "abdal"} and len(canonical_particles) > 1:
        variants.add(" ".join(canonical_particles))
        variants.add("".join(canonical_particles[:2]) + (
            f" {' '.join(canonical_particles[2:])}" if len(canonical_particles) > 2 else ""
        ))

    for aliases in PARTICLE_ALIASES:
        if aliases[0] in canonical_particles:
            for alias in aliases:
                variants.add(
                    " ".join(alias if token == aliases[0] else token for token in canonical_particles)
                )
            variants.add(" ".join(token for token in canonical_particles if token != aliases[0]))

    return sorted(variant for variant in variants if variant)