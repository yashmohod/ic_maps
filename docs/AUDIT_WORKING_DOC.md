# IC Maps — Audit Working Document

Living tracker for bugs, edge cases, and security items from the Aug 2026 audit.
Update **Status** and **Decision / notes** as we discuss and ship fixes.

**Status legend:** `Open` · `Discussing` · `Decided` · `In progress` · `Done` · `Won’t fix` · `Blocked (college)`

---

## How to use this doc

- Each item has: problem summary, your direction, explanation (where needed), proposed approach, and status.
- Prefer linking PRs / commits under **Progress** when something lands.
- Do not treat this as a formal security disclosure; it is an internal engineering checklist.

---

## P0 — Production / correctness blockers

### 1. One-way edges ignored by router

| Field          | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| **Severity**   | High                                                            |
| **Status**     | Done |
| **Where**      | `lib/navigation-graph.ts` (`buildGraph` outdoor + indoor loops) |
| **Also touch** | Optional unit test in `lib/navigation-*.test.ts`                |

**Problem:** DB stores `bi_directional` + `direction`, but adjacency always adds `node_a → node_b` and only adds reverse when bidirectional. Uni-directional edges drawn B→A still route A→B.

**Your note:** Should be easy — fix it.

**Proposed fix:** When `!bi_directional`, push only `(direction ? a→b : b→a)`. Same for indoor. Add a small assert/test with a one-way pair.

**Progress:** Shipped: `buildGraph` honors uni-directional `direction` (outdoor + indoor) + tests.

---

### 2. Base path breaks (share links, auth links, similar raw URLs)

| Field        | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| **Severity** | Critical under `basePath: "/ic_maps"`                                |
| **Status**   | Done |
| **Helpers**  | `withBasePath`, `toPublicPath`, `toRouterPath` in `lib/base-path.ts` |

**Problem:** Hardcoded absolute app paths ignore deploy base path. Locally (empty base) they work; production under `/ic_maps` they 404.

**Your note:** Fix the same way as login so it still works with or without base path; find and fix all similar spots.

**Known broken / risky spots**

| Location                                    | Issue                                 | Fix style                                                       |
| ------------------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| `app/route/[id]/page.tsx`                   | `fetch(\`/api/shareableroute?id=…\`)` | `fetch(withBasePath(...))`                                      |
| `app/customRoute/page.tsx`                  | share URL `${origin}/route/${id}`     | `${origin}${withBasePath(\`/route/${id}\`)}` (like MyMaps)      |
| `components/login-form.tsx`                 | `<a href="/account/signup">`          | `Link` + app path, or `href={toPublicPath(...)}`                |
| `components/signup-form.tsx`                | `<a href="/account/login">`           | same                                                            |
| `app/page.tsx`                              | `href="/account/login"`               | prefer Next `Link` (auto basePath) or `toPublicPath`            |
| `app/customRoute/page.tsx`                  | login `callbackUrl=/customRoute`      | keep router-relative; ensure login redirect uses `toRouterPath` |
| Floorplan / reports “Back” `Link href="/…"` | Next `Link` usually OK                | verify; prefer `Link` over raw `<a>`                            |

**Rule of thumb**

- **Next `<Link href>` / `router.push`:** use app-relative paths (`/account/login`). Next adds `basePath`.
- **Raw `<a href>`, `window.location`, QR/share URLs, `fetch`, `img`/`url()`:** use `withBasePath` / `toPublicPath`.
- **Paths stored in DB:** store without base (`stripBasePath`); prefix only when serving.

**Progress:** Shipped: share fetch/QR + login/signup Links use basePath helpers.

---

### 3. Secure photos (reports + floor plans) — admin-only

| Field        | Value                 |
| ------------ | --------------------- |
| **Severity** | Medium–High (privacy) |
| **Status**   | Done |

**Product decision (2026-08-06):** Guests are **never** shown floorplan images for security reasons. Client-side indoor guidance for guests is **textual only** (turn instructions / labels). Floorplan bitmaps are admin tooling (and admin report inbox if needed).

**Two different upload surfaces**

| Kind                                  | Today                                                                                  | Risk                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Bug / accessibility report photos** | `public/report/{id}_1.ext` — predictable names, world-readable                         | Anyone can enumerate/download                                                   |
| **Floorplan images**                  | `public/uploads/floorplans/destination-{id}/…` — UUID-ish names, still under `public/` | Anyone who learns/guesses URL can load the image; upload already requires admin |

