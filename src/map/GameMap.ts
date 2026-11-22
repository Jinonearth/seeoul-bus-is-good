// MapLibre 지도와 게임 레이어(헥사곤 수요, 수요 흐름, 노선, 정류장, 버스)
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { cellToBoundary, cellToParent, latLngToCell, getHexagonEdgeLengthAvg, UNITS, gridDisk } from 'h3-js';
import { type Demand, stopable } from '../game/data';
import { type Route, posAt, crowdAt, WALK } from '../game/model';
import { baseStyle, labelLayers, INK, PAPER, PINK } from './style';

export type Layer = 'o' | 'd' | 'u';
export type Flow = { from: [number, number]; to: [number, number]; v: number; out: boolean };
const HEX_RES = [7, 8, 9] as const;
// 헥사곤은 화면 줌보다 한 단계 굵게: 같은 줌에서 한 단계 큰 셀
export const resForZoom = (z: number) => (z < 12 ? 7 : z < 13.5 ? 8 : 9);
const ZRANGE: Record<number, [number, number]> = { 7: [0, 12], 8: [12, 13.5], 9: [13.5, 24] };
const DOT = [0, 0.16, 0.32, 0.48, 0.64, 0.8];

let protocolAdded = false;

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[] = []): FC => ({ type: 'FeatureCollection', features });

export class GameMap {
  map: maplibregl.Map;
  ready: Promise<void>;
  isReady = false;   // 레이어 준비됨 (map.loaded()는 타일 읽는 동안 false)
  private dm: Demand;
  private plates = new Set<string>();
  onTap: (e: { lngLat: [number, number]; route?: number }) => void = () => {};

