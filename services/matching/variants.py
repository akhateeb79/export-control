"""Finite Arabic transliteration and deterministic variant generation."""

from __future__ import annotations

import re

from services.matching.normalise import generate_name_variants, normalise_name

TRANSLITERATION_TABLE = {
    "ال": ("al", "el", "ul", ""),
    "ة": ("a", "ah", "at", "eh"),
    "ج": ("j", "g", "dj"),
    "ق": ("q", "k", "g", "gh"),
    "خ": ("kh", "ch", "h", "x"),
    "غ": ("gh", "g", "r"),
    "ث": ("th", "s", "t"),
    "ذ": ("dh", "z", "th", "d"),
    "ض": ("d", "dh", "dt"),
    "ظ": ("z", "dh", "th"),
    "ع": ("a", "aa", ""),
    "ح": ("h", "hh"),
    "ي": ("i", "y", "ee", "ie"),
    "و": ("w", "u", "oo", "ou", "o"),
    "ئ": ("",),
    "ؤ": ("",),
    "ء": ("",),
    "أ": ("a", ""),
    "إ": ("i", ""),
    "آ": ("a", "aa"),
    "ا": ("a",),
    "ب": ("b",),
    "ت": ("t",),
    "د": ("d",),
    "ر": ("r",),
    "ز": ("z",),
    "س": ("s",),
    "ش": ("sh",),
    "ص": ("s",),
    "ط": ("t",),
    "ف": ("f",),
    "ك": ("k",),
    "ل": ("l",),
    "م": ("m",),
    "ن": ("n",),
    "ه": ("h",),
    "ى": ("a", "i", "y"),
    "پ": ("p",),
    "چ": ("ch",),
    "ژ": ("zh",),
    "گ": ("g",),
}


def _latin_consonant_key(value: str) -> str:
    collapsed = re.sub(r"(.)\1+", r"\1", value)
    return re.sub(r"[aeiou]", "", collapsed)


def transliterate_arabic(value: str, maximum_variants: int = 512) -> list[str]:
    """Expand Arabic text using only the finite architecture substitution table."""

    options: list[tuple[str, ...]] = []
    position = 0
    while position < len(value):
        if value[position] == "ّ" and options:
            options[-1] = tuple(sorted(set(options[-1] + tuple(part + part for part in options[-1]))))
            position += 1
            continue
        pair = value[position : position + 2]
        if pair in TRANSLITERATION_TABLE:
            options.append(TRANSLITERATION_TABLE[pair])
            position += 2
        elif value[position] in TRANSLITERATION_TABLE:
            options.append(TRANSLITERATION_TABLE[value[position]])
            position += 1
        else:
            options.append((value[position] if not value[position].isspace() else " ",))
            position += 1

    variants = {""}
    for replacements in options:
        variants = {f"{prefix}{replacement}" for prefix in variants for replacement in replacements}
        if len(variants) > maximum_variants:
            variants = set(sorted(variants)[:maximum_variants])
    return sorted(normalise_name(variant) for variant in variants if normalise_name(variant))


def generate_variants(name: str, script: str) -> list[str]:
    """Generate deterministic spelling variants for Latin or Arabic input."""

    variants = set(generate_name_variants(name))
    if script.lower() == "arabic":
        for transliteration in transliterate_arabic(name):
            variants.update(generate_name_variants(transliteration))

    # Vowel folding is a finite transliteration aid for common Latin Arabic renderings:
    # Mohammed, Mohammad, Muhammad, and Mohamed all share the key "mhmd".
    variants.update(
        _latin_consonant_key(variant)
        for variant in tuple(variants)
        if re.fullmatch(r"[a-z ]+", variant)
    )
    return sorted(variant for variant in variants if variant)