**Implications**

- No guest signed-URL path for floorplans.
- Ensure public APIs / navigate responses do **not** leak `imageUrl` floorplan paths to anonymous clients.
- Admin editors load images only through admin-authenticated media routes.
- Report photos: same private-storage pattern; admin-only GET.

**Proposed implementation**

1. Stop writing under `public/`. Use e.g. `storage/private/floorplans/` and `storage/private/reports/` (outside web root).
2. Serve via authenticated API routes:
   - `GET /api/admin/media/floorplan?key=…` → `requireAdmin()` then stream file.
   - `GET /api/admin/media/report-photo?id=…` → `requireAdmin()`.
3. Non-guessable keys (reports: drop `{id}_1`; floorplans already partly UUID).
4. Magic-byte sniff / re-encode (see item 22).
5. Audit client + API: guest indoor UX = text steps only; strip/hide floorplan image fields on public reads.

**Progress:** Shipped: uploads → `storage/private/`; `GET /api/admin/media`; guests get `imageUrl: null` on floorplan nodes.

---

### 4. Dependency updates (`next`, `better-auth`, audit)

| Field        | Value                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------- |
| **Severity** | High (known CVEs)                                                                                  |
| **Status**   | Done |
| **Notes**    | `npm audit` showed high issues on `next` and `better-auth`; drizzle-kit/esbuild are mostly tooling |

**Proposed:** Bump `next` to patched ≥16.2.11 line; bump `better-auth` to ≥1.6.22; re-run `npm audit` / smoke login + map.

**Progress:** Shipped: `next@16.3.0`, `better-auth@1.6.26`.

---

## P1 — Routing / performance / graph

### 5. Recalculate route only when user leaves uncertainty / off-path

| Field        | Value                                                        |
| ------------ | ------------------------------------------------------------ |
| **Severity** | High (perf / UX on `/route/[id]`)                            |
| **Status**   | Done |
| **Where**    | `app/route/[id]/page.tsx` GPS `useEffect` → `refreshRoute()` |

**Decision (2026-08-06):** Ship the proposed plan.

**Answers**

- **Yes — turn progress is local.** `hooks/use-navigation-progress.ts` advances steps from `userPos` + cached `routeCoords` / `steps` (≈15 m threshold). No server call for “next turn.”
- **Accuracy ring exists.** `UserPos.accuracy` + `AccuracyRingLayer` already draw GPS uncertainty.
- **Today’s bug:** share-route page still calls full `POST /api/map/navigateTo` whenever `userPos.lat/lng` changes (roughly every GPS tick).

**Plan to implement**

1. On GPS update: update camera + local progress only.
2. Re-request route only if:
   - nav conditions / parking / destination change, **or**
   - user is **off the current polyline** by more than `max(accuracy, MIN_OFF_ROUTE_M)` (e.g. 20–30 m), optionally with debounce 2–3 s.
3. Optional hysteresis: require N consecutive off-route samples before recalc.

**Progress:** Shipped: share-route no longer refreshes on every GPS tick; off-polyline `max(accuracy, 25m)` + 2.5s debounce.

---

### 6. Rate limit routing

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| **Severity** | Medium (DoS / cost)                                      |
| **Status**   | Done |
| **Where**    | Primarily `POST /api/map/navigateTo`; optionally reports |

