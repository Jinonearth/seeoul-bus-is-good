// 게임 규칙과 노선 계산. 화면과 분리된 순수 로직.
import { gridDiskDistances, gridDistance, gridPathCells, cellToLatLng } from 'h3-js';
import { type Demand, NB, key, binHours, snapped, snapInfo } from './data';
import { leg, roadsReady } from './roads';

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
export const CAPTURE_BASE = 0.32;        // 정류장 사이 대중교통 통행 중 버스로 갈 만한 몫의 상한 (보정값). 실제 몫 = 이 값 × 지하철과 겨룬 버스 비율
export const BETA = 0.12;               // 지하철과 겨루기: 버스 비율 = 1 / (1 + e^(BETA × (버스 시간 − 지하철 시간))), 분당
export const WALK_STOP = 5;             // 버스 정류장까지 평균 걷는 시간(분)
export const SUB_WAIT = 3;              // 지하철 평균 기다림(분)
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
  stops: string[]; path: [number, number][]; cum: number[];
  visits: { s: number; i: number }[];   // 한 바퀴(고리) 위 정류장에 서는 자리: 고리 위 거리(km), 정류장 번호
  outN: number;                          // path[0..outN]이 가는 길, 나머지는 오는 길
  stopPts: [number, number][];           // 버스가 실제로 서는 도로 위 점들 (가는 길·오는 길)
  uturn: boolean;                        // 돌아갈 길을 못 찾아 제자리 유턴한 곳이 있어요
  lenKm: number; cyc: number; buses: number; headway: number;
  demand: number[]; carried: number[]; capH: number; stopShare: number[];
  broken: boolean;   // 도로로 못 이은 구간이 있어요(직선)
  catch: { cells: number[]; walk: number[]; E: number[] }[];   // 정류장마다 걸어오는 셀(dm.cells 번호), 걷는 거리 가중, 시간대별 걸어오는 출발 수요 합(가중)
  pair: Float64Array;   // [시간대][출발 정류장][도착 정류장] 이 노선이 실어 나를 하루 통행 (evalRoute 예상)
};
// 버스: 고리 위 위치 s, 다음에 설 자리 k, 정차 남은 시간, 탄 사람(내릴 자리별 명수), 만차로 사람을 남겼는지
export type Bus = { s: number; k: number; wait: number; load: Int32Array; on: number; full: boolean; pax: number; hold: number };   // hold: 앞차와 너무 붙어서 정류장에서 더 기다릴 시간(분)
export type Route = Eval & {
  id: number; num: string; type: RouteType; color: string; tx: string; pattern: number;
  from: string; to: string; gus: string[]; bus: Bus[]; example?: boolean;   // gus: 지나는 구 (순서대로, 중복 없이)
  today?: number;   // 오늘 이 노선에 탄 사람
  claim?: { old: Float64Array; young: Float64Array };   // 자리별 이 노선 손님 (30분 무리 둘, state.ts)
};

const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371, t = Math.PI / 180, dLat = (b[1] - a[1]) * t, dLng = (b[0] - a[0]) * t;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * t) * Math.cos(b[1] * t) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const center = (id: string): [number, number] => { const [lat, lng] = cellToLatLng(id); return [lng, lat]; };

