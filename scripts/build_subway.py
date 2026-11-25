"""지하철: 역, 노선 연결, 역↔역 걸리는 시간, 셀마다 가까운 역 → public/data/subway.json

python3 scripts/build_subway.py "<서울시 역사마스터 정보.csv>" public/data/demand.json public/data/subway.json

- 역사마스터(cp949, 역사_ID·역사명·호선·위도·경도)에서 수도권 전 노선을 읽어요. 같은 열차가 이어 다니는 구간은 한 노선으로 묶어요
  (예: 1호선 = 1호선·경부선·경원선·경인선·장항선).
- 노선 안 역 순서: 역끼리 직선거리로 최소 신장 트리(가지 노선도 자연스럽게 나와요). 2호선 순환은 충정로–시청을 이어 닫아요.
- 역↔역 시간(분): 차 안 = 역 사이 직선거리 ÷ 33km/h + 역마다 0.5분, 갈아타기 = 5분 + 걸어서 3분.
  행렬은 demand.json의 서울 역 307곳(환승역은 하나로) 사이, 0~255분.
- 셀마다 가까운 역 두 곳과 걷는 시간(직선 × 1.3 ÷ 4.5km/h). 걷는 거리 1.2km 넘으면 못 쓰는 역.
"""
import sys, csv, json, math, re, heapq, collections

SRC, DEMAND, OUT = sys.argv[1:4]
SPEED, DWELL, XFER = 33, 0.5, 5 + 3
WALK_KMH, DETOUR, WALK_MAX = 4.5, 1.3, 1.2

GROUP = {'경부선': '1호선', '경원선': '1호선', '경인선': '1호선', '장항선': '1호선', '9호선(연장)': '9호선',
         '신분당선(연장)': '신분당선', '신분당선(연장2)': '신분당선', '7호선(인천)': '7호선', '중앙선': '경의중앙선',
         '수인선': '수인분당선', '분당선': '수인분당선', '과천선': '4호선', '안산선': '4호선', '진접선': '4호선',
         '일산선': '3호선', '별내선': '8호선', '9호선': '9호선'}
COLOR = {'1호선': '#0052A4', '2호선': '#00A84D', '3호선': '#EF7C1C', '4호선': '#00A5DE', '5호선': '#996CAC', '6호선': '#CD7C2F',
         '7호선': '#747F00', '8호선': '#E6186C', '9호선': '#BDB092', '경의중앙선': '#77C4A3', '경춘선': '#0C8E72', '공항철도1호선': '#0090D2',
         '신분당선': '#D4003B', '수인분당선': '#F5A200', '우이신설선': '#B0CE18', '신림선': '#6789CA', '서해선': '#8FC31F',
         '수도권 광역급행철도': '#9A6292', '경강선': '#003DA5', '김포골드라인': '#AD8605', '에버라인선': '#56AD2D', '의정부선': '#FDA600',
         '인천1호선': '#7CA8D5', '인천2호선': '#ED8B00'}

KX = 111.32 * math.cos(math.radians(37.55)); KY = 110.54
def km(a, b): return math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY)
def norm(n): return re.sub(r'\(.*?\)', '', n).strip()

rows = list(csv.DictReader(open(SRC, encoding='cp949')))
dem = json.load(open(DEMAND))
seoul = [(s[0], s[1], s[2]) for s in dem['stations']]          # 이름, 경도, 위도
key = {norm(n): i for i, (n, _, _) in enumerate(seoul)}

# 역사마스터 역 → 서울 역 번호 (이름이 같거나, 300m 안 가장 가까운 곳), 아니면 서울 밖
lines = collections.defaultdict(list)    # 노선 → [(id, 이름, (lng, lat), 서울 번호 또는 -1)]
for r in rows:
    ln = GROUP.get(r['호선'], r['호선']); p = (float(r['경도']), float(r['위도'])); n = norm(r['역사명'])
    si = key.get(n, -1)
    if si < 0:
        d, j = min((km(p, (s[1], s[2])), j) for j, s in enumerate(seoul))
        if d < 0.3: si = j
    lines[ln].append((r['역사_ID'], n, p, si))

