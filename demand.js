/* Street Flow Lab · demand.js — trip generation from programme (GFA by use), hourly profiles, mode split, user groups,
   destination choice, background traffic at the study-area gates. Produces generators with doors / vehicle access on the network. */
window.Demand = (() => {
  const G = window.Geom;
  /* hourly profile: mixture of gaussians over the day, normalised to sum 1 */
  const prof = (peaks, base = 0.01) => { const a = new Array(24).fill(0); for (let h = 0; h < 24; h++) { let v = base; for (const [m, s, w] of peaks) v += w * Math.exp(-0.5 * ((h + 0.5 - m) / s) ** 2) / s; a[h] = v; } const sum = a.reduce((x, y) => x + y, 0); return a.map((v) => v / sum); };
  /* person trip ends per 100 m² GFA per day (both directions), downtown Vancouver calibration of ITE-style rates; editable in the UI */
  const USES = {
    residential: { label: 'Residential', rate: 7.6, unit: 85, unitLabel: 'units', attr: 0.25, modes: { walk: 0.40, transit: 0.32, car: 0.20, bike: 0.08 }, pudo: 0.35, truck: 1 / 40, out: prof([[8, 1.3, 0.30], [12.5, 1.5, 0.10], [15, 2, 0.10], [18.5, 2, 0.25], [21, 1.5, 0.1]], 0.02), in: prof([[9, 1.3, 0.08], [13, 1.5, 0.12], [17.5, 1.4, 0.35], [20, 1.5, 0.2], [22.5, 1, 0.1]], 0.02) },
    office: { label: 'Office', rate: 13, unit: 25, unitLabel: 'jobs', attr: 1.0, modes: { walk: 0.30, transit: 0.45, car: 0.20, bike: 0.05 }, pudo: 0.25, truck: 1 / 500, in: prof([[8.5, 0.9, 0.6], [13, 1, 0.2], [16, 1, 0.05]], 0.01), out: prof([[12.2, 0.8, 0.2], [17.3, 0.9, 0.55], [19, 1.2, 0.1]], 0.01) },
    retail: { label: 'Retail', rate: 45, unit: 40, unitLabel: 'jobs', attr: 3.0, modes: { walk: 0.60, transit: 0.22, car: 0.14, bike: 0.04 }, pudo: 0.3, truck: 1 / 150, in: prof([[12.5, 2, 0.4], [15, 2, 0.2], [17.5, 1.5, 0.3]], 0.02), out: prof([[13, 2, 0.4], [15.5, 2, 0.2], [18, 1.5, 0.3]], 0.02) },
    restaurant: { label: 'Restaurant / café', rate: 80, unit: 20, unitLabel: 'jobs', attr: 3.0, modes: { walk: 0.62, transit: 0.20, car: 0.14, bike: 0.04 }, pudo: 0.5, truck: 1 / 80, in: prof([[8, 1, 0.1], [12.2, 0.8, 0.35], [18.8, 1.3, 0.4], [21, 1, 0.1]], 0.01), out: prof([[9, 1, 0.1], [13.2, 0.8, 0.35], [20.3, 1.3, 0.4], [22.5, 1, 0.1]], 0.01) },
    hotel: { label: 'Hotel', rate: 13, unit: 60, unitLabel: 'rooms', attr: 0.6, modes: { walk: 0.45, transit: 0.20, car: 0.33, bike: 0.02 }, pudo: 0.6, truck: 1 / 1500, in: prof([[10, 2, 0.15], [15.5, 1.5, 0.35], [19, 2, 0.3], [22, 1.5, 0.15]], 0.03), out: prof([[8.5, 1.2, 0.3], [11.5, 1, 0.3], [18.5, 2, 0.3]], 0.03) },
    amenity: { label: 'Amenity / community', rate: 6, unit: 100, unitLabel: '', attr: 0.4, modes: { walk: 0.80, transit: 0.10, car: 0.07, bike: 0.03 }, pudo: 0.2, truck: 1 / 2000, in: prof([[7, 1, 0.2], [12, 1.5, 0.2], [18, 1.5, 0.5]], 0.02), out: prof([[8, 1, 0.2], [13, 1.5, 0.2], [19.5, 1.5, 0.5]], 0.02) },
    school: { label: 'School / childcare', rate: 30, unit: 10, unitLabel: 'places', attr: 0.5, modes: { walk: 0.55, transit: 0.15, car: 0.25, bike: 0.05 }, pudo: 0.8, truck: 1 / 1500, in: prof([[8.3, 0.5, 0.8], [13, 1, 0.1]], 0.005), out: prof([[15.2, 0.6, 0.7], [17.5, 1, 0.2]], 0.005) },
    parking: { label: 'Parking (supply)', rate: 0, unit: 32, unitLabel: 'stalls', attr: 0, modes: { walk: 0, transit: 0, car: 1, bike: 0 }, pudo: 0, truck: 0, in: prof([[12, 4, 1]]), out: prof([[12, 4, 1]]) },
    core: { label: 'Core / service', rate: 0, unit: 0, unitLabel: '', attr: 0, modes: { walk: 1, transit: 0, car: 0, bike: 0 }, pudo: 0, truck: 0, in: prof([[12, 4, 1]]), out: prof([[12, 4, 1]]) },
  };
  const USE_KEYS = ['residential', 'office', 'retail', 'restaurant', 'hotel', 'amenity', 'school', 'parking'];
  const MODES = ['walk', 'transit', 'car', 'bike'];

  /* ---------- user groups ----------
     Each group: walking speed, whether it avoids steps, a time-of-day activity shape (relative weight by hour, mean 1),
     mode affinities (multipliers on the use's mode split), lingering propensity in public space and typical dwell. */
  const SCHEDULES = {
    commuter: { label: 'Commuter (AM / PM peaks, evening)', shape: [[8.2, 1.2, 1], [17.8, 1.3, 1], [20.5, 1.5, 0.5]] },
    office: { label: 'Office hours', shape: [[8.6, 1, 1], [12.5, 0.8, 0.6], [17.4, 1, 1]] },
    midday: { label: 'Midday (10–16)', shape: [[12.5, 2.2, 1]] },
    schoolrun: { label: 'School run + afternoon', shape: [[8.3, 0.7, 1], [15.3, 0.8, 1], [17.5, 1.2, 0.5]] },
    evening: { label: 'Evening (17–23)', shape: [[19.5, 1.8, 1], [12.5, 1, 0.3]] },
    allday: { label: 'All day (9–21)', shape: [[14, 4, 1]] },
  };
  const shapeOf = (key) => { const sc = SCHEDULES[key] || SCHEDULES.allday; const a = new Array(24).fill(0); for (let h = 0; h < 24; h++) { let v = 0.05; for (const [m, s, w] of sc.shape) v += w * Math.exp(-0.5 * ((h + 0.5 - m) / s) ** 2); a[h] = v; } const mean = a.reduce((x, y) => x + y, 0) / 24; return a.map((v) => v / mean); };
  const GROUPS = [
    { id: 'families', label: 'Families with children', speed: 1.1, avoidSteps: true, schedule: 'schoolrun', aff: { walk: 1, transit: 0.8, car: 1.4, bike: 0.6 }, linger: 0.25, dwell: 20, spaces: { play: 1, plaza: 0.6, garden: 0.6, seating: 0.4, terrace: 0.3, arcade: 0.3 } },
    { id: 'seniors', label: 'Seniors & reduced mobility', speed: 0.9, avoidSteps: true, schedule: 'midday', aff: { walk: 1, transit: 1.2, car: 0.8, bike: 0.2 }, linger: 0.3, dwell: 25, spaces: { seating: 1, garden: 0.9, plaza: 0.5, terrace: 0.5, arcade: 0.4, play: 0.2 } },
    { id: 'young', label: 'Young adults & professionals', speed: 1.45, avoidSteps: false, schedule: 'commuter', aff: { walk: 1.1, transit: 1.1, car: 0.7, bike: 1.6 }, linger: 0.12, dwell: 15, spaces: { terrace: 1, plaza: 0.6, seating: 0.4, arcade: 0.4, garden: 0.4, play: 0 } },
    { id: 'workers', label: 'Office workers', speed: 1.4, avoidSteps: false, schedule: 'office', aff: { walk: 1, transit: 1.15, car: 0.9, bike: 1 }, linger: 0.15, dwell: 20, spaces: { terrace: 1, plaza: 0.7, seating: 0.6, garden: 0.5, arcade: 0.3, play: 0 } },
    { id: 'shoppers', label: 'Shoppers & errands', speed: 1.2, avoidSteps: false, schedule: 'midday', aff: { walk: 1, transit: 1, car: 1.1, bike: 0.6 }, linger: 0.2, dwell: 10, spaces: { arcade: 1, plaza: 0.6, seating: 0.5, terrace: 0.5, garden: 0.3, play: 0.2 } },
    { id: 'diners', label: 'Diners & evening visitors', speed: 1.3, avoidSteps: false, schedule: 'evening', aff: { walk: 1, transit: 1, car: 1.1, bike: 0.7 }, linger: 0.3, dwell: 40, spaces: { terrace: 1, plaza: 0.7, seating: 0.5, arcade: 0.4, garden: 0.4, play: 0 } },
    { id: 'tourists', label: 'Hotel guests & tourists', speed: 1.1, avoidSteps: false, schedule: 'allday', aff: { walk: 1.2, transit: 0.9, car: 0.9, bike: 0.5 }, linger: 0.3, dwell: 15, spaces: { plaza: 1, garden: 0.8, seating: 0.7, terrace: 0.8, arcade: 0.6, play: 0.1 } },
    { id: 'students', label: 'Students & school children', speed: 1.3, avoidSteps: false, schedule: 'schoolrun', aff: { walk: 1.2, transit: 1.1, car: 0.6, bike: 1.2 }, linger: 0.3, dwell: 25, spaces: { play: 1, plaza: 0.8, seating: 0.6, arcade: 0.4, terrace: 0.3, garden: 0.4 } },
  ];
  /* share of each use's people by group */
  const USE_MIX = {
    residential: { families: 0.28, seniors: 0.18, young: 0.54 },
    office: { workers: 0.9, young: 0.1 },
    retail: { shoppers: 0.5, young: 0.15, families: 0.1, seniors: 0.1, workers: 0.1, tourists: 0.05 },
    restaurant: { diners: 0.45, workers: 0.25, young: 0.15, tourists: 0.15 },
    hotel: { tourists: 0.9, workers: 0.1 },
    amenity: { families: 0.35, seniors: 0.25, young: 0.3, students: 0.1 },
    school: { students: 0.7, families: 0.3 },
  };
  const STREET_MIX = { workers: 0.3, young: 0.25, shoppers: 0.2, tourists: 0.1, families: 0.08, seniors: 0.07 };
  const SPACE_TYPES = { plaza: { label: 'Plaza / forecourt', cap: 40 }, seating: { label: 'Seating / benches', cap: 16 }, play: { label: 'Playground', cap: 15 }, terrace: { label: 'Café terrace', cap: 30 }, arcade: { label: 'Retail arcade / canopy', cap: 50 }, garden: { label: 'Garden / green', cap: 25 } };
  const defaultPeople = () => ({ groups: GROUPS.map((g) => Object.assign({}, g, { aff: Object.assign({}, g.aff), spaces: Object.assign({}, g.spaces) })), mix: JSON.parse(JSON.stringify(USE_MIX)), street: Object.assign({}, STREET_MIX), spaces: [] });

  const STOP_W = { skytrain: 6, bus: 1, ferry: 1.5, rail: 1, tram: 0.6 };
  const TRAFFIC_PROF = (() => { const p = prof([[8, 1.2, 0.4], [12.5, 2.5, 0.25], [17, 1.3, 0.5]], 0.04); const mx = Math.max(...p); return p.map((v) => v / mx); })(); // peak = 1
  const PED_PROF = (() => { const p = prof([[8.5, 1.2, 0.3], [12.5, 1.5, 0.35], [17.5, 1.5, 0.45], [20, 1.5, 0.15]], 0.03); const mx = Math.max(...p); return p.map((v) => v / mx); })();
  const VEH_BASE = { motorway: 600, trunk: 400, primary: 320, secondary: 280, tertiary: 160, unclassified: 70, residential: 50, living_street: 8, service: 6, motorway_link: 250, trunk_link: 200, primary_link: 160, secondary_link: 120, tertiary_link: 80 };
  const PED_GATE = (e) => (e.kind === 'sidewalk' ? [50, 50, 100, 160, 220, 220][Math.max(0, Math.min(5, e.street >= 0 ? e.streetRank : 1))] : e.kind === 'steps' ? 20 : e.kind === 'crossing' ? 30 : 40);

  const DEFAULTS = { intensity: 1, ctxIntensity: 1, background: 1, backgroundPed: 1, externalShare: 0.4, carShift: 1, maxAgents: 7000, maxVeh: 3500, rates: {}, modes: {} };

  /* ---------- generators ---------- */
  function hourly(gen, P, scenario) {
    const uses = gen.uses || {}; gen.out = []; gen.in = []; gen.truck = new Array(24).fill(0); gen.pudoRate = { in: new Array(24).fill(0), out: new Array(24).fill(0) }; gen.daily = { walk: 0, transit: 0, car: 0, bike: 0, total: 0, truck: 0, pudo: 0 }; gen.units = {};
    const k = gen.kind === 'ctx' ? P.ctxIntensity : P.intensity;
    for (let h = 0; h < 24; h++) { gen.out.push({ walk: 0, transit: 0, car: 0, bike: 0 }); gen.in.push({ walk: 0, transit: 0, car: 0, bike: 0 }); }
    for (const u in uses) {
      const U = USES[u]; if (!U || !uses[u]) continue; const rate = P.rates[u] != null ? P.rates[u] : U.rate; const gfa = uses[u];
      const daily = rate * gfa / 100 * k; if (U.unit) gen.units[u] = Math.round(gfa / U.unit);
      const md = modesOf(u, P); const pud = U.pudo;
      for (let h = 0; h < 24; h++) { const o = daily / 2 * U.out[h], i = daily / 2 * U.in[h]; for (const m of MODES) { gen.out[h][m] += o * md[m]; gen.in[h][m] += i * md[m]; } gen.pudoRate.out[h] += o * md.car * pud; gen.pudoRate.in[h] += i * md.car * pud; }
      const trucks = (U.truck || 0) * (U.unit ? gfa / U.unit : gfa / 100) * k; for (let h = 0; h < 24; h++) gen.truck[h] += trucks * prof([[10, 2.2, 0.7], [14.5, 2, 0.3]], 0.005)[h];
      for (const m of MODES) gen.daily[m] += daily * md[m]; gen.daily.total += daily; gen.daily.truck += trucks; gen.daily.pudo += daily * md.car * pud;
    }
    gen.attr = Object.keys(uses).reduce((s, u) => s + (USES[u] ? USES[u].attr * uses[u] / 100 : 0), 0) * (gen.kind === 'ctx' ? P.ctxIntensity : 1);
    return gen;
  }
  /* one use on its own: hourly in/out by mode (with totals), kerb pick-ups, deliveries and daily sums; the same arithmetic as hourly() */
  function useProfile(u, gfa, P) {
    P = Object.assign({}, DEFAULTS, P || {}); const U = USES[u]; const rate = U && P.rates[u] != null ? P.rates[u] : U ? U.rate : 0; const k = P.intensity;
    const r = { in: [], out: [], pudo: new Array(24).fill(0), truck: new Array(24).fill(0), daily: { walk: 0, transit: 0, car: 0, bike: 0, total: 0, truck: 0, pudo: 0 } };
    for (let h = 0; h < 24; h++) { r.in.push({ walk: 0, transit: 0, car: 0, bike: 0, total: 0 }); r.out.push({ walk: 0, transit: 0, car: 0, bike: 0, total: 0 }); }
    if (!U || !rate || !gfa) return r;
    const daily = rate * gfa / 100 * k; const md = modesOf(u, P); const trucks = (U.truck || 0) * (U.unit ? gfa / U.unit : gfa / 100) * k; const tp = prof([[10, 2.2, 0.7], [14.5, 2, 0.3]], 0.005);
    for (let h = 0; h < 24; h++) { const o = daily / 2 * U.out[h], i = daily / 2 * U.in[h]; for (const m of MODES) { r.out[h][m] = o * md[m]; r.in[h][m] = i * md[m]; } r.out[h].total = o; r.in[h].total = i; r.pudo[h] = (o + i) * md.car * U.pudo; r.truck[h] = trucks * tp[h]; }
    for (const m of MODES) r.daily[m] = daily * md[m]; r.daily.total = daily; r.daily.truck = trucks; r.daily.pudo = daily * md.car * U.pudo;
    return r;
  }
  /* what each use puts on the street in a window [t0, t1) in hours: people on foot at the doors, cars, kerb pick-ups, deliveries, per hour */
  function useBreakdown(uses, P, t0, t1) {
    const rows = []; const hrs = Math.max(0.25, t1 - t0);
    for (const u in uses) { if (!uses[u] || u === 'parking') continue; const pr = useProfile(u, uses[u], P); let foot = 0, car = 0, pudo = 0, truck = 0; for (let h = Math.floor(t0); h < Math.ceil(t1); h++) { const f = Math.min(t1, h + 1) - Math.max(t0, h); if (f <= 0) continue; const hi = pr.in[h % 24], ho = pr.out[h % 24]; foot += f * (hi.walk + hi.transit + ho.walk + ho.transit); car += f * (hi.car + ho.car); pudo += f * pr.pudo[h % 24]; truck += f * pr.truck[h % 24]; } rows.push({ use: u, label: USES[u].label, gfa: uses[u], daily: pr.daily.total, foot: foot / hrs, car: car / hrs, pudo: pudo / hrs, truck: truck / hrs }); }
    const tf = rows.reduce((a, r) => a + r.foot, 0) || 1, tc = rows.reduce((a, r) => a + r.car, 0) || 1; for (const r of rows) { r.footShare = r.foot / tf; r.carShare = r.car / tc; }
    rows.sort((a, b) => b.foot - a.foot); return rows;
  }
  function modesOf(u, P) { const base = Object.assign({}, USES[u].modes, P.modes[u] || {}); const car = Math.min(0.9, base.car * P.carShift); const rest = 1 - car; const sum = base.walk + base.transit + base.bike || 1; const f = rest / sum; return { walk: base.walk * f, transit: base.transit * f, bike: base.bike * f, car }; }

  /* ---------- group tables: P(group | use, mode, hour) as cumulative weights ---------- */
  function groupTables(people) {
    const groups = people.groups; const shapes = groups.map((g) => shapeOf(g.schedule)); const gi = {}; groups.forEach((g, i) => (gi[g.id] = i));
    const table = {}; // use -> mode -> hour -> Float64Array cum
    const build = (mix) => { const out = {}; for (const m of ['walk', 'transit']) { out[m] = []; for (let h = 0; h < 24; h++) { const cum = new Float64Array(groups.length); let acc = 0; groups.forEach((g, i) => { const sh = mix[g.id] || 0; acc += sh * shapes[i][h] * (g.aff[m] || 1); cum[i] = acc; }); out[m].push(cum); } } return out; };
    for (const u in people.mix) table[u] = build(people.mix[u]);
    table._street = build(people.street);
    return { table, groups, shapes, gi };
  }

  /* build the full demand model for a prepared network */
  function prepare(net, model, P, people) {
    P = Object.assign({}, DEFAULTS, P || {}); people = people || defaultPeople(); const ped = net.ped;
    const gens = [];
    const addDoor = (gen, p, opts) => { const n = net.attach(p, Object.assign({ maxD: 45, kind: 'door' }, opts || {})); if (n >= 0) { gen.doors.push({ node: n, uses: opts && opts.uses || null, w: opts && opts.w || 1 }); ped.nodes[n].gen = gen.id; } return n; };
    // context buildings
    for (const b of model.context) {
      const gen = { id: gens.length, kind: 'ctx', name: b.name || '', x: b.centre[0], y: b.centre[1], uses: {}, doors: [], veh: null, loading: null, pudo: null, poly: b.poly, gfa: b.gfa, h: b.h };
      for (const u in b.uses) gen.uses[u] = b.gfa * b.uses[u];
      let best = null, bd = Infinity; const cands = b.poly.length > 12 ? b.poly.filter((_, i) => i % Math.ceil(b.poly.length / 12) === 0) : b.poly.slice(); cands.push(b.centre);
      for (const q of cands) { for (const e of ped.grid.near(q, 30)) { if (!e.alive || e.kind === 'crossing' || e.kind === 'steps') continue; const d = G.projPoly(q, e.poly).d; if (d < bd) { bd = d; best = q; } } }
      if (!best) continue;
      addDoor(gen, best, { maxD: 35 });
      if (!gen.doors.length) continue;
      const va = net.vehAccess(best, { alleyD: 45, maxD: 70 }); if (va) gen.veh = va;
      gens.push(gen);
    }
    // parks as attractors
    for (const pk of model.parks || []) { const c = G.centroid(pk.p); const area = Math.abs(G.ringArea(pk.p)); const gen = { id: gens.length, kind: 'park', name: pk.n, x: c[0], y: c[1], uses: {}, doors: [], veh: null, park: true, area }; let best = null, bd = Infinity; for (const q of pk.p.filter((_, i) => i % Math.max(1, Math.ceil(pk.p.length / 10)) === 0)) for (const e of ped.grid.near(q, 25)) { if (!e.alive || e.kind === 'crossing') continue; const d = G.projPoly(q, e.poly).d; if (d < bd) { bd = d; best = q; } } if (!best) continue; addDoor(gen, best, { maxD: 30 }); if (gen.doors.length) gens.push(gen); }
    // transit stops
    const stops = []; for (const s of model.stops) { const gen = { id: gens.length, kind: 'stop', stopType: s.t, name: s.n || s.t, x: s.x, y: s.y, uses: {}, doors: [], veh: null, w: STOP_W[s.t] || 1 }; addDoor(gen, [s.x, s.y], { maxD: 40, kind: 'stop' }); if (!gen.doors.length) continue; gens.push(gen); stops.push(gen); }
    // pedestrian gates
    const pgates = []; for (const ni of net.gates.ped) { const n = ped.nodes[ni]; const e = ped.edges[n.adj[0]]; if (e.street >= 0) e.streetRank = net.veh.segs[e.street].rank; const gen = { id: gens.length, kind: 'gate', name: (e.name || e.kind) + ' (edge of study area)', x: n.x, y: n.y, uses: {}, doors: [{ node: ni, uses: null, w: 1 }], veh: null, gateRate: PED_GATE(e) * P.backgroundPed, gateEdge: e.i }; n.gen = gen.id; gens.push(gen); pgates.push(gen); }
    // vehicle gates
    const vgates = []; for (const ni of net.gates.veh) { const n = net.veh.nodes[ni]; const outs = n.out.map((i) => net.veh.edges[i]), ins = n.in.map((i) => net.veh.edges[i]); const rate = outs.reduce((s, e) => s + (VEH_BASE[e.cls] || 50) * e.lanes, 0) * P.background; const cap = ins.reduce((s, e) => s + e.lanes * (Net.RANK[e.cls] + 1), 0) + outs.reduce((s, e) => s + e.lanes * (Net.RANK[e.cls] + 1), 0); vgates.push({ node: ni, rate, w: cap, name: (outs[0] || ins[0] || {}).name || 'street', canIn: outs.length > 0, canOut: ins.length > 0, x: n.x, y: n.y }); }
    // site generators (per scenario)
    const siteGens = { baseline: [], proposed: [] };
    const mkSite = (scn, blocks, access) => {
      const byUse = {}; for (const b of blocks) for (const u in b.uses) byUse[u] = (byUse[u] || 0) + b.uses[u];
      const gen = { id: gens.length, kind: 'site', scn, name: scn === 'proposed' ? 'Proposed building' : 'Existing building', x: model.site.centre[0], y: model.site.centre[1], uses: byUse, doors: [], veh: null, loading: null, pudo: null, blocks, spaces: [] };
      gens.push(gen); siteGens[scn].push(gen);
      const ent = access.entrances || [];
      for (const en of ent) { const p = en.p; if (en.kind === 'main' || en.kind === 'retail') { addDoor(gen, p, { maxD: 40, uses: en.kind === 'retail' ? new Set(['retail', 'restaurant']) : new Set(['residential', 'office', 'hotel', 'amenity', 'school']), w: en.w || 1 }); } }
      if (!gen.doors.length) { const p = model.site.frontMid; addDoor(gen, p, { maxD: 60 }); }
      const ramp = ent.find((e) => e.kind === 'ramp'); gen.veh = ramp ? net.vehAccess(ramp.p, { preferAlley: !!ramp.lane, alleyD: 40, maxD: 60 }) : null;
      if (!gen.veh) gen.veh = net.vehAccess(model.site.frontMid, { preferAlley: true, alleyD: 60, maxD: 80 });
      const ld = ent.find((e) => e.kind === 'loading'); gen.loading = { mode: access.loadingMode || 'lane', access: ld ? net.vehAccess(ld.p, { preferAlley: access.loadingMode !== 'street', alleyD: 45, maxD: 60 }) : gen.veh };
      const pu = ent.find((e) => e.kind === 'pudo'); const pp = pu ? pu.p : (gen.doors.length ? [ped.nodes[gen.doors[0].node].x, ped.nodes[gen.doors[0].node].y] : model.site.frontMid); gen.pudo = { layby: !!access.layby, access: net.vehAccess(pp, { preferAlley: false, maxD: 45 }) };
      gen.rampGate = access.rampGate || 0; gen.stalls = byUse.parking ? Math.round(byUse.parking / USES.parking.unit) : (access.stalls || 0);
      // through-block walkways
      for (const wk of access.walkways || []) { const a = net.attach(wk.a, { maxD: 40, kind: 'door' }), b = net.attach(wk.b, { maxD: 40, kind: 'door' }); if (a >= 0 && b >= 0 && a !== b) { const e = Net.link(ped, a, b, { kind: 'walkway', w: wk.w || 4, offBaseline: scn === 'proposed', offProposed: scn === 'baseline', site: true }); ped.edges[e.i].keep = true; } }
      // public spaces where people stay (proposed only)
      for (const sp of access.spaces || []) { const n = net.attach(sp.p, { maxD: 40, kind: 'space' }); if (n < 0) continue; gen.spaces.push({ id: sp.id, name: sp.name || SPACE_TYPES[sp.type].label, type: sp.type, cap: sp.cap || SPACE_TYPES[sp.type].cap, node: n, x: sp.p[0], y: sp.p[1] }); }
    };
    if (model.existing && model.existing.blocks.length) mkSite('baseline', model.existing.blocks, model.existing.access || { entrances: [] });
    if (model.proposed && model.proposed.blocks.length) mkSite('proposed', model.proposed.blocks, model.proposed.access || { entrances: [] });
    for (const g of gens) hourly(g, P, g.scn);

    // attractors: top context gens by attraction + site + parks + gates (stops only serve transit legs)
    const ctx = gens.filter((g) => g.kind === 'ctx').sort((a, b) => b.attr - a.attr);
    const attractors = ctx.slice(0, 220).concat(gens.filter((g) => g.kind === 'park' || g.kind === 'site')).filter((g) => g.doors.length);
    for (const a of attractors) a.isAttr = true;
    const dm = { net, P, people, gt: groupTables(people), gens, stops, pgates, vgates, siteGens, attractors, model };
    // destination weights per origin: internal attractors + gates (gates carry the external share)
    for (const g of gens) {
      if (!g.doors.length) continue;
      const w = new Float64Array(attractors.length + pgates.length); let intSum = 0;
      attractors.forEach((a, i) => { if (a.id === g.id) return; const d = Math.hypot(a.x - g.x, a.y - g.y); const v = (a.attr || (a.park ? a.area / 400 : 0)) * Math.exp(-d / 450); w[i] = v; intSum += v; });
      const ext = intSum > 0 ? P.externalShare / (1 - P.externalShare) * intSum : 1; let gs = 0; const gw = pgates.map((p) => { const d = Math.hypot(p.x - g.x, p.y - g.y); const v = p.gateRate * Math.exp(-d / 700) + 1e-6; gs += v; return v; });
      pgates.forEach((p, j) => { w[attractors.length + j] = p.id === g.id ? 0 : ext * gw[j] / gs; });
      const cum = new Float64Array(w.length); let acc = 0; for (let i = 0; i < w.length; i++) { acc += w[i]; cum[i] = acc; } g.destCum = cum;
      // transit stop choice
      const cands = stops.map((s) => ({ s, d: Math.hypot(s.x - g.x, s.y - g.y) })).filter((x) => x.d < 650).sort((a, b) => a.d - b.d).slice(0, 8);
      if (cands.length) { const c2 = new Float64Array(cands.length); let a2 = 0; cands.forEach((x, i) => { a2 += x.s.w * Math.exp(-x.d / 280); c2[i] = a2; }); g.stopCands = cands.map((x) => x.s); g.stopCum = c2; }
    }
    // vehicle gate choice (shared): weights by capacity
    const vin = vgates.filter((v) => v.canIn), vout = vgates.filter((v) => v.canOut);
    dm.vIn = vin; dm.vOut = vout; dm.vOutCum = cum(vout.map((v) => v.w)); dm.vInCum = cum(vin.map((v) => v.w));
    return dm;
  }
  const cum = (arr) => { const c = new Float64Array(arr.length); let a = 0; arr.forEach((v, i) => { a += v; c[i] = a; }); return c; };

  /* interpolated hourly rate at second-of-day t */
  const rateAt = (arr, t, key) => { const h = (t / 3600) % 24; const h0 = Math.floor(h), h1 = (h0 + 1) % 24, f = h - h0; const a = key ? arr[h0][key] : arr[h0], b = key ? arr[h1][key] : arr[h1]; return a + (b - a) * f; };

  /* expected agents in the window for scaling */
  function expected(dm, scenario, t0, t1) {
    let ped = 0, veh = 0; const hrs = (t1 - t0) / 3600;
    const active = (g) => g.kind !== 'site' || g.scn === scenario;
    for (const g of dm.gens) { if (!active(g) || !g.out) continue; for (let t = t0; t < t1; t += 900) { const f = 0.25; ped += f * (rateAt(g.out, t, 'walk') + rateAt(g.out, t, 'transit') + rateAt(g.in, t, 'walk') + rateAt(g.in, t, 'transit')); veh += f * (rateAt(g.out, t, 'car') + rateAt(g.in, t, 'car') + rateAt(g.truck, t) * 2); } if (g.kind === 'gate') ped += g.gateRate * hrs * PED_PROF[Math.floor(((t0 + t1) / 2 / 3600) % 24)]; }
    for (const v of dm.vgates) if (v.canIn) veh += v.rate * TRAFFIC_PROF[Math.floor(((t0 + t1) / 2 / 3600) % 24)] * hrs;
    return { ped, veh };
  }
  /* summary of a generator set (for the programme panel) */
  function summary(gens) { const s = { gfa: 0, uses: {}, daily: { walk: 0, transit: 0, car: 0, bike: 0, total: 0, truck: 0, pudo: 0 }, units: {}, peak: { h: 0, v: 0 } }; const hourTot = new Array(24).fill(0); for (const g of gens) { for (const u in g.uses) { s.uses[u] = (s.uses[u] || 0) + g.uses[u]; s.gfa += g.uses[u]; } for (const k in g.daily) s.daily[k] += g.daily[k]; for (const u in g.units) s.units[u] = (s.units[u] || 0) + g.units[u]; for (let h = 0; h < 24; h++) hourTot[h] += MODES.reduce((a, m) => a + g.out[h][m] + g.in[h][m], 0); } s.hourly = hourTot; let mh = 0; hourTot.forEach((v, h) => { if (v > hourTot[mh]) mh = h; }); s.peak = { h: mh, v: hourTot[mh] }; return s; }
  /* 24 h table by mode for charts: [{h, walk, transit, car, bike, truck}] */
  function profile(gens) { const rows = []; for (let h = 0; h < 24; h++) { const r = { h, walk: 0, transit: 0, car: 0, bike: 0, truck: 0, in: 0, out: 0 }; for (const g of gens) { for (const m of MODES) { r[m] += g.out[h][m] + g.in[h][m]; r.out += g.out[h][m]; r.in += g.in[h][m]; } r.truck += g.truck[h] * 2; } rows.push(r); } return rows; }
  /* 24 h table of the site's people by group (walk + transit arrivals and departures), from the programme alone */
  function groupProfile(gens, people) {
    const groups = people.groups; const shapes = groups.map((g) => shapeOf(g.schedule)); const rows = [];
    for (let h = 0; h < 24; h++) { const r = { h }; for (const g of groups) r[g.id] = 0; rows.push(r); }
    for (const g of gens) for (const u in g.uses) { const U = USES[u]; if (!U || !U.rate || !people.mix[u]) continue; const mix = people.mix[u]; const daily = g.uses[u] / 100 * U.rate; for (let h = 0; h < 24; h++) { const persons = daily / 2 * (U.out[h] + U.in[h]); let tot = 0; const w = groups.map((gr, i) => { const v = (mix[gr.id] || 0) * shapes[i][h]; tot += v; return v; }); if (!tot) continue; groups.forEach((gr, i) => { rows[h][gr.id] += persons * w[i] / tot; }); } }
    return rows;
  }
  /* parking accumulation for the proposed site: cars in minus cars out over the day (non-PUDO) */
  function parkingProfile(gens) { const rows = []; for (let h = 0; h < 24; h++) { let i = 0, o = 0; for (const g of gens) { i += g.in[h].car - g.pudoRate.in[h]; o += g.out[h].car - g.pudoRate.out[h]; } rows.push({ h, i, o }); }
    let run = 0; const series = rows.map((r) => { run += r.i - r.o; return run; }); const mn = Math.min(...series, 0); return series.map((v, h) => ({ h, cars: Math.max(0, Math.round(v - mn)) })); }

  return { USES, USE_KEYS, MODES, DEFAULTS, GROUPS, USE_MIX, STREET_MIX, SPACE_TYPES, SCHEDULES, shapeOf, defaultPeople, groupTables, TRAFFIC_PROF, PED_PROF, prepare, hourly, useProfile, useBreakdown, rateAt, expected, summary, profile, groupProfile, parkingProfile, modesOf, prof };
})();