// 노선 한 바퀴: 가는 길 정류장 1→…→N, 오는 길 N→…→1을 실제 도로(일방통행, 유턴 금지)로 이은 고리.
// 오는 길 정류장은 그 방향으로 지나는 도로 위 후보 자리에 서요(길 건너편 정류장). 종점에서는 블록을 돌아(P턴) 돌아와요.
// 도로 그래프를 아직 못 읽었으면 지나는 셀의 도로 위 점을 잇고 같은 길로 되돌아와요.
// 순환(circ)은 1→…→N→1 한 방향으로만 돌아요.
// lenKm = 한 바퀴의 절반(편도 평균). 두 정류장 사이 길을 못 찾으면 직선으로 잇고 broken
export function routePath(stops: string[], circ = false) {
  const n = stops.length, path: [number, number][] = [], visits: { s: number; i: number }[] = [], stopPts: [number, number][] = [];
  let broken = false, uturn = false, outN = 0;
  const cum = [0], push = (pts: [number, number][]) => { for (const p of pts) { if (path.length) cum.push(cum[cum.length - 1] + hav(path[path.length - 1], p)); path.push(p); } };
  if (n === 0) return { path, cum, visits, outN, stopPts, lenKm: 0, broken, uturn };
  const order = circ ? [...stops.keys(), 0] : [...stops.keys(), ...[...stops.keys()].reverse().slice(1)];   // 순환 0..N-1,0 / 왕복 0..N-1, N-2..0
  if (n === 1) { push([snapped(stops[0])]); return { path, cum, visits: [{ s: 0, i: 0 }], outN: 0, stopPts: [path[0]], lenKm: 0, broken, uturn }; }
  if (roadsReady() && order.every(i => snapInfo(stops[i]))) {
    const start = snapInfo(stops[0])![0];
    let cur = start; push([[start[0], start[1]]]); visits.push({ s: 0, i: 0 }); stopPts.push([start[0], start[1]]);
    for (let k = 1; k < order.length; k++) {
      const i = order[k], last = k === order.length - 1;
      const targets = last ? [start] : snapInfo(stops[i])!;
      const r = leg(cur, targets, last ? `start:${stops[0]}` : stops[i]);
      if (r) { push(r.coords.slice(1)); cur = targets[r.to]; uturn ||= r.uturn; }
      else { broken = true; cur = targets[0]; push([[cur[0], cur[1]]]); }
      if (k === n - 1) outN = path.length - 1;
      if (!last) { visits.push({ s: cum[cum.length - 1], i }); stopPts.push([cur[0], cur[1]]); }
    }
  } else {
    for (let k = 1; k < order.length; k++) {
      const a = stops[order[k - 1]], b = stops[order[k]];
      let seg: [number, number][]; try { seg = gridPathCells(a, b).map(snapped); } catch { seg = [snapped(a), snapped(b)]; }
      push(seg.slice(1));
      if (k === n - 1) outN = path.length - 1;
      if (k < order.length - 1) visits.push({ s: cum[cum.length - 1], i: order[k] });
    }
    visits.unshift({ s: 0, i: 0 }); stops.forEach(s => stopPts.push(snapped(s)));
  }
  if (circ) outN = path.length - 1;
  return { path, cum, visits, outN, stopPts, lenKm: cum[cum.length - 1] / 2, broken, uturn };
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
  const C = stops.map(() => ({ O: new Map<number, number[]>(), D: new Map<number, number[]>(), cells: [] as number[], walk: [] as number[], E: Array(NB).fill(0) as number[] }));
  for (const [id, [i, k]] of best) {
    const c = dm.byId.get(id); if (!c) continue;
    const { O, D } = C[i], w = WALK[k];
    C[i].cells.push(c.i); C[i].walk.push(w);
    for (let b = 0; b < NB; b++) C[i].E[b] += w * c.O[b];
    const o = O.get(c.dong) ?? O.set(c.dong, Array(NB).fill(0)).get(c.dong)!;
    const d = D.get(c.dong) ?? D.set(c.dong, Array(NB).fill(0)).get(c.dong)!;
    const sh = dm.dongShare[c.dong];
    for (let b = 0; b < NB; b++) { o[b] += w * sh[b] * c.o[b]; d[b] += w * c.d[b]; }
  }
  return C;
}

export const cycleOf = (lenKm: number, nVisits: number) => 2 * lenKm / SPEED + nVisits * DWELL_EST;   // 한 바퀴 = 고리 길이 / 속도 + 서는 횟수 × 평균 정차

