# Data-source decision, 2026-10-04

## Decision

Use a permissioned RESO/MLS feed with an explicit status and local contingency fields for verified active results. The existing site, Supabase project and property IDs remain in place. Build a provider-neutral job queue so individual feeds can be enabled without rebuilding the site. No new subscription has been purchased.

RentCast is the most accessible inexpensive discovery option investigated, but is **not sufficient as the sole verifier** for this project's no-pending/no-contingent requirement. Its documented schema only supplies Active/Inactive. Keep it disabled until an account is authorized; discoveries remain candidates until verified by an appropriate feed. Do not substitute a portal scraper.

| Source | Access/cost observed | Decision |
|---|---|---|
| Direct MLS RESO feed (e.g. Bridge) | MLS/provider approval; fees and display rights depend on each agreement | Preferred verification source; configure actual licensed geographic scope, status mapping and display rights |
| SimplyRETS | Basic $49/month, $99 connection fee per feed; multi-MLS adds cost; underlying MLS authorization required | Possible managed feed, not a universal consumer subscription |
| Repliers | Standard $199/month for one MLS; licensing required | Technically suitable, comparatively expensive for personal search |
| RentCast | 50 free calls/month, then $0.20/call; Foundation $74/month includes 1,000, then $0.06/call | Optional nationwide discovery; cannot certify non-contingent status from its documented binary status |
| Zillow / Realtor / LandSearch | Automated extraction prohibited without permission | No scheduled scraping, undocumented endpoints, CAPTCHA bypass or proxy scraping |
| LandSearch XML feed | Imports listings **into** LandSearch | Not a public export/discovery API |
| Agent-supplied licensed RESO data | Requires actual authorization and adequate regional coverage | Potentially least expensive qualifying option; no assumed permission from a public IDX page |

## Sources reviewed

- https://developers.rentcast.io/reference/property-listings
- https://developers.rentcast.io/reference/property-listings-schema
- https://developers.rentcast.io/reference/sale-listings
- https://www.rentcast.io/api
- https://www.rentcast.io/terms-api
- https://simplyrets.com/ and https://simplyrets.com/serviceagreement
- https://repliers.com/plans-and-pricing/
- https://help.repliers.com/en/article/mls-requirements-for-data-licensing-when-signing-up-with-repliers-12fknh6/
- https://bridgedataoutput.com/docs/platform/API/reso-web-api
- https://www.reso.org/web-api-examples/mls/bridge-api-generic/
- https://help.flexmls.com/html/help/admin/en/contingent-status-overview-13313.html
- https://www.zillow.com/corporate/terms-of-use/
- https://www.realtor.com/terms-of-service/
- https://www.landsearch.com/corp/terms and https://www.landsearch.com/feed/specs

Prices are research observations, not approved purchases. No free, permissioned, comprehensive three-state feed with sufficiently explicit status was established. Some MLS systems represent contingency as a substatus of Active: StandardStatus alone is not enough. Provider onboarding must examine the actual metadata and map local status/contingency fields before activation.

## Coverage honesty

A scheduled run is not a successful search. Persist source, region, time, pages, records, failures, quota stops and permission gaps. Missing results, HTTP failures and expired evidence never mean sold. Keep those records and their research; withhold them from active results. Expire active evidence after 30 hours. No provider can guarantee instantaneous status changes between updates.

## Stage 4: account-owned alert email channel (2026-10-04)

The saved-search emails delivered to the owner's own Redfin, Zillow or Realtor.com Gmail inbox are now supported as a **push-only discovery and withdrawal input**. No portal scraping, undocumented listing endpoint or MLS license is implied. An alert may report a new listing, price change, Pending, Contingent, Sold or off-market status. An email cannot prove a listing is still Active and free of contingencies, so this source is prohibited in both JavaScript and SQL from promoting a listing to verified Active. Scope is limited to searches actually saved and sending mail. Gmail click-tracking links can conceal the underlying URL. The source is not active until its real email layouts, relay, secret and public-display approval are validated. A status-capable authorized feed or a human exact-listing check remains necessary for Active verification.
