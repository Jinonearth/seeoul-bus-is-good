"""정류장 자리 맞추기: res9 셀마다 버스가 설 수 있는 도로 위 한 점.

python3 scripts/build_stop_snap.py <NODELINKDATA.zip 또는 MOCT_LINK 폴더> public/data/demand.json public/data/snap.json

- 도로 등급은 build_tiles.py와 같아요. 버스가 설 수 있는 1 간선, 2 편도 2차로, 3 편도 1차로만 쓰고
  0 고속·도시고속은 빼요.
- 셀 육각형 안에 있는 도로 중 셀 중심에서 가장 가까운 점. 큰 길을 조금 더 좋아해서
  등급이 한 단계 낮을 때마다 STEP_M 미터 먼 것으로 쳐요 (간선이 40m 더 멀어도 1차로보다 먼저).
- 육각형 안에 쓸 도로가 없는 셀은 정류장을 둘 수 없어서 파일에 없어요. 파일이 곧 정류장 가능 목록.
- 출력: {셀: [lng, lat]} (소수 6자리)
"""
import sys, json, math, os, tempfile, zipfile
import shapefile, h3
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import nearest_points
from shapely.strtree import STRtree

SRC, DEMAND, OUT = sys.argv[1:4]
STEP_M = 20   # 등급 한 단계당 덜 좋아하는 거리(m)

# 경위도 → 서울 근처 평면 미터 (거리 비교용)
LAT0 = 37.55; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def xy(lng, lat): return (lng * KX, lat * KY)
def ll(x, y): return (x / KX, y / KY)

cells = [c[0] for c in json.load(open(DEMAND))['cells']]
hexes = {c: Polygon([xy(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells}
minx = min(p.bounds[0] for p in hexes.values()) - 500; maxx = max(p.bounds[2] for p in hexes.values()) + 500
miny = min(p.bounds[1] for p in hexes.values()) - 500; maxy = max(p.bounds[3] for p in hexes.values()) + 500

def read_links(src):
    if src.endswith('.zip'):
        d = tempfile.mkdtemp(); z = zipfile.ZipFile(src)
        for n in z.namelist():
            if n.startswith('MOCT_LINK'): z.extract(n, d)
        src = d
    return shapefile.Reader(os.path.join(src, 'MOCT_LINK'), encoding='cp949')

tm = Transformer.from_crs("+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", always_xy=True)
x0, y0 = tm.transform(126.76, 37.41, direction='INVERSE'); x1, y1 = tm.transform(127.19, 37.72, direction='INVERSE')
roads, rcls, seen = [], [], set()
for sr in read_links(SRC).iterShapeRecords():
    bx = sr.shape.bbox
    if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1: continue
    r = sr.record; k = tuple(sorted((r['F_NODE'], r['T_NODE'])))
    if k in seen: continue
    seen.add(k)
    rk, ln = r['ROAD_RANK'], (r['LANES'] or 1)
    c = 0 if rk in ('101', '102') else 1 if (rk == '103' or ln >= 3) else 2 if ln == 2 else 3
    if c == 0: continue
    lo, la = tm.transform([p[0] for p in sr.shape.points], [p[1] for p in sr.shape.points])
    g = LineString([xy(a, b) for a, b in zip(lo, la)])
    bb = g.bounds
    if bb[2] < minx or bb[0] > maxx or bb[3] < miny or bb[1] > maxy: continue
    roads.append(g); rcls.append(c)
tree = STRtree(roads)
print('roads', len(roads))

out, moved = {}, 0
for c in cells:
    hx = hexes[c]; ctr = hx.centroid; best = None
    for i in tree.query(hx, predicate='intersects'):
        part = roads[i].intersection(hx)
        if part.is_empty: continue
        p = nearest_points(part, ctr)[0]
        score = p.distance(ctr) + STEP_M * (rcls[i] - 1)
        if best is None or score < best[0]: best = (score, p)
    if best is None: continue
    lng, lat = ll(best[1].x, best[1].y)
    out[c] = [round(lng, 6), round(lat, 6)]
    if best[1].distance(ctr) > 1: moved += 1

json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print(f'cells {len(cells)}, stop-able {len(out)} ({len(out) / len(cells):.1%}), moved {moved}, no road {len(cells) - len(out)}, {os.path.getsize(OUT)} bytes')
