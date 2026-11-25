"""서울 기본 지도 PMTiles 굽기: 도로(표준노드링크), 구·동 경계, 한강.

python3 scripts/build_tiles.py <NODELINKDATA.zip 또는 MOCT_LINK 폴더> <seoul.json> public/tiles/seoul.pmtiles

레이어
- road: class 0 고속·도시고속, 1 간선(편도 3차로+·국도), 2 편도 2차로, 3 편도 1차로
- gu, dong: 경계선(line)과 라벨 점(label_gu, label_dong)
- river: 한강 중심선(구 경계에서 추출)
"""
import sys, json, math, gzip, os, tempfile, zipfile, collections
import shapefile
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, Point, box, mapping
from shapely.ops import unary_union, linemerge, transform
from shapely.strtree import STRtree
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

SRC, SEOUL, OUT = sys.argv[1:4]
S = json.load(open(SEOUL)); P = S['proj']
def to_ll(x, y): return (x / P['kx'] + P['lon0'], P['lat0'] - y / P['ky'])
def ll_geom(g): return transform(lambda x, y, z=None: to_ll(x, y), g)

# ── 경계 ──
def rings_poly(rs): return unary_union([Polygon(r).buffer(0) for r in rs])
GU = [(g['n'], rings_poly(g['r']), to_ll(g['x'], g['y'])) for g in S['gu']]
DONG = [(d['n'], d['gu'], rings_poly(d['r']), to_ll(d['x'], d['y'])) for d in S['dong']]
city = unary_union([g[1] for g in GU])

# ── 한강: 강북·강남 구가 맞닿은 경계(강 중심선) + 강서·강동의 서울 경계 ──
Gd = {n: p for n, p, _ in GU}
N = unary_union([Gd[k] for k in ['마포구', '용산구', '성동구', '광진구']])
Sb = unary_union([Gd[k] for k in ['강서구', '영등포구', '동작구', '서초구', '강남구', '송파구', '강동구']])
main = N.boundary.intersection(Sb.buffer(0.3))
approx = LineString([(x, y) for x, y in json.load(open(os.path.join(os.path.dirname(__file__), 'river_hint.json')))])
ext = [Gd[k].boundary.intersection(city.boundary.buffer(0.3)).intersection(approx.buffer(30)) for k in ['강서구', '강동구', '광진구']]
river = linemerge(unary_union([main] + ext))
river = unary_union([g for g in getattr(river, 'geoms', [river]) if g.length > 3 and not (g.bounds[2] < 130 and g.bounds[0] < 90)])

# ── 도로 ──
def read_links(src):
    if src.endswith('.zip'):
        d = tempfile.mkdtemp(); z = zipfile.ZipFile(src)
        for n in z.namelist():
            if n.startswith('MOCT_LINK'): z.extract(n, d)
        src = d
    return shapefile.Reader(os.path.join(src, 'MOCT_LINK'), encoding='cp949')
tm = Transformer.from_crs("+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", always_xy=True)
x0, y0 = tm.transform(126.76, 37.41, direction='INVERSE'); x1, y1 = tm.transform(127.19, 37.72, direction='INVERSE')
cityb = city.buffer(15)
cls = collections.defaultdict(list); seen = set()
for sr in read_links(SRC).iterShapeRecords():
    bx = sr.shape.bbox
    if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1: continue
    r = sr.record; k = tuple(sorted((r['F_NODE'], r['T_NODE'])))
    if k in seen: continue
    seen.add(k)
    lo, la = tm.transform([p[0] for p in sr.shape.points], [p[1] for p in sr.shape.points])
    ls = LineString(list(zip(lo, la)))
    rk, ln = r['ROAD_RANK'], (r['LANES'] or 1)
    c = 0 if rk in ('101', '102') else 1 if (rk == '103' or ln >= 3) else 2 if ln == 2 else 3
    cls[c].append(ls)
cityll = ll_geom(cityb)
ROADS = {c: [g for g in getattr(m, 'geoms', [m])] for c, v in cls.items() for m in [linemerge(unary_union(v).intersection(cityll))]}
print({c: len(v) for c, v in ROADS.items()})

