"""정류장 자리와 버스 길 그래프: 표준노드링크 → snap.json + roads.json

python3 scripts/build_stop_snap.py <NODELINKDATA.zip 또는 MOCT_LINK 폴더> public/data/demand.json public/data

도로
- 등급은 build_tiles.py와 같아요. 버스가 다니는 1 간선, 2 편도 2차로, 3 편도 1차로만 쓰고 0 고속·도시고속은 빼요.
- 표준노드링크 링크는 한 방향이에요(F_NODE → T_NODE). 양방향 도로는 방향마다 따로 링크와 노드가 있어서,
  같은 두 노드를 거꾸로 잇는 링크는 거의 없어요. 그래서 링크 하나 = 방향 있는 간선 하나.
- 어느 점에서든 어느 점으로든 갈 수 있게, 서로 오갈 수 있는 가장 큰 덩어리(강하게 연결된 성분)만 남겨요.
- 들어오는 링크 하나, 나가는 링크 하나뿐인 노드는 합쳐서 간선 하나로, 모양은 Douglas-Peucker 5m로 줄여요.
- 길 찾기 비용 = 길이 × 등급 가중(COST). 큰 길을 조금 더 좋아해요.

정류장 자리
- 셀 육각형 안 도로 위, 셀 중심에서 가까운 점. 등급이 한 단계 낮을 때마다 STEP_M 미터,
  막다른 길이면 DEAD_END_M 미터 먼 것으로 쳐요(점수).
- 셀마다 서로 다른 간선 위 후보를 점수 순으로 최대 K개. 첫 번째가 대표 자리이고, 버스는 지나가는 방향에 맞는 후보에 서요
  (가는 길과 오는 길이 길 건너편 정류장에 서는 것처럼).
- 후보가 하나도 없으면 정류장을 둘 수 없어요.

출력
- snap.json: {셀: [[lng, lat, 간선, 간선 시작점에서 거리(m), 점수(m)], ...]} — 정류장 가능 셀 목록이기도 해요
- roads.json: {"n": [lng·1e6, lat·1e6, ...] 노드,
               "e": [[u, v, 길이m, 비용m, 시작 방향°, 끝 방향°, [중간점 lng·1e6, lat·1e6 (앞 점과의 차이) ...]], ...]}  (u → v 한 방향)
"""
import sys, json, math, os, tempfile, zipfile, gzip, collections
import shapefile, h3
from pyproj import Transformer
from shapely.geometry import LineString, Polygon
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

SRC, DEMAND, OUTDIR = sys.argv[1:4]
STEP_M = 50                       # 정류장 자리: 등급 한 단계당 덜 좋아하는 거리(m)
DEAD_END_M = 150                  # 막다른 길은 이만큼 먼 것으로
K = 4                             # 셀당 후보 수
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

# ── 링크 읽기 (방향 그대로) ──
tm = Transformer.from_crs("+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", always_xy=True)
x0, y0 = tm.transform(126.76, 37.41, direction='INVERSE'); x1, y1 = tm.transform(127.19, 37.72, direction='INVERSE')
links, seen = [], set()   # (u, v, geom, cls)
for sr in read_links(SRC).iterShapeRecords():
    bx = sr.shape.bbox
    if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1: continue
    r = sr.record; k = (r['F_NODE'], r['T_NODE'])
    if k in seen or k[0] == k[1]: continue
    rk, ln = r['ROAD_RANK'], (r['LANES'] or 1)
    c = 0 if rk in ('101', '102') else 1 if (rk == '103' or ln >= 3) else 2 if ln == 2 else 3
    if c == 0: continue
    lo, la = tm.transform([p[0] for p in sr.shape.points], [p[1] for p in sr.shape.points])
    g = LineString([xy(a, b) for a, b in zip(lo, la)])
    if g.length == 0 or not g.intersects(area): continue
    seen.add(k); links.append((k[0], k[1], g, c))
print('directed links', len(links))

# ── 서로 오갈 수 있는 가장 큰 덩어리 (Kosaraju, 반복문) ──
out_, in_ = collections.defaultdict(list), collections.defaultdict(list)
for u, v, g, c in links: out_[u].append(v); in_[v].append(u)
nodes = set(out_) | set(in_)
order, done = [], set()
for s in nodes:
    if s in done: continue
    done.add(s); stack = [(s, iter(out_[s]))]
    while stack:
        n, it = stack[-1]
        for m in it:
            if m not in done: done.add(m); stack.append((m, iter(out_[m]))); break
        else: stack.pop(); order.append(n)
comp, sizes = {}, collections.Counter()
for s in reversed(order):
    if s in comp: continue
    comp[s] = s; stack = [s]
    while stack:
        n = stack.pop(); sizes[s] += 1
        for m in in_[n]:
            if m not in comp: comp[m] = s; stack.append(m)
