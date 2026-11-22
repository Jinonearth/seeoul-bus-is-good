// 게임 규칙과 노선 계산. 화면과 분리된 순수 로직.
import { gridDiskDistances, gridDistance, gridPathCells, cellToLatLng } from 'h3-js';
import { type Demand, NB, key, binHours, snapped } from './data';

// ── 규칙 (1차 임시값, 시나리오 기획안과 같음) ──
export const RULES = {
  fleet0: 40,          // 시작 보유 버스
  perBus: 550,         // 하루 수송 목표 = 보유 버스 × 550명
  bonus: 1.5,          // 목표의 150%를
  bonusDays: 3,        // 3일 연속 넘기면
  fleetStep: 10,       // 버스 +10대 (새 목표는 하루 뒤부터)
  maxMiss: 3,          // 3일 연속 미달이면 게임 오버
  settleMin: 5 * 60,   // 매일 05시 정산
  startMin: 6 * 60,    // 1일차 06시(출근 시간대)에 시작
};

// ── 운행 상수 ──
export const SPEED = 20 / 60;      // km/분 (시속 20km)
export const DWELL0 = 0.25;        // 정류장마다 문 여닫기 15초
export const DWELL_PER = 0.03;     // 1명 타고 내릴 때마다 약 2초
export const DWELL_EST = 0.4;      // 한 바퀴 시간 계산용 정류장당 평균 정차(분)
export const BUS_CAP = 75;
export const CAP_H = BUS_CAP * 3 * 2;   // 버스 한 대 한 시간 정원 = 75인승 × 구간 회전 3 × 양방향
export const CAPTURE = 0.135;            // 정류장 사이 대중교통 통행 중 이 노선이 가져가는 비율 (지하철·다른 수단 몫 제외, 보정값)
export const MIN_GAP = 2;               // 이보다 가까운 정류장 사이(헥사곤 칸 수)는 걸어감

// ── 노선 표기 (색약 고려: 색 + 패턴) ──
export const ROUTE_COLORS = ['#0072B2', '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#D55E00', '#CC79A7', '#1D1D1B'];
export const ROUTE_TEXT = ['#FFFFFF', '#1D1D1B', '#1D1D1B', '#1D1D1B', '#1D1D1B', '#1D1D1B', '#1D1D1B', '#FFFFFF'];
export const routeStyle = (n: number) => ({ color: ROUTE_COLORS[n % 8], tx: ROUTE_TEXT[n % 8], pattern: (n + Math.floor(n / 8)) % 4 });
export const PATTERNS = ['실선', '파선', '이중선', '점선'];

export type RouteType = 'trunk' | 'branch' | 'circ';
export const TYPES: Record<RouteType, string> = { trunk: '간선', branch: '지선', circ: '순환' };
const ZONE: Record<string, number> = { 종로구: 0, 중구: 0, 용산구: 0, 도봉구: 1, 강북구: 1, 성북구: 1, 노원구: 1, 동대문구: 2, 중랑구: 2, 성동구: 2, 광진구: 2, 강동구: 3, 송파구: 3, 서초구: 4, 강남구: 4, 동작구: 5, 관악구: 5, 금천구: 5, 강서구: 6, 양천구: 6, 영등포구: 6, 구로구: 6, 은평구: 7, 마포구: 7, 서대문구: 7 };

export type Eval = {
  stops: string[]; path: [number, number][]; cum: number[]; stopAt: number[];
  lenKm: number; cyc: number; buses: number; headway: number;
  demand: number[]; carried: number[]; capH: number; stopShare: number[];
};
export type Bus = { s: number; k: number; wait: number; pax: number };
export type Route = Eval & {
  id: number; num: string; type: RouteType; color: string; tx: string; pattern: number;
  from: string; to: string; bus: Bus[]; seq: { s: number; i: number }[]; example?: boolean;
};

const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLng = (b[0] - a[0]) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const center = (id: string): [number, number] => { const [lat, lng] = cellToLatLng(id); return [lng, lat]; };

// 탭한 정류장 셀들 사이를 지나는 선. 정류장과 지나는 셀 모두 그 셀의 도로 위 점(도로 없는 셀은 중심)을 이어요
export function routePath(stops: string[]) {
  const cells: string[] = [], stopAt: number[] = [];
  stops.forEach((s, i) => {
    if (i === 0) { cells.push(s); stopAt.push(0); return; }
    let seg: string[];
    try { seg = gridPathCells(stops[i - 1], s); } catch { seg = [stops[i - 1], s]; }
    cells.push(...seg.slice(1)); stopAt.push(cells.length - 1);
  });
  const path = cells.map(snapped), cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + hav(path[i - 1], path[i]));
  return { path, cum, stopAt: stopAt.map(i => cum[i]), lenKm: cum[cum.length - 1] };
}

