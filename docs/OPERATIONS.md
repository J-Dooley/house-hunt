# Operations and activation

## What is deployed

The existing GitHub Pages site reads the existing Supabase project's cumulative inventory. Deployment remains GitHub Pages at https://j-dooley.github.io/house-hunt/. No replacement site or project was created.

- `househunt-daily` starts at 6:00 a.m. America/Chicago, using two UTC schedules with a local-hour guard for daylight saving.
- `househunt-worker` dispatches queued work every minute; each invocation processes at most four pages. A run may finish after 6:00, depending on data volume and limits.
- Every page is an atomic database checkpoint. Leases, retries, provider pagination and request caps prevent session-length dependence.
- The browser refreshes data every five minutes and when returning to the tab. No daily GitHub commit is required to publish data changes.
- Discovery and current-property verification are separate jobs. Known provider IDs are checked even if their price moves outside search bounds.
- Saved research, stable property IDs, local preferences and owner-scoped Supabase preferences are retained. Automation cannot write preference rows.
- Expired, ambiguous, unavailable or unqualified records remain archived. Search errors do not label a property sold. Existing research holds are retained until explicitly resolved.

## Current activation state

**The scheduler and worker are deployed; live discovery is blocked by missing authorized data access.**

The initial run records 68 blocked county tasks, zero checked sources/regions, and zero newly verified active matches. The 80 original records are retained, but their historical labels are not fresh machine-verifiable status evidence. They are available in Saved archive. Daily runs continue to report the access gap honestly.

The reviewed search configuration is in `config/search.json`. It records 49 CA, 10 OR and 9 WA county scopes, with three WA locality checks to avoid treating an entire mainland county as an island/coastal match. It also records why the explicit CA county count differs from the earlier shorthand of 48. The current repository supports a two-acre minimum, five-acre rural preference and retained one-acre expensive-market exceptions. Changes to this file must also be applied to `househunt_config.settings`.

## Connect a licensed feed

1. Obtain actual MLS/provider authorization for the intended use and each geographic market. Public IDX access, a GitHub connection or a Supabase account does not grant a data license. Confirm public display rights, required attribution, required disclaimer text, photo rights and archival retention rights. If a license requires a private display, do not activate it on public GitHub Pages.
2. Review the feed's actual RESO metadata and sample records. In `househunt_sources`, configure `adapter=reso`, `config.base_url` to the HTTPS OData root, `scope` to explicit `STATE:County` keys, and `credential_env` to the secret's name. Keep `enabled=false` during onboarding.
3. Store the provider token in Supabase Edge Function Secrets. Never paste it into the repository, the public config table, a frontend bundle or chat. A feed using non-Bearer authentication needs an explicit adapter change, not a guessed endpoint.
4. Set `config.local_status_field`, `active_local_statuses` and `clear_fields` after reviewing local contingency semantics. Example only: `{"local_status_field":"MlsStatus","active_local_statuses":["Active"],"clear_fields":{"ContingentYN":[false]},"status_mapping_reviewed":true}`. Do not copy these values without testing the actual feed. StandardStatus=Active alone is insufficient.
5. Configure confirmed construction and existing-home evidence: `construction_field`, `site_built_values`, `existing_dwelling_field`, `existing_dwelling_values`. If those fields are unavailable, records remain candidates. For compounds, `legal_detached_homes_field` must represent **legal, livable, detached dwellings**, not bedrooms, total units or ADU potential. If absent, compounds remain review candidates.
6. Where required, configure `location_confirmed_field` backed by a real locality/geospatial validation. The three edge counties do not auto-qualify from county alone.
7. Agree the budget; set `monthly_request_limit` conservatively. Calls reserve capacity before sending, including retries. The counter includes this and the prior calendar month, intentionally conservative across unknown provider billing anchors. Use a dedicated account/key and set the cap below the remaining provider allowance; this system cannot see use by unrelated applications.
8. Implement any provider-required attribution/display/retention rules before setting `public_display_authorized=true`. Set `authorization_confirmed=true` only with actual permission, then `enabled=true`.
9. Run `select public.househunt_start_run(true);` and inspect receipts. The minute worker will resume pages. Confirm source samples, status exclusions, pagination and regional coverage. Do not call it complete just because one county finishes.

For multiple feeds, add source rows, each with their own actual scope and credentials. Keep an uncovered-region receipt source until all required geography is covered. A single MLS feed rarely covers all requested markets.

## Optional RentCast discovery

Supported adapter: `rentcast`; secret: `RENTCAST_API_KEY`. It runs state-level searches, paginates in groups of 500 and filters counties/criteria locally. Its receipts explicitly say `CA:*`, etc., not an independent county audit. It does not provide enough contingency evidence to verify an Active match. It is disabled and will incur no calls until authorized. Its findings can be merged by address with a licensed verifier, but unknown construction and compound legality still require evidence. No plan was purchased.

## Monitoring and recovery

Inspect `househunt_runs` and `househunt_coverage` from the site or SQL. Job rows include private cursors, retry count and sanitized failure codes. `complete` means that source task finished, not that every real-world listing was found. Check `checked_at` and task type.

- `blocked`: no access/configuration; no successful search claimed.
- `quota`: request cap reached; do not increase without cost approval.
- `failed`: retry/lease exhaustion or provider error; records remain saved.
- `partial`: some work completed but coverage is incomplete.
- Empty successful response: no matches from that query; never proof an older listing sold.

Retry after fixing access with a manual run. Existing cursor state allows interrupted queued/running jobs to resume. New manual runs are distinct audit records; daily runs are idempotent per Central-time date.

SQL and worker sources are checkpointed in this repository. Database migrations already applied are `househunt_automation_foundation` and `househunt_atomic_page_ingestion`; do not blindly rerun the initial policy DDL. `automation.sql` and `ingestion.sql` record the applied definitions. Bootstrap uses the legacy inventory snapshot; it must not be rerun over newer live research. To pause discovery, disable the relevant source or unschedule the two named cron jobs. This does not erase data or favorites.

## Validation

- `npm test`: status, freshness, dwelling/price/acreage, compound, pagination-origin and identity tests.
- `tests/database.sql`: transactional integration tests of page ingestion, status removal, research preservation, idempotent replay, leases, usage caps, permissions and receipts. Always rolls back fixtures.
- `node scripts/verify-ui.cjs`: optional local browser smoke test with Playwright/Chromium installed; exercises the existing interface and local preference persistence.
- Deployed worker was invoked using its Vault-backed secret and returned HTTP 200 with zero pages while no jobs were ready.

RLS is enabled on all tables. Worker state and observation tables intentionally have no client policies or grants. The dispatch token is stored in Vault; only its SHA-256 digest is available to the service-role worker. Anonymous requests cannot execute worker RPCs or read worker credentials. Supabase's pg_net extension is non-relocatable and uses its own `net` functions; its extension-metadata schema warning does not imply a public inventory write path.

## Remaining limitations

No paid/live listing feed has been tested because none is authorized. Provider-specific schemas, licensing and coverage must be validated before production activation. Missing factual fields deliberately reduce results rather than silently relax the requirements. Feed freshness can lag reality. The 30-hour expiration is a display safeguard, not a guarantee of current availability.