  constructor(el: HTMLElement, dm: Demand) {
    this.dm = dm;
    if (!protocolAdded) { maplibregl.addProtocol('pmtiles', new Protocol().tile); protocolAdded = true; }
    const base = import.meta.env.BASE_URL;
    const tiles = new URL(`${base}tiles/seoul.pmtiles`, location.href).href;
    this.map = new maplibregl.Map({
      container: el, style: baseStyle(tiles), center: [126.99, 37.56], zoom: 10.2, minZoom: 9.3, maxZoom: 15.5,
      maxBounds: [[126.6, 37.35], [127.35, 37.75]], attributionControl: { compact: true },
      localIdeographFontFamily: "'Gothic A1', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif",
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.ready = new Promise(res => this.map.once('load', () => { this.addLayers(); this.isReady = true; res(); }));
    this.map.on('click', e => {
      const pad = matchMedia('(pointer: coarse)').matches ? 22 : 8;
      const hit = this.map.queryRenderedFeatures([[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers: ['route-hit'] });
      this.onTap({ lngLat: [e.lngLat.lng, e.lngLat.lat], route: hit[0]?.properties?.id as number | undefined });
    });
  }

  private addLayers() {
    const m = this.map;
    // 헥사곤 (해상도별): 옅은 먹 외곽선 + 핑크 망점
    for (const res of HEX_RES) {
      const [minzoom, maxzoom] = ZRANGE[res];
      m.addSource(`hex${res}`, { type: 'geojson', data: fc() });
      m.addSource(`dot${res}`, { type: 'geojson', data: fc(), promoteId: 'id' });
      m.addLayer({ id: `hex${res}-u`, type: 'fill', source: `hex${res}`, minzoom, maxzoom, filter: ['==', ['get', 'u'], 1], paint: { 'fill-color': PINK, 'fill-opacity': 0.18 } });
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
    m.addSource('sel', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'sel', type: 'line', source: 'sel', paint: { 'line-color': INK, 'line-width': 3 } });
    // 수요 흐름: 나가는 = 파랑 실선, 들어오는 = 주황 점선
    m.addSource('flows', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'flow-out', type: 'line', source: 'flows', filter: ['all', ['==', ['get', 'out'], true], ['==', ['geometry-type'], 'LineString']], layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#0072B2', 'line-opacity': ['get', 'a'], 'line-width': ['get', 'w'] } });
    m.addLayer({ id: 'flow-in', type: 'line', source: 'flows', filter: ['all', ['==', ['get', 'out'], false], ['==', ['geometry-type'], 'LineString']],
      paint: { 'line-color': '#D55E00', 'line-opacity': ['get', 'a'], 'line-width': ['get', 'w'], 'line-dasharray': [1.4, 0.8] } });
    m.addLayer({ id: 'flow-head', type: 'fill', source: 'flows', filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['case', ['get', 'out'], '#0072B2', '#D55E00'], 'fill-opacity': ['get', 'a'] } });
    // 노선: 먹 테두리 + 노선색 + 패턴(줌 11부터)
    m.addSource('routes', { type: 'geojson', data: fc() });
    const Wf = (f: (w: number) => number) => ['interpolate', ['linear'], ['zoom'], 9, f(4), 13, f(7), 15, f(9)] as never, W = Wf(w => w);
    const op = ['case', ['get', 'dim'], 0.3, 1] as const;
    m.addLayer({ id: 'route-case', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': Wf(w => w + 5), 'line-opacity': op as never } });
    m.addLayer({ id: 'route', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': W, 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p1', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 1], paint: { 'line-color': PAPER, 'line-width': W, 'line-dasharray': [1.3, 1.3], 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p2', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 2], layout: { 'line-join': 'round' }, paint: { 'line-color': PAPER, 'line-width': Wf(w => w * 0.3), 'line-opacity': op as never } });
    m.addLayer({ id: 'route-p3', type: 'line', source: 'routes', minzoom: 11, filter: ['==', ['get', 'pattern'], 3], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': Wf(w => w * 0.45), 'line-dasharray': [0.1, 2.2], 'line-opacity': op as never } });
    m.addLayer({ id: 'route-hit', type: 'line', source: 'routes', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } });
    m.addSource('stops', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 11,
      paint: { 'circle-color': '#FFFFFF', 'circle-stroke-color': INK, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3.5, 14, 6], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3], 'circle-opacity': ['case', ['get', 'dim'], 0.3, 1], 'circle-stroke-opacity': ['case', ['get', 'dim'], 0.3, 1] } });
    // 그리는 중인 노선
    m.addSource('draft', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'draft-case', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': INK, 'line-width': ['case', ['get', 'back'], 6, 11] } });
    m.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'back'], 3, 6] } });
    m.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'first'], 8, 6], 'circle-stroke-color': INK, 'circle-stroke-width': 2.5 } });
    // 버스: 줌아웃 = 흰 네모, 줌인 = 번호판(먹 바탕 + 노선색 띠 + 흰 번호), 정차 중 +N, 만차 경고 삼각형
    this.addSquare(); this.addWarn();
    m.addSource('buses', { type: 'geojson', data: fc() });
    m.addLayer({ id: 'bus-sq', type: 'symbol', source: 'buses', maxzoom: 12.5, layout: { 'icon-image': 'bus-sq', 'icon-allow-overlap': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 12, 1] }, paint: { 'icon-opacity': ['case', ['get', 'dim'], 0.3, 1] } });
    m.addLayer({ id: 'bus-plate', type: 'symbol', source: 'buses', minzoom: 12.5, layout: { 'icon-image': ['concat', 'plate-', ['get', 'rid']], 'icon-allow-overlap': true }, paint: { 'icon-opacity': ['case', ['get', 'dim'], 0.3, 1] } });
    m.addLayer({ id: 'bus-pax', type: 'symbol', source: 'buses', minzoom: 12.5, filter: ['>', ['get', 'pax'], 0],
      layout: { 'text-field': ['concat', '+', ['to-string', ['get', 'pax']]], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-offset': [0, -1.7], 'text-allow-overlap': true },
      paint: { 'text-color': INK, 'text-halo-color': '#FFFFFF', 'text-halo-width': 3 } });
    m.addLayer({ id: 'bus-warn', type: 'symbol', source: 'buses', filter: ['>', ['get', 'crowd'], 1], layout: { 'icon-image': 'warn', 'icon-allow-overlap': true, 'icon-offset': [16, -10], 'icon-size': ['step', ['zoom'], 0.75, 12.5, 1] } });
    // 노선 번호 배지: 줌아웃에서만(줌인하면 버스 번호판이 대신), 버스보다 위
    m.addLayer({ id: 'route-badge', type: 'symbol', source: 'routes', maxzoom: 12.5,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['get', 'num'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-rotation-alignment': 'viewport', 'text-keep-upright': true },
      paint: { 'text-color': INK, 'text-halo-color': '#FFFFFF', 'text-halo-width': 4, 'text-opacity': op as never } });
    for (const l of labelLayers) m.addLayer(l as never);
  }

  private addSquare() {
    const c = document.createElement('canvas'); c.width = c.height = 12; const g = c.getContext('2d')!;
    g.fillStyle = '#FFFFFF'; g.fillRect(1, 1, 10, 10); g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(1, 1, 10, 10);
    this.map.addImage('bus-sq', g.getImageData(0, 0, 12, 12));
  }
  private addWarn() {
    const c = document.createElement('canvas'); c.width = c.height = 20; const g = c.getContext('2d')!;
    g.beginPath(); g.moveTo(10, 2); g.lineTo(18, 17); g.lineTo(2, 17); g.closePath(); g.fillStyle = '#D55E00'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#FFF'; g.font = '800 10px sans-serif'; g.textAlign = 'center'; g.fillText('!', 10, 15);
    this.map.addImage('warn', g.getImageData(0, 0, 20, 20));
  }
  private plate(r: Route) {
    const id = `plate-${r.id}`, k = `${id}:${r.num}:${r.color}`;
    if (this.plates.has(k)) return;
    const dpr = 2, c = document.createElement('canvas'), g = c.getContext('2d')!;
    g.font = '800 12px "Gothic A1", sans-serif'; const w = Math.ceil(g.measureText(r.num).width + 16), h = 18;
    c.width = w * dpr; c.height = h * dpr; g.scale(dpr, dpr);
    g.fillStyle = INK; g.fillRect(0, 0, w, h); g.fillStyle = r.color; g.fillRect(0, 0, 5, h);
    g.fillStyle = '#FFF'; g.font = '800 12px "Gothic A1", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.num, w / 2 + 2.5, h / 2 + 0.5);
    if (this.map.hasImage(id)) this.map.removeImage(id);
    this.map.addImage(id, g.getImageData(0, 0, c.width, c.height), { pixelRatio: dpr });
    this.plates.add(k);
  }

  // 망점 실시간 크기: 셀(및 res7·8 묶음)마다 지금 기다리는 사람 ÷ 평소. 많이 바뀐 것만 고쳐요
  private live = new Map<number, [string, boolean][]>();
  private liveK = new Map<string, number>();
  private layer: Layer = 'o';
  private kids: Map<string, number[]>[] | null = null;
  setLive(pool: Float64Array, eq: (i: number) => number) {
    if (this.layer === 'd') return;
    const dm = this.dm;
    this.kids ??= [7, 8].map(res => { const m = new Map<string, number[]>(); dm.cells.forEach(c => { const p = cellToParent(c.id, res); (m.get(p) ?? m.set(p, []).get(p)!).push(c.i); }); return m; });
    for (const [res, list] of this.live) {
      for (const [id, cov] of list) {
        let k: number;
        if (res === 9) { const i = dm.byId.get(id)!.i, e = eq(i); k = e > 0 ? pool[i] / e : 1; }
        else { let p = 0, e = 0; for (const i of this.kids[res === 7 ? 0 : 1].get(id) ?? []) { p += pool[i]; e += eq(i); } k = e > 0 ? p / e : 1; }
        if (this.layer === 'u' && cov && k < 0.6) k = 0;   // 버스가 닿고 잘 태워 가는 곳은 미충족 아님
        const key = res + id, old = this.liveK.get(key);
        if (old !== undefined && Math.abs(old - k) < 0.03) continue;
        this.liveK.set(key, k); this.map.setFeatureState({ source: `dot${res}`, id }, { k });
      }
    }
  }

  // 지금 시간대 수요를 헥사곤 망점으로
  setDemand(layer: Layer, bin: number, covered: Set<string>) {
    const dm = this.dm;
    this.layer = layer; this.liveK.clear();
    const sets: [number, { id: string; lat: number; lng: number; O: number[]; D: number[]; Ou: number[] }[]][] = [
      [7, [...dm.parents[0].values()]], [8, [...dm.parents[1].values()]], [9, dm.cells]];
    for (const [res, list] of sets) {
      const val = (c: { id: string; O: number[]; D: number[]; Ou: number[] }) => {
        if (layer !== 'u') return layer === 'd' ? c.D[bin] : c.O[bin];
        return c.Ou[bin];   // 버스가 닿는 셀도 넣고, 실시간으로 기다리는 사람이 많을 때만 보여요(setLive)
      };
      const vals = list.map(val), sorted = [...vals].sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * 0.98)] || 1;
      const hex: GeoJSON.Feature[] = [], dot: GeoJSON.Feature[] = [], live: [string, boolean][] = [];
      list.forEach((c, i) => {
        const v = Math.sqrt(Math.min(1, vals[i] / ref));
        const ring = cellToBoundary(c.id, true);
        const cov = isCovered(c.id, res, covered);
        hex.push({ type: 'Feature', properties: { id: c.id, u: layer === 'u' && !cov && vals[i] > 0.04 * ref ? 1 : 0, ns: res === 9 && !stopable(c.id) ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [ring] } });
        if (v >= 0.08) { dot.push({ type: 'Feature', properties: { id: c.id, r: DOT[Math.min(5, 1 + Math.floor(v * 5))] }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } }); live.push([c.id, cov]); }
      });
      this.live.set(res, live); this.map.removeFeatureState({ source: `dot${res}` });
      (this.map.getSource(`hex${res}`) as GeoJSONSource).setData(fc(hex));
      (this.map.getSource(`dot${res}`) as GeoJSONSource).setData(fc(dot));
    }
  }

  setSelected(cell: string | null) {
    (this.map.getSource('sel') as GeoJSONSource).setData(fc(cell ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [cellToBoundary(cell, true)] } }] : []));
  }

  setFlows(flows: Flow[]) {
    const vmax = Math.max(1, ...flows.map(f => f.v)), feats: GeoJSON.Feature[] = [];
    for (const f of flows) {
      const rel = Math.pow(f.v / vmax, 1.7), w = 1.2 + 15 * rel, a = 0.4 + 0.55 * rel;
      // 살짝 휜 곡선, 끝에 화살촉
      const [ax, ay] = f.from, [bx, by] = f.to, mx = (ax + bx) / 2 - (by - ay) * 0.2, my = (ay + by) / 2 + (bx - ax) * 0.2;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20 * 0.92; pts.push([(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by]); }
      feats.push({ type: 'Feature', properties: { out: f.out, w, a }, geometry: { type: 'LineString', coordinates: pts } });
      const e = pts[pts.length - 1], p = pts[pts.length - 2], dx = e[0] - p[0], dy = e[1] - p[1], L = Math.hypot(dx, dy) || 1;
      const s = this.pxToDeg(6 + w * 1.6), ux = dx / L, uy = dy / L, tip: [number, number] = [bx - ux * s * 0.2, by - uy * s * 0.2];
      feats.push({ type: 'Feature', properties: { out: f.out, a: Math.min(1, a + 0.15) }, geometry: { type: 'Polygon', coordinates: [[tip, [e[0] - uy * s * 0.55, e[1] + ux * s * 0.55], [e[0] + uy * s * 0.55, e[1] - ux * s * 0.55], tip]] } });
    }
    (this.map.getSource('flows') as GeoJSONSource).setData(fc(feats));
  }
  private pxToDeg(px: number) { const z = this.map.getZoom(); return px * 360 / (512 * 2 ** z); }

  setRoutes(routes: Route[], focus: number | null) {
    const lines: GeoJSON.Feature[] = [], stops: GeoJSON.Feature[] = [];
    for (const r of routes) {
      this.plate(r);
      const dim = focus != null && focus !== r.id;
      lines.push({ type: 'Feature', properties: { id: r.id, num: r.num, color: r.color, pattern: r.pattern, dim }, geometry: { type: 'LineString', coordinates: r.path } });
      for (const p of r.stopPts) stops.push({ type: 'Feature', properties: { dim }, geometry: { type: 'Point', coordinates: p } });
    }
    (this.map.getSource('routes') as GeoJSONSource).setData(fc(lines));
    (this.map.getSource('stops') as GeoJSONSource).setData(fc(stops));
  }

  setDrawing(on: boolean) { this.map.setLayoutProperty('hex9-ns', 'visibility', on ? 'visible' : 'none'); }

  // 그리는 중인 노선: 가는 길은 굵게, 오는 길은 가늘게. 버스가 서는 도로 위 자리마다 점
  setDraft(path: [number, number][], outN: number, pts: [number, number][], color: string) {
    const f: GeoJSON.Feature[] = [];
    if (path.length > 1) {
      f.push({ type: 'Feature', properties: { color, back: false }, geometry: { type: 'LineString', coordinates: path.slice(0, outN + 1) } });
      if (outN < path.length - 1) f.push({ type: 'Feature', properties: { color, back: true }, geometry: { type: 'LineString', coordinates: path.slice(outN) } });
    }
    pts.forEach((p, i) => f.push({ type: 'Feature', properties: { color, first: i === 0 }, geometry: { type: 'Point', coordinates: p } }));
    (this.map.getSource('draft') as GeoJSONSource).setData(fc(f));
  }

  setBuses(routes: Route[], bin: number, focus: number | null) {
    const f: GeoJSON.Feature[] = [];
    for (const r of routes) {
      const crowd = crowdAt(this.dm, r, bin), dim = focus != null && focus !== r.id;
      for (const b of r.bus) f.push({ type: 'Feature', properties: { rid: r.id, pax: b.wait > 0 ? b.pax : 0, crowd, dim }, geometry: { type: 'Point', coordinates: posAt(r, b.s) } });
    }
    (this.map.getSource('buses') as GeoJSONSource).setData(fc(f));
  }

  cellAt(lngLat: [number, number], res = resForZoom(this.map.getZoom())) { return latLngToCell(lngLat[1], lngLat[0], res); }
}

// 셀(해상도 res)이 정류장 걸어서 닿는 범위에 들어가는지
function isCovered(id: string, res: number, covered: Set<string>) {
  if (res === 9) return covered.has(id);
  // 부모 셀: 자식 셀 중 하나라도 덮이면 덮인 것으로 본다 (setCoverage에서 미리 계산)
  return parentCovered.get(res)?.has(id) ?? false;
}
const parentCovered = new Map<number, Set<string>>();
export function setCoverage(covered: Set<string>, parentsOf: (id: string, res: number) => string) {
  parentCovered.set(7, new Set([...covered].map(c => parentsOf(c, 7))));
  parentCovered.set(8, new Set([...covered].map(c => parentsOf(c, 8))));
}
export const catchmentCells = (stop: string) => gridDisk(stop, WALK.length - 1);
