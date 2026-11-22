"""정류장 자리와 버스 길 그래프: 표준노드링크 → snap.json + roads.json

python3 scripts/build_stop_snap.py <NODELINKDATA.zip 또는 MOCT_LINK 폴더> public/data/demand.json public/data

도로
- 등급은 build_tiles.py와 같아요. 버스가 다니는 1 간선, 2 편도 2차로, 3 편도 1차로만 쓰고 0 고속·도시고속은 빼요.
- 일방통행은 아직 무시해요(양방향 그래프). 버스가 같은 길로 오가요.
- 교차로가 아닌 점(이어진 링크 2개뿐)은 합쳐서 간선 하나로, 모양은 Douglas-Peucker 5m로 줄여요.
- 길 찾기 비용 = 길이 × 등급 가중(COST). 큰 길을 조금 더 좋아해요.

정류장 자리
- 셀 육각형 안 도로 중 셀 중심에서 가장 가까운 점. 등급이 한 단계 낮을 때마다 STEP_M 미터, 막다른 길이면 DEAD_END_M 미터 먼 것으로 쳐요.
- 육각형 안에 쓸 도로가 없거나, 그 도로가 가장 큰 도로망과 이어져 있지 않으면 정류장을 둘 수 없어요.

출력
- snap.json: {셀: [lng, lat, 간선 번호, 간선 시작점에서 거리(m)]} — 정류장 가능 셀 목록이기도 해요
- roads.json: {"n": [lng·1e6, lat·1e6, ...] 교차점, "e": [[u, v, 길이m, 비용m, [중간점 lng·1e6, lat·1e6 (앞 점과의 차이) ...]], ...]}
"""
import sys, json, math, os, tempfile, zipfile, gzip, collections
import shapefile, h3
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

SRC, DEMAND, OUTDIR = sys.argv[1:4]
STEP_M = 50                       # 정류장 자리: 등급 한 단계당 덜 좋아하는 거리(m). 큰 길에 서야 노선이 골목으로 꺾여 들어갔다 나오지 않아요
DEAD_END_M = 150                  # 막다른 길(한쪽 끝이 이어지지 않은 간선)은 이만큼 먼 것으로
COST = {1: 1.0, 2: 1.15, 3: 1.4}  # 길 찾기: 등급별 길이 가중
SIMPLIFY_M = 5

LAT0 = 37.55; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def xy(lng, lat): return (lng * KX, lat * KY)
def ll(x, y): return (x / KX, y / KY)

