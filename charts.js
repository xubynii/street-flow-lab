/* Street Flow Lab · charts.js — small SVG charts (stacked / grouped bars, lines) with a hover tooltip, plus the palette.
   Colours follow the data-viz method: categorical hues in a fixed order per entity, one-hue sequential ramp for levels of
   service, blue↔red diverging ramp around grey for change. Text always wears text tokens. */
window.Charts = (() => {
  const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  /* Palette from the Tower Design Toolkit node categories: public realm teal for people on foot, program terracotta for cars, mobility slate for transit, ecology green for bikes; the project in the accent blue, today in the "limit unknown" grey. */
  const PAL = {
    light: { walk: '#2a9d8f', car: '#b5651d', transit: '#5d6d7e', bike: '#3c8d5a', truck: '#6d4c41', pudo: '#8e5ba8', in: '#2a9d8f', out: '#b5651d', base: '#8a8f98', prop: '#1f5f8b' },
    dark: { walk: '#4fbfb1', car: '#d4844a', transit: '#8e9cab', bike: '#6db387', truck: '#9a7a6e', pudo: '#b48ac4', in: '#4fbfb1', out: '#d4844a', base: '#8a8f98', prop: '#6aa5d6' },
  };
  /* LOS: A–D a one-hue ramp in the accent blue (acceptable), E amber and F red, the toolkit's view-cone state colours. Same hue roles in both themes. */
  const LOS = { light: ['#c9d8e4', '#9db9d0', '#6b93b8', '#1f5f8b', '#d98b1c', '#d0453a'], dark: ['#b7cde0', '#8fb0cb', '#6aa5d6', '#4a90c2', '#e5b76a', '#f09a9a'] };
  const LOS_WORD = { ped: ['free', 'easy', 'busy', 'restricted', 'crowded', 'jammed'], veh: ['free', 'stable', 'busy', 'near capacity', 'at capacity', 'over capacity'], node: ['no wait', 'short wait', 'some delay', 'long delay', 'very long', 'failing'] };
  const SEQ = { light: ['#eef2f6', '#d9e4ee', '#b9cde0', '#8fb0cb', '#6b93b8', '#3f6f9c', '#1f5f8b', '#153f5c'], dark: ['#262c33', '#2a4560', '#1f5f8b', '#3f6f9c', '#4a90c2', '#6aa5d6', '#8fb0cb', '#b7cde0'] };
  const DIV = { light: { neg: ['#9db9d0', '#6b93b8', '#3f6f9c', '#1f5f8b'], mid: '#d9d7d1', pos: ['#f1b8b3', '#e68a84', '#d0453a', '#991b1b'] }, dark: { neg: ['#6aa5d6', '#8fb0cb', '#b7cde0', '#d9e4ee'], mid: '#4a4d52', pos: ['#c84a40', '#e06a60', '#f09a9a', '#f7c0bd'] } };
  const pal = () => PAL[dark() ? 'dark' : 'light'];
  const los = (g) => LOS[dark() ? 'dark' : 'light'][Math.max(0, Math.min(5, g | 0))];
  const seq = (t) => { const r = SEQ[dark() ? 'dark' : 'light']; return r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))]; };
  const div = (t) => { const d = DIV[dark() ? 'dark' : 'light']; if (Math.abs(t) < 0.08) return d.mid; const a = Math.min(3, Math.floor(Math.abs(t) * 4)); return t > 0 ? d.pos[a] : d.neg[a]; };
  const GROUPC = { light: ['#2a9d8f', '#b5651d', '#3c8d5a', '#d9a400', '#8e5ba8', '#1f5f8b', '#6d4c41', '#c0392b'], dark: ['#4fbfb1', '#d4844a', '#6db387', '#e5c04a', '#b48ac4', '#6aa5d6', '#9a7a6e', '#e46a5e'] };
  const groupColor = (i) => GROUPC[dark() ? 'dark' : 'light'][((i % 8) + 8) % 8];
  const lab = (o, k) => (o && o.labels && o.labels[k]) || LABEL[k] || k;
  const LABEL = { walk: 'Walk', transit: 'Transit (walk leg)', car: 'Car + ride-hail', bike: 'Bike', truck: 'Goods', pudo: 'Pick-up / drop-off', in: 'Arriving', out: 'Leaving', base: 'Baseline', prop: 'Proposed' };

  let tip; const tipEl = () => { if (!tip) { tip = document.createElement('div'); tip.className = 'ctip'; tip.hidden = true; document.body.appendChild(tip); } return tip; };
  const showTip = (ev, html) => { const t = tipEl(); t.innerHTML = html; t.hidden = false; const x = Math.min(innerWidth - 240, ev.clientX + 12), y = Math.max(8, ev.clientY - 10 - t.offsetHeight); t.style.left = x + 'px'; t.style.top = y + 'px'; };
  const hideTip = () => { if (tip) tip.hidden = true; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 0) => Geom.fmt(v, d);
  const niceMax = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10; return n * p; };

  /* stacked bars: rows [{h, key1, key2...}], keys in fixed order; x label from row[xKey] */
  function stackedBars(el, rows, keys, o) {
    o = Object.assign({ xKey: 'h', height: 170, unit: '', xLabel: (r) => r.h + ':00', xTick: (r, i) => i % 3 === 0, title: '' }, o || {});
    const W = Math.max(240, el.clientWidth || 320), Hh = o.height, padL = 38, padR = 8, padT = 10, padB = 22; const pw = W - padL - padR, ph = Hh - padT - padB;
    const tot = rows.map((r) => keys.reduce((s, k) => s + (r[k] || 0), 0)); const ymax = niceMax(Math.max(...tot) * 1.05); const P = Object.assign({}, pal(), o.colors || {});
    const bw = pw / rows.length; const bar = Math.max(2, bw - 2);
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="chart" role="img" aria-label="${esc(o.title)}">`;
    for (let g = 0; g <= 4; g++) { const y = padT + ph - ph * g / 4; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 3.5}" class="tick" text-anchor="end">${fmt(ymax * g / 4)}</text>`; }
    rows.forEach((r, i) => { let y0 = padT + ph; const x = padL + i * bw + (bw - bar) / 2; keys.forEach((k, ki) => { const v = r[k] || 0; if (!v) return; const h = ph * v / ymax; y0 -= h; const last = ki === keys.length - 1 || keys.slice(ki + 1).every((kk) => !r[kk]); s += `<rect x="${x}" y="${y0}" width="${bar}" height="${Math.max(0, h - 1)}" fill="${P[k]}" ${last ? 'rx="2"' : ''} data-i="${i}"/>`; }); if (o.xTick(r, i)) s += `<text x="${x + bar / 2}" y="${Hh - 6}" class="tick" text-anchor="middle">${esc(o.xLabel(r))}</text>`; s += `<rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${ph}" fill="transparent" data-i="${i}" class="hit"/>`; });
    s += '</svg>';
    s += `<div class="legend">${keys.map((k) => `<span><i style="background:${P[k]}"></i>${lab(o, k)}</span>`).join('')}</div>`;
    el.innerHTML = s;
    el.querySelectorAll('.hit').forEach((h) => { h.addEventListener('mousemove', (ev) => { const r = rows[Number(h.dataset.i)]; showTip(ev, `<b>${esc(o.xLabel(r))}</b>${keys.map((k) => `<div><i style="background:${P[k]}"></i>${lab(o, k)}: <b>${fmt(r[k])}</b> ${o.unit}</div>`).join('')}<div class="tt">Total ${fmt(keys.reduce((a, k) => a + (r[k] || 0), 0))} ${o.unit}</div>`); }); h.addEventListener('mouseleave', hideTip); });
  }
  /* grouped bars for a few categories × 2 series (baseline / proposed) */
  function groupedBars(el, rows, keys, o) {
    o = Object.assign({ height: 150, unit: '', label: (r) => r.name, title: '', max: null }, o || {});
    const W = Math.max(240, el.clientWidth || 320), Hh = o.height, padL = 34, padR = 8, padT = 10, padB = 34; const pw = W - padL - padR, ph = Hh - padT - padB;
    const ymax = o.max || niceMax(Math.max(1e-6, ...rows.flatMap((r) => keys.map((k) => r[k] || 0))) * 1.08); const P = Object.assign({}, pal(), o.colors || {});
    const gw = pw / Math.max(1, rows.length), bw = Math.max(3, Math.min(22, (gw - 8) / keys.length));
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="chart" role="img" aria-label="${esc(o.title)}">`;
    for (let g = 0; g <= 4; g++) { const y = padT + ph - ph * g / 4; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 3.5}" class="tick" text-anchor="end">${fmt(ymax * g / 4, ymax < 5 ? 1 : 0)}</text>`; }
    if (o.bands) for (const b of o.bands) { if (b.v > ymax * 0.97) continue; const y = padT + ph - ph * b.v / ymax; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="band"/><text x="${W - padR}" y="${y - 2}" class="tick" text-anchor="end">${esc(b.label)}</text>`; }
    rows.forEach((r, i) => { const x0 = padL + i * gw + (gw - bw * keys.length - 2 * (keys.length - 1)) / 2; keys.forEach((k, ki) => { const v = r[k] || 0; const h = ph * Math.min(ymax, v) / ymax; s += `<rect x="${x0 + ki * (bw + 2)}" y="${padT + ph - h}" width="${bw}" height="${h}" fill="${P[k]}" rx="2"/>`; }); const lab = o.label(r); s += `<text x="${padL + i * gw + gw / 2}" y="${Hh - 20}" class="tick" text-anchor="middle">${esc(lab.length > 14 ? lab.slice(0, 13) + '…' : lab)}</text>`; if (r.sub) s += `<text x="${padL + i * gw + gw / 2}" y="${Hh - 8}" class="tick" text-anchor="middle">${esc(r.sub)}</text>`; s += `<rect x="${padL + i * gw}" y="${padT}" width="${gw}" height="${ph}" fill="transparent" data-i="${i}" class="hit"/>`; });
    s += '</svg>' + `<div class="legend">${keys.map((k) => `<span><i style="background:${P[k]}"></i>${lab(o, k)}</span>`).join('')}</div>`;
    el.innerHTML = s;
    el.querySelectorAll('.hit').forEach((h) => { h.addEventListener('mousemove', (ev) => { const r = rows[Number(h.dataset.i)]; showTip(ev, `<b>${esc(o.label(r))}</b>${keys.map((k) => `<div><i style="background:${P[k]}"></i>${lab(o, k)}: <b>${fmt(r[k], 1)}</b> ${o.unit}</div>`).join('')}`); }); h.addEventListener('mouseleave', hideTip); });
  }
  /* single line / area */
  function line(el, rows, key, o) {
    o = Object.assign({ height: 120, unit: '', xLabel: (r) => r.h + ':00', xTick: (r, i) => i % 3 === 0, color: 'prop', ref: null }, o || {});
    const W = Math.max(240, el.clientWidth || 320), Hh = o.height, padL = 38, padR = 8, padT = 10, padB = 22; const pw = W - padL - padR, ph = Hh - padT - padB;
    const ymax = niceMax(Math.max(1e-6, ...rows.map((r) => r[key] || 0), o.ref || 0) * 1.08); const P = pal(); const c = P[o.color] || o.color;
    const X = (i) => padL + pw * (i + 0.5) / rows.length, Y = (v) => padT + ph - ph * v / ymax;
    const peak = rows.reduce((b, r) => ((r[key] || 0) > (b[key] || 0) ? r : b), rows[0] || {});
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="chart" role="img" aria-label="${esc(o.title || `${o.unit} by hour`)}: peak ${fmt(peak[key] || 0)} ${o.unit} at ${esc(o.xLabel(peak))}">`;
    for (let g = 0; g <= 4; g++) { const y = padT + ph - ph * g / 4; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 3.5}" class="tick" text-anchor="end">${fmt(ymax * g / 4)}</text>`; }
    if (o.ref) { s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" class="band"/><text x="${W - padR}" y="${Y(o.ref) - 3}" class="tick" text-anchor="end">${esc(o.refLabel || '')}</text>`; }
    const pts = rows.map((r, i) => `${X(i)},${Y(r[key] || 0)}`).join(' ');
    s += `<polygon points="${X(0)},${Y(0)} ${pts} ${X(rows.length - 1)},${Y(0)}" fill="${c}" opacity="0.12"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`;
    rows.forEach((r, i) => { if (o.xTick(r, i)) s += `<text x="${X(i)}" y="${Hh - 6}" class="tick" text-anchor="middle">${esc(o.xLabel(r))}</text>`; s += `<rect x="${X(i) - pw / rows.length / 2}" y="${padT}" width="${pw / rows.length}" height="${ph}" fill="transparent" data-i="${i}" class="hit"/>`; });
    s += '</svg>'; el.innerHTML = s;
    el.querySelectorAll('.hit').forEach((h) => { h.addEventListener('mousemove', (ev) => { const r = rows[Number(h.dataset.i)]; showTip(ev, `<b>${esc(o.xLabel(r))}</b><div>${fmt(r[key])} ${o.unit}</div>`); }); h.addEventListener('mouseleave', hideTip); });
  }
  function losLegend(el, kind) { const items = kind === 'ped' ? ['≤16', '≤23', '≤33', '≤49', '≤75', '>75'] : kind === 'node' ? ['≤10 s', '≤20', '≤35', '≤55', '≤80', '>80'] : ['≤0.6', '≤0.7', '≤0.8', '≤0.9', '≤1.0', '>1.0']; const words = LOS_WORD[kind] || LOS_WORD.ped; el.innerHTML = `<div class="loslegend"><span><abbr title="Level of service, A (best) to F (worst)">LOS</abbr></span>${items.map((t, i) => `<span title="${Analysis.LETTER[i]}: ${words[i]}, ${t} ${kind === 'ped' ? 'p/min/m' : kind === 'node' ? 's delay' : 'v/c'}"><i style="background:${los(i)}"></i>${Analysis.LETTER[i]} <em>${words[i]}</em></span>`).join('')}<small class="unit">${kind === 'ped' ? 'pedestrians per minute per metre of sidewalk' : kind === 'node' ? 'control delay (signalised)' : 'volume / capacity'}</small></div>`; }
  function divLegend(el, label) { const d = DIV[dark() ? 'dark' : 'light']; el.innerHTML = `<div class="loslegend"><span><i style="background:${d.neg[2]}"></i>less</span><span><i style="background:${d.mid}"></i>≈ same</span><span><i style="background:${d.pos[2]}"></i>more</span><small class="unit">${esc(label)}</small></div>`; }
  const losWord = (kind, g) => (LOS_WORD[kind] || LOS_WORD.ped)[Math.max(0, Math.min(5, g | 0))];
  return { pal, los, losWord, seq, div, LABEL, groupColor, stackedBars, groupedBars, line, losLegend, divLegend, showTip, hideTip, dark };
})();