# ── 타일 ──
def tile_bounds(z, x, y):
    n = 2 ** z
    lon0 = x / n * 360 - 180; lon1 = (x + 1) / n * 360 - 180
    lat1 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    lat0 = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return lon0, lat0, lon1, lat1
def merc(lon, lat): return lon, math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
def tile_xy(lon, lat, z):
    n = 2 ** z; x = (lon + 180) / 360 * n; y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y

GEOMS = []  # (layer, geom_ll, props, minzoom)
RMIN = {0: 9, 1: 11, 2: 12, 3: 13}
for c, gs in ROADS.items():
    for g in gs: GEOMS.append(('road', g, {'class': c}, RMIN[c]))
for n, p, _ in GU: GEOMS.append(('gu', ll_geom(p.boundary), {'name': n}, 9))
for n, gu, p, _ in DONG: GEOMS.append(('dong', ll_geom(p.boundary), {'name': n, 'gu': gu}, 11))
for g in getattr(river, 'geoms', [river]): GEOMS.append(('river', ll_geom(g), {}, 9))
for n, p, c in GU: GEOMS.append(('label_gu', Point(c), {'name': n}, 9))
for n, gu, p, c in DONG: GEOMS.append(('label_dong', Point(c), {'name': n, 'gu': gu}, 12))
tree = STRtree([g[1] for g in GEOMS])

minx, miny, maxx, maxy = cityll.bounds
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
with open(OUT, 'wb') as f:
    w = Writer(f); count = 0
    tiles = []
    for z in range(9, 15):
        ax, ay = tile_xy(minx, maxy, z); bx, by = tile_xy(maxx, miny, z)
        for x in range(int(ax), int(bx) + 1):
            for y in range(int(ay), int(by) + 1): tiles.append((zxy_to_tileid(z, x, y), z, x, y))
    for tid, z, x, y in sorted(tiles):
        b = tile_bounds(z, x, y); pad = (b[2] - b[0]) * 0.02
        clip = box(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)
        tol = (b[2] - b[0]) / 4096 * 1.5
        layers = collections.defaultdict(list)
        for i in tree.query(clip):
            name, g, props, mz = GEOMS[i]
            if z < mz: continue
            gg = g.intersection(clip) if g.geom_type != 'Point' else (g if clip.contains(g) else None)
            if gg is None or gg.is_empty: continue
            if gg.geom_type != 'Point': gg = gg.simplify(tol)
            # 타일 좌표(0..4096, y 아래로)
            def tx(lon, lat, z=z, x=x, y=y):
                X, Y = tile_xy(lon, lat, z); return ((X - x) * 4096, (Y - y) * 4096)
            gt = transform(lambda a, b2, c=None: tx(a, b2), gg)
            layers[name].append({'geometry': gt.wkt, 'properties': props})
        if not layers: continue
        data = mapbox_vector_tile.encode([{'name': k, 'features': v} for k, v in layers.items()], default_options={'y_coord_down': True, 'quantize_bounds': None, 'extents': 4096})
        w.write_tile(tid, gzip.compress(data)); count += 1
    lon_c, lat_c = (minx + maxx) / 2, (miny + maxy) / 2
    w.finalize({'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP, 'min_zoom': 9, 'max_zoom': 14,
                'min_lon_e7': int(minx * 1e7), 'min_lat_e7': int(miny * 1e7), 'max_lon_e7': int(maxx * 1e7), 'max_lat_e7': int(maxy * 1e7),
                'center_zoom': 11, 'center_lon_e7': int(lon_c * 1e7), 'center_lat_e7': int(lat_c * 1e7)},
               {'attribution': '도로: 국토교통부 표준노드링크 · 경계: vuski/admdongkor (CC BY 4.0)',
                'vector_layers': [{'id': k, 'fields': {}} for k in ['road', 'gu', 'dong', 'river', 'label_gu', 'label_dong']]})
print('tiles', count, os.path.getsize(OUT))