cells = [c[0] for c in json.load(open(DEMAND))['cells']]
hexes = {c: Polygon([xy(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells}
area = unary_union(list(hexes.values())).buffer(1500)

def read_links(src):
    if src.endswith('.zip'):
        d = tempfile.mkdtemp(); z = zipfile.ZipFile(src)
        for n in z.namelist():
            if n.startswith('MOCT_LINK'): z.extract(n, d)
        src = d
    return shapefile.Reader(os.path.join(src, 'MOCT_LINK'), encoding='cp949')

# ── 링크 읽기 ──
tm = Transformer.from_crs("+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", always_xy=True)
x0, y0 = tm.transform(126.76, 37.41, direction='INVERSE'); x1, y1 = tm.transform(127.19, 37.72, direction='INVERSE')
links, seen = [], set()   # (u, v, geom, cls)
for sr in read_links(SRC).iterShapeRecords():
    bx = sr.shape.bbox
    if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1: continue
    r = sr.record; k = tuple(sorted((r['F_NODE'], r['T_NODE'])))
    if k in seen or k[0] == k[1]: continue
    rk, ln = r['ROAD_RANK'], (r['LANES'] or 1)
    c = 0 if rk in ('101', '102') else 1 if (rk == '103' or ln >= 3) else 2 if ln == 2 else 3
    if c == 0: continue
    lo, la = tm.transform([p[0] for p in sr.shape.points], [p[1] for p in sr.shape.points])
    g = LineString([xy(a, b) for a, b in zip(lo, la)])
    if g.length == 0 or not g.intersects(area): continue
    seen.add(k); links.append((r['F_NODE'], r['T_NODE'], g, c))
print('links', len(links))

# ── 가장 큰 연결 덩어리만 ──
adj = collections.defaultdict(list)
for i, (u, v, g, c) in enumerate(links): adj[u].append(i); adj[v].append(i)
comp, best = {}, None
for s in adj:
    if s in comp: continue
    stack, members = [s], [s]; comp[s] = s
    while stack:
        n = stack.pop()
        for i in adj[n]:
            u, v = links[i][0], links[i][1]; o = v if u == n else u
            if o not in comp: comp[o] = s; stack.append(o); members.append(o)
    if best is None or len(members) > best[1]: best = (s, len(members))
main = best[0]
links = [L for L in links if comp[L[0]] == main]
print('links in main component', len(links), 'nodes', best[1])

# ── 교차점이 아닌 점(링크 2개) 합치기 ──
adj = collections.defaultdict(list)
for i, (u, v, g, c) in enumerate(links): adj[u].append(i); adj[v].append(i)
junction = {n for n, es in adj.items() if len(es) != 2}
used = [False] * len(links)
edges = []        # (u, v, coords, length, cost)
link_at = {}      # 링크 번호 → (간선 번호, 간선에서 링크가 시작하는 거리, 뒤집혔는지)

def walk(start, first):
    """start 노드에서 first 링크로 출발해 다음 교차점까지"""
    coords, parts, n, i, dist, cost = [], [], start, first, 0.0, 0.0
    while True:
        used[i] = True
        u, v, g, c = links[i]
        pts = list(g.coords); rev = (u != n)
        if rev: pts.reverse()
        o = u if rev else v
        parts.append((i, dist, rev))
        coords.extend(pts if not coords else pts[1:])
        dist += g.length; cost += g.length * COST[c]
        n = o
        if n in junction or n == start: break
        nxt = [j for j in adj[n] if not used[j]]
        if not nxt: break
        i = nxt[0]
    return n, coords, dist, cost, parts

def add(u, i):
    v, coords, dist, cost, parts = walk(u, i)
    e = len(edges); edges.append((u, v, coords, dist, cost))
    for li, off, rev in parts: link_at[li] = (e, off, rev)

for n in junction:
    for i in adj[n]:
        if not used[i]: add(n, i)
for i in range(len(links)):   # 교차점 없는 고리
    if not used[i]: add(links[i][0], i)
print('edges', len(edges))

# ── 정류장 자리 ──
tree = STRtree([L[2] for L in links])
dead = [len(adj[u]) == 1 or len(adj[v]) == 1 for u, v, *_ in edges]
def pos_on_edge(li, p):
    """링크 li 위의 점 p → (간선 번호, 간선 시작점에서 거리)"""
    e, off, rev = link_at[li]; g = links[li][2]; d = g.project(p)
    return e, off + (g.length - d if rev else d)

snap, moved = {}, 0
for c in cells:
    hx = hexes[c]; ctr = hx.centroid; best = None
    for i in tree.query(hx, predicate='intersects'):
        part = links[i][2].intersection(hx)
        if part.is_empty: continue
        p = nearest_points(part, ctr)[0]
        e = link_at[i][0]
        score = p.distance(ctr) + STEP_M * (links[i][3] - 1) + (DEAD_END_M if dead[e] else 0)
        if best is None or score < best[0]: best = (score, p, i)
    if best is None: continue
    snap[c] = (best[2], best[1])

# 간선 모양 줄이기. 정류장 자리는 줄인 선 위 같은 비율 위치로 옮겨요
simple = []
for u, v, coords, dist, cost in edges:
    g = LineString(coords).simplify(SIMPLIFY_M); simple.append(g)
out = {}
for c, (li, p) in snap.items():
    e, d = pos_on_edge(li, p)
    g = simple[e]; t = d / edges[e][3] * g.length
    q = g.interpolate(t)
    lng, lat = ll(q.x, q.y)
    out[c] = [round(lng, 6), round(lat, 6), e, round(t, 1)]
    if q.distance(hexes[c].centroid) > 1: moved += 1

# ── 쓰기 ──
nid = {}; nodes = []
def node(n, x, y):
    if n not in nid:
        nid[n] = len(nid); lng, lat = ll(x, y); nodes.extend([round(lng * 1e6), round(lat * 1e6)])
    return nid[n]
E = []
for (u, v, coords, dist, cost), g in zip(edges, simple):
    pts = list(g.coords)
    a = node(u, *pts[0]); b = node(v, *pts[-1])
    mid, prev = [], [round(ll(*pts[0])[0] * 1e6), round(ll(*pts[0])[1] * 1e6)]
    for x, y in pts[1:-1]:
        lng, lat = ll(x, y); q = [round(lng * 1e6), round(lat * 1e6)]
        mid.extend([q[0] - prev[0], q[1] - prev[1]]); prev = q
    E.append([a, b, round(g.length, 1), round(cost / dist * g.length, 1), mid])

os.makedirs(OUTDIR, exist_ok=True)
for name, obj in [('snap.json', out), ('roads.json', {'n': nodes, 'e': E})]:
    p = os.path.join(OUTDIR, name); s = json.dumps(obj, separators=(',', ':'))
    open(p, 'w').write(s)
    print(name, len(s), 'bytes,', len(gzip.compress(s.encode())), 'gzip')
print(f'cells {len(cells)}, stop-able {len(out)} ({len(out) / len(cells):.1%}), moved {moved}, no usable road {len(cells) - len(out)}')
