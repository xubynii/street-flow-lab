/* Street Flow Lab · site.js — parcels, the site frame (identical to the Downtown Massing Tool so its projects import 1:1),
   context buildings, parks and street names from window.CITY / window.OSM. Data frame: metres, origin -123.118 / 49.283, x east, y north. */
window.Site = (() => {
  const G = window.Geom;
  const D = () => window.CITY;
  const available = () => !!window.CITY;

  function parcelAt(pt) { const P = D().parcels; for (let i = 0; i < P.length; i++) if (G.pip(pt, P[i].p)) return i; return -1; }
  function search(q) { const s = q.trim().toUpperCase(); if (!s) return []; const P = D().parcels, out = []; for (let i = 0; i < P.length && out.length < 12; i++) if (P[i].a && P[i].a.toUpperCase().includes(s)) out.push({ i, a: P[i].a }); for (const n of D().notable || []) if (n.n.toUpperCase().includes(s) && out.length < 12) { const f = D().foot[n.f[0]]; const c = f ? G.centroid(f.p) : null; const i = c ? parcelAt(c) : -1; if (i >= 0) out.push({ i, a: `${n.n} · ${P[i].a}` }); } return out; }

  /* the frame: x along the front edge, y into the lot (ported from the massing tool) */
  function frame(ring, frontIdx) {
    const P0 = ring[frontIdx], P1 = ring[(frontIdx + 1) % ring.length];
    let dir = [P1[0] - P0[0], P1[1] - P0[1]]; const L = Math.hypot(dir[0], dir[1]); dir = [dir[0] / L, dir[1] / L];
    let nrm = [-dir[1], dir[0]];
    const c = G.centroid(ring); if ((c[0] - P0[0]) * nrm[0] + (c[1] - P0[1]) * nrm[1] < 0) { dir = [-dir[0], -dir[1]]; nrm = [-nrm[0], -nrm[1]]; }
    const f = { P0, dir, nrm, off: [0, 0] };
    const loc = ring.map((q) => toLocal(q, f)); const bb = G.bbox(loc); f.off = [bb[0], bb[1]];
    return f;
  }
  const toLocal = (q, f) => [(q[0] - f.P0[0]) * f.dir[0] + (q[1] - f.P0[1]) * f.dir[1] - f.off[0], (q[0] - f.P0[0]) * f.nrm[0] + (q[1] - f.P0[1]) * f.nrm[1] - f.off[1]];
  const fromLocal = (p, f) => { const x = p[0] + f.off[0], y = p[1] + f.off[1]; return [f.P0[0] + x * f.dir[0] + y * f.nrm[0], f.P0[1] + x * f.dir[1] + y * f.nrm[1]]; };

  function ringOf(idx) { const ring = D().parcels[idx].p.slice(); if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop(); return ring; }
  /* street / lane / neighbour classification of each parcel edge */
  function edgeKinds(ring) {
    const d = D(), out = [];
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; let best = null, bd = 22;
      for (const s of d.streets) for (let k = 0; k < s.p.length - 1; k++) { const dd = G.segDist(m, s.p[k], s.p[k + 1]); if (dd < bd) { bd = dd; best = s; } }
      if (best) { out.push({ i, kind: 's', name: best.n || '', cls: best.u }); continue; }
      let lane = false; for (const l of d.lanes) { for (let k = 0; k < l.length - 1 && !lane; k++) if (G.segDist(m, l[k], l[k + 1]) < 9) lane = true; if (lane) break; }
      out.push({ i, kind: lane ? 'l' : 'x', name: '' }); }
    return out;
  }
  function zoneAt(pt) { for (const z of D().zones) if (G.pip(pt, z.p)) return z.z; return null; }
  const streetName = (n) => (n || '').replace(/^\d+(-\d+)?\s+/, '').replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()).replace(/\bSt\b/, 'St').replace(/\bAve\b/, 'Ave');

  function siteFromParcel(idx, frontIdx) {
    const rec = D().parcels[idx]; const ring = ringOf(idx);
    const kinds = edgeKinds(ring), elen = (i) => G.dist(ring[i], ring[(i + 1) % ring.length]);
    const streets = kinds.filter((e) => e.kind === 's');
    let fe = frontIdx; if (fe == null) fe = streets.length ? streets.reduce((b, e) => (elen(e.i) > elen(b.i) ? e : b)).i : 0;
    const f = frame(ring, fe), loc = ring.map((q) => toLocal(q, f)), bb = G.bbox(loc), c = G.centroid(ring);
    const edges = ring.map((p, i) => { const k = kinds[i]; return { i, kind: k.kind, name: k.name, label: k.kind === 's' ? streetName(k.name) : k.kind === 'l' ? 'Lane' : 'Neighbour', cls: k.cls || null, a: loc[i], b: loc[(i + 1) % loc.length], A: ring[i], B: ring[(i + 1) % ring.length], len: elen(i), front: i === fe }; });
    return { addr: rec.a, parcelIndex: idx, ring, poly: loc, edges, frame: f, w: bb[2] - bb[0], d: bb[3] - bb[1], area: Math.abs(G.ringArea(loc)), zone: zoneAt(c), centre: c, streets: [...new Set(streets.map((e) => streetName(e.name)))] };
  }
  /* the massing tool's frame for an imported project (its site.edges carry the front flag) */
  function frameForImport(siteIn) { const idx = siteIn.parcelIndex; if (idx == null || !D().parcels[idx]) return null; const ring = ringOf(idx); const fe = siteIn.edges ? siteIn.edges.findIndex((e) => e.front) : 0; return frame(ring, Math.max(0, fe)); }

  /* ---------- context ---------- */
  const useGuess = (poly, h, zone, nearArterial) => { // rough use mix of an existing building from zoning + shape
    const A = Math.abs(G.ringArea(poly)); const z = zone || '';
    if (/^(RM|RS|RT|FM)/.test(z)) return { residential: 1 };
    if (/^(C-|HA|M-|MC|IC|FC)/.test(z)) return h >= 30 ? { residential: 0.55, office: 0.25, retail: 0.2 } : { retail: 0.45, office: 0.35, residential: 0.2 };
    if (h >= 45 && A < 1100) return { residential: 0.9, retail: 0.1 };
    if (A >= 1100 && h >= 30) return { office: 0.8, retail: 0.12, restaurant: 0.08 };
    if (h < 14) return nearArterial ? { retail: 0.6, restaurant: 0.25, office: 0.15 } : { office: 0.5, retail: 0.3, residential: 0.2 };
    return { residential: 0.45, office: 0.35, retail: 0.12, restaurant: 0.08 };
  };
  function buildingsNear(centre, R, excludeRing) {
    const d = D(), out = []; const within = (p) => G.dist(p, centre) <= R;
    const inSite = (poly) => excludeRing && G.pip(G.centroid(poly), excludeRing);
    const streetGrid = new G.Grid(100); for (const s of d.streets) if (s.u !== 'Residential') for (let k = 0; k < s.p.length - 1; k++) streetGrid.insert({ a: s.p[k], b: s.p[k + 1] }, G.bbox([s.p[k], s.p[k + 1]]));
    const nearArt = (c) => streetGrid.near(c, 40).some((e) => G.segDist(c, e.a, e.b) < 40);
    const push = (poly, h, z0, src, name, lv) => { const c = G.centroid(poly); if (!within(c) || inSite(poly)) return; const A = Math.abs(G.ringArea(poly)); if (A < 20) return; const zone = zoneAt(c); const levels = lv || Math.max(1, Math.round((h - (z0 || 0)) / 3.3)); const gfa = A * levels * 0.85; out.push({ poly, h: h || 10, z0: z0 || 0, src, name, area: A, levels, gfa, zone, uses: useGuess(poly, h || 10, zone, nearArt(c)), centre: c }); };
    if (window.OSM) {
      const near = window.OSM.b.filter((b) => b.p.some(within) || within(G.centroid(b.p)));
      const wholes = near.filter((b) => !b.part), parts = near.filter((b) => b.part);
      for (const b of wholes) { if (parts.some((pc) => G.pip(G.centroid(pc.p), b.p))) continue; let h = b.h; if (!h) { const cb = G.centroid(b.p); const cf = d.foot.find((f) => G.pip(cb, f.p)); h = cf ? cf.h : 10; } push(b.p, h, 0, 'osm', b.n, b.lv); }
      // parts: keep only the ground-touching part per building to avoid double counting floor area; others add to GFA of nearest ground part
      for (const b of parts) if (!b.z0) push(b.p, b.h || 10, 0, 'osm-part', b.n, b.lv);
      for (const b of parts) if (b.z0) { const c = G.centroid(b.p); const host = out.find((o) => o.src === 'osm-part' && G.pip(c, o.poly)) || out.find((o) => G.pip(c, o.poly)); if (host) { const lv = b.lv || Math.max(1, Math.round(((b.h || b.z0 + 3) - b.z0) / 3.3)); host.gfa += Math.abs(G.ringArea(b.p)) * lv * 0.85; host.h = Math.max(host.h, b.h || 0); } }
      for (const cf of d.foot) { const cb = G.centroid(cf.p); if (!within(cb)) continue; if (near.some((b) => G.pip(cb, b.p))) continue; push(cf.p, cf.h, 0, 'city'); }
    } else for (const cf of d.foot) push(cf.p, cf.h, 0, 'city');
    return out;
  }
  function existingOnParcel(ring) { const d = D(); const res = []; const seen = []; if (window.OSM) for (const b of window.OSM.b) { if (b.part) continue; const c = G.centroid(b.p); if (G.pip(c, ring)) { res.push({ poly: b.p, h: b.h || 10, name: b.n, lv: b.lv }); seen.push(b.p); } } for (const cf of d.foot) { const c = G.centroid(cf.p); if (G.pip(c, ring) && !seen.some((p) => G.pip(c, p))) res.push({ poly: cf.p, h: cf.h }); } return res; }
  function parksNear(centre, R) { return (D().parks || []).filter((p) => p.p.some((q) => G.dist(q, centre) <= R)); }
  function streetsNear(centre, R) { return D().streets.filter((s) => s.p.some((q) => G.dist(q, centre) <= R + 60)); }
  function rowWidthAt(p) { let best = null, bd = 40; for (const r of D().row) { const dd = Math.hypot(r[0] - p[0], r[1] - p[1]); if (dd < bd) { bd = dd; best = r[2]; } } return best; }
  return { available, parcelAt, search, frame, toLocal, fromLocal, siteFromParcel, frameForImport, buildingsNear, existingOnParcel, parksNear, streetsNear, rowWidthAt, zoneAt, streetName, ringOf, edgeKinds };
})();
