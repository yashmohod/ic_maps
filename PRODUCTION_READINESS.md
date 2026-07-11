# IC Maps — Production Readiness Backlog

Last updated: 2026-06-23  
Deployment: single private VM (college); scale-out later with Redis.

## P0 — Security & data (do before broad launch)

| Item                                          | Threat / impact                                             | Notes                                                            |
| --------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Move floorplan uploads out of `public/`       | **High** — internal floor plans world-readable if URL known | Store under private dir; serve via admin-only API or signed URLs |
| Move report uploads out of `public/`          | **Medium** — user photos enumerable                         | Admin-only read; optional auth on POST                           |
| Rate limit `POST /api/map/navigateTo`         | **Medium** — DoS / CPU exhaustion                           | Nginx + optional app limiter; ~30/min/IP                         |
| Rate limit report POSTs                       | **Medium** — spam / disk fill                               | ~5/min/IP                                                        |
| Rate limit `/api/auth/*`                      | **High** — credential stuffing                              | ~10/min/IP; lockout messaging                                    |
| Remove request-bearing `console.log` in APIs  | **Medium** — lat/lng, nav prefs in logs                     | Keep structured errors only; strip PII from logs                 |
| CSP headers                                   | **Medium** — XSS impact reduction                           | Via proxy + Next config                                          |
| Enforce `is_entry` for through-building start | **Medium** — wrong indoor paths                             | See navigation.ts asymmetry vs `is_exit`                         |
| Add Zod to all mutating API routes            | **Medium** — bad input / crashes                            | Partial today; complete coverage                                 |

## P1 — Reliability & ops (launch window)

| Item                                        | Impact                | Notes                                        |
| ------------------------------------------- | --------------------- | -------------------------------------------- |
| Health check `GET /api/health`              | Uptime monitoring     | DB ping + graph loaded flag                  |
| `error.tsx` / `loading.tsx` on heavy routes | UX on failures        | map, editors, customRoute                    |
| Structured logging (no PII)                 | Incident response     | JSON logs; level by env                      |
| Audit log for admin mutations               | Accountability        | who changed node/edge/building/floorplan     |
| Geolocation denied — clearer UX             | UX                    | Explain enable steps + manual dest-only mode |
| Fix marketing copy: “turn-by-turn”          | Expectation gap       | GPS follow + recalc ≠ step list unless built |
| Code split large pages                      | Low-end phone perf    | dynamic import editors, React Flow           |
| Complete client fetch error handling        | Fewer silent failures | Toast on non-ok `fetch(withBasePath(...))`   |
| Proxy: auth redirects, security headers     | Centralized guards    | Next middleware / reverse proxy              |

## P2 — After IT approval / growth

| Item                                           | Impact                     | Notes                                              |
| ---------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Email verification (Resend)                    | Account trust              | Currently off intentionally                        |
| Redis pub/sub graph invalidation               | Multi-instance consistency | When 2+ Node processes                             |
| Tests: `lib/navigation.ts` + critical APIs     | Regression safety          | Highest ROI                                        |
| Text-based indoor guidance from node names     | Product                    | No floorplan images; “West elevator to 3rd floor”  |
| Node closure / outage feature                  | Operations                 | New feature if needed; unused `outage_log` dropped |
| Lighter SVG readonly floorplan (admin reports) | Bundle size                | Drop React Flow on read-only views                 |

## P3 — Nice to have

| Item                              | Notes                                 |
| --------------------------------- | ------------------------------------- |
| PWA + offline tile cache          | Service worker + cache PMTiles/styles |
| Real turn-by-turn instructions    | Maneuver list from edge bearings      |
| Metrics (route latency, failures) | Prometheus or simple counters         |
| CI/CD                             | Much later                            |

## Explicitly out of scope (by design)

- Public auth on graph/floorplan **metadata** GETs (needed client-side)
- Floorplan **images** on public navigation (management decision)
- Mobile floorplan editor
- i18n (unless multi-language required)
- Global CDN (campus-only app)

## Already in place / intentional

- Uniform indoor edge cost (feature-based routing, not scale)
- Indoor/outdoor elevator fields in schema (routing logic TBD)
- Per-floor segmented graphs; exit at `is_exit` doors
- Single-process in-memory graph (OK for one VM)
- `@ithaca.edu` shareable routes
- Removed unused `isRouteManager` column and `outage_log` table
- Elevator / multi-floor indoor routing — **data model**; pathfinding rules still to be completed
