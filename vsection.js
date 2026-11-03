/* Street Flow Lab · vsection.js — the section view for the Inside stage: floors to scale, lift shafts with cars, escalators,
   the stair, and people as dots queuing, riding and walking. Draws a VSim instance (live or finished) on its own canvas. */
window.VSection = (() => {
  const G = window.Geom;
  const V = { cv: null, ctx: null, w: 0, h: 0, dpr: 1, getSim: null, needs: true, hover: null, onHover: null, zoom: 1, scroll: 0 };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const USE_FILL = { residential: '--res', hotel: '--hotel', office: '--office', retail: '--retail', restaurant: '--restaurant', amenity: '--amenity', parking: '--parking', core: '--core', school: '--school' };
  const USE_LINE = { residential: '--res-line', hotel: '--hotel-line', office: '--office-line', retail: '--retail-line', restaurant: '--restaurant-line', amenity: '--amenity-line', parking: '--parking-line', core: '--core-line', school: '--school-line' };
  function mount(cv) { V.cv = cv; V.ctx = cv.getContext('2d'); resize(); addEventListener('resize', () => { resize(); V.needs = true; }); cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); const hit = pick(e.clientX - r.left, e.clientY - r.top); if ((hit && hit.key) !== (V.hover && V.hover.key)) { V.hover = hit; V.needs = true; } if (V.onHover) V.onHover(hit, e); }); cv.addEventListener('pointerleave', () => { V.hover = null; V.needs = true; if (V.onHover) V.onHover(null); }); cv.addEventListener('wheel', (e) => { e.preventDefault(); V.zoom = G.clamp(V.zoom * Math.exp(-e.deltaY * 0.001), 0.6, 4); V.needs = true; }, { passive: false }); requestAnimationFrame(loop); }
  function resize() { if (!V.cv) return; const r = V.cv.getBoundingClientRect(); V.dpr = Math.min(2, devicePixelRatio || 1); V.w = r.width; V.h = r.height; V.cv.width = Math.round(r.width * V.dpr); V.cv.height = Math.round(r.height * V.dpr); }
  function loop() { const S = V.getSim ? V.getSim() : null; if (V.cv && !V.cv.hidden && (V.needs || (S && S.live))) { V.needs = false; try { draw(); } catch (err) { console.error(err); } } requestAnimationFrame(loop); }

  let L = null; // layout cache
  function layout(M) {
    const F = M.floors; const zmin = F[0].z, zmax = F[F.length - 1].z + F[F.length - 1].h; const padT = 64, padB = 34, left = 56;
    const px = Math.min(16, Math.max(3.5, (V.h - padT - padB) / (zmax - zmin))) * V.zoom; const Y = (z) => V.h - padB - (z - zmin) * px;
    let x = left + 24; const cols = [];
    const carW = 14, shaftGap = 4;
    for (const g of M.groups) { const w = g.n * (carW + shaftGap) + 10; cols.push({ kind: 'lift', g, x, w }); x += w + 26; }
    if (M.escalators.length) { const w = 70; cols.push({ kind: 'esc', x, w }); x += w + 26; }
    if (M.stairs) { const w = 34; cols.push({ kind: 'stair', x, w }); x += w + 26; }
    const queueX = x; const bodyX = left; const bodyW = Math.max(x + 160 - left, 320);
    return { F, zmin, zmax, px, Y, left, cols, carW, shaftGap, queueX, bodyX, bodyW, padT, padB };
  }
  function pick(sx, sy) { const S = V.getSim ? V.getSim() : null; if (!S || !L) return null; for (const f of L.F) { const y1 = L.Y(f.z + f.h), y0 = L.Y(f.z); if (sy >= y1 && sy <= y0) return { type: 'floor', i: f.i, key: 'f' + f.i, floor: f }; } return null; }

  function draw() {
    const S = V.getSim ? V.getSim() : null; const c = V.ctx; c.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); c.fillStyle = css('--stage'); c.fillRect(0, 0, V.w, V.h);
    if (!S) { c.fillStyle = css('--muted'); c.font = `500 12px ${css('--sans')}`; c.textAlign = 'center'; c.fillText('Add blocks on the Building stage to see the section', V.w / 2, V.h / 2); return; }
    const M = S.model; L = layout(M); const { F, Y, px, left, cols, carW, shaftGap, queueX } = L; const ink = css('--ink'), ink2 = css('--ink2'), line = css('--line'), muted = css('--muted'), paper = css('--paper'), accent = css('--accent');
    const sans = css('--sans'), mono = css('--mono');
    // ground line and floors (slabs as washes of the dominant use, hairline edges)
    const gy = Y(0); c.strokeStyle = ink2; c.lineWidth = 1.2; c.beginPath(); c.moveTo(left - 30, gy); c.lineTo(V.w - 12, gy); c.stroke();
    const hov = V.hover;
    for (const f of F) { const y1 = Y(f.z + f.h), y0 = Y(f.z); const wash = css(USE_FILL[f.use] || '--context'); c.fillStyle = wash; c.globalAlpha = hov && hov.i === f.i ? 1 : 0.55; c.fillRect(left, y1, L.bodyW, y0 - y1); c.globalAlpha = 1; c.strokeStyle = line; c.lineWidth = 0.6; c.beginPath(); c.moveTo(left, y0); c.lineTo(left + L.bodyW, y0); c.stroke(); if (f.level === 1 || f.level % 5 === 0 || f.level < 0 || f === F[F.length - 1]) { c.fillStyle = muted; c.font = `500 10px ${mono}`; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText(f.label, left - 6, (y0 + y1) / 2); } }
    c.strokeStyle = css('--context-edge'); c.lineWidth = 0.8; c.strokeRect(left, Y(F[F.length - 1].z + F[F.length - 1].h), L.bodyW, Y(F[0].z) - Y(F[F.length - 1].z + F[F.length - 1].h));
    const dot = (x, y, col, r) => { c.beginPath(); c.arc(x, y, r || 1.6, 0, Math.PI * 2); c.fillStyle = col; c.fill(); };
    const pedCol = css('--ped'), waitCol = css('--accent'), ridingCol = css('--ped2');
    // lift columns
    for (const col of cols) {
      if (col.kind === 'lift') {
        const g = col.g; const top = Y(g.hi.z + g.hi.h), bot = Y(g.lo.z);
        c.fillStyle = paper; c.fillRect(col.x, top, col.w, bot - top); c.strokeStyle = ink2; c.lineWidth = 0.8; c.strokeRect(col.x, top, col.w, bot - top);
        c.fillStyle = muted; c.font = `600 9px ${sans}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(`${g.n} lifts`, col.x, top - 3);
        g.cars.forEach((car, k) => { const cx = col.x + 5 + k * (carW + shaftGap); const carH = Math.max(6, Math.min(F[car.floor].h * px - 2, 18)); const cy = Y(car.pos) - carH; c.fillStyle = css('--panel'); c.fillRect(cx, cy, carW, carH); c.strokeStyle = car.state === 'dwell' ? accent : ink; c.lineWidth = car.state === 'dwell' ? 1.4 : 0.9; c.strokeRect(cx, cy, carW, carH); const n = car.load.length; for (let i = 0; i < Math.min(n, 12); i++) dot(cx + 3 + (i % 4) * 3, cy + carH - 3 - Math.floor(i / 4) * 3, ridingCol, 1.1); if (n > 12) { c.fillStyle = ink; c.font = `600 8px ${mono}`; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillText(String(n), cx + carW / 2, cy - 9); } });
        // hall queues beside this group's shaft, at each floor
        for (let i = g.lo.i; i <= g.hi.i; i++) { const hq = S.halls[i]; const n = hq.up.length + hq.down.length; if (!n) continue; const y = Y(F[i].z) - 3; for (let k = 0; k < Math.min(n, 40); k++) dot(col.x + col.w + 5 + (k % 20) * 3.2, y - Math.floor(k / 20) * 3.2, waitCol, 1.3); if (n > 40) { c.fillStyle = waitCol; c.font = `600 9px ${mono}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(String(n), col.x + col.w + 5 + 20 * 3.2 + 2, y + 1); } }
      } else if (col.kind === 'esc') {
        for (const E of S.esc) { const e = E.e; const y0 = Y(e.a.z), y1 = Y(e.b.z); const x0 = col.x, x1 = col.x + col.w; c.strokeStyle = ink2; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.moveTo(x0, y0 - 4); c.lineTo(x1, y1 - 4); c.stroke(); for (const d of ['up', 'down']) for (const r of E[d].riding) { const f = G.clamp((S.t - r.t0) / Math.max(1, r.t1 - r.t0), 0, 1); const ff = d === 'up' ? f : 1 - f; dot(x0 + (x1 - x0) * ff + (d === 'up' ? 0 : 6), y0 + (y1 - y0) * ff - 6, ridingCol, 1.4); } const nq = E.up.q.length + E.down.q.length; for (let k = 0; k < Math.min(nq, 30); k++) dot(x0 - 6 - (k % 10) * 3.2, (E.up.q.length > E.down.q.length ? y0 : y1) - 3 - Math.floor(k / 10) * 3.2, waitCol, 1.3); }
        c.fillStyle = muted; c.font = `600 9px ${sans}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('escalators', col.x, Y(Math.max(...S.esc.map((E) => E.e.b.z))) - 8);
      } else if (col.kind === 'stair') {
        const top = Y(F[F.length - 1].z), bot = Y(F[0].z); c.strokeStyle = ink2; c.lineWidth = 0.9; c.beginPath(); for (let i = 0; i < F.length - 1; i++) { const ya = Y(F[i].z), yb = Y(F[i + 1].z); const ym = (ya + yb) / 2; c.moveTo(col.x, ya); c.lineTo(col.x + col.w, ym); c.lineTo(col.x, yb); } c.stroke(); c.strokeStyle = line; c.strokeRect(col.x - 2, top, col.w + 4, bot - top);
        c.fillStyle = muted; c.font = `600 9px ${sans}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('stair', col.x, top - 3);
        if (S.stair) { for (const r of S.stair.riding) { const leg = r.p.legs[r.p.li]; const f = G.clamp((S.t - r.t0) / Math.max(1, r.t1 - r.t0), 0, 1); const z = F[leg.from].z + (F[leg.to].z - F[leg.from].z) * f; const fi = Math.floor(z / 3.3); const u = ((z % 3.3) / 3.3); dot(col.x + col.w * (u < 0.5 ? u * 2 : 2 - u * 2) + (r.dir === 'up' ? 0 : 4), Y(z) - 2, ridingCol, 1.3); void fi; } const nq = S.stair.q.up.length + S.stair.q.down.length; for (let k = 0; k < Math.min(nq, 30); k++) dot(col.x + col.w + 8 + (k % 10) * 3.2, Y(F[0].z) - 3 - Math.floor(k / 10) * 3.2, waitCol, 1.3); }
      }
    }
    // walking in corridors: people whose next leg has not started are drawn as queues above; nothing else to draw
    void queueX; void pedCol;
    // clock + legend
    const ran = S.pedId > 0; const clock = `${String(Math.floor(S.t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((S.t % 3600) / 60)).padStart(2, '0')}`; c.fillStyle = ran ? ink : muted; c.font = `600 12px ${mono}`; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillText(ran ? clock + (S.t < S.t0 ? ' warm-up' : '') : 'not run yet', V.w - 12, 48);
    c.fillStyle = muted; c.font = `500 10px ${sans}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText('section through the core · hover a floor for its numbers · scroll to zoom', left, V.h - 10);
  }
  function snapshot(w, h) { const off = document.createElement('canvas'); off.width = w * 2; off.height = h * 2; const save = { cv: V.cv, ctx: V.ctx, w: V.w, h: V.h, dpr: V.dpr }; V.cv = off; V.ctx = off.getContext('2d'); V.w = w; V.h = h; V.dpr = 2; try { draw(); } finally { Object.assign(V, save); } return off.toDataURL('image/png'); }
  return { mount, V, snapshot, resize, invalidate: () => { V.needs = true; } };
})();
