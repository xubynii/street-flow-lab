"""Fetch the OpenStreetMap street network, crossings, signals and transit stops for the downtown Vancouver peninsula
and write src/osm-streets.js in the local metre frame shared with city-data.js / osm-data.js (origin -123.118, 49.283).

python tools/fetch-osm-streets.py [--refresh]   -> src/osm-streets.js
window.OSMS = {meta, ways:[{id, hw, n, lanes, ow, speed, p:[[x,y]...], nodes:[id...]}], nodes:{id:{k, x, y}}, stops:[{t, n, x, y}]}
"""
import json, re, sys, time, urllib.request, urllib.parse, os
from collections import Counter

ORIGIN = (-123.118, 49.283)
SCALE = (72616.63177192718, 110574.0)
BBOX = (49.268, -123.152, 49.302, -123.090)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'src', 'osm-streets.js')
RAW = os.path.join(HERE, '..', 'docs', 'osm-streets-raw.json')

QUERY = f"""[out:json][timeout:180];
(
  way["highway"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["highway"~"traffic_signals|crossing|bus_stop|stop"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["railway"~"station|subway_entrance|tram_stop"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["public_transport"~"platform|station"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["amenity"="ferry_terminal"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body geom;"""


def fetch():
    if os.path.exists(RAW) and os.path.getsize(RAW) > 100000 and '--refresh' not in sys.argv:
        print('using cached', RAW)
        return json.load(open(RAW, encoding='utf-8'))
    for url in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']:
        try:
            print('fetching', url); t = time.time()
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': QUERY}).encode(),
                                         headers={'User-Agent': 'flowsim-street-flow-lab/1.0 (contact: choisinnie@gmail.com)'})
            with urllib.request.urlopen(req, timeout=240) as r:
                data = json.load(r)
            print('got', len(data.get('elements', [])), 'elements in', round(time.time() - t, 1), 's')
            json.dump(data, open(RAW, 'w', encoding='utf-8'))
            return data
        except Exception as e:
            print('failed', url, e)
    sys.exit('no Overpass mirror answered')


def to_local(lon, lat):
    return [round((lon - ORIGIN[0]) * SCALE[0], 1), round((lat - ORIGIN[1]) * SCALE[1], 1)]


def num(s):
    if s is None:
        return None
    m = re.match(r'^\s*(-?[\d.]+)', str(s))
    return float(m.group(1)) if m else None


KEEP = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
        'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}


def main():
    data = fetch(); ways = []; nodes = {}; stops = []
    for el in data['elements']:
        if el['type'] != 'way':
            continue
        t = el.get('tags', {}); hw = t.get('highway')
        if hw not in KEEP or t.get('area') == 'yes':
            continue
        if hw == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through'):
            continue
        if hw == 'service' and t.get('access') in ('private', 'no'):
            continue
        g = el.get('geometry'); nd = el.get('nodes')
        if not g or not nd:
            continue
        rec = {'id': el['id'], 'hw': hw, 'p': [to_local(q['lon'], q['lat']) for q in g], 'nodes': nd}
        if t.get('name'): rec['n'] = t['name']
        if t.get('lanes'): rec['lanes'] = num(t['lanes'])
        if t.get('oneway') in ('yes', '-1'): rec['ow'] = -1 if t['oneway'] == '-1' else 1
        if t.get('maxspeed'): rec['speed'] = num(t['maxspeed'])
        if t.get('sidewalk'): rec['sw'] = t['sidewalk']
        if t.get('cycleway') or t.get('cycleway:left') or t.get('cycleway:right') or t.get('cycleway:both'): rec['cyc'] = 1
        if t.get('bus') == 'yes' or t.get('psv') == 'yes' or t.get('lanes:psv') or t.get('lanes:bus'): rec['bus'] = 1
        if t.get('tunnel'): rec['tun'] = 1
        if t.get('bridge'): rec['br'] = 1
        if t.get('service'): rec['svc'] = t['service']
        if t.get('footway'): rec['fw'] = t['footway']
        ways.append(rec)
    for el in data['elements']:
        if el['type'] != 'node':
            continue
        t = el.get('tags', {}); hw = t.get('highway'); rw = t.get('railway'); pt = t.get('public_transport')
        xy = to_local(el['lon'], el['lat'])
        if hw in ('traffic_signals', 'crossing', 'stop'):
            if hw == 'traffic_signals': k = 'sig'
            elif hw == 'stop': k = 'stop'
            elif t.get('crossing') == 'traffic_signals': k = 'xsig'
            elif t.get('crossing') in ('marked', 'zebra', 'uncontrolled'): k = 'xmark'
            else: k = 'x'
            nodes[el['id']] = {'k': k, 'x': xy[0], 'y': xy[1]}
        if hw == 'bus_stop' or (pt == 'platform' and not rw):
            stops.append({'t': 'bus', 'n': t.get('name', ''), 'x': xy[0], 'y': xy[1]})
        elif rw == 'subway_entrance':
            stops.append({'t': 'skytrain', 'n': t.get('name', ''), 'x': xy[0], 'y': xy[1]})
        elif rw == 'station' or pt == 'station':
            name = t.get('name', '')
            kind = 'skytrain' if (t.get('station') in ('subway', 'light_rail') or t.get('subway') == 'yes' or 'SkyTrain' in name or 'Station' in name) else 'rail'
            stops.append({'t': kind, 'n': name, 'x': xy[0], 'y': xy[1], 'station': 1})
        elif t.get('amenity') == 'ferry_terminal':
            stops.append({'t': 'ferry', 'n': t.get('name', ''), 'x': xy[0], 'y': xy[1]})
        elif rw == 'tram_stop':
            stops.append({'t': 'tram', 'n': t.get('name', ''), 'x': xy[0], 'y': xy[1]})
    out_stops = []
    for s in stops:
        if any(abs(o['x'] - s['x']) < 3 and abs(o['y'] - s['y']) < 3 and o['t'] == s['t'] for o in out_stops):
            continue
        out_stops.append(s)
    meta = {'source': 'OpenStreetMap contributors, via Overpass API', 'fetched': time.strftime('%Y-%m-%d'), 'bbox': list(BBOX),
            'origin': list(ORIGIN), 'scale': list(SCALE), 'ways': len(ways), 'nodes': len(nodes), 'stops': len(out_stops),
            'license': 'ODbL 1.0 (openstreetmap.org/copyright)'}
    js = 'window.OSMS=' + json.dumps({'meta': meta, 'ways': ways, 'nodes': nodes, 'stops': out_stops}, separators=(',', ':'), ensure_ascii=False) + ';\n'
    open(OUT, 'w', encoding='utf-8').write(js)
    print('ways', len(ways), Counter(w['hw'] for w in ways).most_common())
    print('nodes', len(nodes), Counter(n['k'] for n in nodes.values()), 'stops', len(out_stops), Counter(s['t'] for s in out_stops))
    print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
