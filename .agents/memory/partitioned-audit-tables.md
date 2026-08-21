---
name: Partitioned audit tables
description: PostgreSQL requirements for the platform's monthly-partitioned audit and vendor access tables.
---

Monthly range-partitioned audit tables use composite primary keys containing the
partition timestamp, and every physical partition must have its own enabled and
forced tenant-isolation policy.

**Why:** PostgreSQL rejects a primary or unique key on a partitioned table unless
it includes the partition key. Parent-table RLS does not mark the child partition
relations themselves as protected, which makes a strict per-table RLS check fail.

**How to apply:** Keep the audit identifier paired with `occurred_at` and the
vendor-access identifier paired with `accessed_at`. Whenever scheduled work adds
new monthly partitions, it must also enable and force RLS and add the standard
tenant-isolation policy to each child relation.