// 걸어서 정류장까지 가는 거리(res9 칸 수 0..3, 한 칸 약 350m)별로 타러 오는 비율. 3칸이 약 1km
export const WALK = [1, 1, 0.7, 0.4];
const rings = new Map<string, string[][]>();
const ringsOf = (s: string) => rings.get(s) ?? rings.set(s, gridDiskDistances(s, WALK.length - 1)).get(s)!;

// 노선 하나가 걸어서 닿는 범위를 정류장별로 나눠 동별로 모은 출발·도착 비중.
// 셀마다 이 노선의 가장 가까운 정류장 하나에만 붙어요 (같으면 앞 정류장). 이웃 정류장이 같은 셀을 두 번 세지 않게.
function catchments(dm: Demand, stops: string[]) {
  const best = new Map<string, [number, number]>();   // 셀 → [정류장 번호, 거리]
  stops.forEach((s, i) => ringsOf(s).forEach((ring, k) => { for (const id of ring) { const b = best.get(id); if (!b || k < b[1]) best.set(id, [i, k]); } }));
  const C = stops.map(() => ({ O: new Map<number, number[]>(), D: new Map<number, number[]>() }));
  for (const [id, [i, k]] of best) {
    const c = dm.byId.get(id); if (!c) continue;
    const { O, D } = C[i], w = WALK[k];
    const o = O.get(c.dong) ?? O.set(c.dong, Array(NB).fill(0)).get(c.dong)!;
    const d = D.get(c.dong) ?? D.set(c.dong, Array(NB).fill(0)).get(c.dong)!;
    const sh = dm.dongShare[c.dong];
    for (let b = 0; b < NB; b++) { o[b] += w * sh[b] * c.o[b]; d[b] += w * c.d[b]; }
  }
  return C;
}

export const cycleOf = (lenKm: number, nStops: number) => 2 * lenKm / SPEED + Math.max(0, 2 * nStops - 2) * DWELL_EST;
export const freqFactor = (headway: number) => Math.min(1, Math.max(0.3, 1.25 - headway / 40));

export function evalRoute(dm: Demand, stops: string[], buses: number, type: RouteType = 'trunk'): Eval {
  const geo = routePath(stops);
  const nb = Math.max(1, buses), cyc = cycleOf(geo.lenKm, stops.length), headway = cyc / nb;
  const C = catchments(dm, stops);
  const demand = Array(NB).fill(0), w = stops.map(() => 0);
  for (let i = 0; i < stops.length; i++) for (let j = 0; j < stops.length; j++) {
    if (i === j || stops[i] === stops[j]) continue;
    let gap = 99; try { gap = gridDistance(stops[i], stops[j]); } catch { /* 먼 셀 */ }
    if (gap < MIN_GAP) continue;
    for (const [A, o] of C[i].O) for (const [Cd, d] of C[j].D) {
      const n = dm.od.get(key(A, Cd)); if (!n) continue;
      for (let b = 0; b < NB; b++) { const t = n * o[b] * d[b]; demand[b] += t; w[i] += t; w[j] += t; }
    }
  }
  const f = CAPTURE * freqFactor(headway) * (type === 'circ' ? 0.9 : 1);
  for (let b = 0; b < NB; b++) demand[b] *= f;
  const capH = 60 / headway * CAP_H;
  const carried = demand.map((v, b) => Math.min(v, capH * binHours(dm.bins[b])));
  const W = w.reduce((a, b) => a + b, 0) || 1;
  return { stops, ...geo, cyc, buses: nb, headway, demand, carried, capH, stopShare: w.map(x => x / W) };
}

const serial: Record<string, number> = {};
export function routeNumber(dm: Demand, type: RouteType, stops: string[]) {
  const zone = (s: string) => ZONE[dm.dongs[dm.byId.get(s)?.dong ?? 0].gu] ?? 0;
  const a = zone(stops[0]), b = zone(stops[stops.length - 1]), k = (serial[type + a + b] = (serial[type + a + b] ?? 0) + 1);
  if (type === 'trunk') return `${a}${b}${k % 10}`;
  if (type === 'branch') return `${a}${b}${String(k).padStart(2, '0')}`;
  serial.circ = (serial.circ ?? 0) + 1; return String(serial.circ).padStart(2, '0');
}

