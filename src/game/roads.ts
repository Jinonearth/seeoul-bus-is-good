// 버스가 다니는 도로 그래프와 정류장 사이 길 찾기 (scripts/build_stop_snap.py가 만든 roads.json)
// 일방통행은 아직 무시해요: 양방향 그래프

type Graph = {
  nx: Float64Array; ny: Float64Array;           // 교차점 위치 (m, 휴리스틱용)
  nlng: Float64Array; nlat: Float64Array;
  eu: Int32Array; ev: Int32Array; elen: Float64Array; ecost: Float64Array;
  emid: number[][];                             // 간선 중간점 (lng·1e6, lat·1e6 차이)
  adjStart: Int32Array; adjEdge: Int32Array;    // 교차점별 간선 목록 (CSR)
};

const KX = 111320 * Math.cos(37.55 * Math.PI / 180), KY = 110540;
let G: Graph | null = null;
let loading: Promise<void> | null = null;

export const roadsReady = () => G != null;

export function loadRoads(base = import.meta.env.BASE_URL) {
  loading ??= fetch(`${base}data/roads.json`).then(r => r.json()).then((j: { n: number[]; e: [number, number, number, number, number[]][] }) => {
    const nn = j.n.length / 2, ne = j.e.length;
    const g: Graph = {
      nx: new Float64Array(nn), ny: new Float64Array(nn), nlng: new Float64Array(nn), nlat: new Float64Array(nn),
      eu: new Int32Array(ne), ev: new Int32Array(ne), elen: new Float64Array(ne), ecost: new Float64Array(ne), emid: new Array(ne),
      adjStart: new Int32Array(nn + 1), adjEdge: new Int32Array(ne * 2),
    };
    for (let i = 0; i < nn; i++) { g.nlng[i] = j.n[2 * i] / 1e6; g.nlat[i] = j.n[2 * i + 1] / 1e6; g.nx[i] = g.nlng[i] * KX; g.ny[i] = g.nlat[i] * KY; }
    j.e.forEach(([u, v, len, cost, mid], e) => { g.eu[e] = u; g.ev[e] = v; g.elen[e] = len; g.ecost[e] = cost; g.emid[e] = mid; g.adjStart[u + 1]++; g.adjStart[v + 1]++; });
    for (let i = 0; i < nn; i++) g.adjStart[i + 1] += g.adjStart[i];
    const fill = g.adjStart.slice(0, nn);
    for (let e = 0; e < ne; e++) { g.adjEdge[fill[g.eu[e]]++] = e; g.adjEdge[fill[g.ev[e]]++] = e; }
    G = g; cache.clear();
  });
  return loading;
}

// 간선 e의 모양 (u → v 방향, 끝점 포함)
function edgeCoords(g: Graph, e: number): [number, number][] {
  const u = g.eu[e], v = g.ev[e], mid = g.emid[e];
  const out: [number, number][] = [[g.nlng[u], g.nlat[u]]];
  let x = Math.round(g.nlng[u] * 1e6), y = Math.round(g.nlat[u] * 1e6);
  for (let i = 0; i < mid.length; i += 2) { x += mid[i]; y += mid[i + 1]; out.push([x / 1e6, y / 1e6]); }
  out.push([g.nlng[v], g.nlat[v]]);
  return out;
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY);

