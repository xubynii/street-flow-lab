/* Street Flow Lab · geom.js — vector / polygon helpers, spatial grid, random numbers, binary heap. Classic script: window.Geom. */
window.Geom = (() => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pip = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
  const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
  const bbox = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; } return [x0, y0, x1, y1]; };
  const segDist = (p, a, b) => proj(p, a, b).d;
  function proj(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; const x = a[0] + t * dx, y = a[1] + t * dy; return { t, x, y, d: Math.hypot(p[0] - x, p[1] - y) }; }
  const polyLen = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; };
  /* nearest point on a polyline: {d, s (arc length), x, y, i (segment)} */
  function projPoly(p, P) { let best = { d: Infinity }; let s0 = 0; for (let i = 1; i < P.length; i++) { const r = proj(p, P[i - 1], P[i]); const sl = dist(P[i - 1], P[i]); if (r.d < best.d) best = { d: r.d, s: s0 + r.t * sl, x: r.x, y: r.y, i: i - 1 }; s0 += sl; } return best; }
  /* point at arc length s along polyline P: [x, y, angle] */
  function pointAt(P, s) { if (P.length === 1) return [P[0][0], P[0][1], 0]; let acc = 0; for (let i = 1; i < P.length; i++) { const sl = dist(P[i - 1], P[i]); if (s <= acc + sl || i === P.length - 1) { const t = sl ? Math.max(0, Math.min(1, (s - acc) / sl)) : 0; return [P[i - 1][0] + t * (P[i][0] - P[i - 1][0]), P[i - 1][1] + t * (P[i][1] - P[i - 1][1]), Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0])]; } acc += sl; } return [P[0][0], P[0][1], 0]; }
  /* split polyline at arc length s -> [P1, P2] */
  function splitPoly(P, s) { let acc = 0; for (let i = 1; i < P.length; i++) { const sl = dist(P[i - 1], P[i]); if (s <= acc + sl) { const t = sl ? (s - acc) / sl : 0; const m = [P[i - 1][0] + t * (P[i][0] - P[i - 1][0]), P[i - 1][1] + t * (P[i][1] - P[i - 1][1])]; return [P.slice(0, i).concat([m]), [m].concat(P.slice(i))]; } acc += sl; } return [P.slice(), [P[P.length - 1], P[P.length - 1]]]; }
  /* offset a polyline by d to its left (+) or right (-), mitred */
  function offsetPoly(P, d) { const n = P.length; if (n < 2) return P.slice(); const out = []; for (let i = 0; i < n; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; let dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; let nx = -dy, ny = dx; if (i > 0 && i < n - 1) { const u = [P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]], v = [P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]]; const lu = Math.hypot(u[0], u[1]) || 1, lv = Math.hypot(v[0], v[1]) || 1; const n1 = [-u[1] / lu, u[0] / lu], n2 = [-v[1] / lv, v[0] / lv]; let mx = n1[0] + n2[0], my = n1[1] + n2[1]; const lm = Math.hypot(mx, my) || 1; mx /= lm; my /= lm; const cos = mx * n1[0] + my * n1[1]; const k = Math.min(2.5, 1 / Math.max(0.35, cos)); nx = mx * k; ny = my * k; } out.push([P[i][0] + nx * d, P[i][1] + ny * d]); } return out; }
  const bearing = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  /* uniform grid over bboxes */
  /* query() marks visited items with a stamp; the counter is shared by every grid, because the items (OSM nodes, edges) outlive any one grid and a fresh grid restarting at 1 would mistake an old stamp for "already seen". */
  let GRID_STAMP = 1;
  class Grid {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    key(i, j) { return i * 73856093 ^ j * 19349663; }
    insert(item, bb) { const c = this.cell; const i0 = Math.floor(bb[0] / c), j0 = Math.floor(bb[1] / c), i1 = Math.floor(bb[2] / c), j1 = Math.floor(bb[3] / c); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = this.key(i, j); let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); } a.push(item); } }
    query(bb) { const c = this.cell; const i0 = Math.floor(bb[0] / c), j0 = Math.floor(bb[1] / c), i1 = Math.floor(bb[2] / c), j1 = Math.floor(bb[3] / c); const st = ++GRID_STAMP; const out = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.m.get(this.key(i, j)); if (!a) continue; for (const it of a) { if (it._st === st) continue; it._st = st; out.push(it); } } return out; }
    near(p, r) { return this.query([p[0] - r, p[1] - r, p[0] + r, p[1] + r]); }
  }

  /* deterministic RNG (mulberry32) */
  function rng(seed) { let a = seed >>> 0; const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; f.int = (n) => Math.floor(f() * n); f.pick = (arr) => arr[Math.floor(f() * arr.length)]; f.exp = (mean) => -Math.log(1 - f()) * mean; f.norm = () => { const u = 1 - f(), v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; f.poisson = (lam) => { if (lam <= 0) return 0; if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * f.norm())); const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= f(); } while (p > L); return k - 1; }; f.weighted = (cum) => { const r = f() * cum[cum.length - 1]; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } return lo; }; return f; }

  /* binary min-heap on (key, value) */
  class Heap { constructor() { this.k = []; this.v = []; } get size() { return this.k.length; } push(key, val) { const k = this.k, v = this.v; k.push(key); v.push(val); let i = k.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } } pop() { const k = this.k, v = this.v; const topK = k[0], topV = v[0]; const lk = k.pop(), lv = v.pop(); if (k.length) { k[0] = lk; v[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < k.length && k[l] < k[s]) s = l; if (r < k.length && k[r] < k[s]) s = r; if (s === i) break; [k[s], k[i]] = [k[i], k[s]]; [v[s], v[i]] = [v[i], v[s]]; i = s; } } return { key: topK, val: topV }; } }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, d = 0) => (v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d }));
  return { dist, pip, ringArea, centroid, bbox, segDist, proj, polyLen, projPoly, pointAt, splitPoly, offsetPoly, bearing, angDiff, Grid, rng, Heap, clamp, lerp, fmt };
})();
