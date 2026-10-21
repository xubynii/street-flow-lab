# Street Flow Lab — method notes

## Frame and data
All geometry is in the shared local metre frame of the Downtown Massing Tool data: origin lon −123.118 / lat 49.283, x east, y north, scale 72 616.6 m/° lon and 110 574 m/° lat. The lot frame (x along the front edge, y into the lot) is the same `frame()` as the massing tool, so its block coordinates import unchanged.

- Streets, sidewalks (`footway=sidewalk`), crossings (`footway=crossing` + crossing nodes), signals, stops: OpenStreetMap via Overpass (`tools/fetch-osm-streets.py`).
- Buildings: OpenStreetMap footprints with height / levels, City 2009 footprints as fallback.
- Parcels, right-of-way widths, lanes, parks, zoning: City of Vancouver Open Data (`city-data.js`).

## Network
**Vehicle graph.** Drivable OSM ways split at shared nodes. Lanes per direction from `lanes` (default by class), speed from `maxspeed` (default 50/40/20 km/h) × 0.85. Node control: `highway=traffic_signals` on or within 14 m of the node, or two streets of tertiary rank or above meeting → signal; `highway=stop` with equal ranks → all-way stop; else priority to the higher-rank street. Signals are two-phase: approaches grouped by axis around the highest-rank approach; cycle 80 s, split 58/42 when ranks differ, 50/50 otherwise, 4 s amber, random offset. Link capacity = 1800 veh/h/lane × effective green ratio (0.92 major / 0.40 minor at priority junctions, 0.45 at all-way stops).

**Pedestrian graph.** OSM sidewalks, crossings, footways, paths, steps (speed × 0.55), pedestrian streets, cycleways (shared), living streets and alleys. Sidewalk effective width = class default (4.5 primary, 4.0 secondary, 3.4 tertiary, 3.0 residential) × scale − 1.0 m shy distance. For street segments without a mapped sidewalk within 7 m of the offset line (ROW/2 − sidewalk/2 from City ROW widths), a synthetic sidewalk is generated, trimmed at the corners and attached to the nearest pedestrian edge; synthetic crossings join opposite corners at junctions with no mapped crossing. Crossing control from the crossing node (`traffic_signals` → waits for the phase of the nearest signal node; `marked`/`zebra`; unmarked). Doors (buildings, stops, site entrances) are attached by projecting onto the nearest sidewalk edge and splitting it. Footpaths and service roads inside the lot are removed in the proposed scenario unless "keep existing footpaths" is on; through-block walkways exist only in the proposed scenario.

**Gates.** Dead-end nodes beyond the study radius: through traffic and through-walkers enter and leave there.

## Demand
Person trip ends per 100 m² GFA per day by use (downtown Vancouver calibration of ITE-style rates): residential 7.6, office 13, retail 45, restaurant 80, hotel 13, amenity 6, school 30. Hourly profiles by use and direction (mixture of Gaussians). Mode split per use (walk / transit / car / bike), e.g. residential 40/32/20/8, office 30/45/20/5, retail 60/22/14/4; a global car multiplier shifts the share. Pick-up/drop-off share of car trips: residential 35 %, office 25 %, retail 30 %, restaurant 50 %, hotel 60 %. Deliveries per day: units/40, office GFA/500 per job-unit, retail GFA/150, restaurant GFA/80, hotel rooms/1500.

Neighbouring buildings: GFA = footprint × levels × 0.85; use mix from zoning (RM/RS → residential; C-/HA → mixed) and shape (tall and slender → residential tower; big plate and tall → office; low → retail/commercial, more so near arterials).

Destination choice: gravity over the top 220 neighbouring attractors + parks + site (weight = Σ use attraction × GFA/100 × exp(−d/450 m)); gates receive weight so that a set share (default 40 %) of walk trips leave the study area. Transit trips walk to a stop chosen among the nearest eight by type weight (SkyTrain 6, ferry 1.5, bus 1) × exp(−d/280 m). Car trips drive between the building's access (alley within 45 m preferred, else nearest street) and a vehicle gate chosen by capacity weight. Through traffic per gate: Σ lanes × base flow by class (primary 320, secondary 280, tertiary 160, residential 50 veh/h/lane at peak) × daily profile × background multiplier. Through-walkers per sidewalk gate: 50–220 p/h by street class × profile × multiplier.

