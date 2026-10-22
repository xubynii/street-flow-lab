# Street Flow Lab

Pedestrian and vehicle traffic simulation around a downtown Vancouver massing: how a building's programme and its entrances load the sidewalks, crossings, lanes and junctions around it, compared with the lot as it is today.

Browser tool, no build step, no server-side code. Everything runs locally from `src/`.

## Run it

```
python tools/serve.py            # serves src/ on http://127.0.0.1:8765
```

Open http://127.0.0.1:8765/index.html. (Opening `index.html` directly from disk also works in Edge/Chrome; the server only matters for correct UTF-8 headers.)

## Workflow

The map shows the whole downtown peninsula (every street, building and park in the data); the circle is the simulated study area. Four tabs, and a run bar that is always in the top bar.

1. **Site** — click any lot on the map or search an address. The study area (default 450 m) is built from OpenStreetMap streets, sidewalks, crossings, signals and stops, plus every neighbouring building with an estimated floor area and use. Sliders set how busy the surroundings are.
2. **Building** — the massing as blocks (use, footprint, floors) or an imported Downtown Massing Tool project; the programme it implies with editable trip rates; entrances, parking ramp, loading and pick-up kerb; public realm: places to stay (plaza, seating, playground, terrace, arcade, garden) and through-block walkways.
3. **People** — eight user groups (speed, stairs, schedule, transit/car habits, how long they stop) and who comes with each use, with an hour-by-hour preview.
4. **Run** (top bar) — pick a window (AM, midday, PM, evening, custom) and press Run: baseline (today) and proposed share the same background random stream. **Watch** animates one scenario; *By group* colours pedestrians by user group.
5. **Results** — KPI tiles, sidewalk/crossing and link tables, junction delay chart, *Who is here* (who walks past, who stays where), walksheds, map modes (Sidewalk LOS, Ped density, Traffic LOS, Change, Walkshed), CSV / JSON export and a printable report. The right panel shows an at-a-glance summary, or the numbers of whatever you click on the map.

Projects auto-save to the browser (localStorage) and can be saved/opened as JSON (`Save` / `Open…`).

## Files

- `src/index.html` — layout, CSS tokens (light/dark), script order.
- `src/geom.js` — vector/polygon helpers, spatial grid, RNG, heap.
- `src/site.js` — parcels, the lot frame (identical to the Downtown Massing Tool, so imports align), context buildings, parks, right-of-way widths.
- `src/net.js` — network build: directed vehicle graph with signal phases; undirected pedestrian graph from OSM sidewalks/crossings/paths with synthetic sidewalks where OSM has none; doors, walkways, gates; shortest-path trees with route variants.
- `src/demand.js` — trip generation (rates, hourly profiles, mode split), context generators, destination choice, background traffic, expected agent counts.
- `src/sim.js` — the engine: pedestrian agents (density-dependent speed, signal-tied crossing waits), vehicle agents (point queues with storage/spillback, signals, priority, all-way stop, kerb dwell for deliveries and pick-ups), 15-minute records.
- `src/analysis.js` — LOS grading (HCM sidewalk flow, HCM control delay, v/c), KPIs, scenario comparison, walkshed.
- `src/charts.js` — SVG charts + palette (data-viz method: fixed categorical order, one-hue LOS ramp, diverging change ramp).
- `src/views.js` — the map canvas (context, massing, networks, agents, overlays, hover/select, snapshots).
- `src/report.js` — printable report.
- `src/app.js` — state, panels, run loop, import/export, self-test.
- `src/city-data.js` — City of Vancouver open data (parcels, streets, ROW widths, parks, zoning), copied from the Downtown Massing Tool.
- `src/osm-data.js` — OpenStreetMap building footprints (copied from the Downtown Massing Tool).
- `src/osm-streets.js` — OpenStreetMap highways, crossing/signal nodes, stops (`tools/fetch-osm-streets.py`).

## Tools

- `tools/fetch-osm-streets.py [--refresh]` — Overpass download → `src/osm-streets.js` (raw cache in `docs/osm-streets-raw.json`).
- `tools/serve.py [port]` — local server.
- `tools/jscheck.py` — syntax check of all modules with esprima (no Node on this machine).
- `tools/headless.ps1 -Hash selftest` — boots in headless Edge and prints the self-test (`#selftest`). `-Hash run:pedLos|vehLos|change|report` runs both scenarios and screenshots with `-Shot path.png`; `-Hash tab:building|people|results` screenshots a panel; `-Hash watch` / `watchg` the live animation (coloured by group); `-Hash downtown` the zoomed-out map; `-Dark` for dark mode.

## Limits

Design-stage estimates, not a traffic impact assessment. Routes are shortest-path with random variants (no congestion feedback); signals are generic two-phase 80 s cycles; vehicle turning conflicts are simplified; neighbouring building uses are inferred from zoning and shape; trip rates are downtown-calibrated defaults. Calibrate against counts before quoting numbers. Method details and thresholds: `docs/METHOD.md`.
