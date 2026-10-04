# Househunt automation checkpoint

## Stage 1: saved baseline and source research

- Existing repository: J-Dooley/house-hunt; existing URL remains unchanged.
- Baseline commit: ffcdce843d6204ffc9b99c33f8692dda4d885031.
- 80 existing records and cover-photo links preserved verbatim in data/legacy-inventory.json.
- Existing Supabase inventory contains only 9 records; website currently embeds the fuller inventory.
- property_preferences has existing favorites/hidden state with owner-scoped RLS. Do not overwrite it.
- Explicit geographic/rule configuration in config/search.json; provenance and unresolved geography edges documented there.
- Provider assessment in DATA-SOURCES.md. No paid service activated.

## Planned implementation checkpoints

2. Durable Supabase queue, conservative status/criteria rules, evidence history, resumable provider adapters and tests.
3. Existing-site integration, Central-time morning schedule, coverage receipts and end-to-end validation.

## Activation dependency

At least one licensed feed account covering the requested regions must be authorized. GitHub and Supabase connections are infrastructure access, not MLS data licenses. Optional RentCast discovery requires its own key and spend approval beyond a hard-capped free trial. Complete infrastructure work before requesting this assistance.
