// 수요 데이터: 행정동 OD(평일 하루 평균) + res9 셀 안의 출발/도착 비중
// 셀 a → 셀 c, 시간대 b 통행 = od(A,C) × dongShare[A][b] × o_a[b] × d_c[b]  (A, C = 셀이 속한 동)
import { cellToLatLng, cellToParent } from 'h3-js';

export const NB = 5;
export type Bin = { name: string; from: number; to: number };

export type Cell = {
  id: string; dong: number; lat: number; lng: number;
  o: number[]; d: number[];      // 동 안 비중 (시간대별)
  O: number[]; D: number[];      // 이 셀에서 출발/도착하는 하루 통행 (시간대별)
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
  total: number;
};

export type Agg = { id: string; lat: number; lng: number; O: number[]; D: number[] };

export const key = (a: number, c: number) => a * 1000 + c;

export async function loadDemand(base = import.meta.env.BASE_URL): Promise<Demand> {
  const [dem, flat] = await Promise.all([
    fetch(`${base}data/demand.json`).then(r => r.json()),
    fetch(`${base}data/od.json`).then(r => r.json()) as Promise<number[]>,
  ]);
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
  const cells: Cell[] = dem.cells.map(([id, dong, o, d]: [string, number, number[], number[]]) => {
    const [lat, lng] = cellToLatLng(id);
    const share = dem.dongShare[dong];
    return {
      id, dong, lat, lng, o, d,
      O: o.map((v, b) => dongOut[dong] * share[b] * v),
      D: d.map((v, b) => dongInBin[dong][b] * v),
    };
  });
  const byId = new Map(cells.map(c => [c.id, c]));
  const parents = [7, 8].map(res => {
    const m = new Map<string, Agg>();
    for (const c of cells) {
      const p = cellToParent(c.id, res);
      let g = m.get(p);
      if (!g) { const [lat, lng] = cellToLatLng(p); g = { id: p, lat, lng, O: [0, 0, 0, 0, 0], D: [0, 0, 0, 0, 0] }; m.set(p, g); }
      for (let b = 0; b < NB; b++) { g.O[b] += c.O[b]; g.D[b] += c.D[b]; }
    }
    return m;
  });
  return { bins: dem.bins, dongs: dem.dongs, dongShare: dem.dongShare, cells, byId, od, outOf, into, parents, total };
}

// 게임 시각(분, 0 = 0시) → 시간대 번호
export function binOf(d: Demand, minuteOfDay: number) {
  const h = (minuteOfDay / 60) % 24;
  return d.bins.findIndex(b => h >= b.from && h < b.to);
}
export const binHours = (b: Bin) => b.to - b.from;