main = sizes.most_common(1)[0][0]
links = [L for L in links if comp[L[0]] == main and comp[L[1]] == main]
print('links in largest strongly connected part', len(links), 'nodes', sizes[main], 'of', len(nodes))

# ── 들어오고 나가는 링크가 하나씩뿐인 노드 합치기 ──
outs, ins = collections.defaultdict(list), collections.defaultdict(list)
for i, (u, v, g, c) in enumerate(links): outs[u].append(i); ins[v].append(i)
def through(n): return len(outs[n]) == 1 and len(ins[n]) == 1 and links[outs[n][0]][1] != links[ins[n][0]][0]
used = [False] * len(links)
edges = []        # (u, v, coords, length, cost)
link_at = {}      # 링크 → (간선, 간선에서 링크가 시작하는 거리)
def add(i):
    u = links[i][0]; coords, dist, cost = [], 0.0, 0.0
    while True:
        used[i] = True; a, b, g, c = links[i]
        link_at[i] = (len(edges), dist)
        pts = list(g.coords); coords.extend(pts if not coords else pts[1:])
        dist += g.length; cost += g.length * COST[c]
        if not through(b) or b == u: break
        i = outs[b][0]
        if used[i]: break
    edges.append((u, b, coords, dist, cost))
for i in range(len(links)):
    if not used[i] and not through(links[i][0]): add(i)
for i in range(len(links)):   # 합칠 노드로만 된 고리
    if not used[i]: add(i)
print('edges', len(edges))

# ── 정류장 후보 ──
tree = STRtree([L[2] for L in links])
# 막다른 길: 끝에서 나가는 길이 되돌아오는 길뿐이거나, 시작으로 들어오는 길이 되돌아온 길뿐
eo, ei = collections.defaultdict(set), collections.defaultdict(set)
for u, v, *_ in edges: eo[u].add(v); ei[v].add(u)
dead = [eo[v] <= {u} or ei[u] <= {v} for u, v, *_ in edges]
simple = [LineString(c).simplify(SIMPLIFY_M) for _, _, c, _, _ in edges]

def to_edge(li, p):
    e, off = link_at[li]; d = off + links[li][2].project(p)
    g = simple[e]; t = d / edges[e][3] * g.length
    return e, t, g.interpolate(t)

out, moved, ncand = {}, 0, 0
for c in cells:
    hx = hexes[c]; ctr = hx.centroid; best = {}
    for i in tree.query(hx, predicate='intersects'):
        part = links[i][2].intersection(hx)
        if part.is_empty: continue
        p = nearest_points(part, ctr)[0]
        e = link_at[i][0]
        score = p.distance(ctr) + STEP_M * (links[i][3] - 1) + (DEAD_END_M if dead[e] else 0)
        if e not in best or score < best[e][0]: best[e] = (score, i, p)
    if not best: continue
    cand = []
    for e, (score, i, p) in sorted(best.items(), key=lambda x: x[1][0])[:K]:
        e, t, q = to_edge(i, p); lng, lat = ll(q.x, q.y)
        cand.append([round(lng, 6), round(lat, 6), e, round(t, 1), round(score)])
    out[c] = cand; ncand += len(cand)
    if math.hypot(cand[0][0] * KX - ctr.x, cand[0][1] * KY - ctr.y) > 1: moved += 1

# ── 쓰기 ──
def heading(a, b): return round(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))) % 360
nid = {}; N = []
def node(n, x, y):
    if n not in nid:
        nid[n] = len(nid); lng, lat = ll(x, y); N.extend([round(lng * 1e6), round(lat * 1e6)])
    return nid[n]
E = []
for (u, v, coords, dist, cost), g in zip(edges, simple):
    pts = list(g.coords)
    a = node(u, *pts[0]); b = node(v, *pts[-1])
    prev = [round(ll(*pts[0])[0] * 1e6), round(ll(*pts[0])[1] * 1e6)]; mid = []
    for x, y in pts[1:-1]:
        lng, lat = ll(x, y); q = [round(lng * 1e6), round(lat * 1e6)]
        mid.extend([q[0] - prev[0], q[1] - prev[1]]); prev = q
    E.append([a, b, round(g.length, 1), round(cost / dist * g.length, 1), heading(pts[0], pts[1]), heading(pts[-2], pts[-1]), mid])

os.makedirs(OUTDIR, exist_ok=True)
for name, obj in [('snap.json', out), ('roads.json', {'n': N, 'e': E})]:
    p = os.path.join(OUTDIR, name); s = json.dumps(obj, separators=(',', ':'))
    open(p, 'w').write(s)
    print(name, len(s), 'bytes,', len(gzip.compress(s.encode())), 'gzip')
print(f'cells {len(cells)}, stop-able {len(out)} ({len(out) / len(cells):.1%}), candidates {ncand}, moved {moved}, no usable road {len(cells) - len(out)}')
