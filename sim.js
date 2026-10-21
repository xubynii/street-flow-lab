/* Street Flow Lab · sim.js — the simulation engine. Pedestrians are agents on the undirected sidewalk graph (speed falls with
   density, waits at crossings tied to the signal phases, user groups with their own speed and habits, lingering in the site's
   public spaces). Vehicles are agents on the directed street graph: free-flow travel, point queues with per-lane storage
   (spillback), signal phases, priority / all-way-stop rules, kerb dwell for deliveries and pick-ups. Time is seconds of day.
   Records are kept in 15-minute bins inside the analysis window. */
window.Sim = (() => {
  const G = window.Geom;
  const BIN = 900, GAP = 7.5, HEADWAY = 2.0;
  const DWELL = { truck: [900, 1500], pudo: [60, 120] };

  function create(net, dm, scenario, o) {
    const S = {
      net, dm, scenario, t0: o.t0, t1: o.t1, t: o.t0 - (o.warm || 900), warm: o.warm || 900, dt: o.dt || 1, kPed: o.kPed || 1, kVeh: o.kVeh || 1, rnd: null, rndBg: G.rng((o.seed || 1) * 104729 + 3), rndSite: G.rng((o.seed || 1) * 7919 + 17),
      peds: [], vehs: [], done: false, nextSpawn: -Infinity, stats: { pedTrips: 0, pedDone: 0, pedTime: 0, pedWait: 0, vehTrips: 0, vehDone: 0, vehTime: 0, vehDelay: 0, unroutable: 0, fail: { noAccess: 0, noDir: 0, noRoute: 0, thru: 0, spawnCalls: 0 }, byType: { car: 0, truck: 0, pudo: 0, thru: 0, sitePudoArr: 0 }, site: { pedIn: 0, pedOut: 0, vehIn: 0, vehOut: 0, pudo: 0, truck: 0, frontagePass: 0, crossNear: 0 }, bins: Math.ceil((o.t1 - o.t0) / BIN) },
    };
    const E = net.ped.edges.length, V = net.veh.edges.length, B = S.stats.bins, NG = dm.gt.groups.length;
    S.rec = { pFlow: new Float32Array(E * B), pDens: new Float64Array(E), pMax: new Float32Array(E), pOn: new Int32Array(E), pWaitSum: new Float64Array(E), pWaitN: new Float32Array(E), vVol: new Float32Array(V * B), vDelay: new Float64Array(V), vExit: new Float32Array(V), vMaxQ: new Float32Array(V), vBlocked: new Float32Array(V), vApp: new Float64Array(V), vAppN: new Float32Array(V), vOn: new Int32Array(V),
      frontGroup: new Float32Array(B * NG), siteGroup: new Float32Array(B * NG), pedGroup: new Float32Array(NG) };
    S.q = new Array(V); for (let i = 0; i < V; i++) S.q[i] = [];
    S.lastDep = new Float64Array(V).fill(-1e9); S.lastEntry = new Float64Array(V).fill(-1e9); S.blocked = new Array(V).fill(null); S.nodeLast = new Float64Array(net.veh.nodes.length).fill(-1e9); S.nodeLastMajor = new Float64Array(net.veh.nodes.length).fill(-1e9);
    S.active = dm.gens.filter((g) => g.kind !== 'site' || g.scn === scenario);
    S.siteGen = dm.siteGens[scenario][0] || null;
    S.siteDoors = new Set(); for (const g of dm.siteGens[scenario]) for (const d of g.doors) S.siteDoors.add(d.node);
    // public spaces of this scenario's site: which frontage / door-link edges lead past them
    S.spaces = []; for (const g of dm.siteGens[scenario]) for (const sp of g.spaces || []) { const near = new Set(); for (const e of net.ped.edges) { if (!e.alive || !(e.frontage || e.kind === 'walkway' || e.kind === 'link')) continue; const m = G.pointAt(e.poly, e.L / 2); if (Math.hypot(m[0] - sp.x, m[1] - sp.y) < 28) near.add(e.i); } S.spaces.push(Object.assign({}, sp, { near, occ: new Float32Array(NG), occInt: new Float64Array(B * NG), visits: new Float32Array(NG), dwellSum: 0, dwellN: 0, peak: 0 })); }
    S.spaceByEdge = new Map(); S.spaces.forEach((sp, i) => { for (const ei of sp.near) { if (!S.spaceByEdge.has(ei)) S.spaceByEdge.set(ei, []); S.spaceByEdge.get(ei).push(i); } });
    S.events = []; S.backlog = []; S.rnd = S.rndBg;
    return S;
  }

  /* ---------- signals ---------- */
  const phaseOf = (n, t) => { const r = (t + n.sig.offset) % n.sig.cycle; return r < n.sig.split * n.sig.cycle ? 0 : 1; };
  const greenFor = (n, phase, t) => { const C = n.sig.cycle, r = (t + n.sig.offset) % C, sp = n.sig.split * C; return phase === 0 ? r < sp - n.sig.amber : r >= sp && r < C - n.sig.amber; };
  const greenLeft = (n, phase, t) => { const C = n.sig.cycle, r = (t + n.sig.offset) % C, sp = n.sig.split * C; return phase === 0 ? sp - n.sig.amber - r : C - n.sig.amber - r; };

  /* ---------- spawning ---------- */
  const binOf = (S, t) => Math.floor((t - S.t0) / BIN);
  const inWin = (S, t) => t >= S.t0 && t < S.t1;
  function pickDoor(S, g, use) { if (g.doors.length === 1) return g.doors[0].node; const fit = use ? g.doors.filter((d) => !d.uses || d.uses.has(use)) : g.doors; const arr = fit.length ? fit : g.doors; let tot = 0; for (const d of arr) tot += d.w; let r = S.rnd() * tot; for (const d of arr) { r -= d.w; if (r <= 0) return d.node; } return arr[arr.length - 1].node; }
  function pickUse(S, g, dirKey, mode, t) { const uses = Object.keys(g.uses).filter((u) => Demand.USES[u] && Demand.USES[u].rate > 0); if (uses.length <= 1) return uses[0]; const w = uses.map((u) => { const U = Demand.USES[u]; const h = Math.floor((t / 3600) % 24); return g.uses[u] * (Demand.USES[u].rate) * (dirKey === 'out' ? U.out[h] : U.in[h]); }); let tot = w.reduce((a, b) => a + b, 0); let r = S.rnd() * tot; for (let i = 0; i < uses.length; i++) { r -= w[i]; if (r <= 0) return uses[i]; } return uses[uses.length - 1]; }
  function pickDest(S, g) { const dm = S.dm; if (!g.destCum) return null; const i = S.rnd.weighted(g.destCum); return i < dm.attractors.length ? dm.attractors[i] : dm.pgates[i - dm.attractors.length]; }
  function pickStop(S, g) { if (!g.stopCands) return null; return g.stopCands[S.rnd.weighted(g.stopCum)]; }
  function pickGroup(S, use, mode, t) { const gt = S.dm.gt; const h = Math.floor((t / 3600) % 24); const tab = (use && gt.table[use]) || gt.table._street; const cum = tab[mode === 'transit' ? 'transit' : 'walk'][h]; if (!cum[cum.length - 1]) return Math.min(2, cum.length - 1); return S.rnd.weighted(cum); }

  function pedTrip(S, fromGen, fromNode, toGen, toNode, meta) {
    const net = S.net; // the tree is rooted at whichever end is an attractor / stop / gate
    const rootAtTo = !!(toGen && (toGen.kind !== 'ctx' || toGen.isAttr));
    const root = rootAtTo ? toNode : fromNode; const other = rootAtTo ? fromNode : toNode;
    const gi = meta && meta.g != null ? meta.g : 0; const grp = S.dm.gt.groups[gi];
    const tree = Net.pedTree(net, root, S.scenario, S.rnd.int(2), grp.avoidSteps); if (!isFinite(tree.dist[other])) { S.stats.unroutable++; return null; }
    let path = Net.pedPath(net, tree, other); if (!path.length) return null; if (!rootAtTo) path = path.reverse();
    const p = { path, i: 0, s: 0, v0: grp.speed * (0.9 + S.rnd() * 0.2), wait: 0, k: meta && meta.k || S.kPed, node: fromNode, t0: S.t, waited: 0, site: !!(meta && meta.site), kind: meta && meta.kind || 'walk', g: gi, linger: -1, lingered: false };
    enterPed(S, p, path[0], fromNode); S.peds.push(p); S.stats.pedTrips++; S.rec.pedGroup[gi] += p.k;
    return p;
  }
  function enterPed(S, p, ei, fromNode) { const e = S.net.ped.edges[ei]; p.e = ei; p.dir = e.a === fromNode ? 1 : -1; p.s = 0; S.rec.pOn[ei]++; }
  function spawnPeds(S, g, t, dtS) {
    const kp = g.kind === 'site' ? 1 : S.kPed; const win = inWin(S, t);
    if (g.kind === 'gate') { const lam = g.gateRate * Demand.PED_PROF[Math.floor((t / 3600) % 24)] * dtS / 3600 / kp; const n = S.rnd.poisson(lam); for (let i = 0; i < n; i++) { const d = pickDest(S, g); if (!d || d.id === g.id) continue; pedTrip(S, g, g.doors[0].node, d, pickDoor(S, d), { kind: 'through', g: pickGroup(S, null, 'walk', t) }); } return; }
    if (!g.out) return;
    for (const dir of ['out', 'in']) {
      for (const mode of ['walk', 'transit']) {
        const lam = Demand.rateAt(g[dir], t, mode) * dtS / 3600 / kp; const n = S.rnd.poisson(lam); if (!n) continue;
        for (let i = 0; i < n; i++) {
          const use = pickUse(S, g, dir, mode, t); const door = pickDoor(S, g, use); const gi = pickGroup(S, use, mode, t);
          let other = mode === 'transit' ? pickStop(S, g) : pickDest(S, g); if (!other || other.id === g.id) other = pickDest(S, g); if (!other || other.id === g.id) continue;
          const od = pickDoor(S, other, null);
          const meta = { site: g.kind === 'site', kind: mode, k: kp, g: gi };
          const p = dir === 'out' ? pedTrip(S, g, door, other, od, meta) : pedTrip(S, other, od, g, door, meta);
          if (p && g.kind === 'site' && win) { S.stats.site[dir === 'out' ? 'pedOut' : 'pedIn'] += kp; S.rec.siteGroup[binOf(S, t) * S.dm.gt.groups.length + gi] += kp; }
        }
      }
    }
  }
  const VEh = (S, ei) => S.net.veh.edges[ei];
  const hasSpace = (S, ei, k) => { const q = S.q[ei]; if (!q.length) return true; const e = S.net.veh.edges[ei]; const g = GAP * k / e.lanes; return q[q.length - 1].s > g && q.length * g < e.L + g; };
  function vehTrip(S, path, s0, dest, meta, fromBacklog) {
    if (!path || !path.length) { S.stats.unroutable++; return null; }
    if (!s0 && !fromBacklog && !hasSpace(S, path[0], meta.k || S.kVeh)) { if (S.backlog.length < 4000) S.backlog.push({ path, dest, meta }); return null; }
    const v = { path, i: 0, s: s0 || 0, k: meta.k || S.kVeh, type: meta.type || 'car', dest: dest || null, site: !!meta.site, tEnter: S.t, tLine: -1, gapWait: 0, dwell: 0, t0: S.t, tff: 0, onEdge: -1 };
    insertVeh(S, v, path[0], v.s); S.vehs.push(v); S.stats.vehTrips++; S.stats.byType[v.type] = (S.stats.byType[v.type] || 0) + 1; return v;
  }
  function insertVeh(S, v, ei, s) { const q = S.q[ei]; v.onEdge = ei; v.s = s; v.tEnter = S.t; v.tLine = -1; S.rec.vOn[ei]++; if (inWin(S, S.t)) S.rec.vVol[ei * S.stats.bins + binOf(S, S.t)] += v.k; let idx = q.length; while (idx > 0 && q[idx - 1].s < s) idx--; q.splice(idx, 0, v); }
  function removeVeh(S, v) { const q = S.q[v.onEdge]; const i = q.indexOf(v); if (i >= 0) q.splice(i, 1); S.rec.vOn[v.onEdge]--; v.onEdge = -1; }
  function accessEdge(S, acc, toward) { // choose direction edge of a segment for an access point; returns {edge, s}
    const seg = acc.seg; const net = S.net; const opts = []; if (seg.fwd >= 0 && net.veh.edges[seg.fwd].alive) opts.push({ edge: seg.fwd, s: acc.s }); if (seg.rev >= 0 && net.veh.edges[seg.rev].alive) opts.push({ edge: seg.rev, s: seg.L - acc.s }); if (!opts.length) return null; if (opts.length === 1 || !toward) return opts[0];
    let best = null, bd = Infinity; for (const o of opts) { const e = net.veh.edges[o.edge]; const d = toward.dir === 'to' ? toward.tree.dist[e.b] + (e.L - o.s) / e.vff : toward.tree.dist[e.a] + o.s / e.vff; if (d < bd) { bd = d; best = o; } } return best;
  }
  function carOut(S, g, meta) { const dm = S.dm; S.stats.fail.spawnCalls++; if (!g.veh || !dm.vOut.length) { S.stats.fail.noAccess++; return null; } const gate = dm.vOut[S.rnd.weighted(dm.vOutCum)]; const tree = Net.vehTree(S.net, gate.node, 'to', S.scenario, S.rnd.int(3)); const ae = accessEdge(S, g.veh, { tree, dir: 'to' }); if (!ae) { S.stats.fail.noDir++; return null; } const e = S.net.veh.edges[ae.edge]; if (!isFinite(tree.dist[e.b])) { S.stats.unroutable++; return null; } const path = [ae.edge].concat(Net.vehPathTo(S.net, tree, e.b)); return vehTrip(S, path, ae.s, null, meta); }
  function carIn(S, g, acc, meta, dwell) { const dm = S.dm; S.stats.fail.spawnCalls++; if (!acc || !dm.vIn.length) { S.stats.fail.noAccess++; return null; } const gate = dm.vIn[S.rnd.weighted(dm.vInCum)]; const tree = Net.vehTree(S.net, gate.node, 'from', S.scenario, S.rnd.int(3)); const ae = accessEdge(S, acc, { tree, dir: 'from' }); if (!ae) { S.stats.fail.noDir++; return null; } const e = S.net.veh.edges[ae.edge]; if (!isFinite(tree.dist[e.a])) { S.stats.unroutable++; return null; } const path = Net.vehPathFrom(S.net, tree, e.a).concat([ae.edge]); return vehTrip(S, path, 0, { s: ae.s, dwell: dwell || 0, acc, gen: g }, meta); }
  function spawnVehs(S, g, t, dtS) {
    if (!g.out) return; const kv = g.kind === 'site' ? 1 : S.kVeh; const win = inWin(S, t);
    for (const dir of ['out', 'in']) {
      const lam = Demand.rateAt(g[dir], t, 'car') * dtS / 3600 / kv; const n = S.rnd.poisson(lam);
      for (let i = 0; i < n; i++) {
        const isPudo = S.rnd() < (Demand.rateAt(g.pudoRate[dir], t) / Math.max(1e-9, Demand.rateAt(g[dir], t, 'car')));
        const site = g.kind === 'site';
        if (dir === 'out') { if (isPudo && site) carIn(S, g, g.pudo.access, { type: 'pudo', site, k: kv }, g.pudo.layby ? 0 : S.rnd.exp(1) * 30 + DWELL.pudo[0]); else if (isPudo) continue; else carOut(S, g, { type: 'car', site, k: kv }); if (site && win) S.stats.site.vehOut += kv; }
        else { if (isPudo && site) carIn(S, g, g.pudo.access, { type: 'pudo', site, k: kv }, g.pudo.layby ? 0 : DWELL.pudo[0] + S.rnd() * (DWELL.pudo[1] - DWELL.pudo[0])); else if (isPudo) continue; else { const rampDwell = site && g.rampGate ? g.rampGate : 0; carIn(S, g, g.veh, { type: 'car', site, k: kv }, rampDwell); } if (site && win) S.stats.site.vehIn += kv; }
      }
    }
    const lt = Demand.rateAt(g.truck, t) * dtS / 3600 / kv; const nt = S.rnd.poisson(lt);
    for (let i = 0; i < nt; i++) { const site = g.kind === 'site'; const acc = site ? (g.loading && g.loading.access) : g.veh; const mode = site ? g.loading.mode : 'lane'; const dwell = mode === 'internal' || mode === 'none' ? 0 : DWELL.truck[0] + S.rnd() * (DWELL.truck[1] - DWELL.truck[0]); carIn(S, g, acc, { type: 'truck', site, k: kv }, site ? dwell : 0); if (site && win) S.stats.site.truck += kv; }
  }
  function spawnThrough(S, t, dtS) { const dm = S.dm; const f = Demand.TRAFFIC_PROF[Math.floor((t / 3600) % 24)]; for (const gi of dm.vIn) { const lam = gi.rate * f * dtS / 3600 / S.kVeh; const n = S.rnd.poisson(lam); for (let i = 0; i < n; i++) { let go = null; for (let tries = 0; tries < 4 && !go; tries++) { const c = dm.vOut[S.rnd.weighted(dm.vOutCum)]; if (c.node !== gi.node && Math.hypot(c.x - gi.x, c.y - gi.y) > 150) go = c; } if (!go) { S.stats.fail.thru++; continue; } const tree = Net.vehTree(S.net, gi.node, 'from', S.scenario, S.rnd.int(3)); if (!isFinite(tree.dist[go.node])) { S.stats.fail.thru++; continue; } vehTrip(S, Net.vehPathFrom(S.net, tree, go.node), 0, null, { type: 'thru' }); } } }

  /* ---------- lingering in public space ---------- */
  function maybeLinger(S, p, ei, t) {
    if (p.lingered || !S.spaceByEdge.size) return; const list = S.spaceByEdge.get(ei); if (!list) return;
    const grp = S.dm.gt.groups[p.g]; const NG = S.dm.gt.groups.length;
    for (const si of list) { const sp = S.spaces[si]; let occ = 0; for (let g = 0; g < NG; g++) occ += sp.occ[g]; if (occ + p.k > sp.cap) continue; const appeal = grp.spaces[sp.type] || 0; const prob = grp.linger * appeal * (p.site ? 1.8 : 0.4); // passers-by stop far less often than the building's own people if (S.rnd() >= prob) continue;
      const dwell = Math.max(60, grp.dwell * 60 * (0.5 + S.rnd())); p.linger = si; p.lingered = true; p.wait = dwell; p.lx = sp.x + (S.rnd() - 0.5) * 6; p.ly = sp.y + (S.rnd() - 0.5) * 6; sp.occ[p.g] += p.k; if (inWin(S, t)) { sp.visits[p.g] += p.k; sp.dwellSum += dwell * p.k; sp.dwellN += p.k; } return; }
  }

  /* ---------- stepping ---------- */
  function step(S) {
    const dt = S.dt, t = S.t, net = S.net, rec = S.rec, B = S.stats.bins, NG = S.dm.gt.groups.length; const win = inWin(S, t); const bin = win ? binOf(S, t) : -1;
    if (S.backlog.length) { const keep = []; for (const b of S.backlog) { const ei = b.path[0]; const k = b.meta.k || S.kVeh; const e = VEh(S, ei); if (t - S.lastEntry[ei] >= HEADWAY * k / e.lanes && hasSpace(S, ei, k)) { S.lastEntry[ei] = t; vehTrip(S, b.path, 0, b.dest, b.meta, true); } else keep.push(b); } S.backlog = keep; }
    if (t >= S.nextSpawn) { const dtS = 10; for (const g of S.active) { if (!g.doors.length && g.kind !== 'gate') continue; S.rnd = g.kind === 'site' ? S.rndSite : S.rndBg; spawnPeds(S, g, t, dtS); if (g.kind === 'ctx' || g.kind === 'site') spawnVehs(S, g, t, dtS); } S.rnd = S.rndBg; spawnThrough(S, t, dtS); S.nextSpawn = t + dtS; }
    while (S.events.length && S.events[0].t <= t) S.events.shift().fn();
    if (win && S.spaces.length) for (const sp of S.spaces) { let tot = 0; for (let g = 0; g < NG; g++) { sp.occInt[bin * NG + g] += sp.occ[g] * dt; tot += sp.occ[g]; } if (tot > sp.peak) sp.peak = tot; }
    /* pedestrians */
    const PE = net.ped.edges; let w = 0;
    for (let i = 0; i < S.peds.length; i++) {
      const p = S.peds[i]; const e = PE[p.e];
      if (p.wait > 0) { p.wait -= dt; if (p.linger < 0) { p.waited += dt; if (win) rec.pWaitSum[p.e] += dt * p.k; } if (p.wait > 0) { S.peds[w++] = p; continue; } if (p.linger >= 0) { S.spaces[p.linger].occ[p.g] -= p.k; p.linger = -1; } }
      const rho = rec.pOn[p.e] * p.k / Math.max(1, e.L * e.w);
      const f = e.kind === 'steps' ? 0.55 : Math.max(0.1, 1 - 0.27 * Math.max(0, rho - 0.25));
      p.s += p.v0 * f * dt;
      if (win) { rec.pDens[p.e] += dt * p.k; if (rho > rec.pMax[p.e]) rec.pMax[p.e] = rho; }
      if (p.s >= e.L) {
        const endNode = p.dir === 1 ? e.b : e.a; rec.pOn[p.e]--; if (win) { rec.pFlow[p.e * B + bin] += p.k; if (e.frontage && !p.fr) { p.fr = 1; S.stats.site.frontagePass += p.k; rec.frontGroup[bin * NG + p.g] += p.k; } }
        p.i++;
        if (p.i >= p.path.length) { S.stats.pedDone++; S.stats.pedTime += t - p.t0; S.stats.pedWait += p.waited; continue; }
        const ne = PE[p.path[p.i]]; enterPed(S, p, ne.i, endNode);
        if (ne.kind === 'crossing') { let wt = 0; if (ne.ctrl === 'xsig' && ne.sigNode >= 0) { const n = net.veh.nodes[ne.sigNode]; if (n.sig) { const walk = !greenFor(n, ne.sigPhase, t) && greenLeft(n, 1 - ne.sigPhase, t) > ne.L / Math.min(1.2, p.v0) - 4; if (!walk) { let r = (t + n.sig.offset) % n.sig.cycle; const C = n.sig.cycle, sp = n.sig.split * C; wt = ne.sigPhase === 0 ? (r < sp ? sp - r : C - r + sp) : (r >= sp ? C - r : sp - r); wt = Math.max(1, Math.min(wt + 1, C)); } } else wt = S.rnd.exp(8); } else if (ne.ctrl === 'xmark') wt = S.rnd() < 0.5 ? 0 : S.rnd.exp(6); else if (ne.ctrl === 'x') wt = S.rnd() < 0.4 ? 0 : S.rnd.exp(10); else if (ne.ctrl === 'xq') wt = S.rnd() < 0.7 ? 0 : S.rnd.exp(4); p.wait = wt; if (win) rec.pWaitN[ne.i] += p.k; }
        else maybeLinger(S, p, ne.i, t);
      }
      S.peds[w++] = p;
    }
    S.peds.length = w;
    /* vehicles: per edge, front first */
    const VE = net.veh.edges, VN = net.veh.nodes;
    for (let ei = 0; ei < VE.length; ei++) {
      const q = S.q[ei]; if (!q.length) continue; const e = VE[ei]; const bl = S.blocked[ei]; let lanes = e.lanes; if (bl) { let nb = 0; for (let j = bl.length - 1; j >= 0; j--) { if (bl[j] <= t) bl.splice(j, 1); else nb++; } lanes = Math.max(0.5, e.lanes - nb); if (nb && win) rec.vBlocked[ei] += dt; }
      let queued = 0;
      for (let j = 0; j < q.length; j++) {
        const v = q[j];
        if (v.dwell > 0) { v.dwell -= dt; if (v.dwell <= 0) { finishDwell(S, v); j--; } continue; }
        const gapK = GAP * v.k / lanes; const limit = j === 0 ? e.L : Math.min(e.L, q[j - 1].s - gapK);
        const isLast = v.i === v.path.length - 1; const target = isLast && v.dest ? Math.min(limit, v.dest.s) : limit;
        if (v.s < target) { v.s = Math.min(target, v.s + e.vff * dt); }
        if (isLast && v.dest && v.s >= v.dest.s - 0.01) { if (!arrive(S, v)) { q.splice(j, 1); j--; } continue; }
        if (isLast && !v.dest && v.s >= e.L - 0.01) { // gate exit
          S.stats.vehDone++; S.stats.vehTime += t - v.t0; if (win) { rec.vExit[ei] += v.k; rec.vDelay[ei] += Math.max(0, t - v.tEnter - e.tff) * v.k; } S.rec.vOn[ei]--; v.onEdge = -1; q.splice(j, 1); j--; continue;
        }
        if (v.s >= limit - 0.05 && v.s >= e.L - gapK * (j + 0.5) - 0.05) queued++;
        if (j === 0 && v.s >= e.L - 0.05) {
          if (v.tLine < 0) { v.tLine = t; v.gapWait = S.rnd.exp(3); }
          const n = VN[e.b]; const ne = VE[v.path[v.i + 1]]; if (!ne) { q.splice(j, 1); j--; S.rec.vOn[ei]--; continue; }
          const nq = S.q[ne.i]; const gN = GAP * v.k / ne.lanes; const storage = nq.length === 0 || nq[nq.length - 1].s > gN && nq.length * gN < ne.L + 2 * gN;
          const hw = HEADWAY * v.k / lanes; let ok = (storage || t - v.tLine > 120) && t - S.lastDep[ei] >= hw;
          if (ok) {
            if (n.ctrl === 'sig') ok = greenFor(n, e.phase, t);
            else if (n.ctrl === 'prio') ok = e.phase === 0 ? true : (t - S.nodeLastMajor[n.i] >= 2.5 && t - v.tLine >= v.gapWait);
            else if (n.ctrl === 'allstop') ok = t - S.nodeLast[n.i] >= 2.2 && t - v.tLine >= 1.5;
          }
          if (ok) {
            S.lastDep[ei] = t; S.nodeLast[n.i] = t; if (e.phase === 0) S.nodeLastMajor[n.i] = t;
            if (win) { rec.vExit[ei] += v.k; rec.vDelay[ei] += Math.max(0, t - v.tEnter - e.tff) * v.k; rec.vApp[ei] += (t - v.tLine) * v.k; rec.vAppN[ei] += v.k; }
            S.rec.vOn[ei]--; q.splice(j, 1); j--; v.i++; insertVeh(S, v, ne.i, 0);
          }
        }
      }
      if (win && queued * S.kVeh > rec.vMaxQ[ei]) rec.vMaxQ[ei] = queued * S.kVeh;
    }
    S.t += dt; if (S.t >= S.t1) S.done = true;
    if ((S.t | 0) % 60 === 0) S.vehs = S.vehs.filter((v) => v.onEdge >= 0 || v.dwell > 0);
  }
  function arrive(S, v) {
    const e = S.net.veh.edges[v.onEdge]; const win = inWin(S, S.t);
    if (win) { S.rec.vExit[v.onEdge] += v.k; S.rec.vDelay[v.onEdge] += Math.max(0, S.t - v.tEnter - (v.s / e.vff)) * v.k; }
    S.stats.vehDone++; S.stats.vehTime += S.t - v.t0;
    if (v.site && v.type === 'pudo') { S.stats.byType.sitePudoArr++; if (win) S.stats.site.pudo += v.k; }
    if (v.dest.dwell > 0) {
      v.dwell = v.dest.dwell;
      if (e.cls !== 'service' && v.type !== 'car') { // kerb stop on a street: one lane lost for the dwell (half capacity on a one-lane direction)
        S.rec.vOn[v.onEdge]--; (S.blocked[v.onEdge] = S.blocked[v.onEdge] || []).push(S.t + v.dwell); v.onEdge = -1; const vv = v; S.events.push({ t: S.t + v.dwell, fn: () => { vv.dwell = 0; finishDwell(S, vv); } }); S.events.sort((a, b) => a.t - b.t); return false;
      }
      return true; // alley (or a ramp gate): stays in the queue and holds the vehicles behind
    }
    S.rec.vOn[v.onEdge]--; v.onEdge = -1; return false;
  }
  function finishDwell(S, v) {
    if (v.onEdge >= 0) removeVeh(S, v);
    if (v.type === 'car') return;
    const g = v.dest.gen; if (!g || !v.dest.acc) return; const dm = S.dm; if (!dm.vOut.length) return;
    const gate = dm.vOut[S.rnd.weighted(dm.vOutCum)]; const tree = Net.vehTree(S.net, gate.node, 'to', S.scenario, S.rnd.int(3)); const ae = accessEdge(S, v.dest.acc, { tree, dir: 'to' }); if (!ae) return; const e = S.net.veh.edges[ae.edge]; if (!isFinite(tree.dist[e.b])) return;
    vehTrip(S, [ae.edge].concat(Net.vehPathTo(S.net, tree, e.b)), ae.s, null, { type: v.type, site: v.site, k: v.k });
  }

  function run(S, steps) { for (let i = 0; i < steps && !S.done; i++) step(S); return S.done; }
  const progress = (S) => G.clamp((S.t - (S.t0 - S.warm)) / (S.t1 - (S.t0 - S.warm)), 0, 1);

  /* positions for drawing: x, y, kind (0 walker, 1 site, 2 through, 3 lingering), group */
  function pedPositions(S) { const PE = S.net.ped.edges; const out = new Float32Array(S.peds.length * 4); let n = 0; for (const p of S.peds) { if (p.linger >= 0) { out[n++] = p.lx; out[n++] = p.ly; out[n++] = 3; out[n++] = p.g; continue; } const e = PE[p.e]; const s = p.dir === 1 ? p.s : e.L - p.s; const q = G.pointAt(e.poly, s); out[n++] = q[0]; out[n++] = q[1]; out[n++] = p.site ? 1 : p.kind === 'through' ? 2 : 0; out[n++] = p.g; } return out.subarray(0, n); }
  function vehPositions(S) { const VE = S.net.veh.edges; const out = new Float32Array(S.vehs.length * 4); let n = 0; const alive = []; for (const v of S.vehs) { if (v.onEdge < 0 && v.dwell <= 0) continue; alive.push(v); if (v.onEdge < 0) continue; const e = VE[v.onEdge]; const q = G.pointAt(e.poly, Math.min(e.L, v.s)); out[n++] = q[0]; out[n++] = q[1]; out[n++] = q[2]; out[n++] = v.type === 'truck' ? 3 : v.type === 'pudo' ? 2 : v.site ? 1 : 0; } S.vehs = alive; return out.subarray(0, n); }

  return { create, step, run, progress, pedPositions, vehPositions, phaseOf, greenFor, BIN };
})();
