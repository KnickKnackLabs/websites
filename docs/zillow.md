# Zillow rental tasks

These tasks build rental search URLs and read Zillow pages into JSON evidence.
They do not contact landlords, submit applications, write to Trello, or interpret household requirements.
Zillow's rendered data is not a supported API; readers stop when they cannot establish the requested scope or identity.

## Commands

With the websites CLI installed:

```sh
websites zillow search-url search.toml
websites zillow search "$search_url" --browser "$browser_id"
websites zillow listing "$listing_url" --browser "$browser_id" --calculator
```

From this checkout, use `mise run zillow:search-url -- search.toml`,
`mise run zillow:search -- "$search_url"`, or `mise run zillow:listing -- "$listing_url"`.
Run each task with `--help` for flags.
Bun, Node, BATS, and browser 0.3 are configured in `mise.toml`.
Browser reads also require its Chromium runtime (`browser setup` if not installed).

## Build a search URL

`search-url` prints one URL. Its input is TOML by default, or JSON with `--format json`.
Use `-` to read stdin. Relative file paths use `WEBSITES_CALLER_PWD` when supplied, otherwise the task working directory.

```toml
[map_bounds]
west = -79.1
east = -79.0
south = 35.8
north = 35.9

[filters]
max_rent = 2000
min_bedrooms = 2
min_bathrooms = 1.5
cats_allowed = true
in_unit_laundry = true
listing_age_days = 7
availability_date = "2026-11-01"
```

Supply `[region]` with numeric `id` and `type`, `[map_bounds]`, or both.
Bounds must be ordered and within longitude/latitude ranges.
All filters are optional; unknown fields are rejected rather than silently ignored.
`max_rent` is a positive integer; bedrooms are nonnegative integers; bathrooms are nonnegative finite numbers.
Pet and laundry filters are booleans. Listing age accepts 1, 7, 14, 30, or 90 days.
Availability is a valid calendar date string, not an unquoted TOML date.
The URL selects rentals and disables sale modes. Search filters are not proof that an individual property's narrative agrees with them.

## Read a search

`search` requires an HTTPS Zillow URL containing `searchQueryState`, explicit filters, and a region or map bounds.
It compares the rendered query with the requested query on every page, including filters.
Only key ordering and null unspecified numeric bounds are normalized.

The reader visits every advertised page, up to 20, and fails if page numbers/counts change, rows repeat,
or rows do not account for the advertised result count.
Building rows can represent multiple available units: `advertisedCount` counts units while `rowCount` counts returned rows.
It does not invent individual unit records or merge listings by address.

Successful JSON contains `checked`, `requestedUrl`, `query`, `complete: true`, `advertisedCount`, `rowCount`,
`pages` (URLs, rendered timestamps when available, and counts), and `listings`.
Each listing has an opaque string `id`, `url`, `isBuilding` (null if absent), `availabilityCount`, and the original row as `source`.
Treat building IDs as opaque, not necessarily numeric Zillow property IDs.
Completeness describes this checked result set, not a guarantee that Zillow exposes every available rental.

## Read a listing

`listing` accepts homedetails URLs ending in a numeric `_zpid` identity or `/b/<name>/<id>/` building URLs.
It checks the rendered URL, canonical URL when present, and known hydrated property identities against the requested listing.
It also requires rendered rental/building detail content, not just a URL or a generic page.

Successful JSON contains `checked`, `requestedUrl`, `listing`, `calculator`, and `photoScope`.
`listing` preserves the visible `text`, `title`, source URLs, known hydrated `properties`,
rendered photo URLs/alt text, and `ogImage` when present.
Properties are raw source objects, not a stable normalized schema.
Individual property reads require hydrated Zillow IDs matching the requested ID; missing identity fails closed.
Building reads may lack property hydration and rely on the matching URL/canonical path plus rendered building content.
Photos are rendered images only, not a complete gallery; `photoScope` explicitly says `rendered_images_only`.

Without `--calculator`, no calculator control is clicked.
With it, the reader clicks only one visible control whose text is exactly `Cost calculator`.
Absent or ambiguous controls are reported without clicking.
Original listing evidence stays separate from `calculator.expandedListing`, the page after the click.
`calculator.text` accepts a single identifiable calculator dialog or a unique inline container
anchored by `Cost calculator` with both monthly and move-in cost sections.
Inline containers containing other listing sections or property links are rejected; whole-page text is never sliced into calculator evidence.
Otherwise it is null with `reason: calculator_not_identified`, even if the click succeeded.
Inline detection has synthetic coverage but has not been verified against a live Zillow DOM.
No broad `Show more` controls are clicked. The reader does not claim that all narrative sections have been expanded.

A calculator's “total monthly” figure may omit tenant-paid utilities.
Laundry hookups do not establish that machines are supplied. Pet and lease descriptions may contradict structured fields.
These tasks preserve those statements for a caller to evaluate; they do not output inferred all-in rent, cat eligibility, or lease dates.

## Show a property record

```sh
websites zillow property show '<listing-url>' --calculator --intervene
```

