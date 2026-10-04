# Househunt automation checkpoint

## Stage 1: saved baseline and source research

- Existing repository: J-Dooley/house-hunt; existing URL remains unchanged.
- Baseline commit: ffcdce843d6204ffc9b99c33f8692dda4d885031.
- 80 existing records and cover-photo links preserved verbatim in data/legacy-inventory.json.
- Existing Supabase inventory contains only 9 records; website currently embeds the fuller inventory.
- property_preferences has existing favorites/hidden state with owner-scoped RLS. Do not overwrite it.
- Explicit geographic/rule configuration in config/search.json; provenance and unresolved geography edges documented there.
- Provider assessment in DATA-SOURCES.md. No paid service activated.

## Stage 2: committed, deployed and tested

- Durable Supabase queue, conservative status/criteria rules, evidence history, resumable provider adapters and 11 passing rule tests.
- Atomic database page ingestion tested for status exclusion, preserved research, idempotent replay, lease rejection, request caps and client permissions. Fixtures rolled back.
- Original 80 records seeded into the existing cumulative inventory; original database snapshot saved separately. Existing preference rows left unchanged.
- Deployed authenticated worker tested via Vault-backed dispatch, HTTP 200.

## Stage 3: site integration and schedule

- Existing interface reads the live cumulative database and shows source/region receipts.
- Daily 6 a.m. Central schedule enabled, daylight-saving aware; minute worker drains resumable jobs.
- First run: 68 blocked county tasks, zero regions searched. No feed or credentials invented.
- Historical/unverified properties remain in Saved archive. Active results require fresh explicit active status plus the qualification checks.
- Published site verified in the cloud browser: 80 archive cards, zero falsely verified active cards, and 68 live coverage rows. Backend and JavaScript syntax tests passed. GitHub Pages deployment c7524c1 completed successfully.
- Runbook and activation instructions: OPERATIONS.md.

## Activation dependency

At least one licensed feed account covering the requested regions must be authorized. GitHub and Supabase connections are infrastructure access, not MLS data licenses. Optional RentCast discovery requires its own key and spend approval beyond a hard-capped free trial. Complete infrastructure work before requesting this assistance.
