/* Street Flow Lab · net.js — builds the vehicle graph (directed, signalised nodes) and the pedestrian graph (sidewalks, crossings,
   paths, doors) around a site from window.OSMS (OpenStreetMap ways / crossing nodes) and window.CITY (right-of-way widths).
   Everything in the data frame (metres). Pedestrian edges are undirected; vehicle edges are directed. */
window.Net = (() => {
  const G = window.Geom;
  const RANK = { motorway: 5, trunk: 4, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1, living_street: 0, service: 0, motorway_link: 3, trunk_link: 3, primary_link: 2, secondary_link: 2, tertiary_link: 1 };
  const DEF = { motorway: { lanes: 4, v: 90, row: 30, sw: 0 }, trunk: { lanes: 4, v: 60, row: 30, sw: 2.4 }, primary: { lanes: 4, v: 50, row: 24, sw: 4.5 }, secondary: { lanes: 4, v: 50, row: 24, sw: 4.0 }, tertiary: { lanes: 2, v: 50, row: 20, sw: 3.4 }, unclassified: { lanes: 2, v: 40, row: 20, sw: 3.0 }, residential: { lanes: 2, v: 40, row: 20, sw: 3.0 }, living_street: { lanes: 1, v: 20, row: 12, sw: 0 }, service: { lanes: 1, v: 20, row: 6, sw: 0 }, motorway_link: { lanes: 1, v: 60, row: 12, sw: 0 }, trunk_link: { lanes: 1, v: 50, row: 12, sw: 2 }, primary_link: { lanes: 1, v: 40, row: 12, sw: 2.4 }, secondary_link: { lanes: 1, v: 40, row: 12, sw: 2.4 }, tertiary_link: { lanes: 1, v: 40, row: 12, sw: 2.4 } };
  const WALK_HW = new Set(['footway', 'pedestrian', 'path', 'steps', 'cycleway', 'living_street']);
  const PED_V = 1.3; // m/s free walking speed
  const SAT = 1800;  // veh/h/lane saturation flow
  const EXPECTED_WAIT = { xsig: 20, xmark: 6, x: 9, xq: 4, none: 0 };
  const NICE = (n) => (window.Site ? Site.streetName(n) : n);

  function build(opts) {
    const { centre, R } = opts; const P = Object.assign({ sidewalkScale: 1, cycle: 80, seed: 7 }, opts.params || {});
    const rnd = G.rng(P.seed * 7919 + 11);
    const S = window.OSMS; if (!S) throw new Error('osm-streets.js not loaded');
    const inR = (p, r) => G.dist(p, centre) <= r;
    const ways = S.ways.filter((w) => w.p.some((p) => inR(p, R + 80)));
    const useV = new Map(), useP = new Map();
    const cnt = (m, id) => m.set(id, (m.get(id) || 0) + 1);
    const walkable = (w) => WALK_HW.has(w.hw) || (w.hw === 'service' && w.svc === 'alley');
    const drivable = (w) => RANK[w.hw] != null;
    for (const w of ways) { if (drivable(w)) for (const id of w.nodes) cnt(useV, id); if (walkable(w)) for (const id of w.nodes) cnt(useP, id); }

    /* ---------- vehicle graph ---------- */
    const veh = { nodes: [], edges: [], byOsm: new Map(), segs: [] };
    const vNode = (id, p) => { let i = veh.byOsm.get(id); if (i == null) { i = veh.nodes.length; veh.nodes.push({ i, x: p[0], y: p[1], osm: id, in: [], out: [], deg: 0, ctrl: 'none', sig: null, name: '' }); veh.byOsm.set(id, i); } return i; };
    for (const w of ways) {
      if (!drivable(w)) continue;
      const d = DEF[w.hw]; const lanesT = w.lanes || d.lanes; const perDir = w.ow ? lanesT : Math.max(1, Math.round(lanesT / 2));
      const vff = ((w.speed || d.v) / 3.6) * 0.85; let start = 0;
      for (let i = 1; i < w.nodes.length; i++) {
        const id = w.nodes[i]; const isV = i === w.nodes.length - 1 || (useV.get(id) || 0) >= 2;
        if (!isV) continue;
        const poly = w.p.slice(start, i + 1); if (poly.every((p) => !inR(p, R + 40))) { start = i; continue; }
        const L = G.polyLen(poly); if (L < 0.5) { start = i; continue; }
        const a = vNode(w.nodes[start], w.p[start]), b = vNode(id, w.p[i]);
        const seg = { i: veh.segs.length, a, b, poly, L, cls: w.hw, rank: RANK[w.hw], lanes: perDir, lanesT, vff, name: NICE(w.n || ''), ow: w.ow || 0, way: w.id, alley: w.hw === 'service', sw: w.sw, fwd: -1, rev: -1, onSite: false };
        veh.segs.push(seg);
        const mk = (A, B, pl) => { const e = { i: veh.edges.length, a: A, b: B, poly: pl, L, lanes: perDir, vff, cls: w.hw, rank: RANK[w.hw], name: seg.name, seg: seg.i, alive: true, phase: 0, cap: 0, onSite: false }; veh.edges.push(e); veh.nodes[A].out.push(e.i); veh.nodes[B].in.push(e.i); return e.i; };
        if (w.ow !== -1) seg.fwd = mk(a, b, poly);
        if (w.ow !== 1) seg.rev = mk(b, a, poly.slice().reverse());
        veh.nodes[a].deg++; veh.nodes[b].deg++;
        start = i;
      }
    }
    // signals: tagged nodes, a tagged node within 14 m, or two streets of rank >= 2 meeting
    const sigPts = []; for (const id in S.nodes) { const n = S.nodes[id]; if (n.k === 'sig' && inR([n.x, n.y], R + 60)) sigPts.push(n); }
    const sigGrid = new G.Grid(50); for (const n of sigPts) sigGrid.insert(n, [n.x, n.y, n.x, n.y]);
    const stopIds = new Set(); for (const id in S.nodes) if (S.nodes[id].k === 'stop') stopIds.add(Number(id));
    for (const n of veh.nodes) {
      const inc = [...n.in.map((i) => ({ e: veh.edges[i], out: false })), ...n.out.map((i) => ({ e: veh.edges[i], out: true }))];
      const segsAt = new Set(inc.map((x) => x.e.seg)); if (segsAt.size < 2) continue;
      // bearing leaving the node for each approach / departure
      for (const x of inc) { const pl = x.out ? x.e.poly : x.e.poly.slice().reverse(); const q = G.pointAt(pl, Math.min(12, x.e.L * 0.5)); x.bear = Math.atan2(q[1] - n.y, q[0] - n.x); }
      const ranks = inc.map((x) => x.e.rank); const maxR = Math.max(...ranks);
      const tagged = (S.nodes[n.osm] && S.nodes[n.osm].k === 'sig') || sigGrid.near([n.x, n.y], 14).some((s) => Math.hypot(s.x - n.x, s.y - n.y) <= 14);
      // split approaches into two axis groups around the highest-rank approach
      const ref = inc.reduce((b, x) => (x.e.rank > b.e.rank ? x : b), inc[0]);
      for (const x of inc) { const d = Math.abs(G.angDiff(x.bear, ref.bear)); x.grp = d < Math.PI / 4 || d > 3 * Math.PI / 4 ? 0 : 1; }
      const gA = inc.filter((x) => x.grp === 0), gB = inc.filter((x) => x.grp === 1);
      const rA = Math.max(...gA.map((x) => x.e.rank)), rB = gB.length ? Math.max(...gB.map((x) => x.e.rank)) : -1;
      const twoStreets = gB.length > 0;
      const names = [...new Set(inc.map((x) => x.e.name).filter(Boolean))]; if (names.length === 1 && inc.some((x) => x.e.cls === 'service')) names.push('lane'); n.name = names.join(' & ');
      if (!twoStreets) { n.ctrl = 'none'; continue; }
      const major = rA >= rB ? 0 : 1;
      for (const x of inc) x.e.phase = x.grp === major ? 0 : 1;
      n.axis = major === 0 ? ref.bear : gB[0].bear; // bearing of the major axis
      n.minorAxis = major === 0 ? (gB[0] ? gB[0].bear : ref.bear + Math.PI / 2) : ref.bear;
      if (tagged || (rA >= 2 && rB >= 2 && !(gA.concat(gB).every((x) => x.e.cls.endsWith('_link'))))) { n.ctrl = 'sig'; n.sig = { cycle: P.cycle, split: Math.abs(rA - rB) >= 1 ? 0.58 : 0.5, offset: Math.floor(rnd() * P.cycle), amber: 4 }; }
      else if (stopIds.has(n.osm) && rA === rB) n.ctrl = 'allstop';
      else n.ctrl = 'prio';
    }
    for (const e of veh.edges) { const nb = veh.nodes[e.b]; const gC = nb.ctrl === 'sig' ? (e.phase === 0 ? nb.sig.split : 1 - nb.sig.split) - nb.sig.amber / nb.sig.cycle : nb.ctrl === 'allstop' ? 0.45 : nb.ctrl === 'prio' ? (e.phase === 0 ? 0.92 : 0.4) : 1; e.cap = SAT * e.lanes * gC; e.tff = e.L / e.vff; }

    /* ---------- pedestrian graph ---------- */
    const ped = { nodes: [], edges: [], byOsm: new Map(), grid: new G.Grid(40) };
    const pNode = (p, kind, osm) => { if (osm != null) { const i = ped.byOsm.get(osm); if (i != null) return i; } const i = ped.nodes.length; ped.nodes.push({ i, x: p[0], y: p[1], kind: kind || 'n', adj: [], osm }); if (osm != null) ped.byOsm.set(osm, i); return i; };
    const pEdge = (a, b, props) => { const poly = props.poly || [[ped.nodes[a].x, ped.nodes[a].y], [ped.nodes[b].x, ped.nodes[b].y]]; const L = props.L != null ? props.L : G.polyLen(poly); const e = Object.assign({ i: ped.edges.length, a, b, poly, L, kind: 'path', w: 2.5, ctrl: 'none', sigNode: -1, sigPhase: 0, wait: 0, alive: true, onSite: false, frontage: false, synthetic: false, name: '', factor: 1 }, props); e.cost = cost(e); ped.edges.push(e); ped.nodes[a].adj.push(e.i); ped.nodes[b].adj.push(e.i); ped.grid.insert(e, G.bbox(poly)); return e; };
    const cost = (e) => (e.L / PED_V) * e.factor + e.wait;
    const vehSegGrid = new G.Grid(60); for (const s of veh.segs) vehSegGrid.insert(s, G.bbox(s.poly));
    const nearestStreet = (p, r) => { let best = null, bd = r; for (const s of vehSegGrid.near(p, r)) { const d = G.projPoly(p, s.poly).d; if (d < bd) { bd = d; best = s; } } return best; };
    const vehNodeGrid = new G.Grid(60); for (const n of veh.nodes) vehNodeGrid.insert(n, [n.x, n.y, n.x, n.y]);
    const sidewalkWidth = (cls) => Math.max(1.2, (DEF[cls] ? DEF[cls].sw : 2.4) * P.sidewalkScale - 1.0);
    const nodeOf = (id) => S.nodes[id];
    const crossingCtrl = (w) => { let k = 'x'; for (const id of w.nodes) { const n = nodeOf(id); if (!n) continue; if (n.k === 'xsig') return 'xsig'; if (n.k === 'xmark') k = 'xmark'; } return k; };
    const crossingStreet = (w) => { for (const id of w.nodes) { const i = veh.byOsm.get(id); if (i != null) return { node: i }; } for (const id of w.nodes) if (useV.has(id)) { const n = nodeOf(id); return { osm: id, n }; } return null; };
    for (const w of ways) {
      if (!walkable(w)) continue;
      const plaza = w.hw === 'pedestrian', alley = w.hw === 'service';
      let start = 0;
      for (let i = 1; i < w.nodes.length; i++) {
        const id = w.nodes[i]; const isV = i === w.nodes.length - 1 || (useP.get(id) || 0) >= 2 || (useV.get(id) || 0) >= 1 && w.fw === 'crossing' && false;
        if (!isV) continue;
        const poly = w.p.slice(start, i + 1); if (poly.every((p) => !inR(p, R + 40))) { start = i; continue; }
        const L = G.polyLen(poly); if (L < 0.3) { start = i; continue; }
        const a = pNode(w.p[start], 'n', w.nodes[start]), b = pNode(w.p[i], 'n', id);
        const props = { poly, L, osmWay: w.id, name: NICE(w.n || '') };
        if (w.fw === 'sidewalk') { const st = nearestStreet(G.pointAt(poly, L / 2), 16); props.kind = 'sidewalk'; props.w = sidewalkWidth(st ? st.cls : 'residential'); props.street = st ? st.i : -1; if (st && !props.name) props.name = st.name; }
        else if (w.fw === 'crossing') { props.kind = 'crossing'; props.w = 3.0; props.ctrl = crossingCtrl(w); const mid = G.pointAt(poly, L / 2); const st = nearestStreet(mid, 12); props.street = st ? st.i : -1; if (st) props.name = st.name; if (props.ctrl === 'x' && st && st.rank >= 3) props.ctrl = 'x'; else if (props.ctrl === 'x') props.ctrl = 'xq'; if (props.ctrl === 'xsig') { let best = null, bd = 30; for (const n of vehNodeGrid.near(mid, 30)) if (n.ctrl === 'sig') { const d = Math.hypot(n.x - mid[0], n.y - mid[1]); if (d < bd) { bd = d; best = n; } } if (best) { props.sigNode = best.i; const br = Math.atan2(mid[1] - best.y, mid[0] - best.x); const d = Math.abs(G.angDiff(br, best.axis)); props.sigPhase = d < Math.PI / 4 || d > 3 * Math.PI / 4 ? 0 : 1; } else props.ctrl = 'xmark'; } props.wait = EXPECTED_WAIT[props.ctrl] || 0; }
        else if (w.hw === 'steps') { props.kind = 'steps'; props.w = 2.0; props.factor = 1.8; }
        else if (plaza) { props.kind = 'plaza'; props.w = 6; }
        else if (alley) { props.kind = 'alley'; props.w = 3; props.factor = 1.25; }
        else if (w.hw === 'living_street') { props.kind = 'shared'; props.w = 4; }
        else if (w.hw === 'cycleway') { props.kind = 'path'; props.w = 3; props.factor = 1.05; }
        else { props.kind = 'path'; props.w = w.fw === 'traffic_island' ? 2.5 : 2.5; }
        pEdge(a, b, props);
        start = i;
      }
    }
    /* synthetic sidewalks where OSM has none */
    const hasSidewalkNear = (p, r) => ped.grid.near(p, r).some((e) => e.alive && (e.kind === 'sidewalk' || e.kind === 'plaza' || e.kind === 'shared') && G.projPoly(p, e.poly).d <= r);
    const corners = []; // synthetic sidewalk end nodes: {node, seg, end: 'a'|'b', side}
    for (const s of veh.segs) {
      if (s.cls === 'motorway' || s.cls === 'motorway_link' || s.sw === 'no' || (s.alley) || s.cls === 'living_street') continue;
      if (s.L < 6) continue;
      const row = (window.Site && Site.rowWidthAt(G.pointAt(s.poly, s.L / 2))) || DEF[s.cls].row; const swW = DEF[s.cls].sw || 2.4; const hw = G.clamp(row / 2 - swW / 2, 3.5, 16);
      for (const side of [1, -1]) {
        const Q = G.offsetPoly(s.poly, side * hw); const QL = G.polyLen(Q);
        let hits = 0; for (const f of [0.25, 0.5, 0.75]) if (hasSidewalkNear(G.pointAt(Q, QL * f), 7)) hits++;
        if (hits >= 2) continue; if (hits === 1 && QL < 40) continue;
        const set = Math.min(hw + 2, QL * 0.3); const [, rest] = G.splitPoly(Q, set); const [mid] = G.splitPoly(rest, G.polyLen(rest) - set);
        if (G.polyLen(mid) < 3) continue;
        const a = pNode(mid[0], 'c'), b = pNode(mid[mid.length - 1], 'c');
        pEdge(a, b, { poly: mid, kind: 'sidewalk', w: sidewalkWidth(s.cls), street: s.i, name: s.name, synthetic: true });
        corners.push({ node: a, seg: s.i, end: 'a', side }, { node: b, seg: s.i, end: 'b', side });
      }
    }
    // attach synthetic ends to whatever pedestrian edge is near; otherwise they wait for synthetic crossings / corners
    for (const c of corners) attachNode(ped, c.node, { maxD: 16, skipKinds: ['crossing'], linkKind: 'corner' });
    // synthetic crossings and corner links at vehicle nodes that have no mapped crossing nearby
    const crossGrid = new G.Grid(50); for (const e of ped.edges) if (e.kind === 'crossing') crossGrid.insert(e, G.bbox(e.poly));
    const nodeGrid = new G.Grid(40); for (const n of ped.nodes) nodeGrid.insert(n, [n.x, n.y, n.x, n.y]);
    for (const n of veh.nodes) {
      if (n.deg < 2) continue; const v = [n.x, n.y];
      if (crossGrid.near(v, 24).some((e) => G.projPoly(v, e.poly).d < 24)) continue;
      const segsAt = veh.segs.filter((s) => s.a === n.i || s.b === n.i); const maxHw = Math.max(...segsAt.map((s) => (DEF[s.cls].row || 12) / 2));
      const cluster = nodeGrid.near(v, maxHw + 12).filter((q) => q.kind === 'c' || (q.adj.some((ei) => ped.edges[ei].alive && ped.edges[ei].kind === 'sidewalk')));
      if (cluster.length < 2) continue;
      const arms = segsAt.map((s) => { const pl = s.a === n.i ? s.poly : s.poly.slice().reverse(); const q = G.pointAt(pl, Math.min(15, s.L * 0.6)); const br = Math.atan2(q[1] - v[1], q[0] - v[0]); return { s, br, u: [Math.cos(br), Math.sin(br)], nrm: [-Math.sin(br), Math.cos(br)] }; }).sort((p, q) => p.br - q.br);
      const sideOf = (arm, q) => { const dx = q.x - v[0], dy = q.y - v[1]; const al = dx * arm.u[0] + dy * arm.u[1], ac = dx * arm.nrm[0] + dy * arm.nrm[1]; if (al < -4 || al > maxHw + 14 || Math.abs(ac) < 1.5 || Math.abs(ac) > maxHw + 8) return 0; return ac > 0 ? 1 : -1; };
      const linked = (p, q) => ped.nodes[p].adj.some((ei) => { const e = ped.edges[ei]; return e.alive && (e.a === q || e.b === q); });
      for (const arm of arms) {
        if (arm.s.cls === 'motorway' || arm.s.cls === 'trunk' && arm.s.lanesT >= 4) continue;
        const left = cluster.filter((q) => sideOf(arm, q) === 1), right = cluster.filter((q) => sideOf(arm, q) === -1);
        let best = null, bd = Infinity; for (const l of left) for (const r of right) { const d = Math.hypot(l.x - r.x, l.y - r.y); if (d < bd) { bd = d; best = [l.i, r.i]; } }
        if (best && !linked(best[0], best[1])) { const ctrl = n.ctrl === 'sig' ? 'xsig' : n.ctrl === 'allstop' ? 'xmark' : arm.s.rank >= 3 ? 'x' : 'xq'; const d = Math.abs(G.angDiff(arm.br, n.axis || 0)); pEdge(best[0], best[1], { kind: 'crossing', w: 3, ctrl, wait: EXPECTED_WAIT[ctrl], sigNode: ctrl === 'xsig' ? n.i : -1, sigPhase: d < Math.PI / 4 || d > 3 * Math.PI / 4 ? 0 : 1, street: arm.s.i, name: arm.s.name, synthetic: true }); }
      }
      for (let k = 0; k < arms.length; k++) { const A = arms[k], B = arms[(k + 1) % arms.length]; const la = cluster.filter((q) => sideOf(A, q) === 1), rb = cluster.filter((q) => sideOf(B, q) === -1); let best = null, bd = 14; for (const l of la) for (const r of rb) { if (l.i === r.i) continue; const d = Math.hypot(l.x - r.x, l.y - r.y); if (d < bd) { bd = d; best = [l.i, r.i]; } } if (best && !linked(best[0], best[1])) pEdge(best[0], best[1], { kind: 'corner', w: 3, synthetic: true }); }
    }
    // still-dangling synthetic ends: try a wider attach
    for (const c of corners) if (ped.nodes[c.node].adj.filter((ei) => ped.edges[ei].alive).length < 2) attachNode(ped, c.node, { maxD: 30, skipKinds: [], linkKind: 'corner' });

    const net = { centre, R, params: P, veh, ped, gates: { ped: [], veh: [] }, trees: { ped: new Map(), vehTo: new Map(), vehFrom: new Map() }, attach: (p, o) => attach(net.ped, p, o), vehAccess: (p, o) => vehAccess(net, p, o) };
    computeGates(net);
    return net;
  }

  /* ---------- pedestrian attachments ---------- */
  function splitEdge(ped, e, s) {
    const [P1, P2] = G.splitPoly(e.poly, s); const m = P1[P1.length - 1];
    const mi = ped.nodes.length; ped.nodes.push({ i: mi, x: m[0], y: m[1], kind: 's', adj: [] });
    e.alive = false; ped.nodes[e.a].adj = ped.nodes[e.a].adj.filter((x) => x !== e.i); ped.nodes[e.b].adj = ped.nodes[e.b].adj.filter((x) => x !== e.i);
    const mk = (a, b, poly) => { const n = Object.assign({}, e, { i: ped.edges.length, a, b, poly, L: G.polyLen(poly), alive: true, parent: e.parent != null ? e.parent : e.i }); n.cost = (n.L / PED_V) * n.factor + n.wait; ped.edges.push(n); ped.nodes[a].adj.push(n.i); ped.nodes[b].adj.push(n.i); ped.grid.insert(n, G.bbox(poly)); return n; };
    mk(e.a, mi, P1); mk(mi, e.b, P2); return mi;
  }
  /* nearest alive pedestrian edge to p; returns the node to connect to (existing endpoint or a split point) */
  function nearestPedNode(ped, p, o) {
    const skip = new Set(o.skipKinds || ['crossing']); let best = null, bd = o.maxD || 40;
    for (const e of ped.grid.near(p, bd)) { if (!e.alive || skip.has(e.kind) || (o.exclude && o.exclude.has(e.i))) continue; const r = G.projPoly(p, e.poly); if (r.d < bd) { bd = r.d; best = { e, r }; } }
    if (!best) return -1;
    const { e, r } = best; if (r.s < 2.5) return e.a; if (e.L - r.s < 2.5) return e.b; return splitEdge(ped, e, r.s);
  }
  function attachNode(ped, ni, o) { const n = ped.nodes[ni]; const ex = new Set(n.adj); const t = nearestPedNode(ped, [n.x, n.y], Object.assign({}, o, { exclude: ex })); if (t < 0 || t === ni) return -1; if (n.adj.some((ei) => { const e = ped.edges[ei]; return e.alive && (e.a === t || e.b === t); })) return t; const L = Math.max(0.5, Math.hypot(ped.nodes[t].x - n.x, ped.nodes[t].y - n.y)); const e = { i: ped.edges.length, a: ni, b: t, poly: [[n.x, n.y], [ped.nodes[t].x, ped.nodes[t].y]], L, kind: o.linkKind || 'link', w: 3, ctrl: 'none', sigNode: -1, sigPhase: 0, wait: 0, alive: true, onSite: false, frontage: false, synthetic: true, name: '', factor: 1 }; e.cost = e.L / PED_V; ped.edges.push(e); n.adj.push(e.i); ped.nodes[t].adj.push(e.i); ped.grid.insert(e, G.bbox(e.poly)); return t; }
  /* a door at point p linked to the network: returns the door node index (or -1) */
  function attach(ped, p, o) { o = o || {}; const t = nearestPedNode(ped, p, Object.assign({ maxD: 45, skipKinds: ['crossing', 'steps'] }, o)); if (t < 0) return -1; const tn = ped.nodes[t]; const d = Math.hypot(tn.x - p[0], tn.y - p[1]); if (d < 1.0) { tn.kind = o.kind || 'door'; return t; } const di = ped.nodes.length; ped.nodes.push({ i: di, x: p[0], y: p[1], kind: o.kind || 'door', adj: [] }); const e = { i: ped.edges.length, a: di, b: t, poly: [[p[0], p[1]], [tn.x, tn.y]], L: d, kind: 'link', w: 3, ctrl: 'none', sigNode: -1, sigPhase: 0, wait: 0, alive: true, onSite: false, frontage: false, synthetic: true, name: '', factor: 1, cost: d / PED_V }; ped.edges.push(e); ped.nodes[di].adj.push(e.i); tn.adj.push(e.i); ped.grid.insert(e, G.bbox(e.poly)); return di; }
  /* a connection between two pedestrian nodes (e.g. a through-block walkway) */
  function link(ped, a, b, props) { const A = ped.nodes[a], B = ped.nodes[b]; const poly = [[A.x, A.y], [B.x, B.y]]; const e = Object.assign({ i: ped.edges.length, a, b, poly, L: G.polyLen(poly), kind: 'walkway', w: 4, ctrl: 'none', sigNode: -1, sigPhase: 0, wait: 0, alive: true, onSite: false, frontage: false, synthetic: true, name: '', factor: 1 }, props || {}); e.cost = (e.L / PED_V) * e.factor + e.wait; ped.edges.push(e); A.adj.push(e.i); B.adj.push(e.i); ped.grid.insert(e, G.bbox(poly)); return e; }

  /* ---------- vehicle access: nearest drivable segment (alleys first) ---------- */
  function vehAccess(net, p, o) {
    o = o || {}; const segs = net.veh.segs; let best = null, bd = Infinity;
    const scan = (pred, maxD) => { for (const s of segs) { if (!pred(s) || s.onSite) continue; const r = G.projPoly(p, s.poly); if (r.d < Math.min(bd, maxD)) { bd = r.d; best = { seg: s, s: r.s, d: r.d, x: r.x, y: r.y }; } } };
    if (o.preferAlley !== false) scan((s) => s.alley, o.alleyD || 45);
    if (!best) scan((s) => s.cls !== 'motorway' && s.cls !== 'trunk' && !s.cls.endsWith('_link'), o.maxD || 90);
    if (!best) scan(() => true, 150);
    return best;
  }

  /* ---------- scenario state, site marking ---------- */
  function markSite(net, ring, frontageEdges) {
    const G_ = G; const ped = net.ped, veh = net.veh;
    for (const e of ped.edges) { if (!e.alive) continue; const m = G_.pointAt(e.poly, e.L / 2); e.onSite = G_.pip([m[0], m[1]], ring) && !(e.kind === 'door' || e.kind === 'link' && e.site); }
    for (const s of veh.segs) { const m = G_.pointAt(s.poly, s.L / 2); s.onSite = G_.pip([m[0], m[1]], ring); if (s.onSite) { if (s.fwd >= 0) veh.edges[s.fwd].onSite = true; if (s.rev >= 0) veh.edges[s.rev].onSite = true; } }
    // frontage: sidewalk edges within the right-of-way beside a street edge of the parcel
    const fr = (frontageEdges || []).map((e) => ({ a: e.A, b: e.B }));
    for (const e of ped.edges) { if (!e.alive || e.kind !== 'sidewalk') continue; const m = G_.pointAt(e.poly, e.L / 2); e.frontage = fr.some((f) => G_.segDist([m[0], m[1]], f.a, f.b) < 9.5 && G_.proj([m[0], m[1]], f.a, f.b).t > 0.02 && G_.proj([m[0], m[1]], f.a, f.b).t < 0.98); }
    // nearby intersections
    const c = G_.centroid(ring); net.nearIx = veh.nodes.filter((n) => n.ctrl !== 'none' && n.deg >= 3 && G_.dist([n.x, n.y], c) < 140).map((n) => n.i);
  }
  /* gates: dead-end nodes at the edge of the study area (computed after the base network, kept through attachments) */
  function computeGates(net) {
    const { ped, veh } = net; const c = net.centre;
    for (const n of ped.nodes) n.adj = n.adj.filter((ei) => ped.edges[ei].alive);
    net.gates.ped = ped.nodes.filter((n) => n.adj.length === 1 && G.dist([n.x, n.y], c) > net.R - 2 && ped.edges[n.adj[0]].kind !== 'link' && ped.edges[n.adj[0]].kind !== 'corner').map((n) => n.i);
    net.gates.veh = veh.nodes.filter((n) => n.deg === 1 && G.dist([n.x, n.y], c) > net.R - 2).map((n) => n.i);
    for (const n of ped.nodes) n.gate = false; for (const i of net.gates.ped) ped.nodes[i].gate = true;
    for (const n of veh.nodes) n.gate = false; for (const i of net.gates.veh) veh.nodes[i].gate = true;
  }
  function finalize(net) {
    const { ped } = net;
    ped.alive = ped.edges.filter((e) => e.alive);
    for (const n of ped.nodes) n.adj = n.adj.filter((ei) => ped.edges[ei].alive);
    net.trees.ped.clear(); net.trees.vehTo.clear(); net.trees.vehFrom.clear();
    return net;
  }

  /* ---------- shortest-path trees ---------- */
  /* deterministic per-edge cost noise for route variants (variant 0 = exact shortest path) */
  const noise = (ei, variant, amp) => { if (!variant) return 1; let h = (ei * 2654435761 + variant * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15; return 1 + amp * ((h & 0xffff) / 32768 - 1); };
  function pedTree(net, root, scenario, variant, noSteps) {
    variant = variant || 0; const key = root + '|' + scenario + '|' + variant + (noSteps ? 'n' : ''); const cache = net.trees.ped; const hit = cache.get(key); if (hit) return hit;
    const ped = net.ped, N = ped.nodes.length; const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1); const h = new G.Heap(); dist[root] = 0; h.push(0, root);
    const blocked = (e) => !e.alive || (noSteps && e.kind === 'steps') || (scenario === 'proposed' ? (e.onSite && !e.keep) || e.offProposed : e.offBaseline);
    while (h.size) { const { key: d, val: u } = h.pop(); if (d > dist[u]) continue; for (const ei of ped.nodes[u].adj) { const e = ped.edges[ei]; if (blocked(e)) continue; const v = e.a === u ? e.b : e.a; const nd = d + e.cost * noise(ei, variant, 0.15); if (nd < dist[v]) { dist[v] = nd; prev[v] = ei; h.push(nd, v); } } }
    const t = { dist, prev }; if (cache.size > 500) cache.delete(cache.keys().next().value); cache.set(key, t); return t;
  }
  /* path (edge index list) from node n to the tree root, following prev */
  function pedPath(net, tree, n) { const out = []; let u = n; let guard = 0; while (tree.prev[u] >= 0 && guard++ < 5000) { const e = net.ped.edges[tree.prev[u]]; out.push(e.i); u = e.a === u ? e.b : e.a; } return out; }
  function vehTree(net, root, dir, scenario, variant) {
    variant = variant || 0; const cache = dir === 'to' ? net.trees.vehTo : net.trees.vehFrom; const key = root + '|' + scenario + '|' + variant; const hit = cache.get(key); if (hit) return hit;
    const veh = net.veh, N = veh.nodes.length; const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1); const h = new G.Heap(); dist[root] = 0; h.push(0, root);
    const blocked = (e) => !e.alive || (scenario === 'proposed' ? e.onSite : false);
    while (h.size) { const { key: d, val: u } = h.pop(); if (d > dist[u]) continue; const list = dir === 'to' ? veh.nodes[u].in : veh.nodes[u].out; for (const ei of list) { const e = veh.edges[ei]; if (blocked(e)) continue; const v = dir === 'to' ? e.a : e.b; const nd = d + (e.tff + (veh.nodes[e.b].ctrl === 'sig' ? 12 : veh.nodes[e.b].ctrl === 'none' ? 0 : e.phase ? 8 : 2)) * noise(ei, variant, 0.3); if (nd < dist[v]) { dist[v] = nd; prev[v] = ei; h.push(nd, v); } } }
    const t = { dist, prev }; if (cache.size > 600) cache.delete(cache.keys().next().value); cache.set(key, t); return t;
  }
  /* vehicle path from node a to gate root using a 'to' tree: edges in travel order */
  function vehPathTo(net, tree, a) { const out = []; let u = a; let g = 0; while (tree.prev[u] >= 0 && g++ < 5000) { const e = net.veh.edges[tree.prev[u]]; out.push(e.i); u = e.b; } return out; }
  /* vehicle path from root to node b using a 'from' tree */
  function vehPathFrom(net, tree, b) { const out = []; let u = b; let g = 0; while (tree.prev[u] >= 0 && g++ < 5000) { const e = net.veh.edges[tree.prev[u]]; out.push(e.i); u = e.a; } return out.reverse(); }

  return { build, markSite, finalize, attach, link, attachNode, vehAccess, pedTree, pedPath, vehTree, vehPathTo, vehPathFrom, RANK, DEF, PED_V, SAT };
})();
