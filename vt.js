/* Street Flow Lab · vt.js — inside the tower: the vertical stack from the blocks, lift demand per floor from the same trip
   generation as the street model, an up-peak round-trip-time lift model (Barney / CIBSE Guide D form), and a placement
   critique. Everything is an estimate for design comparison; a lift traffic study needs a dispatcher simulation. */
window.VT = (() => {
  const USES = () => Demand.USES;
  const DEFAULTS = { lifts: 0, cap: 13, speed: 0, door: 4.0, stairShare: 0.5, internalShare: 0.5 }; // 0 = automatic
  const VISITOR = { retail: 1, restaurant: 1, school: 1, amenity: 0.6 }; // uses whose people are mostly visitors from the street
  const BAND = { office: [30, 40], hotel: [40, 55], residential: [50, 70], amenity: [40, 55], retail: [35, 45], restaurant: [35, 45], school: [35, 45] }; // interval s: good ≤, fair ≤

  /* floors from blocks: one entry per slab level, parts by use */
  function stack(blocks) {
    const slabs = [];
    for (const b of blocks) { if (b.use === 'core' || !(b.floors > 0)) continue; const f2f = b.f2f || 3.3; for (let k = 0; k < b.floors; k++) { const z = Math.round((b.z0 + k * f2f) * 2) / 2; let f = slabs.find((s) => Math.abs(s.z - z) < 0.75); if (!f) { f = { z, h: f2f, parts: [] }; slabs.push(f); } f.h = Math.max(f.h, f2f); f.parts.push({ use: b.use, area: b.w * b.d, name: b.name }); } }
    slabs.sort((a, b) => a.z - b.z);
    let above = 0, below = 0; for (const s of slabs) { if (s.z >= -0.5) { above++; s.level = above; s.label = above === 1 ? 'G' : 'L' + above; } }
    for (let i = slabs.length - 1; i >= 0; i--) { const s = slabs[i]; if (s.z < -0.5) { below++; s.level = -below; s.label = 'P' + below; } }
    for (const s of slabs) { s.area = s.parts.reduce((a, p) => a + p.area, 0); s.use = s.parts.slice().sort((a, b) => b.area - a.area)[0].use; }
    return slabs;
  }

  /* per-floor hourly lift passengers: external arrivals/departures of the floor's uses (all modes; car arrivals board at parking) plus internal visits */
  function analyse(blocks, P, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {}); const U = USES(); const slabs = stack(blocks);
    const aboveAll = slabs.filter((s) => s.level >= 1); const served = aboveAll.filter((s) => s.level >= 2); const parkingLv = slabs.filter((s) => s.level < 0 && s.use === 'parking');
    const uses = {}; for (const s of slabs) for (const p of s.parts) if (p.use !== 'parking') uses[p.use] = (uses[p.use] || 0) + p.area;
    const hasHome = !!(uses.residential || uses.hotel), hasWork = !!uses.office;
    const n = served.length; const df = served.length ? served.reduce((a, s) => a + s.h, 0) / served.length : 3.3; const travel = served.length ? served[served.length - 1].z : 0;
    // hourly up / down / interfloor per served floor
    const perFloor = served.map((s) => ({ s, up: new Array(24).fill(0), down: new Array(24).fill(0), internal: new Array(24).fill(0), pop: 0 }));
    let groundTrips = 0, internalDaily = 0;
    for (const s of aboveAll) {
      const f = perFloor.find((x) => x.s === s); const stairs = s.level >= 2 && s.level <= 3 ? o.stairShare : 0;
      for (const p of s.parts) {
        const use = U[p.use]; if (!use || !use.rate) continue; const prof = Demand.useProfile(p.use, p.area, P);
        const pop = use.unit ? p.area / use.unit * (p.use === 'residential' ? 1.9 : p.use === 'hotel' ? 1.3 : 1) : p.area / 100;
        if (!f) { groundTrips += prof.daily.total; continue; }
        f.pop += pop;
        const intShare = (p.use === 'amenity' || p.use === 'restaurant' || p.use === 'retail') && (hasHome || hasWork) ? o.internalShare * (VISITOR[p.use] || 1) : 0;
        for (let h = 0; h < 24; h++) { const i = prof.in[h].total, ou = prof.out[h].total; f.up[h] += i * (1 - intShare) * (1 - stairs); f.down[h] += ou * (1 - intShare) * (1 - stairs); f.internal[h] += (i + ou) * intShare; }
        internalDaily += prof.daily.total * intShare;
      }
    }
    const tot = new Array(24).fill(0), upH = new Array(24).fill(0), dnH = new Array(24).fill(0), inH = new Array(24).fill(0);
    for (const f of perFloor) for (let h = 0; h < 24; h++) { upH[h] += f.up[h]; dnH[h] += f.down[h]; inH[h] += f.internal[h]; tot[h] += f.up[h] + f.down[h] + f.internal[h]; }
    let ph = 0; tot.forEach((v, h) => { if (v > tot[ph]) ph = h; });
    const peak5 = tot[ph] / 12 * 1.25, up5 = upH[ph] / 12 * 1.25, down5 = dnH[ph] / 12 * 1.25, int5 = inH[ph] / 12 * 1.25;
    const upShare = tot[ph] ? (upH[ph] + inH[ph] / 2) / tot[ph] : 0.5;
    const popAbove = perFloor.reduce((a, f) => a + f.pop, 0);
    // lift group
    const autoLifts = () => { let k = 0; for (const u in uses) k += u === 'office' ? uses[u] / 4500 : u === 'residential' ? uses[u] / U.residential.unit / 75 : u === 'hotel' ? uses[u] / U.hotel.unit / 120 : uses[u] / 7000; return Math.max(n >= 3 ? 2 : 1, Math.round(k)); };
    const N = o.lifts > 0 ? o.lifts : autoLifts(); const v = o.speed > 0 ? o.speed : travel <= 30 ? 1.6 : travel <= 60 ? 2.5 : travel <= 100 ? 3.5 : travel <= 150 ? 5 : 6;
    const CC = o.cap; const Pl = Math.max(1, Math.round(CC * 0.8)); const a = 1.0, tp = 1.2, door = o.door;
    const demandShare = perFloor.map((f) => f.up[ph] + f.internal[ph] / 2 + 1e-6); const Ds = demandShare.reduce((x, y) => x + y, 0);
    const rtt = (floors, lifts) => { // floors: indices into perFloor served by this group
      if (!floors.length) return { RTT: 0, INT: 0, HC5: Infinity, S: 0, H: 0 };
      const sh = floors.map((i) => demandShare[i] / Ds); const sum = sh.reduce((x, y) => x + y, 0) || 1; const w = sh.map((x) => x / sum);
      let S = 0; for (const x of w) S += 1 - Math.pow(1 - x, Pl);
      let H = floors.length; let c = 0; for (let i = 0; i < floors.length - 1; i++) { c += w[i]; H -= Math.pow(c, Pl); }
      const top = perFloor[floors[floors.length - 1]].s.z; const tv = df / v; const express = Math.max(0, perFloor[floors[0]].s.z - df) / v; // run past unserved floors
      const ts = v / a + door; const RTT = 2 * H * tv + 2 * express + (S + 1) * ts + 2 * Pl * tp; const INT = RTT / lifts; return { RTT, INT, HC5: 300 * Pl / INT, S, H, top };
    };
    const all = perFloor.map((_, i) => i); const one = rtt(all, N); const plus1 = rtt(all, N + 1), plus2 = rtt(all, N + 2);
    let zoned = null; if (n >= 10 && N >= 3) { const k = Math.ceil(n / 2); const lo = all.slice(0, k), hi = all.slice(k); const nl = Math.floor(N / 2), nh = N - nl; const zl = rtt(lo, nl), zh = rtt(hi, nh); zoned = { lo: zl, hi: zh, split: perFloor[k - 1].s.label, nl, nh, worst: Math.max(zl.INT, zh.INT) }; }
    const utilisation = one.HC5 ? peak5 / one.HC5 : 0;
    const wait = one.INT ? (utilisation < 0.5 ? one.INT * 0.5 : utilisation <= 1 ? one.INT * (0.4 + 1.8 * (utilisation - 0.5) ** 2) : one.INT * 0.85 + 150 * (utilisation - 1)) : 0;
    const queue = peak5 / 300 * wait + Math.max(0, peak5 - one.HC5); // people waiting at the lobby in the peak 5 minutes (Little's law + overflow)
    const bandFor = () => { let g = 999, f = 999; for (const u in uses) if (BAND[u] && uses[u] > 0.08 * Object.values(uses).reduce((x, y) => x + y, 0)) { g = Math.min(g, BAND[u][0]); f = Math.min(f, BAND[u][1]); } if (g === 999) { g = 40; f = 55; } return [g, f]; };
    const [bg, bf] = bandFor(); const band = !n ? 'none' : one.INT <= bg ? 'good' : one.INT <= bf ? 'fair' : 'poor';
    const capOk = one.HC5 >= peak5;
    const dominant = Object.keys(uses).sort((x, y) => uses[y] - uses[x])[0] || null;
    const res = { slabs, served, perFloor, uses, n, df, travel, N, autoN: autoLifts(), v, CC, Pl, peakHour: ph, peak5, up5, down5, int5, upShare, popAbove, groundTrips, internalDaily, one, plus1, plus2, zoned, utilisation, wait, queue, band, bandLimits: [bg, bf], capOk, dominant, parkingLevels: parkingLv.length, hourly: { tot, up: upH, down: dnH, internal: inH } };
    res.advice = advice(res, P);
    return res;
  }

  const fmt = (v, d = 0) => Geom.fmt(v, d); const hh = (h) => `${h}:00–${h + 1}:00`;
  function advice(r, P) {
    const out = []; const U = USES(); const lab = (u) => U[u].label.toLowerCase();
    if (!r.n) { out.push({ k: 'ok', t: 'Nothing above the ground floor needs a lift. The street doors carry everything.' }); return out; }
    // 1. visitor uses placed above the lobby
    for (const f of r.perFloor) for (const p of f.s.parts) { if (!VISITOR[p.use]) continue; const prof = Demand.useProfile(p.use, p.area, P); const rides = (prof.in[r.peakHour].total + prof.out[r.peakHour].total); if (rides < 15) continue; out.push({ k: rides > 150 ? 'bad' : 'warn', t: `${U[p.use].label} on ${f.s.label} sends about ${fmt(rides)} visitor rides an hour through the lifts in the ${hh(r.peakHour)} peak. At ground the same people would use the street doors and never reach the lobby.` }); }
    // 2. amenity for residents high in the tower
    for (const f of r.perFloor) for (const p of f.s.parts) { if (p.use !== 'amenity' || !(r.uses.residential || r.uses.office)) continue; const prof = Demand.useProfile(p.use, p.area, P); const internal = prof.daily.total * 0.5; if (f.s.level >= 5) out.push({ k: 'warn', t: `The amenity on ${f.s.label} is reached only by lift: about ${fmt(internal)} internal visits a day ride up and down inside the building (assumed ${Math.round(50)}% of its use is internal, so they are not on the street). On a podium level (L2–L4) roughly half of those would take the stairs.` }); else if (f.s.level >= 2) out.push({ k: 'ok', t: `The amenity on ${f.s.label} is low enough that about half its internal visits (${fmt(internal * 0.5)} a day) can take the stairs.` }); }
    // 3. home and work on one group
    if ((r.uses.residential || r.uses.hotel) && r.uses.office) { const up = r.hourly.up, dn = r.hourly.down; let am = 0, pm = 0; for (let h = 7; h < 10; h++) am += up[h]; for (let h = 16; h < 20; h++) pm += dn[h] + up[h]; out.push({ k: 'warn', t: `Office and ${r.uses.residential ? 'homes' : 'hotel rooms'} share one lift group: the office morning up-peak (${fmt(am / 3)} rides an hour, 7:00–10:00) and the residential evening two-way peak (${fmt(pm / 4)} an hour, 16:00–20:00) load it at different times, and residents ride with the office crowd in between. A separate residential group, or a sky-lobby transfer, keeps the two apart.` }); }
    // 4. parking rides
    if (r.parkingLevels) { let cars = 0; for (const f of r.perFloor) for (const p of f.s.parts) { const prof = Demand.useProfile(p.use, p.area, P); cars += prof.in[r.peakHour].car + prof.out[r.peakHour].car; } if (cars > 5) out.push({ k: 'ok', t: `About ${fmt(cars)} people an hour ride between the ${r.parkingLevels} parking level${r.parkingLevels > 1 ? 's' : ''} and their floors in the peak. Making them change at the lobby adds a ride for each but keeps the parking off the main group and lets the lobby see who comes in.` }); }
    // 5. capacity verdict
    const o = r.one; const bandWord = { good: 'good', fair: 'fair', poor: 'poor' }[r.band] || '';
    out.push({ k: r.band === 'poor' || !r.capOk ? 'bad' : r.band === 'fair' ? 'warn' : 'ok', t: `${r.N} lift${r.N > 1 ? 's' : ''} of ${r.CC} persons at ${r.v} m/s serving ${r.n} floors: round trip ${fmt(o.RTT)} s, interval ${fmt(o.INT)} s (${bandWord} for this mix: good ≤ ${r.bandLimits[0]} s, fair ≤ ${r.bandLimits[1]} s). Capacity ${fmt(o.HC5)} people per 5 minutes against a peak need of ${fmt(r.peak5)} at ${hh(r.peakHour)}${r.capOk ? '.' : `: short by ${fmt(r.peak5 - o.HC5)}, so queues build at the lobby.`} With one more lift the interval is ${fmt(r.plus1.INT)} s; with two more, ${fmt(r.plus2.INT)} s.` });
    // 6. zoning
    if (r.zoned && r.zoned.worst < o.INT * 0.85) out.push({ k: 'ok', t: `Above about ten floors one group spends most of its round trip travelling. Two zones, ${r.zoned.nl} lift${r.zoned.nl > 1 ? 's' : ''} to ${r.zoned.split} and ${r.zoned.nh} above it, give intervals of ${fmt(r.zoned.lo.INT)} s and ${fmt(r.zoned.hi.INT)} s with the same ${r.N} cars.` });
    // 7. lobby
    if (r.queue > 8) out.push({ k: r.queue > 25 ? 'bad' : 'warn', t: `About ${fmt(r.queue)} people wait in the lobby at the peak (average wait ${fmt(r.wait)} s). The lobby and the main entrance sidewalk have to hold that group without blocking the retail doors.` });
    return out;
  }

  /* SVG: the stack on the left (floor height to scale, width by floor area), lift rides per hour at the peak on the right */
  function stackSvg(r, o) {
    o = Object.assign({ width: 360, floorMax: 11 }, o || {}); const W = o.width; const slabs = r.slabs; if (!slabs.length) return '';
    const USE_FILL = { residential: '--res', hotel: '--hotel', office: '--office', retail: '--retail', restaurant: '--restaurant', amenity: '--amenity', parking: '--parking', core: '--core', school: '--amenity' };
    const USE_LINE = { residential: '--res-line', hotel: '--hotel-line', office: '--office-line', retail: '--retail-line', restaurant: '--restaurant-line', amenity: '--amenity-line', parking: '--parking-line', core: '--core-line', school: '--amenity-line' };
    const zmin = slabs[0].z, zmax = slabs[slabs.length - 1].z + slabs[slabs.length - 1].h; const px = Math.min(o.floorMax, Math.max(5, 420 / (zmax - zmin) * 3.3)) / 3.3; // px per metre
    const Hh = Math.ceil((zmax - zmin) * px) + 26; const left = 34, stackW = 150, gap = 16, barsX = left + stackW + gap, barsW = W - barsX - 8;
    const maxA = Math.max(...slabs.map((s) => s.area)); const peakRides = Math.max(1, ...r.perFloor.map((f) => f.up[r.peakHour] + f.down[r.peakHour] + f.internal[r.peakHour]));
    const Y = (z) => 14 + (zmax - z) * px; const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="chart stack" role="img" aria-label="Stack of ${slabs.length} floors with lift rides per hour at the peak">`;
    s += `<line x1="${left}" x2="${left + stackW}" y1="${Y(0)}" y2="${Y(0)}" class="ground"/>`;
    for (const sl of slabs) { const y = Y(sl.z + sl.h), h = Math.max(2, sl.h * px - 1); let x = left + (stackW - stackW * Math.sqrt(sl.area / maxA)) / 2; const w = stackW * Math.sqrt(sl.area / maxA); let xx = x; for (const p of sl.parts) { const pw = w * p.area / sl.area; s += `<rect x="${xx.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, pw - 0.5).toFixed(1)}" height="${h.toFixed(1)}" fill="var(${USE_FILL[p.use] || '--context'})" stroke="var(${USE_LINE[p.use] || '--context-edge'})" stroke-width="0.6"><title>${esc(sl.label)} · ${esc(Demand.USES[p.use] ? Demand.USES[p.use].label : p.use)} · ${fmt(p.area)} m²</title></rect>`; xx += pw; } if (sl.level === 1 || sl.level % 5 === 0 || sl === slabs[slabs.length - 1] || sl.level < 0) s += `<text x="${left - 5}" y="${(y + h / 2 + 3.5).toFixed(1)}" class="tick" text-anchor="end">${esc(sl.label)}</text>`; }
    const upC = Charts.pal().prop, dnC = Charts.pal().base, inC = Charts.pal().transit;
    for (const f of r.perFloor) { const sl = f.s; const y = Y(sl.z + sl.h), h = Math.max(2, sl.h * px - 1); const u = f.up[r.peakHour], d = f.down[r.peakHour], i = f.internal[r.peakHour]; const k = barsW / peakRides; s += `<rect x="${barsX}" y="${y.toFixed(1)}" width="${(u * k).toFixed(1)}" height="${h.toFixed(1)}" fill="${upC}"/><rect x="${(barsX + u * k).toFixed(1)}" y="${y.toFixed(1)}" width="${(d * k).toFixed(1)}" height="${h.toFixed(1)}" fill="${dnC}"/><rect x="${(barsX + (u + d) * k).toFixed(1)}" y="${y.toFixed(1)}" width="${(i * k).toFixed(1)}" height="${h.toFixed(1)}" fill="${inC}"/>`; }
    s += `<text x="${barsX}" y="${Hh - 4}" class="tick">0</text><text x="${barsX + barsW}" y="${Hh - 4}" class="tick" text-anchor="end">${fmt(peakRides)} rides/h at ${r.peakHour}:00</text></svg>`;
    s += `<div class="legend"><span><i style="background:${upC}"></i>Up from the lobby</span><span><i style="background:${dnC}"></i>Down to the lobby</span><span><i style="background:${inC}"></i>Between floors</span></div>`;
    return s;
  }

  return { DEFAULTS, stack, analyse, stackSvg };
})();
