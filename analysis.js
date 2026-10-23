/* Street Flow Lab · analysis.js — turns simulation records into levels of service, KPIs, scenario comparisons and walksheds.
   Pedestrian LOS: HCM average-flow sidewalk thresholds (p/min/m of effective width) on the peak 15-minute flow.
   Intersection LOS: HCM control-delay thresholds (signalised / unsignalised). Link LOS: volume-to-capacity ratio. */
window.Analysis = (() => {
  const G = window.Geom;
  const PED_LOS = [16, 23, 33, 49, 75]; // p/min/m upper bounds for A..E
  const SIG_LOS = [10, 20, 35, 55, 80], UNSIG_LOS = [10, 15, 25, 35, 50];
  const VC_LOS = [0.6, 0.7, 0.8, 0.9, 1.0];
  const grade = (v, th) => { for (let i = 0; i < th.length; i++) if (v <= th[i]) return i; return 5; };
  const LETTER = 'ABCDEF';

  function compute(S) {
    const net = S.net, rec = S.rec, B = S.stats.bins, H = (S.t1 - S.t0) / 3600;
    const PE = net.ped.edges, VE = net.veh.edges, VN = net.veh.nodes;
    const ped = { peak15: new Float32Array(PE.length), rate: new Float32Array(PE.length), los: new Int8Array(PE.length).fill(-1), hourly: new Float32Array(PE.length), dens: new Float32Array(PE.length), wait: new Float32Array(PE.length), maxDens: rec.pMax };
    for (const e of PE) { if (!e.alive) continue; let mx = 0, tot = 0; for (let b = 0; b < B; b++) { const v = rec.pFlow[e.i * B + b]; tot += v; if (v > mx) mx = v; } ped.peak15[e.i] = mx; ped.hourly[e.i] = tot / H; ped.rate[e.i] = mx / 15 / Math.max(0.8, e.w); ped.dens[e.i] = rec.pDens[e.i] / ((S.t1 - S.t0) * Math.max(1, e.L * e.w)); ped.los[e.i] = tot > 0 ? grade(ped.rate[e.i], PED_LOS) : 0; ped.wait[e.i] = rec.pWaitN[e.i] ? rec.pWaitSum[e.i] / rec.pWaitN[e.i] : 0; }
    const veh = { vol: new Float32Array(VE.length), vc: new Float32Array(VE.length), delay: new Float32Array(VE.length), los: new Int8Array(VE.length).fill(-1), maxQ: rec.vMaxQ, blocked: new Float32Array(VE.length), appDelay: new Float32Array(VE.length) };
    for (const e of VE) { if (!e.alive) continue; let tot = 0; for (let b = 0; b < B; b++) tot += rec.vVol[e.i * B + b]; veh.vol[e.i] = tot / H; veh.vc[e.i] = e.cap ? veh.vol[e.i] / e.cap : 0; veh.delay[e.i] = rec.vExit[e.i] ? rec.vDelay[e.i] / rec.vExit[e.i] : 0; veh.los[e.i] = tot > 0 ? grade(veh.vc[e.i], VC_LOS) : 0; veh.blocked[e.i] = rec.vBlocked[e.i] / (S.t1 - S.t0); veh.appDelay[e.i] = rec.vAppN[e.i] ? rec.vApp[e.i] / rec.vAppN[e.i] : 0; }
    const nodes = { delay: new Float32Array(VN.length), los: new Int8Array(VN.length).fill(-1), vol: new Float32Array(VN.length) };
    for (const n of VN) { if (n.ctrl === 'none' && n.deg < 3) continue; let d = 0, k = 0; for (const ei of n.in) { d += rec.vApp[ei]; k += rec.vAppN[ei]; } nodes.delay[n.i] = k ? d / k : 0; nodes.vol[n.i] = k / H; nodes.los[n.i] = k ? grade(nodes.delay[n.i], n.ctrl === 'sig' ? SIG_LOS : UNSIG_LOS) : 0; }
    const res = { scenario: S.scenario, H, ped, veh, nodes, stats: S.stats, kPed: S.kPed, kVeh: S.kVeh, t0: S.t0, t1: S.t1 };
    res.people = people(S);
    res.kpi = kpis(S, res);
    return res;
  }

  /* who is on the frontage, who the site generates, who occupies its public spaces */
  function people(S) {
    const groups = S.dm.gt.groups, NG = groups.length, B = S.stats.bins, H = (S.t1 - S.t0) / 3600;
    const label = (b) => { const t = S.t0 + b * Sim.BIN; return `${Math.floor(t / 3600)}:${String(Math.round((t % 3600) / 60)).padStart(2, '0')}`; };
    const rows = (arr, scale) => { const out = []; for (let b = 0; b < B; b++) { const r = { h: label(b), b }; groups.forEach((g, i) => { r[g.id] = arr[b * NG + i] * (scale || 1); }); out.push(r); } return out; };
    const tot = (arr) => { const t = {}; groups.forEach((g, i) => { let v = 0; for (let b = 0; b < B; b++) v += arr[b * NG + i]; t[g.id] = v / H; }); return t; };
    const spaces = S.spaces.map((sp) => { const occ = []; for (let b = 0; b < B; b++) { const r = { h: label(b), b }; groups.forEach((g, i) => { r[g.id] = sp.occInt[b * NG + i] / Sim.BIN; }); occ.push(r); } const visits = {}; let vt = 0; groups.forEach((g, i) => { visits[g.id] = sp.visits[i] / H; vt += sp.visits[i]; }); let top = null; groups.forEach((g, i) => { if (!top || sp.visits[i] > sp.visits[top.i]) top = { i, id: g.id, label: g.label }; }); return { name: sp.name, type: sp.type, cap: sp.cap, peak: sp.peak, occ, visits, visitsTotal: vt / H, dwell: sp.dwellN ? sp.dwellSum / sp.dwellN / 60 : 0, top: vt ? top : null }; });
    const occAll = []; for (let b = 0; b < B; b++) { const r = { h: label(b), b }; groups.forEach((g) => { r[g.id] = 0; }); for (const sp of spaces) groups.forEach((g) => { r[g.id] += sp.occ[b][g.id]; }); occAll.push(r); }
    return { groups, front: rows(S.rec.frontGroup, 4), frontTotal: tot(S.rec.frontGroup), site: rows(S.rec.siteGroup, 4), siteTotal: tot(S.rec.siteGroup), spaces, occAll, peakOcc: Math.max(0, ...spaces.map((x) => x.peak)), capacity: spaces.reduce((a, x) => a + x.cap, 0) };
  }
  function kpis(S, res) {
    const net = S.net, st = S.stats.site, H = res.H; const PE = net.ped.edges, VE = net.veh.edges, VN = net.veh.nodes;
    const K = {};
    K.pedIn = st.pedIn / H; K.pedOut = st.pedOut / H; K.vehIn = st.vehIn / H; K.vehOut = st.vehOut / H; K.pudo = st.pudo / H; K.truck = st.truck / H; K.frontagePass = st.frontagePass / H;
    const fr = PE.filter((e) => e.alive && e.frontage); K.frontageEdges = fr.length;
    K.frontageRate = fr.length ? Math.max(...fr.map((e) => res.ped.rate[e.i])) : 0; K.frontageLOS = grade(K.frontageRate, PED_LOS);
    K.frontageMean = fr.length ? fr.reduce((s, e) => s + res.ped.hourly[e.i], 0) / fr.length : 0;
    const c = net.centre; const near = (e, r) => { const m = G.pointAt(e.poly, e.L / 2); return G.dist([m[0], m[1]], c) <= r; };
    const sw = PE.filter((e) => e.alive && (e.kind === 'sidewalk' || e.kind === 'plaza') && near(e, 200)); K.sidewalksNear = sw.length;
    K.worstSidewalk = sw.length ? sw.reduce((b, e) => (res.ped.rate[e.i] > res.ped.rate[b.i] ? e : b)) : null; K.worstSidewalkRate = K.worstSidewalk ? res.ped.rate[K.worstSidewalk.i] : 0; K.worstSidewalkLOS = grade(K.worstSidewalkRate, PED_LOS);
    K.losCount = [0, 0, 0, 0, 0, 0]; for (const e of sw) K.losCount[res.ped.los[e.i]]++;
    // street stress: the peak 15-min sidewalk rate each pedestrian meets, averaged over everyone on sidewalks within 200 m (flow-weighted, p/min/m); comparative only
    let sQ = 0, sQq = 0; for (const e of sw) { const Q = res.ped.hourly[e.i]; sQ += Q; sQq += Q * res.ped.rate[e.i]; } K.stress = sQ ? sQq / sQ : 0;
    const xs = PE.filter((e) => e.alive && e.kind === 'crossing' && near(e, 120)); K.crossings = xs.length; K.crossingFlow = xs.reduce((s, e) => s + res.ped.hourly[e.i], 0); K.crossingWait = xs.length ? xs.reduce((s, e) => s + res.ped.wait[e.i] * res.ped.hourly[e.i], 0) / Math.max(1, K.crossingFlow) : 0;
    K.busiestCrossing = xs.length ? xs.reduce((b, e) => (res.ped.hourly[e.i] > res.ped.hourly[b.i] ? e : b)) : null;
    const ix = (net.nearIx || []).map((i) => VN[i]); K.intersections = ix.map((n) => ({ i: n.i, name: n.name, ctrl: n.ctrl, delay: res.nodes.delay[n.i], los: res.nodes.los[n.i], vol: res.nodes.vol[n.i] }));
    K.ixWorst = K.intersections.length ? Math.max(...K.intersections.map((x) => x.delay)) : 0; K.ixMean = K.intersections.length ? K.intersections.reduce((s, x) => s + x.delay * x.vol, 0) / Math.max(1, K.intersections.reduce((s, x) => s + x.vol, 0)) : 0;
    const links = VE.filter((e) => e.alive && near(e, 300) && res.veh.vol[e.i] > 0); K.links = links.length; K.linksOver = links.filter((e) => res.veh.vc[e.i] >= 0.9).length; K.vcMax = links.length ? Math.max(...links.map((e) => res.veh.vc[e.i])) : 0;
    K.vehDelayHours = VE.reduce((s, e) => s + (e.alive ? S.rec.vDelay[e.i] : 0), 0) / 3600 / H; // vehicle-hours of delay per hour in the area
    const alley = VE.filter((e) => e.alive && e.cls === 'service' && near(e, 90)); K.alleyBlocked = alley.length ? Math.max(...alley.map((e) => Math.max(res.veh.blocked[e.i], S.rec.vMaxQ[e.i] > 0 && res.veh.delay[e.i] > 60 ? Math.min(1, res.veh.delay[e.i] / 900) : 0))) : 0;
    K.heldOutside = (S.backlog ? S.backlog.length : 0) * S.kVeh;
    K.pedTripTime = S.stats.pedDone ? S.stats.pedTime / S.stats.pedDone : 0; K.pedWaitShare = S.stats.pedTime ? S.stats.pedWait / S.stats.pedTime : 0; K.vehTripTime = S.stats.vehDone ? S.stats.vehTime / S.stats.vehDone : 0;
    K.pedTrips = S.stats.pedTrips * S.kPed / ((S.t1 - S.t0 + S.warm) / 3600); K.vehTrips = S.stats.vehTrips * S.kVeh / ((S.t1 - S.t0 + S.warm) / 3600); K.unroutable = S.stats.unroutable;
    return K;
  }

  /* per-edge / node change between two results */
  function compare(base, prop) {
    const n = prop.ped.rate.length; const dPed = new Float32Array(n), dPedLos = new Int8Array(n); for (let i = 0; i < n; i++) { dPed[i] = prop.ped.hourly[i] - base.ped.hourly[i]; dPedLos[i] = prop.ped.los[i] - base.ped.los[i]; }
    const m = prop.veh.vol.length; const dVeh = new Float32Array(m), dVc = new Float32Array(m), dDelay = new Float32Array(m); for (let i = 0; i < m; i++) { dVeh[i] = prop.veh.vol[i] - base.veh.vol[i]; dVc[i] = prop.veh.vc[i] - base.veh.vc[i]; dDelay[i] = prop.veh.delay[i] - base.veh.delay[i]; }
    const k = prop.nodes.delay.length; const dNode = new Float32Array(k); for (let i = 0; i < k; i++) dNode[i] = prop.nodes.delay[i] - base.nodes.delay[i];
    const worse = [], worseBad = []; for (let i = 0; i < n; i++) if (dPedLos[i] > 0) { worse.push(i); if (prop.ped.los[i] >= 3) worseBad.push(i); }
    let linksWorse = 0; for (let i = 0; i < m; i++) if (prop.veh.vc[i] >= 0.9 && base.veh.vc[i] < 0.9) linksWorse++;
    return { dPed, dPedLos, dVeh, dVc, dDelay, dNode, worseSidewalks: worse.length, worseIdx: worse, worseIntoDEF: worseBad.length, linksWorse };
  }
  /* compass octant of a point seen from the site centre, to tell two segments of one street apart */
  const octant = (p, c) => { const a = Math.atan2(p[1] - c[1], p[0] - c[0]); const k = Math.round(((a / Math.PI) * 4 + 8) % 8); return ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'][k]; };

  /* walkshed from a node: time-limited Dijkstra; returns reach stats */
  function walkshed(net, dm, root, scenario, seconds, opts) {
    opts = opts || {}; const tree = Net.pedTree(net, root, scenario, 0, !!opts.noSteps); seconds = seconds * ((opts.speed || Net.PED_V) / Net.PED_V); const nodes = net.ped.nodes; const pts = []; const reach = new Uint8Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) if (tree.dist[i] <= seconds) { reach[i] = 1; pts.push([nodes[i].x, nodes[i].y]); }
    const hull = pts.length >= 3 ? hullOf(pts) : pts; const area = hull.length >= 3 ? Math.abs(G.ringArea(hull)) : 0;
    const got = { res: 0, jobs: 0, retail: 0, gfa: 0, parks: 0, stops: { skytrain: null, bus: null, ferry: null }, buildings: 0 };
    for (const g of dm.gens) { if (!g.doors.length) continue; const d = Math.min(...g.doors.map((x) => tree.dist[x.node])); if (!isFinite(d)) continue; if (g.kind === 'stop') { const cur = got.stops[g.stopType]; if (cur === null || cur === undefined ? true : d < cur) got.stops[g.stopType] = d; continue; } if (d > seconds) continue; if (g.kind === 'park') { got.parks++; continue; } if (g.kind !== 'ctx') continue; got.buildings++; for (const u in g.uses) { got.gfa += g.uses[u]; if (u === 'residential') got.res += g.uses[u] / Demand.USES.residential.unit; else if (Demand.USES[u] && Demand.USES[u].unit && u !== 'hotel') got.jobs += g.uses[u] / Demand.USES[u].unit; if (u === 'retail' || u === 'restaurant') got.retail += g.uses[u]; } }
    return { reach, hull, area, got, tree };
  }
  function hullOf(pts) { const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } up.pop(); lo.pop(); return lo.concat(up); }

  /* catchment: who can walk TO the site within n seconds (uses the same tree, undirected graph) */
  function catchment(ws, dm) { return ws.got; }

  /* table rows for the Results tab */
  function sidewalkRows(net, base, prop, limitR) { const c = net.centre; const rows = []; for (const e of net.ped.edges) { if (!e.alive || (e.kind !== 'sidewalk' && e.kind !== 'plaza' && e.kind !== 'crossing')) continue; const m = G.pointAt(e.poly, e.L / 2); if (G.dist([m[0], m[1]], c) > limitR) continue; if ((base ? base.ped.hourly[e.i] : 0) + prop.ped.hourly[e.i] <= 0) continue; rows.push({ i: e.i, name: e.name || e.kind, dir: octant(m, c), kind: e.kind, frontage: e.frontage, w: e.w, base: base ? base.ped.hourly[e.i] : null, prop: prop.ped.hourly[e.i], baseRate: base ? base.ped.rate[e.i] : null, rate: prop.ped.rate[e.i], baseLos: base ? base.ped.los[e.i] : null, los: prop.ped.los[e.i], wait: prop.ped.wait[e.i] }); } rows.sort((a, b) => b.prop - a.prop); return rows; }
  function linkRows(net, base, prop, limitR) { const c = net.centre; const rows = []; for (const e of net.veh.edges) { if (!e.alive) continue; const m = G.pointAt(e.poly, e.L / 2); if (G.dist([m[0], m[1]], c) > limitR) continue; if ((base ? base.veh.vol[e.i] : 0) + prop.veh.vol[e.i] <= 0) continue; rows.push({ i: e.i, name: e.name || e.cls, cls: e.cls, lanes: e.lanes, cap: e.cap, base: base ? base.veh.vol[e.i] : null, prop: prop.veh.vol[e.i], baseVc: base ? base.veh.vc[e.i] : null, vc: prop.veh.vc[e.i], delay: prop.veh.delay[e.i], baseDelay: base ? base.veh.delay[e.i] : null, maxQ: prop.veh.maxQ[e.i], blocked: prop.veh.blocked[e.i], los: prop.veh.los[e.i], baseLos: base ? base.veh.los[e.i] : null }); } rows.sort((a, b) => b.vc - a.vc); return rows; }

  return { compute, compare, walkshed, catchment, sidewalkRows, linkRows, grade, LETTER, PED_LOS, SIG_LOS, UNSIG_LOS, VC_LOS };
})();