**Decision (2026-08-06):** Single Next process in prod → **in-memory** rate limiter is enough. Be **aggressive** against abuse, but keep **real navigation** working (especially after item #5 cuts GPS spam).

**Goals**

1. A scripted flood cannot pin the event loop / DB.
2. A normal phone user (tap Navigate, change parking, flip ped/veh, occasional off-route recalc) almost never sees 429.
3. Shared dorm NAT is painful either way — bias toward protecting the server, with clear 429 + `Retry-After` so the client can toast and retry.

**Aggressive-but-fair strawman (navigateTo)**

| Limit            | Value                                          | Why                                                                    |
| ---------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Per-IP burst     | **5 / 2 s**                                    | Stops tight loops; still allows double-tap + one mode flip             |
| Per-IP sustained | **20 / min**                                   | After #5, honest use is a handful of routes/session                    |
| Per-IP hard      | **100 / hour** soft warn / hard block optional | Catches slow scrapers                                                  |
| Body / vias      | Reject early (`viaDestIds` ≤ 10 from #7)       | Cheap before A\*                                                       |
| Concurrency      | **Max 2 in-flight navigate per IP**            | Tends actual requests: queue or 429 the 3rd instead of starting 50 A\* |

**“Tending to actual requests” tactics**

- Prefer **token bucket** (refill over time) over a hard lockout that bans for minutes.
- On 429: return JSON `{ error, retryAfterMs }` + header; client toast “Slow down” and **do not** burn retries in a loop.
- Ship **#5 first** (no per-GPS navigate) so aggressive caps don’t hit real walkers.
- Optional: slightly higher bucket for authenticated `@ithaca.edu` later — not required for v1.
- Reports POST: separate, stricter bucket (e.g. **3 / min / IP**) — spam vector, not navigation.

**Implementation**

- Small `lib/rate-limit.ts`: in-memory `Map<ip, { tokens, updatedAt, inflight }>`; prune stale keys periodically.
- Call at top of `navigateTo` (and report routes).
- Single process ⇒ no Redis needed. Document that multi-instance would need shared store later.

**Progress:** Shipped: in-memory limiter on navigateTo + report POSTs.

---

### 7. Cap `viaDestIds` / route destinations at 10

| Field        | Value                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Severity** | Medium                                                                                                |
| **Status**   | Done |
| **Where**    | Zod on `app/api/map/navigateTo/route.ts`; also enforce on shareable-route create UI/API if multi-stop |

**Your note:** Limit to 10 destinations — more than needed, less than infinite crash risk.

**Proposed:** `viaDestIds: z.array(...).max(10)`; mirror on shareable route destination lists if applicable.

**Progress:** Shipped: `viaDestIds.max(10)`.

---

### 8. Graph cache reload race

| Field        | Value                                          |
| ------------ | ---------------------------------------------- |
| **Severity** | High under concurrent edit + traffic           |
| **Status**   | Done |
| **Where**    | `lib/navigation.ts` `getGraph` / `reloadGraph` |

**Plain-language scenario**

1. Process starts cold. User A navigates → `getGraph()` starts loading the graph from DB (**Load L0**, still in flight).
2. Admin edits an edge → API writes DB → `reloadGraph()` loads **G1** (new graph) and sets `store.graph = G1`.
3. Late finish of **L0** still holds the old promise callback: it sets `store.graph = G0` and clears `loading`.
4. Result: memory now has the **old** graph even though DB (and admin UI) has the new edges. Until another successful reload, every navigate uses stale data.

**Which fix is best + easiest?**

| Option                                    | Effort   | Notes                                                                                                                                                                               |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generation counter**                    | Smallest | `let graphGen = 0`; each load captures `const gen = ++graphGen`; only `store.graph = g` if `gen === graphGen` (or `gen >= committed`). `reloadGraph` bumps gen first. ~10–20 lines. |
| Ignore older `store.loading` after reload | Small    | Easy to get wrong if two loads overlap without a gen id                                                                                                                             |
| Mutex / serial queue                      | Medium   | Correct but more plumbing than we need for one process                                                                                                                              |

**Decision (2026-08-06):** Use a **generation counter** — best correctness/effort for a single process.

**Progress:** Shipped: graph generation counter on load/reload.

---

### 9. Through-building hop cost / geometry

| Field        | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| **Severity** | High when through-building enabled                                        |
| **Status**   | Done |
| **Where**    | `lib/navigation.ts` A\* through-building + path reconstruction / geometry |

**Decision (2026-08-06):** Use **straight-line (haversine) distance** between outdoor entry and outdoor exit for hop cost / ETA / geometry — not a fixed 1 m.

**Approach**

- Keep indoor BFS only to prove entry→exit connectivity and apply indoor accessibility filters (stairs/ramp/etc.).
- For **path cost / ETA**: synthetic outdoor entry→exit hop distance = `calcDistance(entry, exit)` (haversine already in `lib/geo.ts`).
- For **map geometry**: draw a straight chord between those outdoor nodes (optional “through building” step in text guide).
- Floorplan images stay admin-only (#3); guests get textual indoor guidance only.

**Progress:** Shipped: through-building hop = haversine chord + synthetic edge ids.

---

### 10. A\* heuristic / “first destination”

| Field        | Value                                                 |
| ------------ | ----------------------------------------------------- |
| **Severity** | Medium                                                |
| **Status**   | Done |
| **Where**    | `lib/navigation.ts` `aStar`; `lib/geo.ts` `heuristic` |

**Decision (2026-08-06):** Change the degree→meter scale so east–west isn’t inflated: use **~82 km per degree longitude** at Ithaca (instead of 111 km for both axes). Accept that the **first destination node A\* pops** is the one we take; node classification (pedestrian / stairs / ramp / incline / dead) is what keeps inaccessible approaches out of the graph.

**Clarification (A\* vs BFS)**

- A\* is not BFS, but with an **admissible** heuristic the first time a **goal** is dequeued it **is** cheapest among allowed goals under edge weights.
- Today’s bug was overestimating east–west cost (111 km/° on lng), which can make “first goal” **not** the true shortest. Scaling lng to ~82 km/° (or `111 * cos(lat)`) restores that guarantee for campus.
- Stairs/ramp/**avoid** flags don’t pick among entrances after the fact — they **exclude** nodes/edges during search. So if both entrances are allowed, A\* still picks the shorter walk; if one entrance is stairs-only and the user avoids stairs, only the ramp/plain path remains. That matches your intent.

**Proposed code**

```ts
// rough Ithaca-friendly, or better: METERS_PER_DEGREE_LNG = 111_000 * Math.cos(toRad(lat))
const deg = Math.sqrt(dLat ** 2 + dLng ** 2); // still crude unless dLng scaled first
```

Prefer: `√((dLat*111e3)² + (dLng*82e3)²)` or haversine for `h`.

**Won’t do (for now):** full closed-set rewrite / multi-goal gScore bake-off beyond fixing the heuristic.

**Progress:** Shipped: heuristic lng ≈ 82 km/°.

---

### 11. `closestNode` should ignore dead nodes

| Field        | Value                                 |
| ------------ | ------------------------------------- |
| **Severity** | Medium                                |
| **Status**   | Done |
| **Where**    | `lib/navigation.ts` `closestNode` SQL |

**Your note:** Update to filter out dead nodes.

**Proposed:** `AND is_dead = false` in the nearest-node query.

**Progress:** Shipped: `closestNode` excludes `is_dead`.

---

### 12. Incline units → degrees (ADA audience)

| Field        | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| **Severity** | Medium                                                                         |
| **Status**   | Done |
| **Where**    | Schema comments, route-editor incline UI, `navigateTo` max incline, OSM import |

**Your note:** Make consistent with **degrees** if that’s what ADA-style guidance uses so intended users can set limits correctly.

**ADA context (for UX copy, not legal advice):** Accessibility guidance often talks about **running slope as a ratio or percent** (e.g. 1:12 ≈ 4.8° ≈ 8.33%). Degrees are understandable; percent is also common. Pick **degrees** app-wide and show a small helper (“≈ 1:12 is about 4.8°”).

**Work**

- Treat `edge_outside.incline` as degrees (migrate comment + any existing meter values — currently mostly 0).
- Route editor: label “degrees”, clamp 0–90 (or −90..90 if signed).
- Main map slider already uses ° — keep; ensure comparison uses same field.
- Indoor ramp nodes already use incline in a degree-like slider — align naming.

**Progress:** Shipped: incline treated as degrees (schema/API/editor labels).

---

### 13. Floorplan edge upsert doesn’t update direction / bidir

| Field        | Value                                          |
| ------------ | ---------------------------------------------- |
| **Severity** | Low (given current product)                    |
| **Status**   | Won’t fix / N/A for now                        |
| **Where**    | `app/api/destination/floorplan/edges/route.ts` |

**Your question:** Inside edges are all bidirectional, no?

**Answer:** **In practice yes.** Floor Plan Editor always creates edges with `biDirectional: true` (`app/destination-editor/floorplan/page.tsx`). The API also defaults to bidirectional when the field is omitted (`biDirectional !== false`). There is no indoor one-way UI today.

**Why the audit flagged it:** The upsert SQL updates handles only, not `direction` / `bi_directional`. That would matter if we ever allowed uni-directional indoor edges or flipped direction on reconnect. With always-bidirectional indoor edges, routing treats A↔B the same either way (and outdoor one-way is a separate issue — item #1).

**Decision (2026-08-06):** No change required while indoor edges stay bidirectional. Revisit if we add one-way indoor connectors later.

**Progress:** Closed.

---

### 14. Manual outdoor nodes default with no nav flags

| Field         | Value                                       |
| ------------- | ------------------------------------------- |
| **Severity**  | Medium (editor footgun)                     |
| **Status**    | Won’t fix (by design)                       |
| **Your note** | Fine — admin’s responsibility to categorize |

**Progress:** Documented; no code change.

---

### 15. OSM ramps + incline heights

| Field        | Value                                          |
| ------------ | ---------------------------------------------- |
| **Severity** | Low–Medium (data quality)                      |
| **Status**   | Done |
| **Where**    | `lib/osm-import.ts`, import APIs               |

**Your note:** Classify as ramps; if we can get heights nice, else set incline 0 and you’ll measure with college resources.

**Campus OSM reality:** Almost no `ramp=yes` tags; a few `incline=up/down` paths without numeric degrees.

**Proposed**

- Keep/improve ramp tagging (`is_ramp`).
- On import: `incline = 0` on edges for ramp segments until you measure.
- Optional later: parse numeric `incline=5%` / `incline=5°` when present in OSM.

**Progress:** Confirmed: OSM import inserts incline `0`; ramps flagged via `is_ramp`.

---

## P2 — Frontend reliability / a11y / auth UX

### 16. Destination switch race — which page?

| Field        | Value                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity** | High (stale UI)                                                                                                                                                              |
| **Status**   | Done |
| **Pages**    | **Main map** `app/page.tsx` (`showBuilding`), **Shareable routes creator** `app/customRoute/page.tsx`, **Route editor** `app/route-editor/page.tsx` (`handelBuildingSelect`) |

**Decision (2026-08-06):** Use proposed fix — monotonic request id and/or `AbortController`; only apply state if response matches the latest selected building.

**Scenario (main map example)**

1. User opens home map, picks **Building A** → `showBuilding(A)` starts fetch.
2. Quickly picks **Building B** → `showBuilding(B)` starts.
3. Slower A response can overwrite B’s markers/polygon while combobox shows B.

**Progress:** Shipped: building-select request ids on home, customRoute, route-editor.

---

### 17. Overlapping route requests — which page?

| Field        | Value                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Severity** | Medium                                                                                                    |
| **Status**   | Done |
| **Pages**    | **Share route view** `app/route/[id]/page.tsx` (`refreshRoute`); **Home map** `app/page.tsx` (`getRoute`) |

**Your note:** Can’t we fix it like #16?

**Answer:** **Yes.** Same idea: bump a `routeRequestId` (or abort prior fetch) when starting `navigateTo`; ignore JSON that isn’t from the latest id. Complements #5 (fewer calls) but still needed for fast parking / mode toggles.

**Progress:** Shipped: routeRequestId on home + share-route navigate.

---

### 18. Failed loads look like empty success + Sonner toasts

| Field        | Value                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **Severity** | Medium                                                                                         |
| **Status**   | Done |
| **Where**    | Home `showBuilding`, route editor building load, destination editor list, floorplan load, etc. |

**Your note:** Fix and add failed Sonner error alerts.

**Proposed:** Always check `res.ok` before treating JSON as data; `toast.error(...)` on failure; don’t clear graphs unless intentional.

**Progress:** Shipped: `res.ok` + Sonner on building loads (home/custom/route-editor).

---

### 19. Floorplan entrance sync after building switch

| Field        | Value                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| **Severity** | Low (accepted)                                                                                |
| **Status**   | Won’t fix / accepted risk                                                                     |
| **Where**    | Floor Plan Editor: `app/destination-editor/floorplan/page.tsx` + `lib/floorplan-entrances.ts` |

**What this feature does**

On building open, `syncFloorplanEntrances` may POST missing indoor doors and PUT unplaced doors onto the first floor.

**The race**

If you switch buildings mid-sync, the UI stops drawing the old building, but in-flight POSTs/PUTs for it can still finish writing.

**Decision (2026-08-06):** **Won’t fix / accepted risk.** Mostly one-time setup; operations are short CRUD. Worst case is odd auto-placed doors an admin can clean up — not a guest-facing outage. Revisit only if editors complain.

**Progress:** Closed.

---

### 20. MapBottomSheet global `touchmove`

| Field        | Value                           |
| ------------ | ------------------------------- |
| **Severity** | Medium (mobile web)             |
| **Status**   | Done |
| **Where**    | `components/MapBottomSheet.tsx` |

**Decision (2026-08-06):** Use proposed **A + C** — attach move/end listeners only while dragging, preferably on the sheet element (not forever on `window` with `passive: false`).

**Progress:** Shipped: MapBottomSheet attaches move/end listeners only while dragging.

---

### 21. MyMaps import unbounded payload

| Field        | Value                                                                |
| ------------ | -------------------------------------------------------------------- |
| **Severity** | Medium                                                               |
| **Status**   | Done |
| **Where**    | `lib/mymaps-transfer.ts`, `app/api/mymaps/maps/[id]/import/route.ts` |

**Decision (2026-08-06):** Cap import at **5000 nodes** (Zod `.max(5000)`). Also cap edges sensibly (e.g. **10000**) so a 5k-node complete graph can’t explode; reject with 400/413.

**Progress:** Shipped: MyMaps transfer caps (5000 nodes / 10000 edges).

---

### 22. Upload MIME trust

| Field        | Value                            |
| ------------ | -------------------------------- |
| **Severity** | Low–Medium                       |
| **Status**   | Done |
| **Where**    | Report + floorplan upload routes |

**Decision (2026-08-06):** Use proposed fix ladder — magic-byte sniff, extension from detected type; optional sharp re-encode later. Pair with #3 private storage.

**Progress:** Shipped: magic-byte sniff on private image save.

---

### 23. Missing destination wiring → 500

| Field        | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| **Severity** | Medium                                                                                    |
| **Status**   | Won’t fix (accepted)                                                                      |
| **Where**    | `lib/navigation.ts` `navigate()` throws; `app/api/map/navigateTo/route.ts` catches as 500 |

**Context:** Destination in combobox but no `destination_node` entrances → navigate throws → 500 / “no route.”

**Decision (2026-08-06):** Leave as-is. Wiring buildings to outdoor nodes is **admin setup responsibility**.

**Progress:** Closed.

---

### 24. Silent `reloadGraph` failure

| Field        | Value                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Severity** | Medium                                                                                                                         |
| **Status**   | Done |
| **Where**    | Many mutation routes: `await reloadGraph().catch(console.error)` e.g. `app/api/map/edge/route.ts`, OSM import, floorplan edges |

**Decision (2026-08-06):** Use proposed fix — retry reload 2–3×; if still failing, return **503** to admin (“saved but routing cache stale”); couple with #8 generation counter.

**Progress:** Shipped: `reloadGraphOr503` on mutation routes.

---

### 25. Signup: exist-check + force Netpass for `@ithaca.edu`

| Field        | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| **Severity** | Medium (auth UX / policy)                                                                                  |
| **Status**   | Done |
| **Where**    | `components/signup-form.tsx`, `lib/auth.ts` hooks (already blocks ithaca email/password paths server-side) |

**Your note:** Check if account exists before signup; anyone using `@ithaca.edu` with email/password should be redirected to Netpass (Microsoft SSO).

**Already partly true:** `lib/auth.ts` before-hook blocks `/sign-up/email`, `/sign-in/email`, `/request-password-reset` for Ithaca emails with SSO message.

**Still do**

- Client: if email ends with `@ithaca.edu`, don’t submit password signup — prompt/redirect Microsoft (same as login).
- On duplicate email: clear toast “Account exists — sign in” (Better Auth error mapping).
- Double-submit guard (`loading` like login).

**Progress:** Shipped: signup loading + duplicate toast; Ithaca → Microsoft.

---

### 26. Logout → public home map

| Field        | Value                           |
| ------------ | ------------------------------- |
| **Severity** | Medium (UX)                     |
| **Status**   | Done |
| **Where**    | `components/profileOptions.tsx` |

**Your note:** Logout should redirect to main public map page.

**Proposed:** After `authClient.signOut()`, `router.replace("/")` + `router.refresh()` (or hard `toPublicPath("/")` if needed).

**Progress:** Shipped: logout → `/`.

---

### 27. Combobox accessible names

| Field        | Value                           |
| ------------ | ------------------------------- |
| **Severity** | Low (a11y)                      |
| **Status**   | Done |
| **Where**    | `components/ComboboxSelect.tsx` |

**Proposed:** `aria-label={label ?? placeholder}` on trigger when visible label omitted.

**Progress:** Shipped: Combobox `aria-label`.

---

### 28. Terms of Service / Privacy Policy

| Field        | Value                                       |
| ------------ | ------------------------------------------- |
| **Severity** | Low (compliance / trust)                    |
| **Status**   | Blocked (college) — don’t forget            |
| **Where**    | Login + signup footers currently `href="#"` |

**Your note:** No docs yet — keep a reminder to ask college authorities for official Terms + Privacy.

**Action when ready:** Replace `#` with real URLs (or college policy pages); until then keep placeholder but track here.

**Owner to ask:** **\*\*\*\***\_\_**\*\*\*\*** (college counsel / IT / marketing)

**Progress:** Reminder logged; no URLs yet.

---

## Suggested implementation order

1. **#1** one-way graph · **#11** dead closestNode · **#7** max 10 vias
2. **#2** basePath sweep · **#26** logout · **#25** signup SSO UX · **#27** a11y
3. **#4** dependency bumps
4. **#5** + **#17** smart recalc / request ids (kills most navigate spam)
5. **#6** rate limit (easier once #5 lands)
6. **#8** generation counter · **#24** reload retry/503 · **#9** through-building hop
7. **#12** degrees · **#15** ramp incline 0
8. **#3** + **#22** private media
9. **#16/#17/#18/#20/#21** reliability pass
10. **#28** wait on college

---

## Implementation plan (all decided work)

Scope: every **Decided** item in this doc. Out of scope: **#13, #14, #19, #23** (won’t fix) and **#28** (blocked on college).

### Phase A — Routing correctness (small, high leverage)

| ID      | Change                                                                                                                                            | Primary files                                                       | Done when                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| **#1**  | Honor `direction` when `!bi_directional` in outdoor + indoor `buildGraph`                                                                         | `lib/navigation-graph.ts` + test                                    | One-way B→A only routes B→A                           |
| **#11** | `closestNode` SQL adds `AND is_dead = false`                                                                                                      | `lib/navigation.ts`                                                 | Dead nodes never become start                         |
| **#7**  | `viaDestIds` / multi-stop max **10**                                                                                                              | `app/api/map/navigateTo/route.ts`; shareable-route UI/API if needed | Oversize → 400                                        |
| **#10** | Heuristic: lat×111 km, lng×**82 km** (or `cos(lat)`)                                                                                              | `lib/geo.ts` + any tests                                            | Unit smoke for E–W vs N–S                             |
| **#9**  | Through-building: keep indoor BFS for connectivity/filters; hop cost + geometry = **haversine(entry, exit)** straight chord; text-only for guests | `lib/navigation.ts`, route geometry helpers, instruction builders   | ETA/path include chord; no floorplan images to guests |

### Phase B — Deploy/auth UX quick wins

| ID      | Change                                                                                   | Primary files                                                                                             | Done when                                    |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **#2**  | Sweep raw `/api`, share URLs, `<a href>` → `withBasePath` / `toPublicPath` / Next `Link` | `app/route/[id]/page.tsx`, `app/customRoute/page.tsx`, login/signup forms, `app/page.tsx`, grep leftovers | Works with basePath empty **and** `/ic_maps` |
| **#26** | Logout → `router.replace("/")` + `refresh`                                               | `components/profileOptions.tsx`                                                                           | Lands on public map                          |
| **#25** | Ithaca email → Netpass UX; exist/duplicate messaging; signup loading guard               | `components/signup-form.tsx` (server hook already blocks)                                                 | No password signup for `@ithaca.edu`         |
| **#27** | Combobox `aria-label={label ?? placeholder}`                                             | `components/ComboboxSelect.tsx`                                                                           | Screen reader has a name                     |

### Phase C — Dependencies

| ID     | Change                                                                                   | Notes                                     |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| **#4** | Bump `next` (≥ patched 16.2.x), `better-auth` (≥ 1.6.22); `npm audit`; smoke login + map | Resolve lockfile carefully; fix breakages |

### Phase D — Navigate traffic control (order matters)

| ID      | Change                                                                                                                                    | Primary files                                                                          | Done when                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| **#5**  | GPS updates: camera + local progress only; recalc if dest/parking/nav change **or** off-polyline by `max(accuracy, 20–30 m)` (+ debounce) | `app/route/[id]/page.tsx`, maybe `hooks/use-navigation-progress.ts` / small geo helper | No per-tick `navigateTo`              |
| **#17** | `routeRequestId` (same idea as #16) on home + share-route navigate                                                                        | `app/page.tsx`, `app/route/[id]/page.tsx`                                              | Stale responses ignored               |
| **#6**  | In-memory limiter: ~5/2s, 20/min, max 2 in-flight/IP; 429 + `Retry-After`; toast; stricter on reports                                     | `lib/rate-limit.ts`, `navigateTo`, report POSTs                                        | Flood limited; normal tap Navigate OK |

### Phase E — Graph cache reliability

| ID      | Change                                                                                   | Primary files                                    | Done when                             |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------- |
| **#8**  | Generation counter on `getGraph` / `reloadGraph`                                         | `lib/navigation.ts`                              | Old load cannot overwrite newer graph |
| **#24** | Retry reload 2–3×; on failure return **503** to admin mutation (“saved but cache stale”) | map/floorplan/OSM mutation routes + small helper | Admin sees failure; no silent stale   |

### Phase F — Incline / OSM data semantics

| ID      | Change                                                                                        | Primary files                                               | Done when               |
| ------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| **#12** | Treat outdoor edge incline as **degrees**; editor labels/clamps; align with main-map ° slider | schema comment, route-editor, incline API copy, nav compare | One unit end-to-end     |
| **#15** | Ramps classified; edge incline **0** until measured (already mostly true)                     | `lib/osm-import.ts` / import path                           | Documented + consistent |

### Phase G — Private media (largest chunk)

| ID      | Change                                                                                                                                                                            | Primary files                                                             | Done when                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| **#3**  | Move floorplan + report files out of `public/`; admin-only GET streamers; guests never get floorplan images (text indoor guide only); strip `imageUrl` from public APIs if leaked | upload routes, new `app/api/admin/media/*`, editors, any public indoor UI | Guessing URL fails; admin editor works |
| **#22** | Magic-byte sniff; extension from detected type                                                                                                                                    | report + floorplan upload                                                 | Fake MIME rejected                     |

### Phase H — Frontend reliability / caps

| ID      | Change                                                                   | Primary files                                 | Done when                                  |
| ------- | ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| **#16** | Request id / abort on building select                                    | `app/page.tsx`, `customRoute`, `route-editor` | Fast A→B doesn’t show A                    |
| **#18** | `res.ok` checks + Sonner errors (don’t fake empty success)               | home, editors, floorplan load                 | Failures toast                             |
| **#20** | MapBottomSheet: listeners only while dragging; prefer sheet target (A+C) | `components/MapBottomSheet.tsx`               | No lifelong non-passive window `touchmove` |
| **#21** | MyMaps import `.max(5000)` nodes (+ e.g. 10000 edges)                    | `lib/mymaps-transfer.ts`                      | Oversize → 400                             |

### Phase I — Reminder only

| ID      | Action                                                            |
| ------- | ----------------------------------------------------------------- |
| **#28** | Ask college for Terms + Privacy URLs; leave `href="#"` until then |

### Suggested PR / commit slicing

1. **Routing core:** #1, #7, #9, #10, #11
2. **Cache:** #8, #24
3. **BasePath + auth UX:** #2, #25, #26, #27
4. **Deps:** #4
5. **Navigate UX + limits:** #5, #16, #17, #6
6. **Reliability polish:** #18, #20, #21
7. **Incline/OSM:** #12, #15
8. **Private media:** #3, #22 (biggest; do last or as its own milestone)

### Test plan (minimum)

- Unit: one-way edge graph; heuristic scale; densify/import flags unchanged.
- Manual: share route under `/ic_maps`; logout → home; Ithaca signup → Netpass; navigate with GPS (no spam); off-route triggers recalc; admin edit edge then navigate sees it; floorplan image 404 when logged out; report photo not public.

---

## Discussion parking lot

- **#3** ~~…~~ → **Decided:** guests never see floorplans; text-only indoor guide.
- **#5** ~~…~~ → **Decided:** proposed off-route / uncertainty recalc plan.
- **#6** ~~…~~ → **Decided:** single process; aggressive in-memory limits (after #5).
- **#8** ~~…~~ → **Decided:** generation counter (easiest correct fix).
- **#9** ~~…~~ → **Decided:** straight-line through-building hop.
- **#10** ~~…~~ → **Decided:** ~82 km/° lng heuristic; first goal + node flags.
- **#13** ~~…~~ → **Won’t fix:** indoor edges are always bidirectional in the editor.
- **#16 / #17** ~~…~~ → **Decided:** request-id / abort pattern (same idea for both).
- **#19** ~~…~~ → **Won’t fix / accepted risk:** one-time setup + short CRUD.
- **#20** ~~…~~ → **Decided:** MapBottomSheet A+C.
- **#21** ~~…~~ → **Decided:** 5000 node import cap.
- **#22** ~~…~~ → **Decided:** magic-byte upload checks.
- **#23** ~~…~~ → **Won’t fix:** admin setup responsibility.
- **#24** ~~…~~ → **Decided:** retry reload + 503 if cache stale.

**Still discussing:** none.

---

_Created from the Aug 2026 static audit. Update statuses as work proceeds._