`property show` reuses the listing reader and presents hydrated pricing, bedrooms/bathrooms,
area, address, coordinates, description and raw `resoFacts` (rental facts/amenities), plus photos and calculator evidence.
Missing fields are null. Conflicting hydrated values are returned as `conflictingValues`, not silently selected.
Narrative and structured facts remain separate: a description saying “2BR plus study” does not overwrite three structured bedrooms.
The property view omits raw page text, hydration and expanded calculator-page copies; use `listing` for detailed evidence.
Pricing is explicit: `price: {amount, kind}` distinguishes `monthly_rent`, `asking_price`, `zestimate`, and `unspecified`.
`monthlyRent` is populated only for `FOR_RENT`; `askingPrice` only for explicit sale statuses.
Provider `zestimate` and `rentZestimate` remain separate estimates, not advertised rent.
An off-market price without an explicit matching valuation field remains unspecified, never rent.
Empty rental-fact fields are omitted. Whole-page text is never parsed into property facts.
Photos are rendered images only and may include neighboring content; a complete property gallery is not yet established.
It accepts the same browser and intervention flags as `listing`; intervention resume preserves this property-record output.
This adds a convenient structured view, not inferred pet eligibility, utility costs or availability guarantees.
A live Cedar Lake read returned hydrated facts, description and scoped inline calculator text successfully;
human-assisted challenge completion remains unverified.

## Hand control to a human

Use `--intervene` on `search` or `listing` when a human can help with verification:

```sh
websites zillow listing --intervene --calculator 'https://www.zillow.com/homedetails/example/123_zpid/'
websites zillow intervention resume '<resumeHandle>'
websites zillow intervention cancel '<resumeHandle>'
```

The `intervention` task group owns the human handoff lifecycle, independently of the task that requested it.
This naming can be reused by other website implementations; the current implementation is Zillow-specific.
Resume uses the saved operation and its original options, without overrides.

Intervention launches a dedicated temporary **headed** browser; it cannot be combined with `--browser`.
If Zillow requests verification, JSON returns `status: needs_human`, a private `resumeHandle`, and the browser ID.
The challenged tab stays open. This is not successful listing/search extraction.
An operating agent should notify the human (for example with `monkeys speak`), then wait for explicit handback.
The tool never clicks or solves verification, calls the human automatically, or assumes that elapsed time means it was solved.

After the human gives control back, `resume` selects only the recorded CDP target in the same browser.
It never falls back to another tab. A remaining challenge returns `needs_human` again with the same handle.
Listing resumes in place; search first checks the parked page, then reruns pagination from page one using the solved browser session.
No partial search is reused as a complete result. Verification may recur during the rerun.
Success returns `status: complete` with evidence under `result`; the dedicated browser closes and the handle is consumed.
`cancel` closes the owned target and dedicated browser and consumes the handle.
Do not use this dedicated browser for unrelated tabs: finishing or cancelling closes the entire dedicated instance.

Handles are stored in `~/.local/state/websites/zillow/` with private directory/file permissions.
They carry source URLs, exact target IDs, and operation options. Treat them as private local capabilities.
Concurrent use of a handle is rejected. Unexpected errors retain recovery state and print the browser ID/handle to stderr.
If browser shutdown fails after a successful read, the task still returns `status: complete` and its evidence,
with `cleanup: {status: pending, browser, recoveryHandle, error}`. This does not claim the browser closed.
Completed evidence is saved privately before shutdown. `intervention resume <recoveryHandle>` retries cleanup
and returns the saved result without rereading Zillow; `intervention cancel <recoveryHandle>` cleans up and discards it.
If the browser is already gone or an interrupted process left a `.lock` directory, recovery is manual:
verify no operation is running before removing that handle's lock/state, and use `browser close <id>` when necessary.
There is no automatic expiry or restart after a browser crash.

## Browser ownership, errors, and privacy

Use `--browser <id>` to select an existing browser explicitly.
Only a new owned tab is navigated and closed; existing human tabs are not changed.
Without it, `browser run` launches an ephemeral browser; add `--headed` to make that launch visible.
There is no automatic site/profile selection. The shared legacy helper no longer passes the obsolete `--site` flag.

Readers use raw CDP evaluation to avoid the Playwright evaluation failure recorded in browser issue #14.
Navigation has a 60-second timeout; initial rendering is polled up to 15 times with one-second waits.
Search pagination waits 1.5 seconds between pages. CDP calls and process execution do not yet have an independent hard timeout.

By default, detected CAPTCHA, human verification, access denial, identity/scope drift, or cleanup errors exit nonzero without success JSON.
Challenges are not bypassed; ordinary reads close their owned tab on failure.
Only explicit `--intervene`/`resume` retains a challenge tab and returns `needs_human`; other errors still fail.
Public task results go to stdout as JSON; browser preambles and errors go to stderr.
Missing, malformed, duplicate, or failed-process result frames are errors, not partial success.

Output can contain addresses, photos, descriptions, and other listing data. Store it privately as appropriate.
Tests use synthetic evidence and mocked browser flows, not private captured pages.
Run `mise run test` for the existing BATS gate, which also runs the Zillow Node tests.
Offline tests cover synthetic evidence and mocked flows.
A real ephemeral-browser smoke verified CDP evaluation, result transport, and owned-tab cleanup.
A public Zillow listing smoke reached a human-verification challenge, with no successful listing JSON.
That exposed the `Press & Hold` wording; challenge detection now covers it with a regression test.
A synthetic, network-intercepted headed-browser smoke verified challenge parking, reconnection to the exact target,
in-place synthetic completion, and target cleanup across separate browser connections.
This exercised the handoff plumbing, not real human verification or Zillow extraction.
It also exposed a managed-browser shutdown race (`ENOTEMPTY` in temporary-profile removal);
retrying `browser close <id>` cleaned up its stopped registry entry. Tool cleanup failures retain recovery handles; completed reads remain usable with an explicit cleanup warning.
Successful live search/listing extraction, human-assisted verification, and calculator layout remain unverified; no challenge was bypassed.
