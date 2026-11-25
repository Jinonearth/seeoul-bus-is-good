"""건물 외곽선 PMTiles: OSM building=* (Overpass로 나눠 받은 JSON들) → public/tiles/buildings.pmtiles

python3 scripts/build_buildings.py <Overpass JSON 폴더> public/data/demand.json public/tiles/buildings.pmtiles

- 받는 쿼리(서울 bbox를 0.05° 칸으로 나눠): [out:json];way["building"](남,서,북,동);out skel geom;
  지도 데이터 © OpenStreetMap 기여자 (ODbL)
- 서울 셀(demand.json의 res9 셀을 res7로 올린 칸) 안에 중심이 있는 건물만
- 타일: 줌 14, 15 (지도는 16.5까지 확대해서 씀). 속성 없이 모양만, 타일 해상도에 맞게 단순화, 화면에서 너무 작은 건 버려요
"""
import sys, json, glob, math, os, gzip, collections
import h3
from shapely.geometry import Polygon, box
from shapely.strtree import STRtree
from shapely.ops import transform
import mapbox_vector_tile
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid, TileType, Compression

SRC, DEMAND, OUT = sys.argv[1:4]
area7 = {h3.cell_to_parent(c[0], 7) for c in json.load(open(DEMAND))['cells']}
seen, polys = set(), []
for fn in sorted(glob.glob(os.path.join(SRC, 'b_*.json'))):
    try: els = json.load(open(fn))['elements']
    except Exception: print('skip', fn); continue
    for e in els:
        if e.get('type') != 'way' or e['id'] in seen: continue
        pts = [(p['lon'], p['lat']) for p in e.get('geometry', []) if p]
        if len(pts) < 4 or pts[0] != pts[-1]: continue
        seen.add(e['id'])
        g = Polygon(pts)
        if not g.is_valid: g = g.buffer(0)
        if g.is_empty: continue
        c = g.centroid
        if h3.latlng_to_cell(c.y, c.x, 7) not in area7: continue
        polys.append(g)
print('buildings', len(polys))
tree = STRtree(polys)

def tile_bounds(z, x, y):
    n = 2 ** z
    return (x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n)))),
            (x + 1) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n)))))
def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n

minx = min(p.bounds[0] for p in polys); miny = min(p.bounds[1] for p in polys); maxx = max(p.bounds[2] for p in polys); maxy = max(p.bounds[3] for p in polys)
sizes = []
with open(OUT, 'wb') as f:
    w = Writer(f); tiles = []
    for z in (14, 15):
        ax, ay = tile_xy(minx, maxy, z); bx, by = tile_xy(maxx, miny, z)
        for x in range(int(ax), int(bx) + 1):
            for y in range(int(ay), int(by) + 1): tiles.append((zxy_to_tileid(z, x, y), z, x, y))
    for tid, z, x, y in sorted(tiles):
        b = tile_bounds(z, x, y); clip = box(*b)
        ext = 4096; px = (b[2] - b[0]) / 512     # 화면 1px(512px 타일 기준)에 해당하는 경도
        feats = []
        for i in tree.query(clip):
            g = polys[i]
            if g.area < (px * 1.2) ** 2: continue    # 화면에서 1px보다 작은 건물은 빼요
            gg = g.intersection(clip).simplify(px * 0.4)
            if gg.is_empty: continue
            gt = transform(lambda a, b2, c=None, z=z, x=x, y=y: ((tile_xy(a, b2, z)[0] - x) * ext, (tile_xy(a, b2, z)[1] - y) * ext), gg)
            feats.append({'geometry': gt.wkt, 'properties': {}})
        if not feats: continue
        data = gzip.compress(mapbox_vector_tile.encode([{'name': 'building', 'features': feats}], default_options={'y_coord_down': True, 'quantize_bounds': None, 'extents': ext}))
        w.write_tile(tid, data); sizes.append(len(data))
    w.finalize({'tile_type': TileType.MVT, 'tile_compression': Compression.GZIP, 'min_zoom': 14, 'max_zoom': 15,
                'min_lon_e7': int(minx * 1e7), 'min_lat_e7': int(miny * 1e7), 'max_lon_e7': int(maxx * 1e7), 'max_lat_e7': int(maxy * 1e7),
                'center_zoom': 15, 'center_lon_e7': int(126.98 * 1e7), 'center_lat_e7': int(37.56 * 1e7)},
               {'attribution': '건물 © OpenStreetMap 기여자 (ODbL)', 'vector_layers': [{'id': 'building', 'fields': {}}]})
sizes.sort()
print('tiles', len(sizes), 'file', os.path.getsize(OUT), 'bytes; tile median', sizes[len(sizes) // 2], 'p95', sizes[int(len(sizes) * 0.95)], 'max', sizes[-1])
