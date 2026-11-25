"""배경 그림용 PMTiles: 땅 쓰임(녹지·숲·주거·상업·공업, OSM)과 굵게 부풀린 도로 면(표준노드링크)

python3 scripts/build_land.py <NODELINKDATA.zip> <osm_land.json> public/tiles/land.pmtiles [--no-land]

- osm_land.json: Overpass `out geom` 결과 (서울 bbox의 landuse·leisure·natural 면). 받는 쿼리는 README에.
  지도 데이터 © OpenStreetMap 기여자 (ODbL).
- land 레이어 (z11–14): class = forest(숲·수풀) / green(공원·잔디·묘지·골프장) / res(주거) / com(상업·판매) / ind(공업)
- road_area 레이어 (z13–14): 도로 등급별로 링크를 부풀려(BUF) 합친 면. 방향마다 따로 그려진 도로가 한 덩어리로 보여요.
  길 찾기 그래프와는 상관없는 그림용이에요.
"""
import sys, json, math, os, gzip, tempfile, zipfile, collections
import shapefile
from pyproj import Transformer
from shapely.geometry import Polygon, LineString, box, MultiPolygon
from shapely.ops import unary_union, polygonize, linemerge, transform
from shapely.strtree import STRtree
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

SRC, OSM, OUT = [a for a in sys.argv[1:] if not a.startswith('--')][:3]
BUF = {0: 16, 1: 12, 2: 8, 3: 5}   # 도로 반폭(m), 실제보다 부풀림
BBOX = (126.76, 37.41, 127.19, 37.72)
LAT0 = 37.55; KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def to_m(g): return transform(lambda x, y, z=None: (x * KX, y * KY), g)
def to_ll(g): return transform(lambda x, y, z=None: (x / KX, y / KY), g)

# ── 땅 쓰임 ──
def kind(t):
    lu, le, na = t.get('landuse'), t.get('leisure'), t.get('natural')
    if lu == 'forest' or na in ('wood', 'scrub', 'heath'): return 'forest'
    if lu in ('grass', 'meadow', 'cemetery', 'recreation_ground', 'village_green') or le in ('park', 'garden', 'golf_course') or na == 'grassland': return 'green'
    if lu == 'residential': return 'res'
    if lu in ('commercial', 'retail'): return 'com'
    if lu == 'industrial': return 'ind'
    return None
els = json.load(open(OSM))['elements']
polys = collections.defaultdict(list)
for e in els:
    k = kind(e.get('tags', {}))
    if not k: continue
    try:
        if e['type'] == 'way':
            pts = [(p['lon'], p['lat']) for p in e.get('geometry', [])]
            if len(pts) >= 4 and pts[0] == pts[-1]: polys[k].append(Polygon(pts).buffer(0))
        else:
            outer = [LineString([(p['lon'], p['lat']) for p in m['geometry']]) for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
            inner = [LineString([(p['lon'], p['lat']) for p in m['geometry']]) for m in e.get('members', []) if m.get('role') == 'inner' and m.get('geometry')]
            o = unary_union(list(polygonize(linemerge(outer)))) if outer else None
            if o is None or o.is_empty: continue
            if inner:
                i = unary_union(list(polygonize(linemerge(inner))))
                if not i.is_empty: o = o.difference(i)
            polys[k].append(o.buffer(0))
    except Exception:
        continue
clipb = box(*BBOX)
LAND = {}
for k, ps in polys.items():
    u = unary_union([p for p in ps if p.is_valid and not p.is_empty]).intersection(clipb)
    LAND[k] = u
    print('land', k, len(ps), round(to_m(u).area / 1e6, 1), 'km²')
# 겹치면 위 순서가 이겨요: 숲 > 녹지 > 상업 > 공업 > 주거
taken = None
for k in ['forest', 'green', 'com', 'ind', 'res']:
    if k not in LAND: continue
    if taken is not None: LAND[k] = LAND[k].difference(taken)
    taken = LAND[k] if taken is None else unary_union([taken, LAND[k]])

# ── 도로 면 ──
def read_links(src):
    d = tempfile.mkdtemp(); z = zipfile.ZipFile(src)
    for n in z.namelist():
        if n.startswith('MOCT_LINK'): z.extract(n, d)
    return shapefile.Reader(os.path.join(d, 'MOCT_LINK'), encoding='cp949')
tm = Transformer.from_crs("+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs", "EPSG:4326", always_xy=True)
x0, y0 = tm.transform(BBOX[0], BBOX[1], direction='INVERSE'); x1, y1 = tm.transform(BBOX[2], BBOX[3], direction='INVERSE')
lines = collections.defaultdict(list)
for sr in read_links(SRC).iterShapeRecords():
    bx = sr.shape.bbox
    if bx[2] < x0 or bx[0] > x1 or bx[3] < y0 or bx[1] > y1: continue
    r = sr.record; rk, ln = r['ROAD_RANK'], (r['LANES'] or 1)
    c = 0 if rk in ('101', '102') else 1 if (rk == '103' or ln >= 3) else 2 if ln == 2 else 3
    lo, la = tm.transform([p[0] for p in sr.shape.points], [p[1] for p in sr.shape.points])
    lines[c].append(LineString([(a * KX, b * KY) for a, b in zip(lo, la)]))
ROAD = {}
for c, ls in lines.items():
    u = unary_union([l.buffer(BUF[c], cap_style='round', join_style='round', resolution=4) for l in ls]).simplify(2)
    ROAD[c] = to_ll(u).intersection(clipb)
    print('road', c, len(ls))

# ── 타일 ──
def tile_bounds(z, x, y):
    n = 2 ** z
    return (x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))),
            (x + 1) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))))
