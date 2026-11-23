"""헥사곤 지형 타일: 셀마다 가장 넓은 땅 쓰임 → public/data/terrain.json

python3 scripts/build_terrain.py <osm_land.json> public/data/demand.json public/data/terrain.json

- 땅 쓰임은 build_land.py와 같은 OSM 면(숲·녹지·주거·상업·공업). 지도 데이터 © OpenStreetMap 기여자 (ODbL).
- res9 셀마다 종류별로 겹치는 넓이를 재서 가장 넓은 것, 셀의 25%도 안 덮이면 기타(o).
- res8·res7은 자식 res9 셀들의 넓이를 더해서 같은 규칙.
- 출력: {셀: 글자} 글자 = f 숲, g 녹지, r 주거, c 상업, i 공업, o 기타
"""
import sys, json, math, collections
import h3
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union, polygonize, linemerge
from shapely.strtree import STRtree

OSM, DEMAND, OUT = sys.argv[1:4]
LAT0 = 37.55; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def m(pts): return [(x * KX, y * KY) for x, y in pts]

def kind(t):
    lu, le, na = t.get('landuse'), t.get('leisure'), t.get('natural')
    if lu == 'forest' or na in ('wood', 'scrub', 'heath'): return 'f'
    if lu in ('grass', 'meadow', 'cemetery', 'recreation_ground', 'village_green') or le in ('park', 'garden', 'golf_course') or na == 'grassland': return 'g'
    if lu == 'residential': return 'r'
    if lu in ('commercial', 'retail'): return 'c'
    if lu == 'industrial': return 'i'
    return None

polys, kinds = [], []
for e in json.load(open(OSM))['elements']:
    k = kind(e.get('tags', {}))
    if not k: continue
    try:
        if e['type'] == 'way':
            pts = [(p['lon'], p['lat']) for p in e.get('geometry', [])]
            if len(pts) >= 4 and pts[0] == pts[-1]: g = Polygon(m(pts)).buffer(0)
            else: continue
        else:
            outer = [LineString(m([(p['lon'], p['lat']) for p in x['geometry']])) for x in e.get('members', []) if x.get('role') == 'outer' and x.get('geometry')]
            inner = [LineString(m([(p['lon'], p['lat']) for p in x['geometry']])) for x in e.get('members', []) if x.get('role') == 'inner' and x.get('geometry')]
            g = unary_union(list(polygonize(linemerge(outer)))) if outer else None
            if g is None or g.is_empty: continue
            if inner:
                i = unary_union(list(polygonize(linemerge(inner))))
                if not i.is_empty: g = g.difference(i)
            g = g.buffer(0)
    except Exception:
        continue
    if g.is_valid and not g.is_empty: polys.append(g); kinds.append(k)
tree = STRtree(polys)
print('polygons', len(polys))

PRI = 'fgcir'   # 같은 곳이 여러 종류로 겹치면 앞쪽이 이겨요 (숲 > 녹지 > 상업 > 공업 > 주거)
cells = [c[0] for c in json.load(open(DEMAND))['cells']]
area9 = {}
for c in cells:
    hx = Polygon(m([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]))
    taken = None; a = collections.Counter()
    hits = sorted(tree.query(hx, predicate='intersects'), key=lambda i: PRI.index(kinds[i]))
    for i in hits:
        part = polys[i].intersection(hx)
        if taken is not None: part = part.difference(taken)
        if part.is_empty: continue
        a[kinds[i]] += part.area; taken = part if taken is None else unary_union([taken, part])
    a['_'] = hx.area
    area9[c] = a

def pick(a):
    tot = a['_']; best = max((v, k) for k, v in a.items() if k != '_') if len(a) > 1 else (0, 'o')
    return best[1] if best[0] >= 0.25 * tot else 'o'

out = {c: pick(a) for c, a in area9.items()}
for res in (8, 7):
    agg = collections.defaultdict(collections.Counter)
    for c, a in area9.items():
        agg[h3.cell_to_parent(c, res)].update(a)
    out.update({p: pick(a) for p, a in agg.items()})
s = json.dumps(out, separators=(',', ':'))
open(OUT, 'w').write(s)
import gzip
print('cells', len(out), collections.Counter(out[c] for c in cells), len(s), 'bytes,', len(gzip.compress(s.encode())), 'gzip')