Scaling: expected trips in the window / agent cap gives k persons per pedestrian agent and k vehicles per vehicle agent (background only; site trips are always 1:1). Baseline and proposed use the same random stream for the background and a separate one for the site.

## User groups
Eight groups with walking speed (0.9–1.45 m/s), stair avoidance (routes exclude `steps`), a daily activity shape (commuter, office hours, midday, school run, evening, all day), mode affinities and lingering behaviour. Every walk or transit trip is assigned a group with probability ∝ (share of the trip's use by group) × (group activity at that hour) × (group affinity for the mode); through-walkers at the gates use a street mix. Neighbouring buildings use the same tables. Defaults: residential 28 % families / 18 % seniors / 54 % young adults; office 90 % workers; retail 50 % shoppers; restaurant 45 % diners / 25 % workers; hotel 90 % guests; amenity mixed; school 70 % students / 30 % families.

**Places to stay.** Each place on the lot edge is attached to the sidewalk and knows the frontage edges within 28 m. When a pedestrian who has not yet stopped enters one of those edges, they stop with probability linger(group) × appeal(place type, group) × 1.8 for the building's own people or × 0.4 for passers-by, if the place is below capacity; the stay is dwell(group) × U(0.5, 1.5). Records: average people present per 15-minute bin by group, visits by group, mean stay, peak occupancy; who passes the frontage and who the site generates, by group and bin. The slow-walker walkshed uses the seniors' speed and excludes stairs.

## Simulation
1 s steps, 15 min warm-up, records in 15-minute bins.

**Pedestrians.** Free speed 1.2–1.5 m/s; density on an edge ρ = persons / (length × effective width); speed factor 1 − 0.27 (ρ − 0.25) for ρ > 0.25 p/m², floor 0.10. Signalised crossing: start only while the crossed street is red with enough green left; otherwise wait for the phase. Marked crossing: 50 % no wait, else exp(6 s); unmarked arterial: 40 % no wait, else exp(10 s); quiet street: 70 % no wait, else exp(4 s). Routes: shortest generalised time (steps × 1.8, alleys × 1.25, expected crossing waits), two cost-noise variants.

**Vehicles.** Free-flow to the back of the queue; 7.5 m per vehicle; the first vehicle leaves when: departure headway ≥ 2 s per lane (per agent k), the next link has storage, and the control allows (green; priority minor approach: no major departure for 2.5 s and a personal gap exp(3 s); all-way stop: 2.2 s node headway). Mid-link origins and destinations. Deliveries dwell 15–25 min, pick-ups 60–120 s (30–60 s with exp noise for outbound pick-ups); in an alley the vehicle stays in the queue and blocks it; on a street it removes a lane for the dwell (a one-lane direction keeps half its capacity); with a lay-by there is no effect. Neighbouring buildings' deliveries arrive and leave without a kerb stop. The outbound leg is spawned when the dwell ends. Parking gate dwell (default 6 s) holds the car on the access link. Routes: shortest time with junction penalties, three cost-noise variants. Vehicles entering at a gate wait outside the area (a backlog) until their entry link has space; a vehicle that has stood at the stop line for 120 s with permission but no downstream space squeezes in, which breaks the circular deadlocks a pure point-queue grid would otherwise fall into.

## Analysis
- Sidewalk / crossing LOS: peak 15-minute flow ÷ 15 ÷ effective width, HCM average-flow thresholds A ≤ 16, B ≤ 23, C ≤ 33, D ≤ 49, E ≤ 75 p/min/m.
- Junction LOS: volume-weighted control delay of all approaches; HCM signalised thresholds 10/20/35/55/80 s, unsignalised 10/15/25/35/50 s.
- Link LOS: v/c with thresholds 0.6/0.7/0.8/0.9/1.0.
- Change map: proposed − baseline per sidewalk (persons/h), link (v/c) and junction (s).
- Walkshed: Dijkstra from the main entrance at walking cost, 300 s and 600 s; hull area; homes (res GFA / 85 m²), jobs (GFA / m² per job), retail GFA, parks, nearest stop times.
- Frontage: sidewalk edges within the right-of-way beside the lot's street edges; each walker is counted once.

## Known simplifications
No congestion feedback on routes; no turning conflicts or left-turn phases; generic signal timings; pedestrian priority at marked crossings is not enforced on vehicles; bikes are counted but not simulated; neighbouring building uses are inferred; parking supply constrains nothing except the accumulation chart.
