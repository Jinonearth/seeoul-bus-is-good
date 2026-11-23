// MapLibre 지도와 게임 레이어(헥사곤 수요, 수요 흐름, 노선, 정류장, 버스)
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { cellToBoundary, cellToParent, latLngToCell, getHexagonEdgeLengthAvg, UNITS } from 'h3-js';
import { type Demand, stopable, snapped } from '../game/data';
import { type Route, posAt, BUS_CAP } from '../game/model';
import { baseStyle, labelLayers, INK, PAPER, PINK } from './style';
import { addTerrainPatterns, VARIANTS } from './sprites';

export type Flow = { from: [number, number]; to: [number, number]; v: number; out: boolean };
const HEX_RES = [7, 8, 9] as const;
// 헥사곤은 화면 줌보다 한 단계 굵게: 같은 줌에서 한 단계 큰 셀
export const resForZoom = (z: number) => (z < 12 ? 7 : z < 13.5 ? 8 : 9);
const ZRANGE: Record<number, [number, number]> = { 7: [0, 12], 8: [12, 13.5], 9: [13.5, 24] };
const DOT = [0, 0.16, 0.32, 0.48, 0.64, 0.8];
// 탄 사람 채움 색 (Okabe-Ito): ¼·½ 초록 여유, ¾ 노랑 붐빔, 꽉 빨강 만원. 길이도 함께 늘어서 색 없이도 읽혀요
const LOAD_COLOR = ['', '#009E73', '#009E73', '#F0E442', '#D55E00'];
// 지하철을 지도에 그릴지 (수요 계산에서 지하철과 겨루는 건 그대로). 지금은 숨겨요
export const SHOW_SUBWAY = false;
// 지형: OSM 땅 쓰임이 없는 칸(o)도 정류장을 둘 수 있는 도심이면 집(r), 수요가 아주 큰 곳이면 건물(c)로 채워요
const busy: Record<number, number> = {};
function terrainOf(dm: Demand, c: { id: string; O: number[] }, res: number) {
  const t = dm.terrain[c.id] ?? 'o'; if (t !== 'o') return t;
  if (busy[res] === undefined) { const list = res === 9 ? dm.cells : [...dm.parents[res === 7 ? 0 : 1].values()]; const v = list.map(x => x.O.reduce((a, b) => a + b, 0)).sort((a, b) => a - b); busy[res] = v[Math.floor(v.length * 0.85)]; }
  const tot = c.O.reduce((a, b) => a + b, 0);
  if (tot >= busy[res]) return 'c';
  return res < 9 || stopable(c.id) ? 'r' : 'o';
}
const LO_Z = 13, LO_TOL_M = 300;   // 이 줌 아래에선 노선을 단순한 선 하나로 (Douglas-Peucker 허용 거리)
const KX = 111320 * Math.cos(37.55 * Math.PI / 180), KY = 110540;
const mDist = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY) / 1000;
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!, A = pts[a], B = pts[b];
    const ax = A[0] * KX, ay = A[1] * KY, bx = B[0] * KX - ax, by = B[1] * KY - ay, L2 = bx * bx + by * by;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * KX - ax, py = pts[i][1] * KY - ay;
      const t = L2 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0, d = Math.hypot(px - t * bx, py - t * by);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function along(line: [number, number][], cum: number[], d: number): [number, number] {
  let i = 1; while (i < line.length - 1 && cum[i] < d) i++;
  const a = line[i - 1], b = line[i] ?? a, L = cum[i] - cum[i - 1], t = L > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]) / L)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

let protocolAdded = false;

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[] = []): FC => ({ type: 'FeatureCollection', features });

export class GameMap {
  map: maplibregl.Map;
  ready: Promise<void>;
  isReady = false;   // 레이어 준비됨 (map.loaded()는 타일 읽는 동안 false)
  private dm: Demand;
  private plates = new Set<string>();
  onTap: (e: { lngLat: [number, number]; route?: number; stop?: string }) => void = () => {};

