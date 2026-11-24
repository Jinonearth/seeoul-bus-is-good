"""지형 면: 같은 지형 res9 헥사곤을 합치고 모서리를 둥글게 → public/data/terrain.geojson

python3 scripts/build_terrain_shapes.py public/data

- 입력: terrain.json(셀 → 지형), demand.json, od.json, snap.json (모두 public/data)
- 땅 쓰임이 없는 셀(o)은 정류장을 둘 수 있으면 주거(r), 출발 수요가 상위 15%면 상업(c) — 지도 그림만을 위한 규칙
- 같은 지형끼리 합친 뒤 +SM → −2SM → +SM 버퍼로 헥사곤 계단을 둥글게 다듬어요
- edge: 지형 둘레 바깥 EDGE m 띠 (나무가 성기게 흩어지는 가장자리용)
- 출력: GeoJSON FeatureCollection, properties = {t: 지형, edge: 0|1}
"""
import sys, json, math, collections, gzip, os
import h3
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union, transform

D = sys.argv[1]
SM, EDGE = 60, 70
LAT0 = 37.55; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
to_ll = lambda g: transform(lambda x, y, z=None: (x / KX, y / KY), g)

terr = json.load(open(f'{D}/terrain.json')); dem = json.load(open(f'{D}/demand.json'))
flat = json.load(open(f'{D}/od.json')); snap = json.load(open(f'{D}/snap.json'))
out_d = collections.Counter()
for i in range(0, len(flat), 3): out_d[flat[i]] += flat[i + 2]
O = {c[0]: sum(out_d[c[1]] * dem['dongShare'][c[1]][b] * c[2][b] for b in range(5)) for c in dem['cells']}
busy = sorted(O.values())[int(len(O) * 0.85)]
cls = {}
for c in dem['cells']:
    t = terr.get(c[0], 'o')
    if t == 'o' and c[0] in snap: t = 'c' if O[c[0]] >= busy else 'r'
    cls[c[0]] = t
print(collections.Counter(cls.values()))

feats = []
for t in 'ofgirc':
    hexes = [Polygon([(lng * KX, lat * KY) for lat, lng in h3.cell_to_boundary(c)]) for c, k in cls.items() if k == t]
    if not hexes: continue
    u = unary_union([h.buffer(0.5) for h in hexes])
    sm = u.buffer(SM, resolution=6).buffer(-2 * SM, resolution=6).buffer(SM, resolution=6).simplify(4)
    if sm.is_empty: sm = u
    edge = sm.buffer(EDGE, resolution=6).difference(sm).simplify(6)
    for g, e in ((edge, 1), (sm, 0)):
        if g.is_empty: continue
        feats.append({'type': 'Feature', 'properties': {'t': t, 'edge': e}, 'geometry': mapping(to_ll(g))})
def rnd(o):
    if isinstance(o, float): return round(o, 5)
    if isinstance(o, (list, tuple)): return [rnd(x) for x in o]
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    return o
s = json.dumps(rnd({'type': 'FeatureCollection', 'features': feats}), separators=(',', ':'))
open(f'{D}/terrain.geojson', 'w').write(s)
print('terrain.geojson', len(s), 'bytes,', len(gzip.compress(s.encode())), 'gzip')