def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
def parts(g): return list(getattr(g, 'geoms', [g]))
G = []   # (layer, geom, props, minzoom)
WITH_LAND = '--no-land' not in sys.argv   # 땅 쓰임은 이제 헥사곤 지형(build_terrain.py)으로 그려서 기본은 도로 면만
for k, g in (LAND.items() if WITH_LAND else []):
    for p in parts(g):
        if p.geom_type == 'Polygon' and not p.is_empty: G.append(('land', p, {'class': k}, 11))
for c, g in ROAD.items():
    for p in parts(g):
        if p.geom_type == 'Polygon' and not p.is_empty: G.append(('road_area', p, {'class': c}, 13))
tree = STRtree([g[1] for g in G])
os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
with open(OUT, 'wb') as f:
    w = Writer(f); tiles = []
    for z in range(11, 15):
        ax, ay = tile_xy(BBOX[0], BBOX[3], z); bx, by = tile_xy(BBOX[2], BBOX[1], z)
        for x in range(int(ax), int(bx) + 1):
            for y in range(int(ay), int(by) + 1): tiles.append((zxy_to_tileid(z, x, y), z, x, y))
    count = 0
    for tid, z, x, y in sorted(tiles):
        b = tile_bounds(z, x, y); pad = (b[2] - b[0]) * 0.02
        clip = box(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad); tol = (b[2] - b[0]) / 4096 * 2
        layers = collections.defaultdict(list)
        for i in tree.query(clip):
            name, g, props, mz = G[i]
            if z < mz: continue
            gg = g.intersection(clip)
            if gg.is_empty: continue
            gg = gg.simplify(tol)
            if gg.is_empty or gg.area < tol * tol * 4: continue
            gt = transform(lambda a, b2, c=None, z=z, x=x, y=y: ((tile_xy(a, b2, z)[0] - x) * 4096, (tile_xy(a, b2, z)[1] - y) * 4096), gg)
            layers[name].append({'geometry': gt.wkt, 'properties': props})
        if not layers: continue
        data = mapbox_vector_tile.encode([{'name': k, 'features': v} for k, v in layers.items()], default_options={'y_coord_down': True, 'quantize_bounds': None, 'extents': 4096})
        w.write_tile(tid, gzip.compress(data)); count += 1
    w.finalize({'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP, 'min_zoom': 11, 'max_zoom': 14,
                'min_lon_e7': int(BBOX[0] * 1e7), 'min_lat_e7': int(BBOX[1] * 1e7), 'max_lon_e7': int(BBOX[2] * 1e7), 'max_lat_e7': int(BBOX[3] * 1e7),
                'center_zoom': 12, 'center_lon_e7': int(126.98 * 1e7), 'center_lat_e7': int(37.56 * 1e7)},
               {'attribution': '땅 쓰임 © OpenStreetMap 기여자 (ODbL)', 'vector_layers': [{'id': 'land', 'fields': {}}, {'id': 'road_area', 'fields': {}}]})
print('tiles', count, os.path.getsize(OUT), 'bytes')
