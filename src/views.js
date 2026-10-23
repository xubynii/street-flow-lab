/* Street Flow Lab · views.js — the map canvas: context, site, massing, networks, agents and analysis overlays. */
window.Views = (() => {
  const G = window.Geom;
  const V = { cv: null, ctx: null, scale: 1.2, cx: 0, cy: 0, w: 0, h: 0, dpr: 1, hover: null, sel: null, onSelect: null, onHover: null, onPick: null, getState: null, needs: true, picking: false, mode3d: false, az: -0.6, tilt: 0.95 };
  /* 3D: a parallel (axonometric) projection. The ground plane maps to the screen by an affine transform, so every flat layer is drawn once in plan and draped; buildings and flow ribbons are drawn on top as sorted prisms. az rotates about the vertical, tilt is the elevation angle (π/2 = plan). */
  const rot = (x, y) => { const ca = Math.cos(V.az), sa = Math.sin(V.az); return [x * ca - y * sa, x * sa + y * ca]; };
  const toScreen3 = (x, y, z) => { const r = rot(x - V.cx, y - V.cy); return [V.w / 2 + r[0] * V.scale, V.h / 2 - (r[1] * Math.sin(V.tilt) + (z || 0) * Math.cos(V.tilt)) * V.scale]; };
  const depth3 = (x, y, z) => rot(x - V.cx, y - V.cy)[1] - (z || 0) * Math.cos(V.tilt) * 0.5; // larger = farther from the viewer
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const USE_FILL = { residential: '--res', hotel: '--hotel', office: '--office', retail: '--retail', restaurant: '--restaurant', amenity: '--amenity', parking: '--parking', core: '--core', school: '--school' };
  const USE_LINE = { residential: '--res-line', hotel: '--hotel-line', office: '--office-line', retail: '--retail-line', restaurant: '--restaurant-line', amenity: '--amenity-line', parking: '--parking-line', core: '--core-line', school: '--school-line' };

  function mount(cv) {
    V.cv = cv; V.ctx = cv.getContext('2d'); resize(); addEventListener('resize', () => { resize(); V.needs = true; });
    let drag = null;
    cv.addEventListener('contextmenu', (e) => { if (V.mode3d) e.preventDefault(); });
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: V.cx, cy: V.cy, az: V.az, tilt: V.tilt, orbit: V.mode3d && (e.button === 2 || e.shiftKey || e.altKey), moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.orbit) { V.az = drag.az - dx * 0.008; V.tilt = G.clamp(drag.tilt + dy * 0.006, 0.35, Math.PI / 2); }
        else if (V.mode3d) { const inv = unrot(dx / V.scale, -dy / (V.scale * Math.sin(V.tilt))); V.cx = drag.cx - inv[0]; V.cy = drag.cy - inv[1]; }
        else { V.cx = drag.cx - dx / V.scale; V.cy = drag.cy + dy / V.scale; }
        V.needs = true; return; }
      const m = toModel(e); const h = pick(m); if (hoverKey(h) !== hoverKey(V.hover)) { V.hover = h; V.needs = true; } if (V.onHover) V.onHover(h, e); });
    cv.addEventListener('pointerup', (e) => { if (drag && !drag.moved) { const m = toModel(e); if (V.picking && V.onPick) V.onPick(m); else { V.sel = pick(m); if (V.onSelect) V.onSelect(V.sel, m); } V.needs = true; } drag = null; });
    cv.addEventListener('pointerleave', () => { V.hover = null; V.needs = true; if (V.onHover) V.onHover(null); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const m = toModel(e); const f = Math.exp(-e.deltaY * 0.0012); const ns = G.clamp(V.scale * f, 0.15, 14); V.cx = m[0] - (m[0] - V.cx) * V.scale / ns; V.cy = m[1] - (m[1] - V.cy) * V.scale / ns; V.scale = ns; V.needs = true; }, { passive: false });
    // keyboard: arrows pan, + / - zoom, Enter selects what sits at the centre, Escape clears
    cv.addEventListener('keydown', (e) => {
      const step = 60 / V.scale; let used = true;
      if (e.key === 'ArrowLeft') V.cx -= step; else if (e.key === 'ArrowRight') V.cx += step; else if (e.key === 'ArrowUp') V.cy += step; else if (e.key === 'ArrowDown') V.cy -= step;
      else if (e.key === '+' || e.key === '=') V.scale = G.clamp(V.scale * 1.25, 0.15, 14); else if (e.key === '-' || e.key === '_') V.scale = G.clamp(V.scale / 1.25, 0.15, 14);
      else if (V.mode3d && (e.key === '[' || e.key === ']')) V.az += (e.key === '[' ? -1 : 1) * Math.PI / 12;
      else if (V.mode3d && (e.key === '{' || e.key === '}')) V.tilt = G.clamp(V.tilt + (e.key === '{' ? -0.1 : 0.1), 0.35, Math.PI / 2);
      else if (e.key === 'Enter') { const m = [V.cx, V.cy]; if (V.picking && V.onPick) V.onPick(m); else { V.sel = pick(m, 3); V.hover = V.sel; if (V.onSelect) V.onSelect(V.sel, m); } }
      else if (e.key === 'Escape') { V.sel = null; V.hover = null; if (V.onSelect) V.onSelect(null); }
      else used = false;
      if (used) { e.preventDefault(); V.needs = true; }
    });
    requestAnimationFrame(loop);
  }
  const hoverKey = (h) => (h ? h.type + ':' + h.i : '');
  function resize() { const r = V.cv.getBoundingClientRect(); V.dpr = Math.min(2, devicePixelRatio || 1); V.w = r.width; V.h = r.height; V.cv.width = Math.round(r.width * V.dpr); V.cv.height = Math.round(r.height * V.dpr); }
  const toScreen = (x, y) => [V.w / 2 + (x - V.cx) * V.scale, V.h / 2 - (y - V.cy) * V.scale];
  const unrot = (x, y) => { const ca = Math.cos(-V.az), sa = Math.sin(-V.az); return [x * ca - y * sa, x * sa + y * ca]; };
  const toModel = (e) => { const r = V.cv.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; if (V.mode3d) { const u = (sx - V.w / 2) / V.scale, v = -(sy - V.h / 2) / (V.scale * Math.sin(V.tilt)); const m = unrot(u, v); return [V.cx + m[0], V.cy + m[1]]; } return [V.cx + (sx - V.w / 2) / V.scale, V.cy - (sy - V.h / 2) / V.scale]; };
  /* ---------- linework helpers: a diagonal hatch pattern per colour, and streets as a pair of kerb lines ---------- */
  const hatches = new Map();
  function hatch(c, colorHex, gap) { const key = colorHex + '|' + gap; let p = hatches.get(key); if (!p) { const t = document.createElement('canvas'); t.width = t.height = gap; const g = t.getContext('2d'); g.strokeStyle = colorHex; g.lineWidth = 0.7; g.beginPath(); g.moveTo(-1, gap + 1); g.lineTo(gap + 1, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(gap - 1, gap + 1); g.lineTo(gap + 1, gap - 1); g.stroke(); p = t; hatches.set(key, p); } return c.createPattern(p, 'repeat'); }
  /* a road drawn as paper between two kerb lines: a wide stroke in the kerb colour, then the carriageway in the street colour over it; crossing streets erase each other's kerbs at the junction */
  function kerbRoads(c, segs, widthOf, kerbCol, streetCol) { c.lineCap = 'round'; c.lineJoin = 'round'; for (const pass of [0, 1]) { c.strokeStyle = pass ? streetCol : kerbCol; for (const s of segs) { const w = widthOf(s); if (!(w > 0)) continue; c.lineWidth = pass ? Math.max(0.4, w - 1.1) : w + 0.1; c.beginPath(); const P = s.poly; for (let i = 0; i < P.length; i++) { const p = s.sc(P[i][0], P[i][1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } c.stroke(); } } }

  /* ---------- downtown base layer (all streets, buildings and parks in the data), cached per view ---------- */
  let base = null, baseT = null, BB = null;
  const DRIVE_W = { motorway: 4, trunk: 4, primary: 4, secondary: 4, tertiary: 2, unclassified: 2, residential: 2, living_street: 1, service: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1 };
  function prepBB() { if (BB) return; BB = { ways: [], b: [], parks: [] }; if (window.OSMS) for (const w of window.OSMS.ways) BB.ways.push(DRIVE_W[w.hw] ? G.bbox(w.p) : null); if (window.OSM) for (const b of window.OSM.b) BB.b.push(b.part ? null : G.bbox(b.p)); if (window.CITY) for (const pk of window.CITY.parks) BB.parks.push(G.bbox(pk.p)); const xs = [], ys = []; if (window.OSM) for (const bb of BB.b) if (bb) { xs.push(bb[0], bb[2]); ys.push(bb[1], bb[3]); } BB.all = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [-2400, -1700, 2000, 2100]; }
  function renderBase() {
    prepBB(); const S = V.scale, dpr = V.dpr; const cv = document.createElement('canvas'); cv.width = Math.round(V.w * dpr); cv.height = Math.round(V.h * dpr); const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const theme = css('--stage'); c.fillStyle = theme; c.fillRect(0, 0, V.w, V.h);
    const vis = [V.cx - V.w / 2 / S - 20, V.cy - V.h / 2 / S - 20, V.cx + V.w / 2 / S + 20, V.cy + V.h / 2 / S + 20]; const hit = (bb) => bb && bb[2] >= vis[0] && bb[0] <= vis[2] && bb[3] >= vis[1] && bb[1] <= vis[3];
    const sc = (x, y) => [V.w / 2 + (x - V.cx) * S, V.h / 2 - (y - V.cy) * S];
    const path = (P, close) => { c.beginPath(); for (let i = 0; i < P.length; i++) { const p = sc(P[i][0], P[i][1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } if (close) c.closePath(); };
    if (window.CITY) { const pk0 = css('--park'), hc = css('--hatch'); window.CITY.parks.forEach((pk, i) => { if (!hit(BB.parks[i])) return; path(pk.p, true); c.fillStyle = pk0; c.fill(); if (S > 0.5) { c.fillStyle = hatch(c, hc, Math.max(5, Math.min(9, 4 * S))); c.fill(); } c.strokeStyle = hc; c.lineWidth = 0.5; c.stroke(); }); }
    if (window.OSMS) { const segs = []; window.OSMS.ways.forEach((w, i) => { const bb = BB.ways[i]; if (!hit(bb)) return; if (S < 0.35 && (w.hw === 'service' || w.hw === 'living_street')) return; const lanes = w.lanes || DRIVE_W[w.hw]; segs.push({ poly: w.p, w: Math.max(0.8, (lanes * 3.3 + (w.hw === 'service' ? 0 : 1)) * S), sc }); }); if (S < 0.5) { c.strokeStyle = css('--kerb'); for (const s of segs) { c.lineWidth = Math.max(0.5, s.w * 0.3); path(s.poly, false); c.stroke(); } } else kerbRoads(c, segs, (s) => s.w, css('--kerb'), css('--street')); }
    if (window.OSM) { const fill = css('--context'), edge = css('--context-edge'); c.fillStyle = fill; c.strokeStyle = edge; c.lineWidth = S > 1.2 ? 0.6 : 0.4; window.OSM.b.forEach((b, i) => { const bb = BB.b[i]; if (!hit(bb)) return; if ((bb[2] - bb[0]) * (bb[3] - bb[1]) * S * S < 6) return; path(b.p, true); c.fill(); c.stroke(); }); }
    base = { canvas: cv, scale: S, cx: V.cx, cy: V.cy, w: V.w, h: V.h, theme };
  }
  function drawBase(c) {
    const theme = css('--stage');
    if (!base || base.w !== V.w || base.h !== V.h || base.theme !== theme) renderBase();
    if (base.scale !== V.scale || base.cx !== V.cx || base.cy !== V.cy) { const r = V.scale / base.scale; const ox = V.w / 2 + (base.cx - V.cx) * V.scale - base.w / 2 * r, oy = V.h / 2 - (base.cy - V.cy) * V.scale - base.h / 2 * r; c.fillStyle = theme; c.fillRect(0, 0, V.w, V.h); c.drawImage(base.canvas, ox, oy, base.w * r, base.h * r); clearTimeout(baseT); baseT = setTimeout(() => { base = null; V.needs = true; }, 160); return; }
    c.drawImage(base.canvas, 0, 0, V.w, V.h);
  }
  function fitDowntown() { prepBB(); const bb = BB.all; V.cx = (bb[0] + bb[2]) / 2; V.cy = (bb[1] + bb[3]) / 2; V.scale = Math.min(V.w / (bb[2] - bb[0]), V.h / (bb[3] - bb[1])) * 0.95; V.needs = true; }
  function fit(centre, R) { V.cx = centre[0]; V.cy = centre[1]; V.scale = Math.min(V.w, V.h) / (2 * R * 1.08); V.needs = true; }
  function loop() { if (V.needs || (V.getState && V.getState().live)) { V.needs = false; try { draw(); } catch (err) { console.error(err); } } requestAnimationFrame(loop); }

  /* ---------- picking ---------- */
  function pick(m, widen) {
    const st = V.getState ? V.getState() : null; if (!st || !st.net) return null; const tol = Math.max(2.5, 7 / V.scale) * (widen || 1);
    let best = null, bd = tol;
    if (st.net.veh && st.mode !== 'pedLos' && st.mode !== 'walkshed') { for (const n of st.net.veh.nodes) { if (n.ctrl === 'none' && n.deg < 3) continue; const d = Math.hypot(n.x - m[0], n.y - m[1]); if (d < bd + 2) { bd = d; best = { type: 'node', i: n.i }; } } }
    for (const e of st.net.ped.grid.near(m, tol)) { if (!e.alive || e.kind === 'link') continue; const d = G.projPoly(m, e.poly).d; if (d < bd) { bd = d; best = { type: 'ped', i: e.i }; } }
    if (st.mode !== 'pedLos' && st.mode !== 'walkshed') for (const s of st.net.veh.segs) { if (s.onSite && st.scenario === 'proposed') continue; const d = G.projPoly(m, s.poly).d; if (d < bd + 1.5 && d < tol + 2) { bd = d; best = { type: 'veh', i: s.i }; } }
    if (!best && st.gens) for (const g of st.gens) { if (g.kind !== 'ctx' || !g.poly) continue; if (G.pip(m, g.poly)) return { type: 'gen', i: g.id }; }
    if (!best && st.site && G.pip(m, st.site.ring)) return { type: 'site', i: 0 };
    return best;
  }

  /* ---------- flow heat: a smoothed raster of hourly flow per metre of sidewalk (or vehicles per link), cached per result ---------- */
  let heat = null;
  function heatField(st) {
    const kind = st.heatKind === 'veh' ? 'veh' : 'ped'; const res = st.res; if (!res || !st.net) return null;
    if (heat && heat.res === res && heat.kind === kind && heat.R === st.R && heat.cx === st.centre[0] && heat.cy === st.centre[1] && heat.dark === Charts.dark()) return heat;
    const cell = 3, pad = 40; const x0 = st.centre[0] - st.R - pad, y0 = st.centre[1] - st.R - pad; const n = Math.ceil((2 * st.R + 2 * pad) / cell); const acc = new Float32Array(n * n);
    const add = (poly, v) => { for (let i = 1; i < poly.length; i++) { const a = poly[i - 1], b = poly[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const steps = Math.max(1, Math.ceil(L / (cell * 0.5))); for (let s = 0; s <= steps; s++) { const t = s / steps; const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; const ix = Math.floor((x - x0) / cell), iy = Math.floor((y - y0) / cell); if (ix >= 0 && iy >= 0 && ix < n && iy < n) acc[iy * n + ix] += v / (steps + 1) * L / cell; } } };
    if (kind === 'ped') { for (const e of st.net.ped.alive || st.net.ped.edges) { if (!e.alive || e.kind === 'link') continue; const v = res.ped.hourly[e.i]; if (v > 0) add(e.poly, v); } }
    else { for (const e of st.net.veh.edges) { if (!e.alive) continue; const v = res.veh.vol[e.i]; if (v > 0) add(e.poly, v); } }
    // three box blurs ≈ gaussian, radius 2 cells (6 m)
    const tmp = new Float32Array(n * n); const r = 2;
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < n; y++) { let s = 0; for (let x = -r; x <= r; x++) s += x >= 0 ? acc[y * n + x] : 0; for (let x = 0; x < n; x++) { tmp[y * n + x] = s / (2 * r + 1); if (x + r + 1 < n) s += acc[y * n + x + r + 1]; if (x - r >= 0) s -= acc[y * n + x - r]; } }
      for (let x = 0; x < n; x++) { let s = 0; for (let y = -r; y <= r; y++) s += y >= 0 ? tmp[y * n + x] : 0; for (let y = 0; y < n; y++) { acc[y * n + x] = s / (2 * r + 1); if (y + r + 1 < n) s += tmp[(y + r + 1) * n + x]; if (y - r >= 0) s -= tmp[(y - r) * n + x]; } }
    }
    const nz = Array.from(acc).filter((v) => v > 0).sort((a, b) => a - b); const ref = nz.length ? nz[Math.floor(nz.length * 0.96)] : 1;
    const lut = []; for (let i = 0; i < 48; i++) { const t = i / 47; const hex = Charts.seq(Math.min(0.999, 0.12 + t * 0.88)); const h = hex.replace('#', ''); const num = parseInt(h, 16); lut.push([(num >> 16) & 255, (num >> 8) & 255, num & 255, Math.round(255 * Math.min(0.88, t < 0.04 ? t * 6 : 0.24 + t * 0.7))]); }
    const cv = document.createElement('canvas'); cv.width = n; cv.height = n; const c = cv.getContext('2d'); const img = c.createImageData(n, n); const px = img.data;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = acc[y * n + x] / ref; if (v <= 0.015) continue; const k = lut[Math.min(47, Math.floor(Math.min(1, v) * 47))]; const o = ((n - 1 - y) * n + x) * 4; px[o] = k[0]; px[o + 1] = k[1]; px[o + 2] = k[2]; px[o + 3] = k[3]; }
    c.putImageData(img, 0, 0);
    heat = { res, kind, R: st.R, cx: st.centre[0], cy: st.centre[1], dark: Charts.dark(), canvas: cv, x0, y0, size: n * cell, ref, peak: nz.length ? nz[nz.length - 1] : 0 };
    return heat;
  }

  /* ---------- drawing ---------- */
  function draw() { const st = V.getState ? V.getState() : {}; if (V.mode3d && st.net) draw3d(st); else { const c = V.ctx; c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); c.clearRect(0, 0, V.w, V.h); drawScene(c, st, false); drawChrome(c); } }
  function drawChrome(c) {
    const S = V.scale;
    // keyboard focus: a centre mark so Enter has a visible target
    if (document.activeElement === V.cv) { const cx = V.w / 2, cy = V.h / 2; c.strokeStyle = hexA(css('--accent'), 0.9); c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.moveTo(cx - 14, cy); c.lineTo(cx - 11, cy); c.moveTo(cx + 11, cy); c.lineTo(cx + 14, cy); c.moveTo(cx, cy - 14); c.lineTo(cx, cy - 11); c.moveTo(cx, cy + 11); c.lineTo(cx, cy + 14); c.stroke(); }
    // scale bar, bottom right so it never sits under the legend
    const bar = niceBar(120 / S); const bw = bar * S; const x1 = V.w - 14; c.fillStyle = css('--ink2'); c.fillRect(x1 - bw, V.h - 18, bw, 2); c.font = `500 10px ${css('--mono')}`; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText((bar >= 1000 ? bar / 1000 + ' km' : bar + ' m') + (V.mode3d ? ' along the ground' : ''), x1, V.h - 22);
  }
  function drawScene(c, st, flat) {
    drawBase(c);
    const S = V.scale; const net = st.net; const res = st.res; const mode = st.mode || 'live';
    const line = (poly, w, color, dash) => { c.beginPath(); for (let i = 0; i < poly.length; i++) { const p = toScreen(poly[i][0], poly[i][1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); } c.lineWidth = w; c.strokeStyle = color; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]); };
    const poly = (ring, fill, stroke, lw) => { c.beginPath(); ring.forEach((q, i) => { const p = toScreen(q[0], q[1]); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.lineWidth = lw || 1; c.strokeStyle = stroke; c.stroke(); } };
    // study circle: the sheet the study is drawn on
    if (st.centre) { const p = toScreen(st.centre[0], st.centre[1]); c.beginPath(); c.arc(p[0], p[1], st.R * S, 0, Math.PI * 2); c.fillStyle = css('--paper'); c.fill(); c.strokeStyle = css('--ink2'); c.lineWidth = 0.8; c.setLineDash([6, 4]); c.stroke(); c.setLineDash([]); }
    // parks: hatched
    for (const pk of st.parks || []) { poly(pk.p, css('--park'), null); c.beginPath(); pk.p.forEach((q, i) => { const p = toScreen(q[0], q[1]); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }); c.closePath(); c.fillStyle = hatch(c, css('--hatch'), Math.max(5, Math.min(9, 4 * S))); c.fill(); c.strokeStyle = css('--hatch'); c.lineWidth = 0.6; c.stroke(); }
    // streets: paper between kerb lines
    if (net) { const segs = []; for (const s of net.veh.segs) { if (s.onSite && st.scenario === 'proposed' && st.hasProposed) continue; segs.push({ poly: s.poly, w: Math.max(1.5, (s.lanesT * 3.3 + (s.alley ? 0 : 1)) * S), sc: toScreen }); } kerbRoads(c, segs, (s) => s.w, css('--kerb'), css('--street')); }
    // flow heat (under the buildings, so the blur does not spill onto roofs)
    if (mode === 'heat' && res) { const H = heatField(st); if (H) { const a = toScreen(H.x0, H.y0 + H.size), b = toScreen(H.x0 + H.size, H.y0); c.imageSmoothingEnabled = true; c.drawImage(H.canvas, a[0], a[1], b[0] - a[0], b[1] - a[1]); } }
    // context buildings: a faint wash and a charcoal hairline; taller ones a shade deeper (flat footprints; in 3D the prisms are drawn afterwards)
    const fill = css('--context'), edge = css('--context-edge'); const dim = mode === 'walkshed' && st.walk;
    for (const b of st.context || []) { const t = G.clamp(b.h / 120, 0, 1); poly(b.poly, dim || flat ? fill : shade(fill, t * 0.7, Charts.dark()), edge, S > 1.2 ? 0.7 : 0.5); }
    // walkshed
    if (mode === 'walkshed' && st.walk && net) { const w5 = st.walk.w5, w10 = st.walk.w10; if (w10 && w10.hull.length > 2) poly(w10.hull, hexA(Charts.pal().walk, 0.10), hexA(Charts.pal().walk, 0.5), 1); if (w5 && w5.hull.length > 2) poly(w5.hull, hexA(Charts.pal().walk, 0.16), hexA(Charts.pal().walk, 0.8), 1.2); }
    // pedestrian network
    if (net && st.layers.network !== false) {
      const base = css('--sidewalk'), xcol = css('--crossing');
      for (const e of net.ped.alive || net.ped.edges) {
        if (!e.alive) continue; const blocked = st.scenario === 'proposed' ? (e.onSite && !e.keep) || e.offProposed : e.offBaseline; if (blocked && mode !== 'live') continue;
        if (e.kind === 'link') continue;
        let col = e.kind === 'crossing' ? xcol : base, w = e.kind === 'crossing' ? 0.9 : e.kind === 'walkway' ? 2 : 0.9, dash = e.kind === 'crossing' ? [3, 2.5] : null;
        if (blocked) { col = css('--muted'); dash = [2, 3]; }
        if (res && (mode === 'pedLos' || mode === 'density') && res.ped.hourly[e.i] > 0) { col = mode === 'pedLos' ? Charts.los(res.ped.los[e.i]) : Charts.seq(G.clamp(res.ped.dens[e.i] / 0.6, 0, 0.999)); w = G.clamp(1 + Math.sqrt(res.ped.hourly[e.i]) / 6, 1, 9) * Math.max(0.6, Math.min(1.4, S / 2)); dash = e.kind === 'crossing' ? [4, 3] : null; }
        else if (mode === 'heat') { col = hexA(base, 0.5); w = 0.8; }
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
      poly(st.site.ring, css('--site-fill'), css('--site-line'), 1.6);
      const blocks = st.scenario === 'baseline' ? st.existingFoot || [] : st.footprints || [];
      const sorted = blocks.slice().sort((a, b) => (a.z0 || 0) - (b.z0 || 0) || (b.area || 0) - (a.area || 0));
      for (const b of sorted) { poly(b.poly, css(USE_FILL[b.use] || '--context'), css(USE_LINE[b.use] || '--context-edge'), 1); if (!flat && S > 1.6 && b.name) { const cc = G.centroid(b.poly); const p = toScreen(cc[0], cc[1]); c.fillStyle = css('--ink2'); c.font = `500 ${Math.round(10)}px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.label || b.name, p[0], p[1]); } }
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
    // labels (plan only: sheared text is unreadable in 3D)
    if (net && !flat && st.layers.labels !== false && S > 1.1) {
      c.fillStyle = css('--label'); c.font = `600 ${Math.round(G.clamp(9 + S * 1.2, 10, 15))}px ${css('--sans')}`; c.textAlign = 'center'; c.textBaseline = 'middle'; const done = [];
      for (const s of net.veh.segs) { if (!s.name || s.L < 40 || s.alley) continue; const m = G.pointAt(s.poly, s.L / 2); if (done.some((d) => d.n === s.name && Math.hypot(d.x - m[0], d.y - m[1]) < 150)) continue; done.push({ n: s.name, x: m[0], y: m[1] }); const p = toScreen(m[0], m[1]); let a = -m[2]; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI; c.save(); c.translate(p[0], p[1]); c.rotate(a); c.fillText(s.name, 0, 0); c.restore(); }
    }
    // hover / selection highlight
    for (const h of [V.sel, V.hover]) { if (!h || !net) continue; c.lineWidth = h === V.sel ? 4 : 3; c.strokeStyle = hexA(css('--accent'), h === V.sel ? 0.9 : 0.55); if (h.type === 'ped') { const e = net.ped.edges[h.i]; if (e) line(e.poly, c.lineWidth, c.strokeStyle); } else if (h.type === 'veh') { const s = net.veh.segs[h.i]; line(s.poly, c.lineWidth + 2, c.strokeStyle); } else if (h.type === 'node') { const n = net.veh.nodes[h.i]; const p = toScreen(n.x, n.y); c.beginPath(); c.arc(p[0], p[1], 10, 0, Math.PI * 2); c.stroke(); } else if (h.type === 'gen' && st.gens) { const g = st.gens[h.i]; if (g && g.poly) poly(g.poly, null, c.strokeStyle, 2); } }
  }

  /* ---------- 3D: drape the plan, then prisms and flow ribbons sorted far to near ---------- */
  let flatCv = null;
  function draw3d(st) {
    const c = V.ctx; const W = V.w, H = V.h, dpr = V.dpr; const K = 1.8; const fw = Math.round(W * K), fh = Math.round(H * K);
    if (!flatCv) flatCv = document.createElement('canvas'); if (flatCv.width !== Math.round(fw * dpr) || flatCv.height !== Math.round(fh * dpr)) { flatCv.width = Math.round(fw * dpr); flatCv.height = Math.round(fh * dpr); }
    const fc = flatCv.getContext('2d'); fc.setTransform(dpr, 0, 0, dpr, 0, 0); fc.clearRect(0, 0, fw, fh);
    const save = { cv: V.cv, ctx: V.ctx, w: V.w, h: V.h, mode3d: V.mode3d }; V.cv = flatCv; V.ctx = fc; V.w = fw; V.h = fh; V.mode3d = false;
    try { drawScene(fc, st, true); } finally { Object.assign(V, save); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = css('--stage'); c.fillRect(0, 0, W, H);
    const ca = Math.cos(V.az), sa = Math.sin(V.az), sp = Math.sin(V.tilt);
    // ground: flat pixel (u, v) from the centre maps to screen (u ca + v sa, −u sa sp + v ca sp)
    c.save(); c.setTransform(dpr * ca, dpr * -sa * sp, dpr * sa, dpr * ca * sp, dpr * W / 2, dpr * H / 2); c.drawImage(flatCv, -fw / 2, -fh / 2, fw, fh); c.restore();
    const items = []; const S = V.scale; const dark = Charts.dark(); const mode = st.mode || 'live'; const res = st.res; const net = st.net;
    const prism = (ring, z0, z1, fillHex, edgeHex, alpha, roofT) => {
      const ccw = G.ringArea(ring) > 0; const n = ring.length; let cxs = 0, cys = 0; for (const p of ring) { cxs += p[0]; cys += p[1]; }
      const d = depth3(cxs / n, cys / n, (z0 + z1) / 2); const rt = roofT || 0;
      items.push({ d, draw: () => {
        c.globalAlpha = alpha == null ? 1 : alpha;
        const walls = [];
        for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; const ex = b[0] - a[0], ey = b[1] - a[1]; const nx = ccw ? ey : -ey, ny = ccw ? -ex : ex; const rn = rot(nx, ny); if (rn[1] >= 0) continue; const len = Math.hypot(nx, ny) || 1; const light = 0.5 + 0.5 * Math.max(0, (-rn[1] * 0.8 + rn[0] * 0.6) / len); walls.push({ a, b, light, d: depth3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0) }); }
        walls.sort((p, q) => q.d - p.d);
        // linework: the wash stays light, the shadow side is told by a hatch, every edge is a charcoal hairline
        for (const wl of walls) { const p0 = toScreen3(wl.a[0], wl.a[1], z0), p1 = toScreen3(wl.b[0], wl.b[1], z0), p2 = toScreen3(wl.b[0], wl.b[1], z1), p3 = toScreen3(wl.a[0], wl.a[1], z1); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.lineTo(p3[0], p3[1]); c.closePath(); c.fillStyle = shade(fillHex, rt + (dark ? 0.5 : 0.9) * (1 - wl.light), dark); c.fill(); if (wl.light < 0.62 && z1 - z0 > 6) { c.fillStyle = hatch(c, edgeHex, 6); c.globalAlpha = (alpha == null ? 1 : alpha) * 0.35; c.fill(); c.globalAlpha = alpha == null ? 1 : alpha; } c.strokeStyle = edgeHex; c.lineWidth = 0.55; c.stroke(); }
        c.beginPath(); ring.forEach((p, i) => { const q = toScreen3(p[0], p[1], z1); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = rt ? shade(fillHex, rt, dark) : fillHex; c.fill(); c.strokeStyle = edgeHex; c.lineWidth = 0.8; c.stroke();
        c.globalAlpha = 1;
      } });
    };
    const ribbon = (pl, h, col) => { if (pl.length < 2 || h <= 0.2) return; const m = G.pointAt(pl, G.polyLen(pl) / 2); if (st.centre && G.dist([m[0], m[1]], st.centre) > st.R + 25) return; items.push({ d: depth3(m[0], m[1], h / 2), draw: () => { c.beginPath(); pl.forEach((p, i) => { const q = toScreen3(p[0], p[1], 0); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); for (let i = pl.length - 1; i >= 0; i--) { const q = toScreen3(pl[i][0], pl[i][1], h); c.lineTo(q[0], q[1]); } c.closePath(); c.fillStyle = hexA(col, 0.72); c.fill(); c.beginPath(); pl.forEach((p, i) => { const q = toScreen3(p[0], p[1], h); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.strokeStyle = col; c.lineWidth = 1.2; c.stroke(); } }); };
    // context buildings and the massing
    const dim = mode === 'walkshed' && st.walk; const cfill = css('--context'), cedge = css('--context-edge');
    for (const b of st.context || []) prism(b.poly, 0, Math.max(3, b.h || 10), cfill, cedge, dim ? 0.6 : 1, dim ? 0 : G.clamp(b.h / 120, 0, 1) * 0.35);
    const blocks = st.scenario === 'baseline' ? st.existingFoot || [] : st.footprints || [];
    for (const b of blocks) { const z0 = Math.max(0, b.z0 || 0); const z1 = z0 + (b.h || 10); if (z1 <= z0) continue; prism(b.poly, z0, z1, css(USE_FILL[b.use] || '--context'), css(USE_LINE[b.use] || '--context-edge')); }
    // flow ribbons: height is flow, colour follows the map mode
    if (net && res && mode !== 'live' && mode !== 'walkshed') {
      const hp = (v) => G.clamp(2 + Math.sqrt(v) * 1.4, 0, 70), hv = (v) => G.clamp(2 + v / 25, 0, 70); const Hf = mode === 'heat' ? heatField(st) : null; const kind = st.heatKind === 'veh' ? 'veh' : 'ped';
      if (mode === 'pedLos' || mode === 'density' || mode === 'change' || (mode === 'heat' && kind === 'ped')) for (const e of net.ped.alive || net.ped.edges) { if (!e.alive || e.kind === 'link') continue; const v = res.ped.hourly[e.i]; if (!(v > 0)) continue; const blocked = st.scenario === 'proposed' ? (e.onSite && !e.keep) || e.offProposed : e.offBaseline; if (blocked) continue; let col; if (mode === 'pedLos') col = Charts.los(res.ped.los[e.i]); else if (mode === 'density') col = Charts.seq(G.clamp(res.ped.dens[e.i] / 0.6, 0, 0.999)); else if (mode === 'change') { const d = st.cmp ? st.cmp.dPed[e.i] : 0; if (Math.abs(d) < 5) continue; col = Charts.div(G.clamp(d / Math.max(60, Math.abs(st.cmp.pedRef || 400)), -1, 1)); ribbon(e.poly, hp(Math.abs(d)), col); continue; } else col = Charts.seq(G.clamp(v / Math.max(1, (Hf ? Hf.ref : 400) * 0.9), 0.12, 0.999)); ribbon(e.poly, hp(v), col); }
      if (mode === 'vehLos' || (mode === 'heat' && kind === 'veh')) for (const e of net.veh.edges) { if (!e.alive || (e.onSite && st.scenario === 'proposed')) continue; const v = res.veh.vol[e.i]; if (!(v > 0)) continue; const pl = G.offsetPoly(e.poly, -(e.lanes * 1.6 + 0.6)); const col = mode === 'vehLos' ? Charts.los(res.veh.los[e.i]) : Charts.seq(G.clamp(v / Math.max(1, (Hf ? Hf.ref : 800) * 0.9), 0.12, 0.999)); ribbon(pl, hv(v), col); }
    }
    items.sort((a, b) => b.d - a.d); for (const it of items) it.draw();
    drawChrome(c);
  }
  const ENT_LABEL = { main: 'Lobby', retail: 'Retail', ramp: 'Parking ramp', loading: 'Loading', pudo: 'Pick-up' };
  const niceBar = (v) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m < 2 ? 1 : m < 5 ? 2 : 5) * p; };
  function hexA(hex, a) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
  function shade(hex, t, dk) { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; const k = dk ? 1 + 0.35 * t : 1 - 0.14 * t; r = G.clamp(r * k, 0, 255); g = G.clamp(g * k, 0, 255); b = G.clamp(b * k, 0, 255); return `rgb(${r | 0},${g | 0},${b | 0})`; }
  function snapshot(w, h, three) { const off = document.createElement('canvas'); off.width = w * 2; off.height = h * 2; const save = { cv: V.cv, ctx: V.ctx, w: V.w, h: V.h, dpr: V.dpr, mode3d: V.mode3d }; V.cv = off; V.ctx = off.getContext('2d'); V.w = w; V.h = h; V.dpr = 2; if (three != null) V.mode3d = !!three; const keep = base; base = null; const keepFlat = flatCv; flatCv = null; try { draw(); } finally { Object.assign(V, save); base = keep; flatCv = keepFlat; } return off.toDataURL('image/png'); }
  function set3d(on) { V.mode3d = !!on; V.needs = true; }
  return { mount, fit, fitDowntown, V, toModel, toScreen, snapshot, set3d, heatField, invalidate: () => { V.needs = true; }, select: (s) => { V.sel = s; V.needs = true; } };
})();