export function evalRoute(dm: Demand, stops: string[], buses: number, type: RouteType = 'trunk'): Eval {
  const geo = routePath(stops, type === 'circ');
  const nb = Math.max(1, buses), cyc = cycleOf(geo.lenKm, stops.length > 1 ? geo.visits.length : 0), headway = cyc / nb;
  const C = catchments(dm, stops);
  const n = stops.length, demand = Array(NB).fill(0), w = stops.map(() => 0), pair = new Float64Array(NB * n * n);
  for (let i = 0; i < stops.length; i++) for (let j = 0; j < stops.length; j++) {
    if (i === j || stops[i] === stops[j]) continue;
    let gap = 99; try { gap = gridDistance(stops[i], stops[j]); } catch { /* 먼 셀 */ }
    if (gap < MIN_GAP) continue;
    for (const [A, o] of C[i].O) for (const [Cd, d] of C[j].D) {
      const nAC = dm.od.get(key(A, Cd)); if (!nAC) continue;
      for (let b = 0; b < NB; b++) { const t = nAC * o[b] * d[b]; demand[b] += t; w[i] += t; w[j] += t; pair[(b * n + i) * n + j] += t; }
    }
  }
  // 정류장 쌍마다 버스 시간과 지하철 시간을 견줘 버스 몫을 정해요 (배차간격 효과는 기다림 headway/2로)
  const share = busShares(dm, stops, geo, headway, type === 'circ');
  demand.fill(0); w.fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const f = CAPTURE_BASE * share[i * n + j];
    for (let b = 0; b < NB; b++) { const x = (b * n + i) * n + j, t = pair[x] * f; pair[x] = t; demand[b] += t; w[i] += t; w[j] += t; }
  }
  const capH = 60 / headway * CAP_H;
  const carried = demand.map((v, b) => Math.min(v, capH * binHours(dm.bins[b])));
  const W = w.reduce((a, b) => a + b, 0) || 1;
  return { stops, ...geo, cyc, buses: nb, headway, demand, carried, capH, stopShare: w.map(x => x / W), catch: C.map(c => ({ cells: c.cells, walk: c.walk, E: c.E })), pair };
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
const gusOf = (dm: Demand, stops: string[]) => [...new Set(stops.map(s => guName(dm, s)).filter(Boolean))];
// 정류장 i → j 버스 몫 (n×n). 버스 시간 = 걷기 + 배차간격/2 + 차 안(고리 위 거리 ÷ 속도 + 사이 정류장 정차),
// 지하철 시간 = 정류장 셀에서 가까운 역까지 걷기 + 기다림 + 역↔역 + 내린 역에서 걷기 (두 셀 다 걸어갈 역이 있을 때만)
export function busShares(dm: Demand, stops: string[], geo: { visits: { s: number; i: number }[]; lenKm: number }, headway: number, circ: boolean) {
  const n = stops.length, out = new Float64Array(n * n).fill(1), V = geo.visits, len = V.length, L = 2 * geo.lenKm;
  if (n < 2 || !len) return out;
  const S = dm.sub, near = stops.map(s => S.cell[dm.byId.get(s)?.i ?? -1] ?? []);
  const kOut = (i: number) => i, kIn = (i: number) => (i === n - 1 ? n - 1 : (2 * n - 2 - i) % len);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const fwd = circ || j > i, ki = fwd ? kOut(i) : kIn(i), kj = fwd ? kOut(j) : kIn(j);
    if (ki >= len || kj >= len) continue;
    const ds = ((V[kj].s - V[ki].s) % L + L) % L, mid = ((kj - ki + len) % len) - 1;
    const tBus = WALK_STOP + headway / 2 + ds / SPEED + Math.max(0, mid) * DWELL_EST;
    let tSub = Infinity; const a = near[i], b = near[j];
    for (let x = 0; x < a.length; x += 2) for (let y = 0; y < b.length; y += 2) {
      const t = a[x + 1] + SUB_WAIT + S.m[a[x] * S.N + b[y]] + b[y + 1]; if (t < tSub) tSub = t;
    }
    out[i * n + j] = 1 / (1 + Math.exp(BETA * (tBus - tSub)));
  }
  return out;
}

// 노선 이름: 순환은 지나는 구(최대 3개, 더 있으면 …), 아니면 출발↔도착
export const routeName = (r: { type: RouteType; from: string; to: string; gus: string[] }) =>
  r.type === 'circ' ? (r.gus.length > 3 ? `${r.gus.slice(0, 3).join('·')}…` : r.gus.join('·')) : `${r.from}↔${r.to}`;
export const guName = (dm: Demand, cell: string) => { const c = dm.byId.get(cell); return c ? dm.dongs[c.dong].gu.replace(/구$/, '') : ''; };

