"""Syntax-check every script in src/ with esprima (Node is not installed on this machine)."""
import esprima, glob, os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
bad = 0
for f in sorted(glob.glob(os.path.join(root, '*.js'))):
    if os.path.basename(f) in ('city-data.js', 'osm-data.js', 'osm-streets.js'): continue
    try:
        esprima.parseScript(open(f, encoding='utf-8').read())
        print('ok ', os.path.basename(f))
    except Exception as e:
        bad += 1; print('ERR', os.path.basename(f), e)
sys.exit(bad)