export const dongName = (dm: Demand, cell: string) => { const c = dm.byId.get(cell); return c ? dm.dongs[c.dong].n : '서울 밖'; };
export const guName = (dm: Demand, cell: string) => { const c = dm.byId.get(cell); return c ? dm.dongs[c.dong].gu.replace(/구$/, '') : ''; };

let rid = 0, styleIdx = 0;
export function makeRoute(dm: Demand, type: RouteType, stops: string[], buses: number, example = false): Route {
  const e = evalRoute(dm, stops, buses, type);
  const r: Route = { ...e, id: ++rid, num: routeNumber(dm, type, stops), type, ...routeStyle(styleIdx++), from: guName(dm, stops[0]), to: guName(dm, stops[stops.length - 1]), bus: [], seq: [], example };
  resetBuses(r); return r;
}
export function updateRoute(dm: Demand, r: Route, stops: string[], buses: number) {
  Object.assign(r, evalRoute(dm, stops, buses, r.type), { from: guName(dm, stops[0]), to: guName(dm, stops[stops.length - 1]) });
  resetBuses(r);
}
// 왕복 경로 위 정류장 위치: 가는 길 0..n-1, 오는 길 n-2..1
function resetBuses(r: Route) {
  const L = r.lenKm; r.seq = [];
  r.stopAt.forEach((s, i) => r.seq.push({ s, i }));
  for (let i = r.stopAt.length - 2; i >= 1; i--) r.seq.push({ s: 2 * L - r.stopAt[i], i });
  r.bus = Array.from({ length: r.buses }, (_, n) => {
    const s = n / r.buses * 2 * L; let k = r.seq.findIndex(q => q.s >= s); if (k < 0) k = 0;
    return { s, k, wait: 0, pax: 0 };
  });
}

// 버스 한 대가 이 정류장에서 태우고 내리는 사람 (지난 버스 이후 쌓인 수요)
// 가운데 정류장은 양방향으로 배차간격의 절반마다, 종점은 배차간격마다 버스가 와요
// stopShare는 통행 하나를 타는 곳과 내리는 곳에서 두 번 세므로, 통행 수는 그 절반
export function boardAt(dm: Demand, r: Route, i: number, bin: number) {
  const perMin = r.demand[bin] / (binHours(dm.bins[bin]) * 60);
  const end = i === 0 || i === r.stops.length - 1;
  const raw = perMin * r.headway * r.stopShare[i] * (end ? 2 : 1);
  const on = Math.min(BUS_CAP, raw);
  return { n: Math.round(on), rode: on / 2, missed: (raw - on) / 2 };
}
// 이번 걸음에 들른 정류장에서 태운/못 태운 통행을 tally에 더해요
export type Tally = { rode: number; missed: number };
export function moveBus(dm: Demand, r: Route, b: Bus, gm: number, bin: number, tally?: Tally) {
  const L2 = 2 * r.lenKm; let left = gm;
  if (L2 <= 0 || !r.seq.length) return;
  for (let guard = 0; guard < 30 && left > 0; guard++) {
    if (b.wait > 0) { const u = Math.min(b.wait, left); b.wait -= u; left -= u; if (b.wait <= 0) b.pax = 0; continue; }
    const q = r.seq[b.k]; let dist = q.s - b.s; if (dist < 0) dist += L2;
    const step = SPEED * left;
    if (step < dist) { b.s = (b.s + step) % L2; return; }
    b.s = q.s; left -= dist / SPEED;
    const v = boardAt(dm, r, q.i, bin); b.pax = v.n; b.wait = DWELL0 + DWELL_PER * v.n; b.k = (b.k + 1) % r.seq.length;
    if (tally) { tally.rode += v.rode; tally.missed += v.missed; }
  }
}
// 경로 위 거리 s(왕복) → 좌표
export function posAt(r: Route, s: number): [number, number] {
  const L = r.lenKm; let d = ((s % (2 * L)) + 2 * L) % (2 * L); if (d > L) d = 2 * L - d;
  const c = r.cum; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const t = c[hi] > c[lo] ? (d - c[lo]) / (c[hi] - c[lo]) : 0, a = r.path[lo], b = r.path[hi] ?? a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
// 지금 시간대 혼잡도 (1 넘으면 정원 초과)
export const crowdAt = (dm: Demand, r: Route, bin: number) => r.demand[bin] / binHours(dm.bins[bin]) / r.capH;
