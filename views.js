/* Street Flow Lab · views.js — the map canvas: context, site, massing, networks, agents and analysis overlays. */
window.Views = (() => {
  const G = window.Geom;
  const V = { cv: null, ctx: null, scale: 1.2, cx: 0, cy: 0, w: 0, h: 0, dpr: 1, hover: null, sel: null, onSelect: null, onHover: null, onPick: null, getState: null, needs: true, picking: false };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const USE_FILL = { residential: '--res', hotel: '--hotel', office: '--office', retail: '--retail', restaurant: '--restaurant', amenity: '--amenity', parking: '--parking', core: '--core', school: '--amenity' };
  const USE_LINE = { residential: '--res-line', hotel: '--hotel-line', office: '--office-line', retail: '--retail-line', restaurant: '--restaurant-line', amenity: '--amenity-line', parking: '--parking-line', core: '--core-line', school: '--amenity-line' };

  function mount(cv) {
    V.cv = cv; V.ctx = cv.getContext('2d'); resize(); addEventListener('resize', () => { resize(); V.needs = true; });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: V.cx, cy: V.cy, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => { if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; V.cx = drag.cx - dx / V.scale; V.cy = drag.cy + dy / V.scale; V.needs = true; return; } const m = toModel(e); const h = pick(m); if (hoverKey(h) !== hoverKey(V.hover)) { V.hover = h; V.needs = true; } if (V.onHover) V.onHover(h, e); });
    cv.addEventListener('pointerup', (e) => { if (drag && !drag.moved) { const m = toModel(e); if (V.picking && V.onPick) V.onPick(m); else { V.sel = pick(m); if (V.onSelect) V.onSelect(V.sel, m); } V.needs = true; } drag = null; });
    cv.addEventListener('pointerleave', () => { V.hover = null; V.needs = true; if (V.onHover) V.onHover(null); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const m = toModel(e); const f = Math.exp(-e.deltaY * 0.0012); const ns = G.clamp(V.scale * f, 0.15, 14); V.cx = m[0] - (m[0] - V.cx) * V.scale / ns; V.cy = m[1] - (m[1] - V.cy) * V.scale / ns; V.scale = ns; V.needs = true; }, { passive: false });
    requestAnimationFrame(loop);
  }
  const hoverKey = (h) => (h ? h.type + ':' + h.i : '');
  function resize() { const r = V.cv.getBoundingClientRect(); V.dpr = Math.min(2, devicePixelRatio || 1); V.w = r.width; V.h = r.height; V.cv.width = Math.round(r.width * V.dpr); V.cv.height = Math.round(r.height * V.dpr); }
  const toScreen = (x, y) => [V.w / 2 + (x - V.cx) * V.scale, V.h / 2 - (y - V.cy) * V.scale];
  const toModel = (e) => { const r = V.cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; return [V.cx + (sx - V.w / 2) / V.scale, V.cy - (sy - V.h / 2) / V.scale]; };
  function fit(centre, R) { V.cx = centre[0]; V.cy = centre[1]; V.scale = Math.min(V.w, V.h) / (2 * R * 1.08); V.needs = true; }
  function loop() { if (V.needs || (V.getState && V.getState().live)) { V.needs = false; try { draw(); } catch (err) { console.error(err); } } requestAnimationFrame(loop); }

  /* ---------- picking ---------- */
  function pick(m) {
    const st = V.getState ? V.getState() : null; if (!st || !st.net) return null; const tol = Math.max(2.5, 7 / V.scale);
    let best = null, bd = tol;
    if (st.net.veh && st.mode !== 'pedLos' && st.mode !== 'walkshed') { for (const n of st.net.veh.nodes) { if (n.ctrl === 'none' && n.deg < 3) continue; const d = Math.hypot(n.x - m[0], n.y - m[1]); if (d < bd + 2) { bd = d; best = { type: 'node', i: n.i }; } } }
    for (const e of st.net.ped.grid.near(m, tol)) { if (!e.alive || e.kind === 'link') continue; const d = G.projPoly(m, e.poly).d; if (d < bd) { bd = d; best = { type: 'ped', i: e.i }; } }
    if (st.mode !== 'pedLos' && st.mode !== 'walkshed') for (const s of st.net.veh.segs) { if (s.onSite && st.scenario === 'proposed') continue; const d = G.projPoly(m, s.poly).d; if (d < bd + 1.5 && d < tol + 2) { bd = d; best = { type: 'veh', i: s.i }; } }
    if (!best && st.gens) for (const g of st.gens) { if (g.kind !== 'ctx' || !g.poly) continue; if (G.pip(m, g.poly)) return { type: 'gen', i: g.id }; }
    if (!best && st.site && G.pip(m, st.site.ring)) return { type: 'site', i: 0 };
    return best;
  }

  /* ---------- drawing ---------- */
  function draw() {
    const st = V.getState ? V.getState() : {}; const c = V.ctx; c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); c.clearRect(0, 0, V.w, V.h);
    c.fillStyle = css('--stage'); c.fillRect(0, 0, V.w, V.h);
    const S = V.scale; const net = st.net; const res = st.res; const mode = st.mode || 'live';
    const line = (poly, w, color, dash) => { c.beginPath(); for (let i = 0; i < poly.length; i++) { const p = toScreen(poly[i][0], poly[i][1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } c.lineWidth = w; c.strokeStyle = color; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    const poly = (ring, fill, stroke, lw) => { c.beginPath(); ring.forEach((q, i) => { const p = toScreen(q[0], q[1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = lw || 1; c.strokeStyle = stroke; c.stroke(); } };
    // study circle
    if (st.centre) { const p = toScreen(st.centre[0], st.centre[1]); c.beginPath(); c.arc(p[0], p[1], st.R * S, 0, Math.PI * 2); c.fillStyle = css('--paper'); c.fill(); c.strokeStyle = css('--line'); c.lineWidth = 1; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]); }
    // parks
    for (const pk of st.parks || []) poly(pk.p, css('--park'), null);
    // street ribbons
    if (net) { const rib = css('--street'); for (const s of net.veh.segs) { if (s.onSite && st.scenario === 'proposed' && st.hasProposed) continue; const w = Math.max(1.5, (s.lanesT * 3.3 + (s.alley ? 0 : 1)) * S); line(s.poly, w, rib); } }
    // context buildings
    const fill = css('--context'), edge = css('--context-edge'); const dim = mode === 'walkshed' && st.walk;
    for (const b of st.context || []) { const t = G.clamp(b.h / 120, 0, 1); poly(b.poly, dim ? fill : shade(fill, t, Charts.dark()), edge, 0.6); }
    // walkshed
    if (mode === 'walkshed' && st.walk && net) { const w5 = st.walk.w5, w10 = st.walk.w10; if (w10 && w10.hull.length > 2) poly(w10.hull, hexA(Charts.pal().walk, 0.10), hexA(Charts.pal().walk, 0.5), 1); if (w5 && w5.hull.length > 2) poly(w5.hull, hexA(Charts.pal().walk, 0.16), hexA(Charts.pal().walk, 0.8), 1.2); }
    // pedestrian network
    if (net && st.layers.network !== false) {
      const base = css('--sidewalk'), xcol = css('--crossing');
      for (const e of net.ped.alive || net.ped.edges) {
        if (!e.alive) continue; const blocked = st.scenario === 'proposed' ? (e.onSite && !e.keep) || e.offProposed : e.offBaseline; if (blocked && mode !== 'live') continue;
        if (e.kind === 'link') continue;
        let col = e.kind === 'crossing' ? xcol : base, w = e.kind === 'crossing' ? 1 : e.kind === 'walkway' ? 2.2 : 1.2, dash = e.kind === 'crossing' ? [3, 3] : null;
        if (blocked) { col = css('--muted'); dash = [2, 3]; }
        if (res && (mode === 'pedLos' || mode === 'density') && res.ped.hourly[e.i] > 0) { col = mode === 'pedLos' ? Charts.los(res.ped.los[e.i]) : Charts.seq(G.clamp(res.ped.dens[e.i] / 0.6, 0, 0.999)); w = G.clamp(1 + Math.sqrt(res.ped.hourly[e.i]) / 6, 1, 9) * Math.max(0.6, Math.min(1.4, S / 2)); dash = e.kind === 'crossing' ? [4, 3] : null; }
        else if (st.cmp && mode === 'change') { const d = st.cmp.dPed[e.i]; const ref = Math.max(60, Math.abs(st.cmp.pedRef || 400)); col = Charts.div(G.clamp(d / ref, -1, 1)); w = G.clamp(1 + Math.sqrt(Math.abs(d)) / 4, 1, 8); if (Math.abs(d) < 5) w = 1; }
        else if (mode === 'walkshed' && st.walk && st.walk.w10) { const r5 = st.walk.w5.reach, r10 = st.walk.w10.reach; const inn = r5[e.a] && r5[e.b] ? 2 : r10[e.a] && r10[e.b] ? 1 : 0; col = inn === 2 ? Charts.pal().walk : inn === 1 ? hexA(Charts.pal().walk, 0.55) : base; w = inn ? 2.2 : 1; }
        line(e.poly, w, col, dash);
      }
    }
    // vehicle overlays
    if (net && res && (mode === 'vehLos' || mode === 'change')) {
      for (const e of net.veh.edges) { if (!e.alive || (e.onSite && st.scenario === 'proposed')) continue; const vol = res.veh.vol[e.i]; if (vol <= 0 && mode === 'vehLos') continue; const off = e.lanes * 1.6 + 0.6; const pl = G.offsetPoly(e.poly, -off); let col, w; if (mode === 'vehLos') { col = Charts.los(res.veh.los[e.i]); w = G.clamp(1.5 + vol / 220, 1.5, 7); } else { const d = st.cmp ? st.cmp.dVc[e.i] : 0; col = Charts.div(G.clamp(d / 0.25, -1, 1)); w = G.clamp(1 + Math.abs(d) * 14, 1, 7); if (Math.abs(d) < 0.01) continue; } line(pl, w, col); }
      if (mode === 'vehLos' || mode === 'change') for (const n of net.veh.nodes) { if (n.ctrl === 'none' || res.nodes.vol[n.i] <= 0) continue; const p = toScreen(n.x, n.y); const r = G.clamp(3 + res.nodes.vol[n.i] / 300, 3, 9) * Math.max(0.8, Math.min(1.6, S / 2)); c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fillStyle = mode === 'vehLos' ? Charts.los(res.nodes.los[n.i]) : Charts.div(G.clamp((st.cmp ? st.cmp.dNode[n.i] : 0) / 15, -1, 1)); c.fill(); c.strokeStyle = css('--paper'); c.lineWidth = 1.2; c.stroke(); if (S > 1.4) { c.fillStyle = css('--accent-fg'); c.font = `600 ${Math.round(9 * Math.min(1.3, S / 2 + 0.5))}px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = (res.nodes.los[n.i] >= 3 || Charts.dark()) ? '#fff' : '#0b0b0b'; c.fillText(Analysis.LETTER[res.nodes.los[n.i]], p[0], p[1] + 0.5); } }
    }
    // site + massing
    if (st.site) {
      poly(st.site.ring, css('--site-fill'), css('--site-line'), 1.5);
      const blocks = st.scenario === 'baseline' ? st.existingFoot || [] : st.footprints || [];
      const sorted = blocks.slice().sort((a, b) => (a.z0 || 0) - (b.z0 || 0) || (b.area || 0) - (a.area || 0));
      for (const b of sorted) { poly(b.poly, css(USE_FILL[b.use] || '--context'), css(USE_LINE[b.use] || '--context-edge'), 1); if (S > 1.6 && b.name) { const cc = G.centroid(b.poly); const p = toScreen(cc[0], cc[1]); c.fillStyle = css('--ink2'); c.font = `500 ${Math.round(10)}px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.label || b.name, p[0], p[1]); } }
      if (!sorted.length && st.scenario === 'baseline' && st.site) { const cc = st.site.centre; const p = toScreen(cc[0], cc[1]); c.fillStyle = css('--muted'); c.font = `500 11px ${css('--sans')}`; c.textAlign = 'center'; c.fillText('vacant', p[0], p[1]); }
      // public spaces
      if (st.scenario === 'proposed') for (const sp of st.spaces || []) { const p = toScreen(sp.p[0], sp.p[1]); const rr = Math.max(5, Math.sqrt(sp.cap || 20) * S * 0.45); c.beginPath(); c.arc(p[0], p[1], rr, 0, Math.PI * 2); c.fillStyle = hexA(Charts.pal().transit, 0.18); c.fill(); c.setLineDash([3, 3]); c.strokeStyle = Charts.pal().transit; c.lineWidth = 1; c.stroke(); c.setLineDash([]); if (S > 1.2) { c.fillStyle = css('--ink2'); c.font = `500 10px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(sp.name || sp.type, p[0], p[1] + rr + 2); } }
      // entrances
      for (const en of st.entrances || []) { const p = toScreen(en.p[0], en.p[1]); c.beginPath(); c.arc(p[0], p[1], en.kind === 'main' ? 5 : 4, 0, Math.PI * 2); c.fillStyle = en.kind === 'ramp' ? css('--accent') : en.kind === 'loading' ? css('--review') : en.kind === 'pudo' ? css('--pass') : css('--ink'); c.fill(); c.strokeStyle = css('--paper'); c.lineWidth = 1.5; c.stroke(); if (S > 1.2) { c.fillStyle = css('--ink2'); c.font = `500 10px ${css('--sans')}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(ENT_LABEL[en.kind] || en.kind, p[0] + 7, p[1]); } }
    }
    // stops & gates
    if (st.stops && S > 0.5) for (const s of st.stops) { const p = toScreen(s.x, s.y); const sk = s.t === 'skytrain'; c.beginPath(); if (sk) c.rect(p[0] - 4, p[1] - 4, 8, 8); else c.arc(p[0], p[1], 2.6, 0, Math.PI * 2); c.fillStyle = sk ? css('--accent') : css('--muted'); c.fill(); if (sk) { c.strokeStyle = css('--paper'); c.lineWidth = 1; c.stroke(); } }
    // agents
    if (st.live && st.sim) {
      const P = Sim.pedPositions(st.sim); const pc = [css('--ped'), css('--accent'), css('--ped2'), css('--accent')]; const r = G.clamp(S * 0.45, 1.2, 3.2);
      if (st.layers.byGroup) { for (let g = 0; g < 8; g++) { c.fillStyle = Charts.groupColor(g); c.beginPath(); for (let i = 0; i < P.length; i += 4) { if (P[i + 3] !== g) continue; const p = toScreen(P[i], P[i + 1]); const rr = P[i + 2] === 3 ? r * 1.5 : r; c.moveTo(p[0] + rr, p[1]); c.arc(p[0], p[1], rr, 0, Math.PI * 2); } c.fill(); } }
      else for (let k = 0; k < 4; k++) { c.fillStyle = pc[k]; c.beginPath(); for (let i = 0; i < P.length; i += 4) { if (P[i + 2] !== k) continue; const p = toScreen(P[i], P[i + 1]); const rr = k === 3 ? r * 1.5 : r; c.moveTo(p[0] + rr, p[1]); c.arc(p[0], p[1], rr, 0, Math.PI * 2); } c.fill(); }
      const Vv = Sim.vehPositions(st.sim); const vc = [css('--veh'), css('--accent'), css('--pass'), css('--review')]; const L = Math.max(3, 4.4 * S), Wd = Math.max(2, 1.9 * S);
      for (let i = 0; i < Vv.length; i += 4) { const p = toScreen(Vv[i], Vv[i + 1]); c.save(); c.translate(p[0], p[1]); c.rotate(-Vv[i + 2]); c.fillStyle = vc[Vv[i + 3]] || vc[0]; const l = Vv[i + 3] === 3 ? L * 1.8 : L; c.fillRect(-l / 2, -Wd / 2, l, Wd); c.restore(); }
      // signal heads
      if (S > 1.6 && net) for (const n of net.veh.nodes) { if (n.ctrl !== 'sig') continue; const p = toScreen(n.x, n.y); const ph = Sim.phaseOf(n, st.sim.t); const ax = ph === 0 ? n.axis : n.minorAxis; c.strokeStyle = css('--pass'); c.lineWidth = 2; c.beginPath(); c.moveTo(p[0] - Math.cos(ax) * 6, p[1] + Math.sin(ax) * 6); c.lineTo(p[0] + Math.cos(ax) * 6, p[1] - Math.sin(ax) * 6); c.stroke(); }
    }
    // labels
    if (net && st.layers.labels !== false && S > 1.1) {
      c.fillStyle = css('--label'); c.font = `600 ${Math.round(G.clamp(9 + S * 1.2, 10, 15))}px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'middle'; const done = [];
      for (const s of net.veh.segs) { if (!s.name || s.L < 40 || s.alley) continue; const m = G.pointAt(s.poly, s.L / 2); if (done.some((d) => d.n === s.name && Math.hypot(d.x - m[0], d.y - m[1]) < 150)) continue; done.push({ n: s.name, x: m[0], y: m[1] }); const p = toScreen(m[0], m[1]); let a = -m[2]; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI; c.save(); c.translate(p[0], p[1]); c.rotate(a); c.fillText(s.name, 0, 0); c.restore(); }
    }
    // hover / selection highlight
    for (const h of [V.sel, V.hover]) { if (!h || !net) continue; c.lineWidth = h === V.sel ? 4 : 3; c.strokeStyle = hexA(css('--accent'), h === V.sel ? 0.9 : 0.55); if (h.type === 'ped') { const e = net.ped.edges[h.i]; if (e) line(e.poly, c.lineWidth, c.strokeStyle); } else if (h.type === 'veh') { const s = net.veh.segs[h.i]; line(s.poly, c.lineWidth + 2, c.strokeStyle); } else if (h.type === 'node') { const n = net.veh.nodes[h.i]; const p = toScreen(n.x, n.y); c.beginPath(); c.arc(p[0], p[1], 10, 0, Math.PI * 2); c.stroke(); } else if (h.type === 'gen' && st.gens) { const g = st.gens[h.i]; if (g && g.poly) poly(g.poly, null, c.strokeStyle, 2); } }
    // scale bar + north
    const bar = niceBar(120 / S); const bw = bar * S; c.fillStyle = css('--ink2'); c.fillRect(14, V.h - 18, bw, 2); c.font = `500 10px ${css('--mono')}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(bar >= 1000 ? bar / 1000 + ' km' : bar + ' m', 14, V.h - 22);
  }
  const ENT_LABEL = { main: 'Lobby', retail: 'Retail', ramp: 'Parking ramp', loading: 'Loading', pudo: 'Pick-up' };
  const niceBar = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p; };
  function hexA(hex, a) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function shade(hex, t, dk) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const k = dk ? 1 + 0.35 * t : 1 - 0.14 * t; r = G.clamp(r * k, 0, 255); g = G.clamp(g * k, 0, 255); b = G.clamp(b * k, 0, 255); return `rgb(${r | 0},${g | 0},${b | 0})`; }
  function snapshot(w, h) { const off = document.createElement('canvas'); off.width = w * 2; off.height = h * 2; const save = { cv: V.cv, ctx: V.ctx, w: V.w, h: V.h, dpr: V.dpr }; V.cv = off; V.ctx = off.getContext('2d'); V.w = w; V.h = h; V.dpr = 2; try { draw(); } finally { Object.assign(V, save); } return off.toDataURL('image/png'); }
  return { mount, fit, V, toModel, toScreen, snapshot, invalidate: () => { V.needs = true; }, select: (s) => { V.sel = s; V.needs = true; } };
})();
