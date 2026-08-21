---
name: Ingestion service privilege
description: RLS constraint for list-ingestion re-screening across tenant cases.
---

Cross-tenant list updates must use a dedicated ingestion service role with `BYPASSRLS` (or a narrowly vetted equivalent database function) to enumerate affected cases. The job must still set `app.tenant_id` locally before every tenant-scoped update.

**Why:** RLS filters `compliance_cases` and `screening_results` before the cascade can discover their tenant IDs. Setting a system-tenant context is not a cross-tenant access grant and otherwise turns the cascade into a silent no-op.

**How to apply:** Configure the ingestion connection separately from ordinary application connections, validate its authority before a cascade, and run a regression test under an RLS-enforced non-owner role.