# Export Control & Trade Compliance Platform

Multi-tenant SaaS supporting export control decisions for Gulf re-export businesses.

**The platform recommends and evidences. The compliance officer determines.**

## Before Writing Any Code

Read `AGENTS.md`. It holds the ten non-negotiable compliance rules and the constraints
that make this a regulated product rather than an ordinary CRUD application.

## Specifications

Everything is in `docs/`. Start with `docs/README.md`.

## Building

`docs/build-prompts.md` — one prompt per slice, in order.
`docs/verification.md` — run the matching checks before starting the next slice.

Build order: schema → ingestion → matching → sanctions → classification → licence →
modules → frontend.

## Stack

Node + Express, React, Python + rapidfuzz for matching, PostgreSQL with `pg_trgm`,
Anthropic API for model calls.

Sanctions screening is deterministic and makes no model call.
