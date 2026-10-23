"""Fetch OpenStreetMap buildings (context model with heights) (and building parts) for the downtown Vancouver peninsula from Overpass and write
src/osm-data.js in the same local metre frame as city-data.js (origin -123.118, 49.283; x east, y north).

python tools/fetch-osm-buildings.py            -> src/osm-data.js (window.OSM = {meta, b:[{h, z0?, p:[[x,y],...], n?, lv?, src}]})
Heights: height=* (m or ft) > building:levels*3.2 (+ roof:levels*3.2) > est:height > null (filled later from the City data).
"""
import json, re, sys, time, urllib.request, urllib.parse, os

ORIGIN = (-123.118, 49.283)
SCALE = (72616.63177192718, 110574.0)     # metres per degree of longitude / latitude at the origin (matches city-data.js)
BBOX = (49.268, -123.152, 49.302, -123.090)  # south, west, north, east: Downtown + West End + Yaletown + Coal Harbour
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'osm-data.js')
RAW = os.path.join(os.path.dirname(__file__), '..', 'docs', 'osm-raw.json')

QUERY = f"""[out:json][timeout:180];
(
  way["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["building"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  way["building:part"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  relation["building:part"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body geom;"""

def fetch():
    if os.path.exists(RAW) and os.path.getsize(RAW) > 100000 and '--refresh' not in sys.argv:
        print('using cached', RAW); return json.load(open(RAW, encoding='utf-8'))
    for url in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
        try:
            print('fetching', url); t = time.time()
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(), headers={'User-Agent': 'street-flow-lab/1.0 (contact: choisinnie@gmail.com)'})
            with urllib.request.urlopen(req, timeout=240) as r: data = json.load(r)
            print('got', len(data.get('elements', [])), 'elements in', round(time.time() - t, 1), 's')
            json.dump(data, open(RAW, 'w', encoding='utf-8')); return data
        except Exception as e: print('failed', url, e)
    sys.exit('no Overpass mirror answered')

def to_local(lon, lat): return [round((lon - ORIGIN[0]) * SCALE[0], 1), round((lat - ORIGIN[1]) * SCALE[1], 1)]
def num(s):
    if s is None: return None
    m = re.match(r'^\s*(-?[\d.]+)\s*(m|ft|feet|\')?\s*$', str(s));
    if not m: return None
    v = float(m.group(1)); return v * 0.3048 if m.group(2) in ('ft', 'feet', "'") else v
def height_of(t):
    h = num(t.get('height'));
    if h: return round(h, 1), 'height'
    lv = num(t.get('building:levels'));
    if lv: return round(lv * 3.2 + (num(t.get('roof:levels')) or 0) * 3.2, 1), 'levels'
    e = num(t.get('est_height')) or num(t.get('est:height'))
    if e: return round(e, 1), 'est'
    return None, None

def ring_area(r):
    a = 0
    for i in range(len(r)): p, q = r[i], r[(i + 1) % len(r)]; a += p[0] * q[1] - q[0] * p[1]
    return a / 2

def main():
    data = fetch(); out = []; parts = 0; skipped = 0
    for el in data['elements']:
        t = el.get('tags', {}); is_part = 'building:part' in t and t.get('building:part') not in ('no',)
        if t.get('building') in ('no',) and not is_part: continue
        rings = []
        if el['type'] == 'way' and 'geometry' in el:
            rings = [[to_local(p['lon'], p['lat']) for p in el['geometry']]]
        elif el['type'] == 'relation':
            for m in el.get('members', []):
                if m.get('role') in ('outer', '') and 'geometry' in m: rings.append([to_local(p['lon'], p['lat']) for p in m['geometry']])
        for ring in rings:
            if len(ring) > 1 and ring[0] == ring[-1]: ring = ring[:-1]
            if len(ring) < 3 or abs(ring_area(ring)) < 4: skipped += 1; continue
            h, src = height_of(t); z0 = num(t.get('min_height')) or (num(t.get('building:min_level')) or 0) * 3.2 or 0
            rec = {'p': ring, 'h': h, 'src': src or 'none', 'id': f"{el['type'][0]}{el['id']}"}
            if z0: rec['z0'] = round(z0, 1)
            if is_part: rec['part'] = 1; parts += 1
            if t.get('name'): rec['n'] = t['name']
            lv = num(t.get('building:levels'))
            if lv: rec['lv'] = lv
            out.append(rec)
    # a building that is fully described by its parts keeps only the parts (avoid double extrusion)
    part_ids = {r['id'] for r in out if r.get('part')}
    meta = {'source': 'OpenStreetMap contributors, via Overpass API', 'fetched': time.strftime('%Y-%m-%d'), 'bbox': BBOX, 'origin': ORIGIN, 'scale': SCALE, 'count': len(out), 'parts': parts,
            'with_height': sum(1 for r in out if r['h']), 'license': 'ODbL 1.0 (openstreetmap.org/copyright)'}
    js = 'window.OSM=' + json.dumps({'meta': meta, 'b': out}, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(OUT, 'w', encoding='utf-8').write(js)
    print('wrote', OUT, round(len(js) / 1e6, 2), 'MB', meta)

if __name__ == '__main__': main()