# 노선 안 연결: 최소 신장 트리 (Prim)
edges = {}
for ln, st in lines.items():
    # 같은 이름은 한 역
    uniq = {}
    for s in st: uniq.setdefault(s[1], s)
    st = list(uniq.values()); n = len(st)
    if n < 2: continue
    inT = [False] * n; best = [(math.inf, -1)] * n; best[0] = (0, -1); E = []
    for _ in range(n):
        u = min((i for i in range(n) if not inT[i]), key=lambda i: best[i][0]); inT[u] = True
        if best[u][1] >= 0: E.append((best[u][1], u))
        for v in range(n):
            if not inT[v]:
                d = km(st[u][2], st[v][2])
                if d < best[v][0]: best[v] = (d, u)
    # 최소 신장 트리가 틀리게 잇는 곳 바로잡기: 경의선 서울역 지선은 신촌(경의중앙)으로 이어져요
    if ln == '경의중앙선':
        ix = {s[1]: i for i, s in enumerate(st)}
        if '서울역' in ix and '신촌' in ix:
            E = [(a, b) for a, b in E if ix['서울역'] not in (a, b)] + [(ix['서울역'], ix['신촌'])]
    if ln == '2호선':
        a = next((i for i, s in enumerate(st) if s[1] == '충정로'), None); b = next((i for i, s in enumerate(st) if s[1] == '시청'), None)
        if a is not None and b is not None: E.append((a, b))
    edges[ln] = (st, E)

# 의심 가는 노선: 이어진 역 사이가 4km 넘는 곳
for ln, (st, E) in edges.items():
    long = [(st[a][1], st[b][1], round(km(st[a][2], st[b][2]), 1)) for a, b in E if km(st[a][2], st[b][2]) > 4]
    if long and any(st[a][3] >= 0 or st[b][3] >= 0 for a, b in E): print('check', ln, long[:4])

# 그래프: (노선, 역 이름) 노드, 차 안 간선 + 같은 역 갈아타기
node = {}; adj = collections.defaultdict(list)
def nid(ln, name):
    k = (ln, name)
    if k not in node: node[k] = len(node)
    return node[k]
by_name = collections.defaultdict(list)
for ln, (st, E) in edges.items():
    for s in st: by_name[s[1]].append(nid(ln, s[1]))
    for a, b in E:
        t = km(st[a][2], st[b][2]) * 1.0 / SPEED * 60 + DWELL
        u, v = nid(ln, st[a][1]), nid(ln, st[b][1]); adj[u].append((v, t)); adj[v].append((u, t))
for name, ns in by_name.items():
    for u in ns:
        for v in ns:
            if u != v: adj[u].append((v, XFER))
# 서울 역 번호 → 그 역의 노드들
seoul_nodes = collections.defaultdict(list)
for ln, (st, E) in edges.items():
    for s in st:
        if s[3] >= 0: seoul_nodes[s[3]].append(node[(ln, s[1])])
missing = [seoul[i][0] for i in range(len(seoul)) if i not in seoul_nodes]
print('seoul stations', len(seoul), 'on graph', len(seoul_nodes), 'missing', missing)

N = len(seoul); M = [255] * (N * N)
for i in range(N):
    dist = {}; pq = [(0.0, u) for u in seoul_nodes.get(i, [])]
    for _, u in pq: dist[u] = 0.0
    heapq.heapify(pq)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, math.inf): continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, math.inf): dist[v] = nd; heapq.heappush(pq, (nd, v))
    for j in range(N):
        ds = [dist[u] for u in seoul_nodes.get(j, []) if u in dist]
        if ds: M[i * N + j] = min(255, round(min(ds)))

# 셀마다 가까운 역 둘: [역, 걷는 분, 역, 걷는 분] (없으면 -1)
cells = []
for c in dem['cells']:
    from h3 import cell_to_latlng
    lat, lng = cell_to_latlng(c[0]); p = (lng, lat)
    near = sorted((km(p, (s[1], s[2])) * DETOUR, j) for j, s in enumerate(seoul))[:2]
    row = []
    for d, j in near:
        if d <= WALK_MAX: row += [j, round(d / WALK_KMH * 60, 1)]
    cells.append(row)

# 그리기: 노선마다 서울 근처 구간 선분
draw = []
for ln, (st, E) in edges.items():
    segs = [[list(st[a][2]), list(st[b][2])] for a, b in E if min(km(st[a][2], (126.98, 37.56)), km(st[b][2], (126.98, 37.56))) < 30]
    if segs: draw.append({'n': ln, 'c': COLOR.get(ln, '#888888'), 's': segs})

json.dump({'st': [[n, round(x, 5), round(y, 5)] for n, x, y in seoul], 'm': M, 'cell': cells, 'lines': draw}, open(OUT, 'w'), separators=(',', ':'))
import os, gzip
s = open(OUT).read(); print(OUT, len(s), 'bytes,', len(gzip.compress(s.encode())), 'gzip; cells with a station in reach', sum(1 for c in cells if c), 'of', len(cells))
