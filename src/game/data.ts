// 수요 데이터: 행정동 OD(평일 하루 평균) + res9 셀 안의 출발/도착 비중
// 셀 a → 셀 c, 시간대 b 통행 = od(A,C) × dongShare[A][b] × o_a[b] × d_c[b]  (A, C = 셀이 속한 동)
import { cellToLatLng, cellToParent, gridDisk } from 'h3-js';
import type { Cand } from './roads';

export const NB = 5;
export type Bin = { name: string; from: number; to: number };

export type Cell = {
  id: string; i: number; dong: number; lat: number; lng: number;
  o: number[]; d: number[];      // 동 안 비중 (시간대별)
  O: number[]; D: number[];      // 이 셀에서 출발/도착하는 하루 통행 (시간대별)
  Ou: number[];                  // 미충족 레이어용 출발: 3칸 안에 정류장 둘 곳이 없는 셀은 0
};

export type Demand = {
  bins: Bin[];
  dongs: { n: string; gu: string; c: [number, number] }[];
  dongShare: number[][];
  cells: Cell[];
  byId: Map<string, Cell>;
  od: Map<number, number>;                 // A*1000+C → 하루 통행
  outOf: Map<number, [number, number][]>;  // A → [[C, 통행]]
  into: Map<number, [number, number][]>;   // C → [[A, 통행]]
  parents: Map<string, Agg>[];             // [res7, res8] 집계
  unreachable: Set<string>;
  sub: Subway;                             // 지하철 (scripts/build_subway.py)                // 3칸 안에 정류장을 둘 수 있는 셀이 없는 셀 (산·공항 등)
  total: number;
};

// 지하철: 서울 역(환승역 하나로), 역↔역 분(0~255), 셀마다 가까운 역 [역, 걷는 분, 역, 걷는 분], 그리기용 노선 선분
export type Subway = { st: [string, number, number][]; N: number; m: Uint8Array; cell: number[][]; lines: { n: string; c: string; s: [number, number][][] }[] };
export type Agg = { id: string; lat: number; lng: number; O: number[]; D: number[]; Ou: number[] };

export const key = (a: number, c: number) => a * 1000 + c;

// 정류장 자리: 셀마다 버스가 설 수 있는 도로 위 한 점 (scripts/build_stop_snap.py).
// 목록에 없는 셀은 쓸 도로가 없어 정류장을 둘 수 없어요.
const SNAP = new Map<string, Cand[]>();   // 셀 → 도로 위 정류장 후보들 (첫 번째가 대표 자리)
export const stopable = (id: string) => SNAP.has(id);
export const snapInfo = (id: string) => SNAP.get(id);
export const snapped = (id: string): [number, number] => { const p = SNAP.get(id)?.[0]; if (p) return [p[0], p[1]]; const [lat, lng] = cellToLatLng(id); return [lng, lat]; };

export async function loadDemand(base = import.meta.env.BASE_URL): Promise<Demand> {
  const [dem, flat, snap, subj] = await Promise.all([
    fetch(`${base}data/demand.json`).then(r => r.json()),
    fetch(`${base}data/od.json`).then(r => r.json()) as Promise<number[]>,
    fetch(`${base}data/snap.json`).then(r => r.json()) as Promise<Record<string, Cand[]>>,
    fetch(`${base}data/subway.json`).then(r => r.json()) as Promise<{ st: [string, number, number][]; m: number[]; cell: number[][]; lines: Subway['lines'] }>,
  ]);
  const sub: Subway = { st: subj.st, N: subj.st.length, m: Uint8Array.from(subj.m), cell: subj.cell, lines: subj.lines };
  SNAP.clear(); for (const id in snap) SNAP.set(id, snap[id]);
  const od = new Map<number, number>(), outOf = new Map<number, [number, number][]>(), into = new Map<number, [number, number][]>();
  const nd = dem.dongs.length, dongOut = new Float64Array(nd), dongInBin = Array.from({ length: nd }, () => new Float64Array(NB));
  let total = 0;
  for (let i = 0; i < flat.length; i += 3) {
    const a = flat[i], c = flat[i + 1], n = flat[i + 2];
    od.set(key(a, c), n); total += n; dongOut[a] += n;
    (outOf.get(a) ?? outOf.set(a, []).get(a)!).push([c, n]);
    (into.get(c) ?? into.set(c, []).get(c)!).push([a, n]);
    for (let b = 0; b < NB; b++) dongInBin[c][b] += n * dem.dongShare[a][b];
  }
  const cells: Cell[] = dem.cells.map(([id, dong, o, d]: [string, number, number[], number[]], i: number) => {
    const [lat, lng] = cellToLatLng(id);
    const share = dem.dongShare[dong];
    return {
      id, i, dong, lat, lng, o, d,
      O: o.map((v, b) => dongOut[dong] * share[b] * v),
      D: d.map((v, b) => dongInBin[dong][b] * v),
      Ou: [],
    };
  });
  // 걸어서 닿는 3칸 안에 정류장을 둘 수 있는 셀이 하나도 없으면 미충족으로 치지 않아요
  const unreachable = new Set(cells.filter(c => !SNAP.has(c.id) && !gridDisk(c.id, 3).some(x => SNAP.has(x))).map(c => c.id));
  for (const c of cells) c.Ou = unreachable.has(c.id) ? c.O.map(() => 0) : c.O;
  const byId = new Map(cells.map(c => [c.id, c]));
  const parents = [7, 8].map(res => {
    const m = new Map<string, Agg>();
    for (const c of cells) {
      const p = cellToParent(c.id, res);
      let g = m.get(p);
      if (!g) { const [lat, lng] = cellToLatLng(p); g = { id: p, lat, lng, O: [0, 0, 0, 0, 0], D: [0, 0, 0, 0, 0], Ou: [0, 0, 0, 0, 0] }; m.set(p, g); }
      for (let b = 0; b < NB; b++) { g.O[b] += c.O[b]; g.D[b] += c.D[b]; g.Ou[b] += c.Ou[b]; }
    }
    return m;
  });
  return { bins: dem.bins, dongs: dem.dongs, dongShare: dem.dongShare, cells, byId, od, outOf, into, parents, unreachable, sub, total };
}

// 게임 시각(분, 0 = 0시) → 시간대 번호
export function binOf(d: Demand, minuteOfDay: number) {
  const h = (minuteOfDay / 60) % 24;
  return d.bins.findIndex(b => h >= b.from && h < b.to);
}
export const binHours = (b: Bin) => b.to - b.from;