let rid = 0, styleIdx = 0;
export function makeRoute(dm: Demand, type: RouteType, stops: string[], buses: number, example = false): Route {
  const e = evalRoute(dm, stops, buses, type);
  const r: Route = { ...e, id: ++rid, num: routeNumber(dm, type, stops), type, ...routeStyle(styleIdx++), from: guName(dm, stops[0]), to: guName(dm, stops[stops.length - 1]), gus: gusOf(dm, stops), bus: [], example };
  resetBuses(r); return r;
}
export function updateRoute(dm: Demand, r: Route, stops: string[], buses: number) {
  r.claim = undefined;
  Object.assign(r, evalRoute(dm, stops, buses, r.type), { from: guName(dm, stops[0]), to: guName(dm, stops[stops.length - 1]), gus: gusOf(dm, stops) });
  resetBuses(r);
}
// 버스를 고리 위에 고르게
function resetBuses(r: Route) {
  const L = 2 * r.lenKm;
  r.bus = Array.from({ length: r.buses }, (_, n) => {
    const s = n / r.buses * L; let k = r.visits.findIndex(q => q.s >= s); if (k < 0) k = 0;
    return { s, k, wait: 0, load: new Int32Array(r.visits.length), on: 0, full: false, pax: 0, hold: 0 };
  });
}

// 정류장에 설 때마다 serve(노선, 버스, 자리 번호)가 내리고 타는 사람을 처리하고 그 합(명)을 돌려줘요. 정차 = 15초 + 1명당 약 2초
export type Serve = (r: Route, b: Bus, k: number) => number;
export function moveBus(r: Route, b: Bus, gm: number, serve: Serve) {
  const L2 = 2 * r.lenKm; let left = gm;
  const seq = r.visits;
  if (L2 <= 0 || !seq.length) return;
  for (let guard = 0; guard < 200 && left > 0; guard++) {
    if (b.wait > 0) { const u = Math.min(b.wait, left); b.wait -= u; left -= u; if (b.wait <= 0) b.pax = 0; continue; }
    const q = seq[b.k]; let dist = q.s - b.s; if (dist < 0) dist += L2;
    const step = SPEED * left;
    if (step < dist) { b.s = (b.s + step) % L2; return; }
    b.s = q.s; left -= dist / SPEED;
    const moved = serve(r, b, b.k); b.pax = moved; b.wait = DWELL0 + DWELL_PER * moved + b.hold; b.hold = 0; b.k = (b.k + 1) % seq.length;
  }
}
// 자리 k(고리에서 k번째로 서는 곳)에서 타는 사람이 갈 수 있는 정류장들과 그 자리 번호
// 가는 길(k < n-1): 뒤쪽 정류장 j > i, 내릴 자리 = j. 오는 길(k ≥ n-1): 앞쪽 j < i, 내릴 자리 = (2n-2-j) % 자리 수
export function destsOf(r: Route, k: number): [number, number][] {
  const n = r.stops.length, len = r.visits.length, i = r.visits[k].i, out: [number, number][] = [];
  if (r.type === 'circ') { for (let d = 1; d < n; d++) { const j = (i + d) % n; out.push([j, j]); } return out; }   // 순환: 한 방향으로 돌며 어디든, 내릴 자리 = j
  if (k < n - 1) for (let j = i + 1; j < n; j++) out.push([j, j]);
  else for (let j = i - 1; j >= 0; j--) out.push([j, (2 * n - 2 - j) % len]);
  return out;
}
// 고리 위 거리 s → 좌표
export function posAt(r: Route, s: number): [number, number] {
  const L = 2 * r.lenKm, d = ((s % L) + L) % L;
  const c = r.cum; let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const t = c[hi] > c[lo] ? (d - c[lo]) / (c[hi] - c[lo]) : 0, a = r.path[lo], b = r.path[hi] ?? a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
// 지금 시간대 혼잡도 (1 넘으면 정원 초과)
export const crowdAt = (dm: Demand, r: Route, bin: number) => r.demand[bin] / binHours(dm.bins[bin]) / r.capH;
