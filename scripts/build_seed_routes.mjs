// 예시 노선 정류장 뽑기: 지나는 점들을 도로로 잇고, 그 길 위 약 450m마다 도로 위 자리가 길에서 60m 안인 정류장 가능 셀
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
function seed(pts, gap = 450) {
  const way = pts.map(([lng, lat]) => near(lng, lat));
  const path = M.routePath(way).path;   // 도로 길
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
  const last = way[way.length-1]; if (stops[stops.length-1] !== last) stops.push(last);
  return stops;
}
const T = seed([[127.062, 37.655], [127.056, 37.636], [127.047, 37.618], [127.03, 37.602], [127.012, 37.588], [126.998, 37.571], [126.992, 37.566], [127.007, 37.548], [127.017, 37.535], [127.027, 37.519], [127.035, 37.502]]);
const B = seed([[126.93, 37.484], [126.918, 37.486], [126.908, 37.487], [126.896, 37.484], [126.885, 37.48], [126.875, 37.495]]);
for (const [st, n] of [[T, 18], [B, 6]]) { const r = M.makeRoute(dm, 'trunk', st, n); const segs=[]; for (let i=1;i<st.length;i++){ const dd=r.stopAt[i]-r.stopAt[i-1]; segs.push((dd/ (d(D.snapped(st[i-1]),D.snapped(st[i]))/1000)).toFixed(1)); } console.log(st.length, r.lenKm.toFixed(1), segs.join(' ')); }
fs.writeFileSync('src/game/seeds.ts', `// scripts/build_seed_routes.mjs가 만든 예시 노선 정류장 (res9 셀). 도로 데이터를 다시 만들면 이것도 다시 만들어요\nexport const SEED_TRUNK = ${JSON.stringify(T)};\nexport const SEED_BRANCH = ${JSON.stringify(B)};\n`);
await sv.close();