// 간선 e 위 거리 t0 → t1 사이 모양 (t0 > t1이면 거꾸로)
function sub(g: Graph, e: number, t0: number, t1: number): [number, number][] {
  const c = edgeCoords(g, e), rev = t0 > t1, a = Math.min(t0, t1), b = Math.max(t0, t1);
  const out: [number, number][] = [];
  let s = 0;
  const at = (p: [number, number], q: [number, number], k: number): [number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  for (let i = 1; i < c.length; i++) {
    const L = dist(c[i - 1], c[i]), s1 = s + L;
    if (s1 >= a && s <= b && L > 0) {
      if (!out.length) out.push(at(c[i - 1], c[i], Math.max(0, (a - s) / L)));
      out.push(at(c[i - 1], c[i], Math.min(1, (b - s) / L)));
    }
    s = s1;
    if (s > b) break;
  }
  if (!out.length) out.push(c[0]);
  return rev ? out.reverse() : out;
}

// 최소 힙 (비용, 교차점)
class Heap {
  k: number[] = []; v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v, top: [number, number] = [k[0], v[0]], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export type Snap = [number, number, number, number];   // lng, lat, 간선, 간선 위 거리(m)
const cache = new Map<string, [number, number][] | null>();

// 정류장 a → b 도로 길 (못 찾으면 null)
export function roadBetween(ka: string, a: Snap, kb: string, b: Snap): [number, number][] | null {
  const g = G; if (!g) return null;
  const key = ka + '|' + kb;
  if (cache.has(key)) return cache.get(key)!;
  const back = cache.get(kb + '|' + ka);
  if (back !== undefined) { const r = back && [...back].reverse(); cache.set(key, r); return r; }
  const r = search(g, a, b); cache.set(key, r); return r;
}

function search(g: Graph, a: Snap, b: Snap): [number, number][] | null {
  const [, , ea, ta] = a, [, , eb, tb] = b;
  const fa = g.ecost[ea] / (g.elen[ea] || 1), fb = g.ecost[eb] / (g.elen[eb] || 1);
  let best = Infinity, bestEnd = -1, bestTail = 0;
  if (ea === eb) { best = Math.abs(ta - tb) * fa; }
  const nn = g.nx.length, gs = new Float64Array(nn).fill(Infinity), via = new Int32Array(nn).fill(-1), from = new Int32Array(nn).fill(-1);
  const bx = b[0] * KX, by = b[1] * KY, h = (n: number) => Math.hypot(g.nx[n] - bx, g.ny[n] - by);
  const heap = new Heap();
  const start = (n: number, c: number) => { if (c < gs[n]) { gs[n] = c; via[n] = -2; heap.push(c + h(n), n); } };
  start(g.eu[ea], ta * fa); start(g.ev[ea], (g.elen[ea] - ta) * fa);
  const tailU = tb * fb, tailV = (g.elen[eb] - tb) * fb;
  while (heap.size) {
    const [f, n] = heap.pop();
    if (f >= best) break;
    const c = gs[n]; if (f - h(n) > c + 1e-6) continue;
    if (n === g.eu[eb] && c + tailU < best) { best = c + tailU; bestEnd = n; bestTail = 0; }
    if (n === g.ev[eb] && c + tailV < best) { best = c + tailV; bestEnd = n; bestTail = 1; }
    for (let i = g.adjStart[n]; i < g.adjStart[n + 1]; i++) {
      const e = g.adjEdge[i], o = g.eu[e] === n ? g.ev[e] : g.eu[e], nc = c + g.ecost[e];
      if (nc < gs[o]) { gs[o] = nc; via[o] = e; from[o] = n; heap.push(nc + h(o), o); }
    }
  }
  if (bestEnd < 0) return best < Infinity ? sub(g, ea, ta, tb) : null;
  // 거꾸로 따라가며 간선 목록
  const chain: [number, number][] = [];   // [간선, 출발 교차점]
  for (let n = bestEnd; via[n] !== -2; n = from[n]) chain.push([via[n], from[n]]);
  chain.reverse();
  const s0 = chain.length ? chain[0][1] : bestEnd;
  const out: [number, number][] = sub(g, ea, ta, s0 === g.eu[ea] ? 0 : g.elen[ea]);
  for (const [e, n] of chain) { const c = edgeCoords(g, e); if (n !== g.eu[e]) c.reverse(); out.push(...c.slice(1)); }
  const tail = sub(g, eb, bestTail === 0 ? 0 : g.elen[eb], tb);
  out.push(...tail.slice(1));
  return out;
}
