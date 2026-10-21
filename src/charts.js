/* Street Flow Lab · charts.js — small SVG charts (stacked / grouped bars, lines) with a hover tooltip, plus the palette.
   Colours follow the data-viz method: categorical hues in a fixed order per entity, one-hue sequential ramp for levels of
   service, blue↔red diverging ramp around grey for change. Text always wears text tokens. */
window.Charts = (() => {
  const dark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const PAL = {
    light: { walk: '#2a78d6', car: '#eb6834', transit: '#1baf7a', bike: '#eda100', truck: '#4a3aa7', pudo: '#e87ba4', in: '#2a78d6', out: '#eb6834', base: '#9a9893', prop: '#2a78d6' },
    dark: { walk: '#3987e5', car: '#d95926', transit: '#199e70', bike: '#c98500', truck: '#9085e9', pudo: '#d55181', in: '#3987e5', out: '#d95926', base: '#7d7b76', prop: '#3987e5' },
  };
  const LOS = { light: ['#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'], dark: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'] };
  const SEQ = { light: ['#e8f0fb', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'], dark: ['#26303d', '#1c3a5e', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'] };
  const DIV = { light: { neg: ['#9ec5f4', '#5598e7', '#256abf', '#104281'], mid: '#dedcd6', pos: ['#f3b6b3', '#ea8886', '#dc4d4b', '#a3202a'] }, dark: { neg: ['#6da7ec', '#9ec5f4', '#b7d3f6', '#cde2fb'], mid: '#4a4844', pos: ['#c4504e', '#dc6b69', '#ec8f8d', '#f5b2b0'] } };
  const pal = () => PAL[dark() ? 'dark' : 'light'];
  const los = (g) => LOS[dark() ? 'dark' : 'light'][Math.max(0, Math.min(5, g | 0))];
  const seq = (t) => { const r = SEQ[dark() ? 'dark' : 'light']; return r[Math.max(0, Math.min(r.length - 1, Math.floor(t * r.length)))]; };
  const div = (t) => { const d = DIV[dark() ? 'dark' : 'light']; if (Math.abs(t) < 0.08) return d.mid; const a = Math.min(3, Math.floor(Math.abs(t) * 4)); return t > 0 ? d.pos[a] : d.neg[a]; };
  const GROUPC = { light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'], dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] };
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
    if (o.bands) for (const b of o.bands) { const y = padT + ph - ph * Math.min(ymax, b.v) / ymax; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="band"/><text x="${W - padR}" y="${y - 2}" class="tick" text-anchor="end">${esc(b.label)}</text>`; }
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
    let s = `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" class="chart">`;
    for (let g = 0; g <= 4; g++) { const y = padT + ph - ph * g / 4; s += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="grid"/><text x="${padL - 6}" y="${y + 3.5}" class="tick" text-anchor="end">${fmt(ymax * g / 4)}</text>`; }
    if (o.ref) { s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(o.ref)}" y2="${Y(o.ref)}" class="band"/><text x="${W - padR}" y="${Y(o.ref) - 3}" class="tick" text-anchor="end">${esc(o.refLabel || '')}</text>`; }
    const pts = rows.map((r, i) => `${X(i)},${Y(r[key] || 0)}`).join(' ');
    s += `<polygon points="${X(0)},${Y(0)} ${pts} ${X(rows.length - 1)},${Y(0)}" fill="${c}" opacity="0.12"/><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`;
    rows.forEach((r, i) => { if (o.xTick(r, i)) s += `<text x="${X(i)}" y="${Hh - 6}" class="tick" text-anchor="middle">${esc(o.xLabel(r))}</text>`; s += `<rect x="${X(i) - pw / rows.length / 2}" y="${padT}" width="${pw / rows.length}" height="${ph}" fill="transparent" data-i="${i}" class="hit"/>`; });
    s += '</svg>'; el.innerHTML = s;
    el.querySelectorAll('.hit').forEach((h) => { h.addEventListener('mousemove', (ev) => { const r = rows[Number(h.dataset.i)]; showTip(ev, `<b>${esc(o.xLabel(r))}</b><div>${fmt(r[key])} ${o.unit}</div>`); }); h.addEventListener('mouseleave', hideTip); });
  }
  function losLegend(el, kind) { const items = kind === 'ped' ? ['≤16', '≤23', '≤33', '≤49', '≤75', '>75'] : kind === 'node' ? ['≤10 s', '≤20', '≤35', '≤55', '≤80', '>80'] : ['≤0.6', '≤0.7', '≤0.8', '≤0.9', '≤1.0', '>1.0']; el.innerHTML = `<div class="loslegend">${items.map((t, i) => `<span><i style="background:${los(i)}"></i>${Analysis.LETTER[i]} <small>${t}</small></span>`).join('')}<small class="unit">${kind === 'ped' ? 'p/min per m of sidewalk' : kind === 'node' ? 'control delay (signalised)' : 'volume / capacity'}</small></div>`; }
  function divLegend(el, label) { const d = DIV[dark() ? 'dark' : 'light']; el.innerHTML = `<div class="loslegend"><span><i style="background:${d.neg[2]}"></i>less</span><span><i style="background:${d.mid}"></i>≈ same</span><span><i style="background:${d.pos[2]}"></i>more</span><small class="unit">${esc(label)}</small></div>`; }
  return { pal, los, seq, div, LABEL, groupColor, stackedBars, groupedBars, line, losLegend, divLegend, showTip, hideTip, dark };
})();