  constructor(el: HTMLElement, dm: Demand) {
    this.dm = dm;
    if (!protocolAdded) { maplibregl.addProtocol('pmtiles', new Protocol().tile); protocolAdded = true; }
    const base = import.meta.env.BASE_URL;
    const tiles = new URL(`${base}tiles/seoul.pmtiles`, location.href).href, land = new URL(`${base}tiles/land.pmtiles`, location.href).href;
    this.map = new maplibregl.Map({
      container: el, style: baseStyle(tiles, land), center: [126.99, 37.56], zoom: 10.2, minZoom: 9.3, maxZoom: 15.5,
      maxBounds: [[126.6, 37.35], [127.35, 37.75]], attributionControl: { compact: true },
      localIdeographFontFamily: "'Gothic A1', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.ready = new Promise(res => this.map.once('load', () => { this.addLayers(); this.isReady = true; this.foldAttrib(); res(); }));
    this.map.on('zoom', () => { if (this.flows.length) this.drawFlows(); });
    this.map.on('click', e => {
      const pad = matchMedia('(pointer: coarse)').matches ? 22 : 8;
      const hit = this.map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['route-hit'] });
      const st = this.map.getLayer('stops-hi') ? this.map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['stops-hi'] }) : [];
      this.onTap({ lngLat: [e.lngLat.lng, e.lngLat.lat], route: hit[0]?.properties?.id as number | undefined, stop: st[0]?.properties?.cell as string | undefined });
    });
  }

  private addLayers() {
    const m = this.map;
    // 헥사곤 지형 타일: 셀마다 바탕색 + 직접 그린 픽셀 그림(나무·집·건물), 도로·강 아래. 타일 사이는 옅은 틈
    addTerrainPatterns(m);
    // 헥사곤 (해상도별): 옅은 먹 외곽선 + 핑크 망점
    for (const res of HEX_RES) {
      const [minzoom, maxzoom] = ZRANGE[res];
      m.addSource(`hex${res}`, { type: 'geojson', data: fc() });
      m.addSource(`dot${res}`, { type: 'geojson', data: fc(), promoteId: 'id' });
      // 지형 타일: 헥사곤마다 픽셀 아트 무늬(종류 × 변형 3), 사이는 옅은 틈. 도로·강 아래
      m.addLayer({ id: `terrain${res}`, type: 'fill', source: `hex${res}`, minzoom, maxzoom, paint: { 'fill-pattern': ['concat', 'pat-', ['get', 't'], '-', ['get', 'v']] as never, 'fill-opacity': 0.85 } }, 'river');
      m.addLayer({ id: `terrain${res}-gap`, type: 'line', source: `hex${res}`, minzoom, maxzoom, paint: { 'line-color': '#F4F0E4', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 15, 2.2], 'line-opacity': 0.85 } }, 'river');
      // 노선 그리는 중: 도로가 없어 정류장을 둘 수 없는 셀을 옅은 회색으로
      if (res === 9) m.addLayer({ id: 'hex9-ns', type: 'fill', source: 'hex9', minzoom, maxzoom, filter: ['==', ['get', 'ns'], 1], layout: { visibility: 'none' }, paint: { 'fill-color': INK, 'fill-opacity': 0.14 } });
      m.addLayer({ id: `hex${res}-line`, type: 'line', source: `hex${res}`, minzoom, maxzoom, paint: { 'line-color': INK, 'line-opacity': 0.12, 'line-width': 1 } });
      // 망점 반지름 = 셀 크기 × 단계 비율. 줌이 1 오르면 화면 크기 2배
      const edge = getHexagonEdgeLengthAvg(res, UNITS.m), k = (z: number) => edge / (156543 * Math.cos(37.55 * Math.PI / 180) / 2 ** z);
      m.addLayer({ id: `dot${res}`, type: 'circle', source: `dot${res}`, minzoom, maxzoom,
        paint: { 'circle-color': PINK, 'circle-opacity': 0.85,
          // k = 지금 기다리는 사람 ÷ 평소 (실시간, 면적이 k배)
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 8, ['*', ['get', 'r'], ['sqrt', ['coalesce', ['feature-state', 'k'], 1]], k(8)], 16, ['*', ['get', 'r'], ['sqrt', ['coalesce', ['feature-state', 'k'], 1]], k(16)]] } });
    }
    // 지하철: 노선색을 회색 쪽으로 흐리게 한 가는 선 + 역 눈금 (줌 11부터, 버스 노선 아래). 버스가 겨루는 상대
    if (SHOW_SUBWAY) {
    const mute = (hex: string) => { const n = parseInt(hex.slice(1), 16), g = 0x9A, k = 0.45; const ch = (v: number) => Math.round(v * k + g * (1 - k)); return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`; };
    m.addSource('subway', { type: 'geojson', data: fc(this.dm.sub.lines.flatMap(l => l.s.map(seg => ({ type: 'Feature' as const, properties: { c: mute(l.c) }, geometry: { type: 'LineString' as const, coordinates: seg } })))) });
    m.addSource('subway-st', { type: 'geojson', data: fc(this.dm.sub.st.map(([, x, y]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [x, y] } }))) });
    m.addLayer({ id: 'subway', type: 'line', source: 'subway', minzoom: 11, layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 15, 3], 'line-opacity': 0.8 } });
    m.addLayer({ id: 'subway-st', type: 'circle', source: 'subway-st', minzoom: 11, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 15, 4], 'circle-color': '#FFFFFF', 'circle-stroke-color': '#8A867C', 'circle-stroke-width': 1.2 } });
    }
    m.addSource('sel', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'sel', type: 'line', source: 'sel', paint: { 'line-color': INK, 'line-width': 3 } });
    // 수요 흐름: 나가는 = 파랑 실선, 들어오는 = 주황 점선
    m.addSource('flows', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'flow-out', type: 'line', source: 'flows', filter: ['all', ['==', ['get', 'out'], true], ['==', ['geometry-type'], 'LineString']], layout: { 'line-cap': 'butt' },
      paint: { 'line-color': '#0072B2', 'line-opacity': ['get', 'a'], 'line-width': ['get', 'w'] } });
    m.addLayer({ id: 'flow-in', type: 'line', source: 'flows', filter: ['all', ['==', ['get', 'out'], false], ['==', ['geometry-type'], 'LineString']],
      paint: { 'line-color': '#D55E00', 'line-opacity': ['get', 'a'], 'line-width': ['get', 'w'], 'line-dasharray': [1.4, 0.8] } });
    m.addLayer({ id: 'flow-head', type: 'fill', source: 'flows', filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['case', ['get', 'out'], '#0072B2', '#D55E00'], 'fill-opacity': ['get', 'a'] } });
    // 노선: 먹 테두리 + 노선색 + 패턴(줌 11부터)
    m.addSource('routes', { type: 'geojson', data: fc() });
    const Wf = (f: (w: number) => number) => ['interpolate', ['linear'], ['zoom'], 9, f(4), 13, f(7), 15, f(9)] as never, W = Wf(w => w);
    // 줌 13 아래에서는 노선마다 단순한 선 하나(lo), 위에서는 실제 도로 길(가는 길 + 오는 길)
    const dimOp = ['case', ['get', 'dim'], 0.3, 1];
    const op = ['step', ['zoom'], ['case', ['get', 'lo'], dimOp, 0], LO_Z, ['case', ['get', 'lo'], 0, dimOp]] as const;
    // 바쁜 배경 위에서도 노선이 떠 보이게 흰 바깥 테두리
    m.addLayer({ id: 'route-halo', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'rgba(255,255,255,0.85)', 'line-width': Wf(w => w + 9), 'line-opacity': op as never } });
    m.addLayer({ id: 'route-case', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': Wf(w => w + 5), 'line-opacity': op as never } });
    m.addLayer({ id: 'route', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': W, 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p1', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 1], paint: { 'line-color': PAPER, 'line-width': W, 'line-dasharray': [1.3, 1.3], 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p2', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 2], layout: { 'line-join': 'round' }, paint: { 'line-color': PAPER, 'line-width': Wf(w => w * 0.3), 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p3', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 3], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': Wf(w => w * 0.45), 'line-dasharray': [0.1, 2.2], 'line-opacity': op as never } });
    m.addLayer({ id: 'route-hit', type: 'line', source: 'routes', filter: ['!', ['get', 'lo']], paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } });
    m.addSource('stops', { type: 'geojson', data: fc() });
    // 줌인 정류장: 셀마다 하나. 노선 하나 = 흰 동그라미, 둘 이상 = 환승 알약(노선색 점)
    m.addSource('stops-hi', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'stops-hi', type: 'symbol', source: 'stops-hi', minzoom: LO_Z, layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 15, 0.75] }, paint: { 'icon-opacity': ['case', ['get', 'dim'], 0.35, 1] } });
    m.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 12, maxzoom: LO_Z, filter: ['get', 'lo'],
      paint: { 'circle-color': '#FFFFFF', 'circle-stroke-color': INK, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 14, 6], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 14, 3], 'circle-opacity': op as never, 'circle-stroke-opacity': op as never } });
    // 그리는 중인 노선
    m.addSource('draft', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'draft-case', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': ['case', ['get', 'back'], 6, 11] } });
    m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'back'], 3, 6] } });
    m.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'first'], 8, 6], 'circle-stroke-color': INK, 'circle-stroke-width': 2.5 } });
    // 버스: 줌아웃 = 흰 네모, 줌인 = 번호판. 둘 다 탄 사람만큼 먹색이 차올라요. 만차로 사람을 남기면 경고 삼각형
    this.addSquare(); this.addWarn();
    m.addSource('buses', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'bus-sq', type: 'symbol', source: 'buses', maxzoom: 12.5, layout: { 'icon-image': ['concat', 'bus-sq-', ['get', 'lv']], 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1] }, paint: { 'icon-opacity': ['*', ['case', ['get', 'dim'], 0.3, 1], ['get', 'a']] } });
    m.addLayer({ id: 'bus-plate', type: 'symbol', source: 'buses', minzoom: 12.5, layout: { 'icon-image': ['concat', 'plate-', ['get', 'rid'], '-', ['get', 'lv']], 'icon-allow-overlap': true }, paint: { 'icon-opacity': ['*', ['case', ['get', 'dim'], 0.3, 1], ['get', 'a']] } });
    m.addLayer({ id: 'bus-warn', type: 'symbol', source: 'buses', filter: ['all', ['>', ['get', 'crowd'], 1], ['!', ['get', 'ret']]], layout: { 'icon-image': 'warn', 'icon-allow-overlap': true, 'icon-offset': [16, -10], 'icon-size': ['step', ['zoom'], 0.75, 12.5, 1] } });
    // 노선 번호 배지: 줌아웃에서만(줌인하면 버스 번호판이 대신), 버스보다 위
    m.addLayer({ id: 'route-badge', type: 'symbol', source: 'routes', maxzoom: 12.5, filter: ['get', 'lo'],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['get', 'num'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-rotation-alignment': 'viewport', 'text-keep-upright': true },
      paint: { 'text-color': INK, 'text-halo-color': '#FFFFFF', 'text-halo-width': 4, 'text-opacity': dimOp as never } });
    for (const l of labelLayers) m.addLayer(l as never);
  }

  // 줌아웃 버스: 흰 네모 안에 탄 사람만큼 왼쪽에서 차요 (0, ¼, ½, ¾, 꽉, 색은 LOAD_COLOR)
  private addSquare() {
    for (let lv = 0; lv <= 4; lv++) {
      const c = document.createElement('canvas'); c.width = c.height = 12; const g = c.getContext('2d')!;
      g.fillStyle = '#FFFFFF'; g.fillRect(1, 1, 10, 10);
      const fw = Math.round(10 * lv / 4); g.fillStyle = LOAD_COLOR[lv]; g.fillRect(1, 1, fw, 10);
      g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(1, 1, 10, 10);
      this.map.addImage(`bus-sq-${lv}`, g.getImageData(0, 0, 12, 12));
    }
  }
  private addWarn() {
    const c = document.createElement('canvas'); c.width = c.height = 20; const g = c.getContext('2d')!;
    g.beginPath(); g.moveTo(10, 2); g.lineTo(18, 17); g.lineTo(2, 17); g.closePath(); g.fillStyle = '#D55E00'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#FFF'; g.font = '800 10px sans-serif'; g.textAlign = 'center'; g.fillText('!', 10, 15);
    this.map.addImage('warn', g.getImageData(0, 0, 20, 20));
  }
  // 줌인 버스 번호판: 흰 바탕 + 왼쪽 노선색 띠 + 번호. 탄 사람만큼 왼쪽에서 차고(0, ¼, ½, ¾, 꽉, 초록·노랑·빨강), 채움 위 글자는 흰색(노랑 위는 먹색)
  private plate(r: Route) {
    const k = `${r.id}:${r.num}:${r.color}`;
    if (this.plates.has(k)) return;
    for (let lv = 0; lv <= 4; lv++) {
      const id = `plate-${r.id}-${lv}`, dpr = 2, c = document.createElement('canvas'), g = c.getContext('2d')!;
      g.font = '800 12px "Gothic A1", sans-serif'; const w = Math.ceil(g.measureText(r.num).width + 18), h = 20;
      c.width = w * dpr; c.height = h * dpr; g.scale(dpr, dpr);
      g.fillStyle = '#FFFFFF'; g.fillRect(1, 1, w - 2, h - 2);
      const fw = (w - 7) * lv / 4; g.fillStyle = LOAD_COLOR[lv]; g.fillRect(6, 1, fw, h - 2);
      g.fillStyle = r.color; g.fillRect(1, 1, 5, h - 2);
      g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
      // 번호: 흰 바탕 부분은 먹색, 먹색이 찬 부분은 흰색 (글자가 경계에 걸려도 읽히게)
      g.font = '800 12px "Gothic A1", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = INK; g.fillText(r.num, w / 2 + 2.5, h / 2 + 0.5);
      if (fw > 0) { g.save(); g.beginPath(); g.rect(6, 1, fw, h - 2); g.clip(); g.fillStyle = lv === 3 ? INK : '#FFFFFF'; g.fillText(r.num, w / 2 + 2.5, h / 2 + 0.5); g.restore(); }
      if (this.map.hasImage(id)) this.map.removeImage(id);
      this.map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: dpr });
    }
    this.plates.add(k);
  }

  // 망점 실시간 크기: 셀(및 res7·8 묶음)마다 지금 기다리는 사람 ÷ 평소. 많이 바뀐 것만 고쳐요
  private live = new Map<number, string[]>();
  private liveK = new Map<string, number>();
  private kids: Map<string, number[]>[] | null = null;
  setLive(pool: Float64Array, eq: (i: number) => number) {
    const dm = this.dm;
    this.kids ??= [7, 8].map(res => { const m = new Map<string, number[]>(); dm.cells.forEach(c => { const p = cellToParent(c.id, res); (m.get(p) ?? m.set(p, []).get(p)!).push(c.i); }); return m; });
    for (const [res, list] of this.live) {
      for (const id of list) {
        let k: number;
        if (res === 9) { const i = dm.byId.get(id)!.i, e = eq(i); k = e > 0 ? pool[i] / e : 1; }
        else { let p = 0, e = 0; for (const i of this.kids[res === 7 ? 0 : 1].get(id) ?? []) { p += pool[i]; e += eq(i); } k = e > 0 ? p / e : 1; }
        const key = res + id, old = this.liveK.get(key);
        if (old !== undefined && Math.abs(old - k) < 0.03) continue;
        this.liveK.set(key, k); this.map.setFeatureState({ source: `dot${res}`, id }, { k });
      }
    }
  }

  // 지금 시간대 수요를 헥사곤 망점으로
  setDemand(bin: number) {
    const dm = this.dm;
    this.liveK.clear();
    const sets: [number, { id: string; lat: number; lng: number; O: number[] }[]][] = [
      [7, [...dm.parents[0].values()]], [8, [...dm.parents[1].values()]], [9, dm.cells]];
    for (const [res, list] of sets) {
      const val = (c: { O: number[] }) => c.O[bin];   // 지금 시간대 출발 수요 (실시간 크기는 setLive)
      const vals = list.map(val), sorted = [...vals].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.98)] || 1;
      const hex: GeoJSON.Feature[] = [], dot: GeoJSON.Feature[] = [], live: string[] = [];
      list.forEach((c, i) => {
        const v = Math.sqrt(Math.min(1, vals[i] / ref));
        const ring = cellToBoundary(c.id, true);
        const t = terrainOf(dm, c, res);
        hex.push({ type: 'Feature', properties: { id: c.id, t, v: parseInt(c.id.slice(-6, -3), 16) % VARIANTS, ns: res === 9 && !stopable(c.id) ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [ring] } });
        if (v >= 0.08) { dot.push({ type: 'Feature', properties: { id: c.id, r: DOT[Math.min(5, 1 + Math.floor(v * 5))] }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } }); live.push(c.id); }
      });
      this.live.set(res, live); this.map.removeFeatureState({ source: `dot${res}` });
      (this.map.getSource(`hex${res}`) as GeoJSONSource).setData(fc(hex));
      (this.map.getSource(`dot${res}`) as GeoJSONSource).setData(fc(dot));
    }
  }

  // 옮겨 놓은 정류장 칸을 잠깐 테두리로
  private flashT = 0;
  flash(cell: string) {
    this.setSelected(cell); clearTimeout(this.flashT);
    this.flashT = window.setTimeout(() => this.setSelected(null), 1200);
  }

  setSelected(cell: string | null) {
    (this.map.getSource('sel') as GeoJSONSource).setData(fc(cell ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cellToBoundary(cell, true)] } }] : []));
  }

  // 지도 출처(ⓘ)는 처음엔 접어 둬요 (펼친 글이 위 상태 막대 아래를 가려서)
  private foldAttrib() {
    const a = this.map.getContainer().querySelector('.maplibregl-ctrl-attrib');
    a?.classList.remove('maplibregl-compact-show'); a?.removeAttribute('open');
  }
  // 수요 흐름 화살표: 화면(px)에서 만들어요. 화살촉 밑변 = 선 굵기, 길이 = 굵기 × 1.5, 선은 화살촉 밑변에서 끝나요.
  // 줌이 바뀌면 다시 그려서 어느 줌에서나 같은 모양
  private flows: Flow[] = [];
  setFlows(flows: Flow[]) { this.flows = flows; this.drawFlows(); }
  private drawFlows() {
    const flows = this.flows, m = this.map;
    const vmax = Math.max(1, ...flows.map(f => f.v)), feats: GeoJSON.Feature[] = [];
    const un = (x: number, y: number): [number, number] => { const q = m.unproject([x, y]); return [q.lng, q.lat]; };
    for (const f of flows) {
      const rel = Math.pow(f.v / vmax, 1.7), w = Math.round((2 + 12 * rel) * 2) / 2, a = 0.4 + 0.55 * rel;
      // 살짝 휜 곡선 (화면 좌표), 끝점은 셀 중심 조금 앞
      const A = m.project(f.from), B = m.project(f.to), mx = (A.x + B.x) / 2 - (B.y - A.y) * 0.2, my = (A.y + B.y) / 2 + (B.x - A.x) * 0.2;
      const P: [number, number][] = [];
      for (let i = 0; i <= 32; i++) { const t = i / 32 * 0.94; P.push([(1 - t) ** 2 * A.x + 2 * (1 - t) * t * mx + t * t * B.x, (1 - t) ** 2 * A.y + 2 * (1 - t) * t * my + t * t * B.y]); }
      // 끝에서 화살촉 길이만큼 잘라 선의 끝(밑변)을 찾기
      const head = w * 1.5; let left = head, k = P.length - 1, base: [number, number] = P[k];
      while (k > 0) { const d = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]); if (d >= left) { const t = left / d; base = [P[k][0] + (P[k - 1][0] - P[k][0]) * t, P[k][1] + (P[k - 1][1] - P[k][1]) * t]; break; } left -= d; k--; }
      const tip = P[P.length - 1], shaft = [...P.slice(0, k), base];
      if (shaft.length < 2) continue;
      const dx = tip[0] - base[0], dy = tip[1] - base[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
      feats.push({ type: 'Feature', properties: { out: f.out, w, a }, geometry: { type: 'LineString', coordinates: shaft.map(([x, y]) => un(x, y)) } });
      feats.push({ type: 'Feature', properties: { out: f.out, a }, geometry: { type: 'Polygon', coordinates: [[un(...tip), un(base[0] + nx, base[1] + ny), un(base[0] - nx, base[1] - ny), un(...tip)]] } });
    }
    (m.getSource('flows') as GeoJSONSource | undefined)?.setData(fc(feats));
  }

  // 줌아웃용 단순한 선: 가는 길 도로를 LO_TOL_M로 줄인 선 하나. 버스와 정류장은 가는 길 비율대로 그 위에
  private lo = new Map<number, { line: [number, number][]; cum: number[]; out: number }>();
  private loOf(r: Route) {
    const out = r.path.slice(0, r.outN + 1), line = simplify(out, LO_TOL_M), cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + mDist(line[i - 1], line[i]));
    const v = { line, cum, out: r.cum[r.outN] || 1e-9 }; this.lo.set(r.id, v); return v;
  }
  private loAt(r: Route, s: number): [number, number] {
    const v = this.lo.get(r.id) ?? this.loOf(r), L = r.cum[r.cum.length - 1] || 1, d = ((s % L) + L) % L;
    const f = d <= v.out ? d / v.out : 1 - (d - v.out) / Math.max(1e-9, L - v.out);
    return along(v.line, v.cum, f * v.cum[v.cum.length - 1]);
  }

  setRoutes(routes: Route[], focus: number | null) {
    const lines: GeoJSON.Feature[] = [], stops: GeoJSON.Feature[] = [], cells = new Map<string, { colors: string[]; dim: boolean }>();
    this.lo.clear();
    for (const r of routes) {
      this.plate(r);
      const dim = focus != null && focus !== r.id, props = { id: r.id, num: r.num, color: r.color, pattern: r.pattern, dim };
      lines.push({ type: 'Feature', properties: { ...props, lo: false }, geometry: { type: 'LineString', coordinates: r.path } });
      const v = this.loOf(r);
      if (v.line.length > 1) lines.push({ type: 'Feature', properties: { ...props, lo: true }, geometry: { type: 'LineString', coordinates: v.line } });
      r.stops.forEach(c => { const v = cells.get(c) ?? cells.set(c, { colors: [], dim: true }).get(c)!; if (!v.colors.includes(r.color)) v.colors.push(r.color); v.dim &&= dim; });
      for (const q of r.visits) if (q.s <= v.out + 1e-9) stops.push({ type: 'Feature', properties: { dim, lo: true }, geometry: { type: 'Point', coordinates: this.loAt(r, q.s) } });
    }
    (this.map.getSource('routes') as GeoJSONSource).setData(fc(lines));
    (this.map.getSource('stops') as GeoJSONSource).setData(fc(stops));
    // 셀마다 정류장 하나: 그 셀의 대표 도로 위 자리 (가는 길·오는 길 자리 사이가 아니라, 정류장 둘 곳으로 고른 바로 그 점)
    const hi: GeoJSON.Feature[] = [];
    for (const [cell, v] of cells) hi.push({ type: 'Feature', properties: { cell, dim: v.dim, img: this.stopImg(v.colors) }, geometry: { type: 'Point', coordinates: snapped(cell) } });
    (this.map.getSource('stops-hi') as GeoJSONSource).setData(fc(hi));
  }

  // 정류장 그림: 노선 하나 = 24×24 흰 동그라미(먹 3px), 둘 이상 = 흰 알약(먹 3px, 높이 15) 안에 노선색 점 (넷 넘으면 +n)
  private stopImgs = new Set<string>();
  private stopImg(colors: string[]) {
    const id = colors.length < 2 ? 'stop-1' : `stop-${colors.slice(0, 4).join('')}${colors.length > 4 ? `+${colors.length - 4}` : ''}`;
    if (this.stopImgs.has(id)) return id;
    const dpr = 2, c = document.createElement('canvas'), g = c.getContext('2d')!;
    if (colors.length < 2) {
      c.width = c.height = 24 * dpr; g.scale(dpr, dpr);
      g.beginPath(); g.arc(12, 12, 7.5, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    } else {
      const k = Math.min(4, colors.length), more = colors.length - k, w = Math.max(40, 18 + k * 9 + (more ? 14 : 0));
      c.width = w * dpr; c.height = 24 * dpr; g.scale(dpr, dpr);
      g.beginPath(); g.roundRect(2.5, 4.5, w - 5, 15, 7.5); g.fillStyle = '#FFFFFF'; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
      const x0 = w / 2 - ((k - 1) * 9 + (more ? 14 : 0)) / 2;
      colors.slice(0, k).forEach((col, i) => { g.beginPath(); g.arc(x0 + i * 9, 12, 3.5, 0, Math.PI * 2); g.fillStyle = col; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke(); });
      if (more) { g.fillStyle = INK; g.font = '800 8px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`+${more}`, x0 + (k - 1) * 9 + 11, 12.5); }
    }
    this.map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: dpr });
    this.stopImgs.add(id); return id;
  }

  setDrawing(on: boolean) { this.map.setLayoutProperty('hex9-ns', 'visibility', on ? 'visible' : 'none'); }

  // 그리는 중인 노선: 가는 길은 굵게, 오는 길은 가늘게. 버스가 서는 도로 위 자리마다 점
  setDraft(path: [number, number][], outN: number, pts: [number, number][], color: string, hi = -1) {
    const f: GeoJSON.Feature[] = [];
    if (path.length > 1) {
      f.push({ type: 'Feature', properties: { color, back: false }, geometry: { type: 'LineString', coordinates: path.slice(0, outN + 1) } });
      if (outN < path.length - 1) f.push({ type: 'Feature', properties: { color, back: true }, geometry: { type: 'LineString', coordinates: path.slice(outN) } });
    }
    pts.forEach((p, i) => f.push({ type: 'Feature', properties: { color: i === hi ? '#FFB800' : color, first: i === 0 || i === hi }, geometry: { type: 'Point', coordinates: p } }));
    (this.map.getSource('draft') as GeoJSONSource).setData(fc(f));
  }

  setBuses(routes: Route[], bin: number, focus: number | null) {
    const f: GeoJSON.Feature[] = [], lo = this.map.getZoom() < LO_Z;
    for (const r of routes) {
      const dim = focus != null && focus !== r.id; void bin;
      for (const b of r.bus) f.push({ type: 'Feature', properties: { rid: r.id, lv: Math.min(4, Math.round(b.on / BUS_CAP * 4)), crowd: b.full ? 2 : b.on / BUS_CAP, dim, a: (b.a ?? 1) * (b.retire ? 0.55 : 1), ret: !!b.retire }, geometry: { type: 'Point', coordinates: lo ? this.loAt(r, b.s) : posAt(r, b.s) } });
    }
    (this.map.getSource('buses') as GeoJSONSource).setData(fc(f));
  }

  cellAt(lngLat: [number, number], res = resForZoom(this.map.getZoom())) { return latLngToCell(lngLat[1], lngLat[0], res); }
}

