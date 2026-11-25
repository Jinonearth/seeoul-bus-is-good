// 예시 노선 정류장 뽑기: 지나는 점들을 도로로 잇고, 그 길 위 약 450m마다 도로 위 자리가 길에서 60m 안인 정류장 가능 셀.
// 그다음 한 바퀴에서 정류장 사이가 직선의 2.2배 넘게 돌아가는 정류장을 빼요
// node scripts/build_seed_routes.mjs  → src/game/seeds.ts
import { createServer } from 'vite';
import fs from 'node:fs';
const root = process.cwd();
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync(root + '/public' + u, 'utf8')) });
const sv = await createServer({ root, server: { middlewareMode: true }, logLevel: 'error' });
const h3 = await sv.ssrLoadModule('h3-js');
const D = await sv.ssrLoadModule('/src/game/data.ts'), M = await sv.ssrLoadModule('/src/game/model.ts'), R = await sv.ssrLoadModule('/src/game/roads.ts');
const dm = await D.loadDemand('/'); await R.loadRoads('/');
const KX = 111320 * Math.cos(37.55 * Math.PI / 180), KY = 110540, d = (a, b) => Math.hypot((a[0]-b[0])*KX, (a[1]-b[1])*KY);
const near = (lng, lat) => h3.gridDiskDistances(h3.latLngToCell(lat, lng, 9), 3).flat().find(D.stopable);
function seed(pts, gap = 450, circ = false) {
  const way = pts.map(([lng, lat]) => near(lng, lat));
  const rp = M.routePath(way, circ), path = rp.path.slice(0, rp.outN + 1);   // 가는 길 도로 (순환은 한 바퀴 전체)
  const stops = [way[0]]; let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const L = d(path[i-1], path[i]); let s = 0;
    while (acc + (L - s) >= gap) {
      s += gap - acc; acc = 0;
      const k = s / L, p = [path[i-1][0] + (path[i][0]-path[i-1][0])*k, path[i-1][1] + (path[i][1]-path[i-1][1])*k];
      const c = h3.gridDisk(h3.latLngToCell(p[1], p[0], 9), 1).filter(D.stopable).map(c => [c, d(D.snapped(c), p)]).sort((a, b) => a[1] - b[1])[0];
      if (c && c[1] < 60 && c[0] !== stops[stops.length-1]) stops.push(c[0]);
    }
    acc += L - s;
  }
  const last = way[way.length-1]; if (!circ && stops[stops.length-1] !== last) stops.push(last);
  if (circ) while (stops.length > 1 && stops[stops.length - 1] === stops[0]) stops.pop();
  // 가는 길·오는 길에서 크게 돌아가게 만드는 정류장(도로 위 자리가 한 방향에만 있는 곳 등)은 빼요
  for (let round = 0; round < 40; round++) {
    const r = M.routePath(stops, circ), v = r.visits; let worst = -1, wr = 2.2;
    for (let k = 1; k < v.length; k++) {
      const a = D.snapped(stops[v[k - 1].i]), b = D.snapped(stops[v[k].i]), ratio = (v[k].s - v[k - 1].s) * 1000 / Math.max(d(a, b), 150);
      const i = v[k].i; if (ratio > wr && i !== 0 && (circ || i !== stops.length - 1)) { wr = ratio; worst = i; }
    }
    if (worst < 0) break;
    stops.splice(worst, 1);
  }
  return stops;
}
const T = seed([[127.062, 37.655], [127.056, 37.636], [127.047, 37.618], [127.03, 37.602], [127.012, 37.588], [126.998, 37.571], [126.992, 37.566], [127.007, 37.548], [127.017, 37.535], [127.027, 37.519], [127.035, 37.502]]);
const B = seed([[126.93, 37.484], [126.918, 37.486], [126.908, 37.487], [126.896, 37.484], [126.885, 37.48], [126.875, 37.495]]);
// 순환: 서울역 → 시청 → 광화문 → 종로3가 → 동대문 → 동대입구 → 명동 → 서울역
const C = seed([[126.972, 37.556], [126.977, 37.566], [126.977, 37.572], [126.992, 37.570], [127.008, 37.571], [127.004, 37.559], [126.986, 37.561], [126.972, 37.556]], 450, true);
for (const [st, circ] of [[T, false], [B, false], [C, true]]) { const t = performance.now(); const rp = M.routePath(st, circ); console.log(st.length, 'stops', rp.lenKm.toFixed(1), 'km one way', (performance.now() - t).toFixed(0), 'ms', 'uturn', rp.uturn, 'broken', rp.broken); }
fs.writeFileSync('src/game/seeds.ts', `// scripts/build_seed_routes.mjs가 만든 예시 노선 정류장 (res9 셀). 도로 데이터를 다시 만들면 이것도 다시 만들어요\nexport const SEED_TRUNK = ${JSON.stringify(T)};\nexport const SEED_BRANCH = ${JSON.stringify(B)};\nexport const SEED_CIRC = ${JSON.stringify(C)};\n`);
await sv.close();
