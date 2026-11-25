// 버스가 다니는 도로 그래프와 정류장 사이 길 찾기 (scripts/build_stop_snap.py가 만든 roads.json)
// 간선은 한 방향(일방통행 그대로). 양방향 도로는 방향마다 간선이 따로 있어요.
// 길 찾기는 "어느 간선으로 들어왔는지"를 상태로 삼아, 그 자리에서 거꾸로 꺾는 유턴을 막아요.

type Graph = {
  nx: Float64Array; ny: Float64Array; nlng: Float64Array; nlat: Float64Array;
  eu: Int32Array; ev: Int32Array; elen: Float64Array; ecost: Float64Array;
  eh0: Int16Array; eh1: Int16Array;              // 간선 시작·끝 방향(도)
  emid: number[][];
  outStart: Int32Array; outEdge: Int32Array;     // 노드별 나가는 간선 (CSR)
};

const KX = 111320 * Math.cos(37.55 * Math.PI / 180), KY = 110540;
const UTURN = 150;            // 이보다 크게 꺾으면 유턴
const DETOUR_M = 6000;        // 유턴 없이 돌아가는 길이 이보다 길어지면 포기하고 유턴 허용
let G: Graph | null = null;
let loading: Promise<void> | null = null;

export const roadsReady = () => G != null;

export function loadRoads(base = import.meta.env.BASE_URL) {
  loading ??= fetch(`${base}data/roads.json`).then(r => r.json()).then((j: { n: number[]; e: [number, number, number, number, number, number, number[]][] }) => {
    const nn = j.n.length / 2, ne = j.e.length;
    const g: Graph = {
      nx: new Float64Array(nn), ny: new Float64Array(nn), nlng: new Float64Array(nn), nlat: new Float64Array(nn),
      eu: new Int32Array(ne), ev: new Int32Array(ne), elen: new Float64Array(ne), ecost: new Float64Array(ne),
      eh0: new Int16Array(ne), eh1: new Int16Array(ne), emid: new Array(ne),
      outStart: new Int32Array(nn + 1), outEdge: new Int32Array(ne),
    };
    for (let i = 0; i < nn; i++) { g.nlng[i] = j.n[2 * i] / 1e6; g.nlat[i] = j.n[2 * i + 1] / 1e6; g.nx[i] = g.nlng[i] * KX; g.ny[i] = g.nlat[i] * KY; }
    j.e.forEach(([u, v, len, cost, h0, h1, mid], e) => { g.eu[e] = u; g.ev[e] = v; g.elen[e] = len; g.ecost[e] = cost; g.eh0[e] = h0; g.eh1[e] = h1; g.emid[e] = mid; g.outStart[u + 1]++; });
    for (let i = 0; i < nn; i++) g.outStart[i + 1] += g.outStart[i];
    const fill = g.outStart.slice(0, nn);
    for (let e = 0; e < ne; e++) g.outEdge[fill[g.eu[e]]++] = e;
    G = g; cache.clear();
  });
  return loading;
}

function edgeCoords(g: Graph, e: number): [number, number][] {
  const u = g.eu[e], v = g.ev[e], mid = g.emid[e];
  const out: [number, number][] = [[g.nlng[u], g.nlat[u]]];
  let x = Math.round(g.nlng[u] * 1e6), y = Math.round(g.nlat[u] * 1e6);
  for (let i = 0; i < mid.length; i += 2) { x += mid[i]; y += mid[i + 1]; out.push([x / 1e6, y / 1e6]); }
  out.push([g.nlng[v], g.nlat[v]]);
  return out;
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY);

