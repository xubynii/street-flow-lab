/* Street Flow Lab · vsim.js — inside the tower: a time-stepped simulation of people moving between floors by lift, escalator
   and stair. Demand per floor comes from the same trip generation as the street model (Demand.useProfile on the stack from
   VT.stack). Lifts run a simple collective control per group; escalators and stairs are capacity-limited conveyors.
   Design-stage estimate: no destination dispatch, no door re-opening, no transfers between lift groups except at the lobby. */
window.VSim = (() => {
  const G = window.Geom;
  const ESC_CAP = 1.2;   // persons/s per escalator per direction (1 m step, practical)
  const ESC_VZ = 0.25;   // m/s vertical (0.5 m/s along a 30° incline)
  const STAIR_CAP = 0.7; // persons/s per metre of stair width per direction
  const VISITOR = { retail: 1, restaurant: 1, school: 1, amenity: 0.6 };
  const DEF = { escPref: 0.85, stairShare: 0.5, internalShare: 0.5, maxStairFloors: 3 };

  /* ---------- model: floors, demand, devices ---------- */
  function build(blocks, P, cfg) {
    cfg = Object.assign({}, DEF, cfg || {}); const slabs = VT.stack(blocks); if (!slabs.length) return null;
    const floors = slabs.map((s, i) => ({ i, level: s.level, label: s.label, z: s.z, h: s.h, use: s.use, parts: s.parts, area: s.area, park: s.level < 0 && s.use === 'parking', served: s.level >= 2 || (s.level < 0 && s.use === 'parking') }));
    const lobby = floors.find((f) => f.level === 1) || floors[0]; const parks = floors.filter((f) => f.park);
    const hasHome = slabs.some((s) => s.parts.some((p) => p.use === 'residential' || p.use === 'hotel')), hasWork = slabs.some((s) => s.parts.some((p) => p.use === 'office'));
    // hourly demand per floor: arrivals / departures (persons/h) with a car share, plus internal trips
    for (const f of floors) {
      f.arr = new Array(24).fill(0); f.dep = new Array(24).fill(0); f.car = new Array(24).fill(0); f.int = new Array(24).fill(0); f.attr = 0;
      if (f.level < 2) continue;
      for (const p of f.parts) { const U = Demand.USES[p.use]; if (!U || !U.rate) continue; const pr = Demand.useProfile(p.use, p.area, P); const intShare = VISITOR[p.use] && (hasHome || hasWork) ? cfg.internalShare * VISITOR[p.use] : 0; for (let h = 0; h < 24; h++) { f.arr[h] += pr.in[h].total * (1 - intShare); f.dep[h] += pr.out[h].total * (1 - intShare); f.car[h] += (pr.in[h].car + pr.out[h].car); f.int[h] += (pr.in[h].total + pr.out[h].total) * intShare; } if (VISITOR[p.use]) f.attr += p.area * VISITOR[p.use]; }
    }
    for (const f of floors) { f.carShare = f.arr.map((a, h) => { const tot = a + f.dep[h]; return tot > 0 ? Math.min(0.95, f.car[h] / Math.max(1e-6, tot + f.int[h])) : 0; }); }
    // devices
    const served = floors.filter((f) => f.served && f.level >= 2); const top = served.length ? served[served.length - 1] : lobby; const bottom = parks.length ? parks[parks.length - 1] : lobby;
    const groups = (cfg.groups && cfg.groups.length ? cfg.groups : [null]).map((g, k) => { const r = VT.analyse(blocks, P, P.vt || {}); const d = { name: `Lifts ${k + 1}`, n: r.N, cap: r.CC, v: r.v, a: 1.0, door: 4, from: bottom.level, to: top.level }; const o = Object.assign(d, g || {}); if (!(o.n > 0)) o.n = d.n; o.lo = floors.find((f) => f.level === Math.min(o.from, o.to)) || bottom; o.hi = floors.find((f) => f.level === Math.max(o.from, o.to)) || top; o.cars = []; return o; });
    const escalators = (cfg.escalators || []).map((e, k) => { const a = floors.find((f) => f.level === e.from), b = floors.find((f) => f.level === e.to); return a && b && a !== b ? { name: `Escalator ${k + 1}`, a: a.i < b.i ? a : b, b: a.i < b.i ? b : a, pairs: e.pairs || 1, cap: ESC_CAP * (e.pairs || 1) } : null; }).filter(Boolean);
    const stairs = cfg.stairs === false ? null : Object.assign({ width: 1.2 }, cfg.stairs || {});
    return { floors, lobby, parks, served, groups, escalators, stairs, cfg, blocks };
  }

  const kin = (s, v, a) => (s <= 0 ? 0 : s < v * v / a ? 2 * Math.sqrt(s / a) : s / v + v / a);

  /* ---------- simulation ---------- */
  function create(model, opts) {
    const o = Object.assign({ t0: 16.5 * 3600, t1: 18 * 3600, warm: 600, seed: 1, dt: 1 }, opts || {}); const rnd = G.rng(o.seed * 48271 + 7);
    const S = { model, t: o.t0 - o.warm, t0: o.t0, t1: o.t1, dt: o.dt, rnd, done: false, peds: [], active: [], halls: [], esc: [], stair: null, rec: { waits: [], journeys: [], byFloor: new Map(), series: [], mode: { lift: 0, esc: 0, stair: 0 }, carLoadSum: 0, carLoadN: 0, maxLobbyQ: 0, over60: 0, trips: 0, escUse: 0, stairUse: 0 }, nextRec: o.t0, pedId: 0 };
    const F = model.floors;
    for (const f of F) S.halls.push({ up: [], down: [] });
    for (const g of model.groups) { g.cars = []; for (let k = 0; k < g.n; k++) g.cars.push({ g, floor: model.lobby.i, pos: model.lobby.z, dir: 0, state: 'idle', until: 0, from: model.lobby.i, to: model.lobby.i, tDep: 0, tArr: 0, load: [], calls: new Set(), idleSince: S.t, target: -1 }); }
    for (const e of model.escalators) S.esc.push({ e, up: { q: [], riding: [] }, down: { q: [], riding: [] } });
    if (model.stairs) S.stair = { q: { up: [], down: [] }, riding: [] };
    return S;
  }
  const rateAt = (arr, t) => Demand.rateAt(arr, t);

  function route(S, o, d) {
    const M = S.model; const legs = []; const up = d > o; const k = Math.abs(d - o);
    // escalator path: chain of escalators between consecutive floor indices
    if (M.escalators.length) { let cur = o; const path = []; while (cur !== d) { const e = M.escalators.find((x) => (up ? x.a.i === cur && x.b.i <= d : x.b.i === cur && x.a.i >= d)); if (!e) { path.length = 0; break; } path.push(e); cur = up ? e.b.i : e.a.i; } if (path.length && S.rnd() < M.cfg.escPref) { for (const e of path) legs.push({ kind: 'esc', e, dir: up ? 'up' : 'down' }); return { mode: 'esc', legs }; } }
    if (S.stair && k <= M.cfg.maxStairFloors) { const p = M.cfg.stairShare * (up ? 0.6 : 1) * (k === 1 ? 1 : k === 2 ? 0.6 : 0.3); if (S.rnd() < p) return { mode: 'stair', legs: [{ kind: 'stair', from: o, to: d }] }; }
    const covers = (g, i) => i >= g.lo.i && i <= g.hi.i; const direct = M.groups.filter((g) => covers(g, o) && covers(g, d));
    if (direct.length) { const g = direct[Math.floor(S.rnd() * direct.length)]; return { mode: 'lift', legs: [{ kind: 'lift', g, from: o, to: d }] }; }
    const L = M.lobby.i; const g1 = M.groups.find((g) => covers(g, o) && covers(g, L)), g2 = M.groups.find((g) => covers(g, L) && covers(g, d));
    if (g1 && g2) return { mode: 'lift', legs: [{ kind: 'lift', g: g1, from: o, to: L }, { kind: 'lift', g: g2, from: L, to: d }] };
    if (S.stair) return { mode: 'stair', legs: [{ kind: 'stair', from: o, to: d }] };
    return null;
  }

  function spawn(S, o, d) { const r = route(S, o, d); if (!r || o === d) return; const p = { id: S.pedId++, t0: S.t, o, d, mode: r.mode, legs: r.legs, li: 0, tQ: S.t, tBoard: -1, state: 'queue' }; S.peds.push(p); S.active.push(p); enterLeg(S, p); }
  function enterLeg(S, p) {
    const leg = p.legs[p.li]; p.tQ = S.t; p.state = 'queue';
    if (leg.kind === 'lift') { const up = leg.to > leg.from; S.halls[leg.from][up ? 'up' : 'down'].push(p); }
    else if (leg.kind === 'esc') { const E = S.esc.find((x) => x.e === leg.e); E[leg.dir].q.push(p); }
    else { S.stair.q[leg.to > leg.from ? 'up' : 'down'].push(p); }
  }
  function finishLeg(S, p) { const leg = p.legs[p.li]; if (p.li === 0 && p.tBoard >= 0 && S.t >= S.t0) { const w = p.tBoard - p.t0; S.rec.waits.push(w); if (w > 60) S.rec.over60++; const bf = S.rec.byFloor.get(leg.from) || { n: 0, w: 0, maxQ: 0 }; bf.n++; bf.w += w; S.rec.byFloor.set(leg.from, bf); } p.li++; if (p.li < p.legs.length) { enterLeg(S, p); return; } p.state = 'done'; p.tDone = S.t; if (S.t >= S.t0) { S.rec.journeys.push(S.t - p.t0); S.rec.trips++; S.rec.mode[p.mode]++; } const k = S.active.indexOf(p); if (k >= 0) S.active.splice(k, 1); }

  function step(S) {
    const M = S.model, F = M.floors, dt = S.dt, t = S.t; const h = (t / 3600) % 24;
    // demand
    const served = M.served; const tot = t >= S.t0 ? 1 : 1; void tot;
    for (const f of served) {
      const arr = rateAt(f.arr, t) / 3600 * dt, dep = rateAt(f.dep, t) / 3600 * dt, inn = rateAt(f.int, t) / 3600 * dt; const cs = f.carShare[Math.floor(h)];
      const origin = () => (M.parks.length && S.rnd() < cs ? M.parks[Math.floor(S.rnd() * M.parks.length)].i : M.lobby.i);
      if (S.rnd() < arr) spawn(S, origin(), f.i);
      if (S.rnd() < dep) spawn(S, f.i, origin());
      if (S.rnd() < inn) { const cands = served.filter((g) => g !== f); if (cands.length) { let sum = 0; for (const g of cands) sum += (g.attr || 0) + 1; let r = S.rnd() * sum; let g = cands[cands.length - 1]; for (const c of cands) { r -= (c.attr || 0) + 1; if (r <= 0) { g = c; break; } } if (S.rnd() < 0.5) spawn(S, f.i, g.i); else spawn(S, g.i, f.i); } }
    }
    // lifts
    for (const g of M.groups) {
      const lo = g.lo.i, hi = g.hi.i; const inRange = (i) => i >= lo && i <= hi;
      const callsAhead = (c, dir) => { for (let i = lo; i <= hi; i++) { if (dir > 0 ? i <= c.floor : i >= c.floor) continue; if (c.calls.has(i) || S.halls[i][dir > 0 ? 'up' : 'down'].length) return true; } return false; };
      const nextStop = (c, dir) => { let best = -1; for (let i = lo; i <= hi; i++) { if (dir > 0 ? i <= c.floor : i >= c.floor) continue; if (c.calls.has(i) || S.halls[i][dir > 0 ? 'up' : 'down'].length) { if (best < 0 || (dir > 0 ? i < best : i > best)) best = i; } } return best; };
      const anyCall = () => { let best = -1, bw = -1; for (let i = lo; i <= hi; i++) for (const d of ['up', 'down']) { const q = S.halls[i][d]; if (q.length) { const w = t - q[0].tQ; if (w > bw) { bw = w; best = i; } } } return best; };
      // at a floor: let people off, let people on in the car's direction (or whichever direction is waiting when empty), then dwell
      const arrive = (c) => { c.state = 'dwell'; let alight = 0, board = 0; c.load = c.load.filter((p) => { if (p.legs[p.li].to === c.floor) { alight++; finishLeg(S, p); return false; } return true; }); c.calls.delete(c.floor); const pref = c.dir > 0 ? 'up' : c.dir < 0 ? 'down' : (S.halls[c.floor].up.length >= S.halls[c.floor].down.length ? 'up' : 'down'); const dirs = pref === 'up' ? ['up', 'down'] : ['down', 'up']; for (const d of dirs) { if (c.load.length && d !== pref) break; if (c.load.length === 0 && d !== pref && callsAhead(c, c.dir)) continue; const q = S.halls[c.floor][d]; while (q.length && c.load.length < g.cap) { const p = q.shift(); p.tBoard = t; p.state = 'ride'; c.load.push(p); c.calls.add(p.legs[p.li].to); board++; } if (c.load.length) { c.dir = c.load[0].legs[c.load[0].li].to > c.floor ? 1 : -1; break; } } c.until = t + g.door + Math.max(0, (alight + board) * 1.0); S.rec.carLoadSum += c.load.length / g.cap; S.rec.carLoadN++; };
      for (const c of g.cars) {
        if (c.state === 'move') { if (t >= c.tArr) { c.floor = c.to; c.pos = F[c.to].z; arrive(c); } else { const f = (t - c.tDep) / Math.max(1, c.tArr - c.tDep); c.pos = F[c.from].z + (F[c.to].z - F[c.from].z) * G.clamp(f, 0, 1); } continue; }
        if (c.state === 'dwell') { if (t < c.until) continue; if (c.load.length) { const dir = c.dir || (c.load[0].legs[c.load[0].li].to > c.floor ? 1 : -1); c.dir = dir; const ns = nextStop(c, dir); if (ns >= 0) { c.state = 'move'; c.from = c.floor; c.to = ns; c.tDep = t; c.tArr = t + kin(Math.abs(F[ns].z - F[c.floor].z), g.v, g.a); continue; } } if (S.halls[c.floor].up.length || S.halls[c.floor].down.length) { c.dir = 0; arrive(c); continue; } c.state = 'idle'; c.dir = 0; c.idleSince = t; }
        if (c.state === 'idle') {
          // serve a call at this floor first
          if (S.halls[c.floor].up.length || S.halls[c.floor].down.length) { c.dir = 0; arrive(c); continue; }
          const callAhead = (() => { let best = -1, bd = 1e9; for (let i = lo; i <= hi; i++) { if (S.halls[i].up.length || S.halls[i].down.length) { const d = Math.abs(i - c.floor); if (d < bd && !g.cars.some((o2) => o2 !== c && o2.state === 'move' && o2.to === i)) { bd = d; best = i; } } } return best; })();
          const go = callAhead >= 0 ? callAhead : (t - c.idleSince > 20 && c.floor !== M.lobby.i && inRange(M.lobby.i) ? M.lobby.i : -1);
          if (go >= 0 && go !== c.floor) { c.state = 'move'; c.from = c.floor; c.to = go; c.dir = go > c.floor ? 1 : -1; c.tDep = t; c.tArr = t + kin(Math.abs(F[go].z - F[c.floor].z), g.v, g.a); }
        }
      }
      void anyCall;
    }
    // escalators
    for (const E of S.esc) { const rise = E.e.b.z - E.e.a.z; const T = rise / ESC_VZ + 2; for (const d of ['up', 'down']) { const L = E[d]; let room = E.e.cap * dt; while (L.q.length && room >= 1) { const p = L.q.shift(); p.tBoard = t; p.state = 'ride'; L.riding.push({ p, t0: t, t1: t + T }); room -= 1; S.rec.escUse++; } if (room > 0 && room < 1 && L.q.length && S.rnd() < room) { const p = L.q.shift(); p.tBoard = t; p.state = 'ride'; L.riding.push({ p, t0: t, t1: t + T }); S.rec.escUse++; } L.riding = L.riding.filter((r) => { if (t >= r.t1) { finishLeg(S, r.p); return false; } return true; }); } }
    // stairs
    if (S.stair) { const cap = STAIR_CAP * M.stairs.width * dt; for (const d of ['up', 'down']) { const q = S.stair.q[d]; let room = cap; while (q.length && room >= 1) { const p = q.shift(); const leg = p.legs[p.li]; const dz = Math.abs(F[leg.to].z - F[leg.from].z); const T = dz / 3.3 * (d === 'up' ? 16 : 13); p.tBoard = t; p.state = 'ride'; S.stair.riding.push({ p, t0: t, t1: t + T, dir: d }); room -= 1; S.rec.stairUse++; } if (room > 0 && room < 1 && q.length && S.rnd() < room) { const p = q.shift(); const leg = p.legs[p.li]; const dz = Math.abs(F[leg.to].z - F[leg.from].z); const T = dz / 3.3 * (d === 'up' ? 16 : 13); p.tBoard = t; p.state = 'ride'; S.stair.riding.push({ p, t0: t, t1: t + T, dir: d }); S.rec.stairUse++; } } S.stair.riding = S.stair.riding.filter((r) => { if (t >= r.t1) { finishLeg(S, r.p); return false; } return true; }); }
    // records
    if (t >= S.nextRec) { const lobbyQ = S.halls[M.lobby.i].up.length + S.halls[M.lobby.i].down.length; let waiting = 0, maxQ = 0; S.halls.forEach((hq, i) => { const n = hq.up.length + hq.down.length; waiting += n; if (n > maxQ) maxQ = n; const bf = S.rec.byFloor.get(i); if (bf && n > bf.maxQ) bf.maxQ = n; else if (!bf && n) S.rec.byFloor.set(i, { n: 0, w: 0, maxQ: n }); }); for (const E of S.esc) waiting += E.up.q.length + E.down.q.length; if (S.stair) waiting += S.stair.q.up.length + S.stair.q.down.length; if (t >= S.t0) { S.rec.series.push({ t, h: `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`, lobbyQ, waiting, riding: S.active.length - waiting }); if (lobbyQ > S.rec.maxLobbyQ) S.rec.maxLobbyQ = lobbyQ; } S.nextRec = t + 60; }
    S.t += dt; if (S.t >= S.t1) S.done = true;
  }
  function run(S, steps) { let n = 0; while (!S.done && n < steps) { step(S); n++; } return S.done; }
  function runAll(S) { while (!S.done) step(S); return S; }
  const progress = (S) => G.clamp((S.t - (S.t0 - 600)) / (S.t1 - (S.t0 - 600)), 0, 1);

  /* ---------- results ---------- */
  function results(S) {
    const r = S.rec; const M = S.model; const q = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
    const mean = (arr) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0); const H = (S.t1 - S.t0) / 3600;
    const perFloor = M.floors.filter((f) => f.served || f === M.lobby).map((f) => { const bf = r.byFloor.get(f.i) || { n: 0, w: 0, maxQ: 0 }; return { i: f.i, label: f.label, level: f.level, use: f.use, trips: bf.n, avgWait: bf.n ? bf.w / bf.n : 0, maxQ: bf.maxQ }; });
    const groups = M.groups.map((g) => ({ name: g.name, n: g.n, cap: g.cap, v: g.v, from: g.lo.label, to: g.hi.label }));
    const devices = [];
    for (const g of M.groups) devices.push({ kind: 'lift', name: `${g.name}: ${g.n} × ${g.cap} persons, ${g.v} m/s, ${g.lo.label}–${g.hi.label}`, perHour: 0 });
    for (const E of S.esc) devices.push({ kind: 'esc', name: `${E.e.name}: ${E.e.a.label}–${E.e.b.label}${E.e.pairs > 1 ? `, ${E.e.pairs} pairs` : ''}`, perHour: 0 });
    if (S.stair) devices.push({ kind: 'stair', name: `Stairs: ${M.stairs.width} m wide`, perHour: r.stairUse / H });
    const liftTrips = r.mode.lift; devices.filter((d) => d.kind === 'lift').forEach((d) => { d.perHour = liftTrips / H / Math.max(1, M.groups.length); }); devices.filter((d) => d.kind === 'esc').forEach((d) => { d.perHour = r.escUse / H / Math.max(1, S.esc.length); });
    const total = Math.max(1, r.mode.lift + r.mode.esc + r.mode.stair);
    return { trips: r.trips, perHour: r.trips / H, avgWait: mean(r.waits), p95Wait: q(r.waits, 0.95), maxWait: r.waits.length ? Math.max(...r.waits) : 0, avgJourney: mean(r.journeys), p95Journey: q(r.journeys, 0.95), over60: r.waits.length ? r.over60 / r.waits.length : 0, maxLobbyQ: r.maxLobbyQ, carUtil: r.carLoadN ? r.carLoadSum / r.carLoadN : 0, modeShare: { lift: r.mode.lift / total, esc: r.mode.esc / total, stair: r.mode.stair / total }, perFloor, series: r.series, groups, devices, t0: S.t0, t1: S.t1, escalators: M.escalators.length, stairs: !!S.stair };
  }
  /* a one-line verdict in the designer's words */
  function verdict(R) {
    const band = R.avgWait <= 30 ? 'good' : R.avgWait <= 45 ? 'fair' : 'poor';
    const s = `${R.trips > 0 ? `${Geom.fmt(R.perHour)} trips an hour` : 'No trips'} between floors; ${Geom.fmt(R.modeShare.lift * 100)}% by lift${R.escalators ? `, ${Geom.fmt(R.modeShare.esc * 100)}% by escalator` : ''}${R.stairs ? `, ${Geom.fmt(R.modeShare.stair * 100)}% by stair` : ''}. Average wait for a lift ${Geom.fmt(R.avgWait)} s (${band}; 95% board within ${Geom.fmt(R.p95Wait)} s), door to door ${Geom.fmt(R.avgJourney)} s. The lobby queue peaks at ${R.maxLobbyQ} people.`;
    return { band, text: s };
  }
  return { DEF, build, create, step, run, runAll, progress, results, verdict, ESC_CAP, STAIR_CAP };
})();
