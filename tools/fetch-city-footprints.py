"""Refresh the City of Vancouver building footprints (with heights) inside src/city-data.js from the Open Data Portal.

python tools/fetch-city-footprints.py             -> rewrites the `foot` layer of src/city-data.js ([{h, p:[[x,y],...]}])
python tools/fetch-city-footprints.py --dry-run   -> downloads and reports, writes nothing
python tools/fetch-city-footprints.py --dataset building-footprints-2009

Dataset: building-footprints-2009 (LiDAR-derived; fields hgt_agl = height above ground, topelev_m, baseelev_m). The portal's
Explore API v2.1 is queried with an in_bbox filter for the downtown peninsula, paged 100 records at a time. Coordinates are
converted to the same local metre frame as the rest of city-data.js (origin -123.118, 49.283; x east, y north).
Raw download is cached in docs/city-footprints-raw.json; pass --refresh to download again.
"""
import json, os, sys, time, urllib.parse, urllib.request

ORIGIN = (-123.118, 49.283)
SCALE = (72616.63177192718, 110574.0)
BBOX = (49.268, -123.152, 49.302, -123.090)  # south, west, north, east
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'city-data.js')
RAW = os.path.join(HERE, '..', 'docs', 'city-footprints-raw.json')
DATASET = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--dataset=')), 'building-footprints-2009')
if '--dataset' in sys.argv: DATASET = sys.argv[sys.argv.index('--dataset') + 1]
BASE = f'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/{DATASET}/records'


def fetch():
    if os.path.exists(RAW) and os.path.getsize(RAW) > 10000 and '--refresh' not in sys.argv:
        print('using cached', RAW); return json.load(open(RAW, encoding='utf-8'))
    where = f'in_bbox(geo_point_2d,{BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]})'
    recs, offset, t = [], 0, time.time()
    while True:
        q = urllib.parse.urlencode({'where': where, 'limit': 100, 'offset': offset, 'select': 'bldgid,hgt_agl,topelev_m,baseelev_m,geom'})
        req = urllib.request.Request(f'{BASE}?{q}', headers={'User-Agent': 'street-flow-lab/1.0 (contact: choisinnie@gmail.com)'})
        with urllib.request.urlopen(req, timeout=120) as r: d = json.load(r)
        rows = d.get('results', []); recs.extend(rows); offset += len(rows)
        if offset % 2000 < 100: print(f'  {offset} / {d.get("total_count", "?")} records', flush=True)
        if not rows or offset >= d.get('total_count', 0) or offset >= 10000: break  # the API caps offset+limit at 10000
    print('downloaded', len(recs), 'records in', round(time.time() - t, 1), 's')
    os.makedirs(os.path.dirname(RAW), exist_ok=True); json.dump(recs, open(RAW, 'w', encoding='utf-8'))
    return recs


def to_local(lon, lat): return [round((lon - ORIGIN[0]) * SCALE[0], 1), round((lat - ORIGIN[1]) * SCALE[1], 1)]


def rings(geom):
    """Outer rings of a Polygon / MultiPolygon GeoJSON geometry (the portal wraps it as {geometry: {...}})."""
    g = geom.get('geometry', geom) if isinstance(geom, dict) else None
    if not g: return []
    if g.get('type') == 'Polygon': return [g['coordinates'][0]]
    if g.get('type') == 'MultiPolygon': return [p[0] for p in g['coordinates']]
    return []


def main():
    recs = fetch(); foot = []; noh = 0
    for r in recs:
        h = r.get('hgt_agl')
        if h is None and r.get('topelev_m') is not None and r.get('baseelev_m') is not None: h = r['topelev_m'] - r['baseelev_m']
        if h is None: noh += 1; h = 6.0
        for ring in rings(r.get('geom')):
            p = [to_local(*c[:2]) for c in ring]
            if len(p) > 2 and p[0] == p[-1]: p = p[:-1]
            if len(p) >= 3: foot.append({'h': round(max(2.5, float(h)), 1), 'p': p})
    print(f'{len(foot)} footprints ({noh} without a height, set to 6 m)')
    if '--dry-run' in sys.argv: print('dry run, nothing written'); return
    src = open(OUT, encoding='utf-8').read(); i = src.index('{'); prefix = src[:i]; body = src[i:].rstrip().rstrip(';')
    data = json.loads(body); before = len(data.get('foot', []))
    data['foot'] = foot
    meta = data.setdefault('meta', {}); meta['footprints'] = {'dataset': DATASET, 'fetched': time.strftime('%Y-%m-%d'), 'count': len(foot)}
    open(OUT, 'w', encoding='utf-8').write(prefix + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f'wrote {OUT}: foot {before} -> {len(foot)}')


if __name__ == '__main__': main()
