# Househunt

Existing West Coast Property Finder: https://j-dooley.github.io/house-hunt/

The original site and inventory are retained. Supabase hosts the cumulative inventory, private preferences and a resumable daily discovery/verification queue. GitHub Pages displays fresh verified active matches and a separate saved archive.

**Live discovery currently awaits authorized listing-feed access.** The deployed 6 a.m. Central scheduler records this as blocked, not as a completed search. No paid data plan was purchased.

- [Source assessment](docs/DATA-SOURCES.md)
- [Operations, activation and limitations](docs/OPERATIONS.md)
- [Development checkpoints](docs/PROGRESS.md)
- [Search scope and criteria](config/search.json)

Run `npm test` for the pure rule tests. Database integration tests are in `tests/database.sql` and roll back all fixtures. Supabase SQL and Edge Function source are versioned under `supabase/`.