// 간선 e 위 거리 t0 → t1 (t0 ≤ t1) 사이 모양
function sub(g: Graph, e: number, t0: number, t1: number): [number, number][] {
  const c = edgeCoords(g, e), out: [number, number][] = [];
  const at = (p: [number, number], q: [number, number], k: number): [number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  let s = 0;
  for (let i = 1; i < c.length; i++) {
    const L = dist(c[i - 1], c[i]), s1 = s + L;
    if (s1 >= t0 && s <= t1 && L > 0) {
      if (!out.length) out.push(at(c[i - 1], c[i], Math.max(0, (t0 - s) / L)));
      out.push(at(c[i - 1], c[i], Math.min(1, (t1 - s) / L)));
    }
    s = s1; if (s > t1) break;
  }
  if (!out.length) out.push(c[0]);
  return out;
}

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

// 정류장 후보: lng, lat, 간선, 간선 위 거리(m), 점수(m, 작을수록 좋은 자리)
export type Cand = [number, number, number, number, number];
export type Leg = { coords: [number, number][]; to: number; uturn: boolean };   // to = 도착한 후보 번호

const cache = new Map<string, Leg | null>();
// e 끝에서 f로 꺾는 각도(도, -180..180, 왼쪽 +)
const turn = (g: Graph, e: number, f: number) => ((((g.eh0[f] - g.eh1[e]) % 360) + 540) % 360) - 180;
const SHORT_M = 60;   // 이보다 짧은 간선(중앙분리대 유턴 연결로 등)을 사이에 둔 두 번 꺾기도 합쳐서 유턴인지 봐요

// 후보 a에서 출발해 targets 중 하나에 서기까지. 유턴 없이 못 가면 유턴을 허용하고 uturn
export function leg(a: Cand, targets: Cand[], key: string): Leg | null {
  const g = G; if (!g) return null;
  const k = `${a[2]}:${a[3]}>${key}`;
  if (cache.has(k)) return cache.get(k)!;
  const r = search(g, a, targets, false) ?? search(g, a, targets, true);
  cache.set(k, r); return r;
}

function search(g: Graph, a: Cand, targets: Cand[], allowU: boolean): Leg | null {
  const [, , ea, ta] = a, f = (e: number) => g.ecost[e] / (g.elen[e] || 1);
  const byEdge = new Map<number, number[]>();
  targets.forEach((t, i) => (byEdge.get(t[2]) ?? byEdge.set(t[2], []).get(t[2])!).push(i));
  let best = Infinity, bestPrev = -1, bestTo = -1, direct = false;
  for (const i of byEdge.get(ea) ?? []) if (targets[i][3] >= ta) { const c = (targets[i][3] - ta) * f(ea) + targets[i][4]; if (c < best) { best = c; bestTo = i; direct = true; } }
  const gx = targets[0][0] * KX, gy = targets[0][1] * KY;
  const h = (e: number) => Math.hypot(g.nx[g.ev[e]] - gx, g.ny[g.ev[e]] - gy);
  const cap = dist([a[0], a[1]], [targets[0][0], targets[0][1]]) * 3 + DETOUR_M;
  const gs = new Map<number, number>(), prev = new Map<number, number>(), tin = new Map<number, number>(), heap = new Heap();
  const g0 = (g.elen[ea] - ta) * f(ea); gs.set(ea, g0); prev.set(ea, -1); heap.push(g0 + h(ea), ea);
  while (heap.size) {
    const [key, e] = heap.pop();
    if (key >= best) break;
    const c = gs.get(e)!; if (key - h(e) > c + 1e-6) continue;
    if (!allowU && c > cap) break;
    const n = g.ev[e];
    for (let i = g.outStart[n]; i < g.outStart[n + 1]; i++) {
      const o = g.outEdge[i];
      const d = turn(g, e, o);
      if (!allowU && (Math.abs(d) > UTURN || (g.elen[e] < SHORT_M && Math.abs(d + (tin.get(e) ?? 0)) > UTURN))) continue;
      for (const ti of byEdge.get(o) ?? []) { const tc = c + targets[ti][3] * f(o) + targets[ti][4]; if (tc < best) { best = tc; bestTo = ti; bestPrev = e; direct = false; } }
      const nc = c + g.ecost[o];
      if (nc < (gs.get(o) ?? Infinity)) { gs.set(o, nc); prev.set(o, e); tin.set(o, d); heap.push(nc + h(o), o); }
    }
  }
  if (bestTo < 0) return null;
  const T = targets[bestTo];
  if (direct) return { coords: sub(g, ea, ta, T[3]), to: bestTo, uturn: allowU };
  const chain: number[] = [];
  for (let e = bestPrev; e !== -1; e = prev.get(e)!) chain.push(e);
  chain.reverse();   // chain[0] = ea
  const out = sub(g, ea, ta, g.elen[ea]);
  for (const e of chain.slice(1)) out.push(...edgeCoords(g, e).slice(1));
  out.push(...sub(g, T[2], 0, T[3]).slice(1));
  return { coords: out, to: bestTo, uturn: allowU };
}
