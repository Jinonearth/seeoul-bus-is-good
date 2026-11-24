// 이어진 그림 지도 무늬: 위에서 비스듬히 본(3/4) 픽셀 아트. 옛 휴대용 RPG·농장 게임 같은 분위기만 빌리고 모양·색은 모두 새로 그렸어요.
// 지형은 헥사곤이 아니라 합쳐서 둥글게 다듬은 면(terrain.geojson)에 칠하고, 무늬는 128×128 타일이라 반복이 덜 보여요.
// 규칙: 1px 테두리는 그 물체의 가장 어두운 색, 밝기 3~4단, 빛은 왼쪽 위, 그림자는 오른쪽 아래. 1 논리 px = 1 CSS px (기기 PR배, 보간 없음).
import type { Map as MLMap } from 'maplibre-gl';

const T = 128, PR = 2;
type Px = (x: number, y: number, w?: number, h?: number) => void;
type Pen = (c: string) => Px;

function canvasTile(draw: (pen: Pen, rnd: () => number) => void, seed: number) {
  const c = document.createElement('canvas'); c.width = c.height = T * PR;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  const pen: Pen = col => (x, y, w = 1, h = 1) => { g.fillStyle = col; for (const dx of [0, -T, T]) for (const dy of [0, -T, T]) g.fillRect((Math.round(x) + dx) * PR, (Math.round(y) + dy) * PR, w * PR, h * PR); };
  draw(pen, rng(seed));
  return g.getImageData(0, 0, c.width, c.height);
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sprite(pen: Pen, x: number, y: number, rows: string[], pal: Record<string, string>) {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const k = row[i]; if (k !== ' ' && pal[k]) pen(pal[k])(x + i, y + j); } });
}
function ground(pen: Pen, r: () => number, base: string, specks: string[], n: number) {
  pen(base)(0, 0, T, T);
  for (let i = 0; i < n; i++) pen(specks[Math.floor(r() * specks.length)])(Math.floor(r() * T), Math.floor(r() * T), r() < 0.3 ? 2 : 1, 1);
}
// 흩어 놓기: 서로 gap 이상 떨어진 자리 (가까운 무리로 모이게 하려면 cluster 중심 둘레에서)
function scatter(r: () => number, n: number, gap: number, around?: [number, number][], spread = 20) {
  const pts: [number, number][] = [];
  for (let t = 0; t < n * 40 && pts.length < n; t++) {
    let x = r() * T, y = r() * T;
    if (around?.length) { const [cx, cy] = around[Math.floor(r() * around.length)]; x = cx + (r() - 0.5) * spread * 2; y = cy + (r() - 0.5) * spread * 2; }
    x = ((x % T) + T) % T; y = ((y % T) + T) % T;
    if (pts.every(([a, b]) => { const dx = Math.min(Math.abs(a - x), T - Math.abs(a - x)), dy = Math.min(Math.abs(b - y), T - Math.abs(b - y)); return Math.hypot(dx, dy) >= gap; })) pts.push([x, y]);
  }
  return pts.sort((a, b) => a[1] - b[1]);
}

// ── 나무: 둥근 수관 덩어리 (왼쪽 위 빛, 오른쪽 아래 짙음) ──
const P = { o: '#24461F', d: '#36672C', m: '#4C8A3A', l: '#68A84C', h: '#93CC6B', t: '#6B4A2B', u: '#47311D', s: 'rgba(20,40,18,0.35)' };
const TREE = [
  '   oooooo   ',
  '  ollhhmmo  ',
  ' olhhllmmdo ',
  'olhllmmmmddo',
  'olllmmmmmddo',
  'olmmmmmmdddo',
  'odmmmmmddddo',
  ' oddmmdddddos',
  '  oodddddoos',
  '    ootuoo ss',
  '     utu  ss',
];
const TREE_S = [
  '  oooo  ',
  ' olhlmo ',
  'olhlmmdo',
  'olmmmddo',
  'odmmdddos',
  ' oodddoss',
  '   tu ss'];
const BUSH = [' oooo ', 'olhmdo', 'odmmdos', ' ooooss'];
const TUFT = [' g g ', 'gG gG', ' GgG '];
const FLOWER = [' p ', 'pyp', ' p '];
export function path(pen: Pen, r: () => number, x0: number, y0: number, len: number, horiz: boolean) {
  let x = x0, y = y0;
  for (let i = 0; i < len; i++) {
    pen('#B39A6A')(x - 1, y - 1, horiz ? 1 : 4, horiz ? 4 : 1); pen('#D9C38F')(x, y, horiz ? 1 : 3, horiz ? 3 : 1); pen('#E6D3A3')(x, y, 1, 1);
    if (horiz) { x++; if (r() < 0.15) y += r() < 0.5 ? 1 : -1; } else { y++; if (r() < 0.15) x += r() < 0.5 ? 1 : -1; }
  }
}
const GRASS = ['#7FB451', '#8DC05C', '#73A847', '#9ACB68'];

// ── 지형 무늬 ──
const forestCore = (pen: Pen, r: () => number) => {
  ground(pen, r, '#3E7330', ['#356629', '#4A8238'], 300);
  for (const [x, y] of scatter(r, 140, 7)) { if (r() < 0.75) sprite(pen, x - 6, y - 6, TREE, P); else sprite(pen, x - 4, y - 4, TREE_S, P); }
};
const forestEdge = (pen: Pen, r: () => number) => {
  ground(pen, r, '#86BA57', GRASS, 360);
  for (const [x, y] of scatter(r, 14, 18)) sprite(pen, x - 6, y - 6, r() < 0.5 ? TREE : TREE_S, P);
  for (const [x, y] of scatter(r, 20, 12)) sprite(pen, x - 2, y - 1, TUFT, { g: '#6A9F43', G: '#55863A' });
};
const park = (pen: Pen, r: () => number) => {
  ground(pen, r, '#8EC25E', GRASS, 420);
  for (const [x, y] of scatter(r, 9, 22)) sprite(pen, x - 6, y - 6, TREE, P);
  for (const [x, y] of scatter(r, 10, 14)) sprite(pen, x - 3, y - 2, BUSH, P);
  for (const [x, y] of scatter(r, 30, 8)) sprite(pen, x - 1, y - 1, FLOWER, { p: r() < 0.5 ? '#F29BB9' : '#F7F2E6', y: '#F2C94E' });
};
// ── 3/4로 본 건물: 위는 평평한 옥상, 아래는 층수만큼 높은 앞 벽(창 격자). 높을수록 앞 벽이 길고 그림자도 길어요 ──
// x, y = 옥상 왼쪽 위, w = 너비, d = 옥상 깊이, h = 앞 벽 높이(px). 그림자는 오른쪽(동)과 아래(남)로
type Bld = { roof: string; roofHi: string; edge: string; wall: string; wallSh: string; win: string; winHi?: string };
function building(pen: Pen, x: number, y: number, w: number, d: number, h: number, c: Bld, glass = false) {
  const sh = Math.max(2, Math.round(h * 0.35));
  pen('rgba(25,30,25,0.28)')(x + w, y + 2, sh, d + h - 1);          // 동쪽 그림자
  pen('rgba(25,30,25,0.22)')(x + 2, y + d + h, w + sh - 2, Math.max(1, Math.round(sh / 2)));   // 남쪽 그림자
  pen(c.edge)(x - 1, y - 1, w + 2, d + h + 2);                       // 테두리
  pen(c.roof)(x, y, w, d); pen(c.roofHi)(x, y, w, 1); pen(c.roofHi)(x, y, 1, d);   // 옥상 (왼쪽 위 빛)
  if (w > 10) { pen(c.edge)(x + 2, y + 1, 5, 3); pen('#E9E6DF')(x + 3, y + 1, 3, 2); }   // 옥상 계단실·설비
  pen(c.edge)(x, y + d, w, 1);                                       // 처마 줄
  pen(c.wall)(x, y + d + 1, w, h - 1);                               // 앞 벽
  pen(c.wallSh)(x + w - 2, y + d + 1, 2, h - 1);                     // 벽 오른쪽 그늘
  if (glass) { for (let yy = y + d + 2; yy < y + d + h - 1; yy += 2) pen(c.win)(x + 1, yy, w - 3, 1); for (let xx = x + 3; xx < x + w - 2; xx += 4) pen(c.wallSh)(xx, y + d + 1, 1, h - 1); if (c.winHi) pen(c.winHi)(x + 1, y + d + 2, Math.round(w / 3), 1); }
  else for (let yy = y + d + 2; yy < y + d + h - 1; yy += 2) for (let xx = x + 1; xx < x + w - 2; xx += 3) pen(c.win)(xx, yy, 2, 1);   // 층마다 창 줄
}
const APT: Bld[] = [
  { roof: '#D9D5CB', roofHi: '#ECE9E1', edge: '#7D776C', wall: '#EFE7D6', wallSh: '#D4C9B3', win: '#7E97A6' },
  { roof: '#D4D6D3', roofHi: '#E9EBE8', edge: '#737873', wall: '#F2F1EC', wallSh: '#D2D2CB', win: '#7A90A0' },
  { roof: '#DCD3C8', roofHi: '#EEE7DD', edge: '#7E7064', wall: '#EADBC9', wallSh: '#CFBCA5', win: '#8197A3' },
];
const VILLA: Bld[] = [
  { roof: '#CBBFAF', roofHi: '#DDD3C5', edge: '#6E6255', wall: '#E8D9C4', wallSh: '#CBB89E', win: '#7C93A0' },
  { roof: '#C8C2BC', roofHi: '#DCD7D1', edge: '#686259', wall: '#D9CFC6', wallSh: '#BDB1A5', win: '#7C93A0' },
  { roof: '#C3B2A6', roofHi: '#D8C9BE', edge: '#6A5A4F', wall: '#E3C9B4', wallSh: '#C7A891', win: '#7C93A0' },
];
const TOWER: Bld[] = [
  { roof: '#C9CDD1', roofHi: '#E1E4E7', edge: '#4F5A64', wall: '#8FA9BC', wallSh: '#6F8A9E', win: '#B7CEDC', winHi: '#DCEAF2' },
  { roof: '#CCCAC4', roofHi: '#E3E1DC', edge: '#55606A', wall: '#9AAFBD', wallSh: '#7790A1', win: '#C2D5E0', winHi: '#E2EEF4' },
  { roof: '#D2CFC8', roofHi: '#E6E3DD', edge: '#5C5850', wall: '#D9D2C4', wallSh: '#BCB3A2', win: '#8AA2B2' },
];
function parking(pen: Pen, x: number, y: number, w: number) {
  pen('#A9A79F')(x, y, w, 7); pen('#B9B7AF')(x, y, w, 1);
  for (let i = x + 2; i < x + w - 1; i += 4) pen('#E8E6DE')(i, y + 1, 1, 5);
}
const residential = (pen: Pen, r: () => number) => {
  ground(pen, r, '#93C063', GRASS, 300);
  // 아파트 단지: 긴 판상형 동이 나란히 (앞 벽 높이 = 층수), 사이에 녹지·주차장
  for (const row of [0, 1]) {
    const y0 = 6 + row * 40;
    for (const x0 of [4, 52]) {
      const w = 38 + Math.floor(r() * 6), h = 14 + Math.floor(r() * 8), c = APT[Math.floor(r() * APT.length)];
      building(pen, x0, y0, w, 6, h, c);
      if (r() < 0.6) parking(pen, x0, y0 + 6 + h + 4, w - 6);
      else for (const [tx, ty] of scatter(r, 3, 10, [[x0 + w / 2, y0 + 6 + h + 8]], 14)) sprite(pen, tx - 4, ty - 4, TREE_S, P);
    }
  }
  // 빌라 골목: 3~4층 네모난 건물이 조금씩 모여요
  for (const [x, y] of scatter(r, 6, 17, [[30, 100], [92, 100]], 18)) building(pen, x - 6, y - 8, 11 + Math.floor(r() * 3), 5, 7 + Math.floor(r() * 3), VILLA[Math.floor(r() * VILLA.length)]);
  for (const [x, y] of scatter(r, 6, 16)) sprite(pen, x - 4, y - 4, TREE_S, P);
};
const commercial = (pen: Pen, r: () => number) => {
  ground(pen, r, '#CFC8B8', ['#C3BCAC', '#D9D3C5'], 260);
  for (let i = 0; i < T; i += 16) { pen('#C2BBAA')(i, 0, 1, T); pen('#C2BBAA')(0, i, T, 1); }   // 보도블록
  // 업무 빌딩: 큰 바닥, 유리 앞 벽이 높고 그림자도 길어요. 사이사이 작은 광장과 나무
  const spots: [number, number][] = [[6, 4], [52, 2], [90, 8], [14, 62], [64, 58], [100, 70]];
  for (const [x, y] of spots) { if (r() < 0.12) continue; const t = TOWER[Math.floor(r() * TOWER.length)], glass = t !== TOWER[2]; building(pen, x, y, 20 + Math.floor(r() * 10), 9, 20 + Math.floor(r() * 16), t, glass); }
  for (const [x, y] of scatter(r, 7, 18)) sprite(pen, x - 4, y - 4, TREE_S, P);
};
const industrial = (pen: Pen, r: () => number) => {
  ground(pen, r, '#BFC3BC', ['#B1B5AE', '#CBCFC8'], 220);
  for (let row = 0; row < 4; row++) {
    const y = row * 32 + 6, off = Math.floor(r() * 40);
    for (const x0 of [off, off + 64]) {
      if (r() < 0.2) continue;
      const blue = r() < 0.5, [L, M, Dk, E] = blue ? ['#A4BAC4', '#8AA2AE', '#6F8794', '#4F6470'] : ['#A9C0A6', '#8EA690', '#728A74', '#526A55'];
      pen('rgba(30,40,40,0.28)')(x0 + 2, y + 2, 36, 14); pen(E)(x0, y, 36, 14); pen(M)(x0 + 1, y + 1, 34, 8);
      for (let i = 1; i < 35; i += 2) pen(L)(x0 + i, y + 1, 1, 8);
      pen(Dk)(x0 + 1, y + 9, 34, 4); pen('#D6D1C4')(x0 + 1, y + 9, 34, 1);   // 앞 벽
    }
  }
};
const open = (pen: Pen, r: () => number) => {
  ground(pen, r, '#A3C873', GRASS, 300);
  for (const [x, y] of scatter(r, 6, 30)) sprite(pen, x - 6, y - 6, TREE, P);
  for (const [x, y] of scatter(r, 18, 14)) sprite(pen, x - 2, y - 1, TUFT, { g: '#6A9F43', G: '#55863A' });
};
const softEdge = (pen: Pen, r: () => number) => {   // 다른 지형 둘레 띠: 풀밭에 덤불 조금
  ground(pen, r, '#93C063', GRASS, 340);
  for (const [x, y] of scatter(r, 8, 22)) sprite(pen, x - 3, y - 2, BUSH, P);
};

const DRAW: Record<string, (pen: Pen, r: () => number) => void> = {
  f: forestCore, 'f-edge': forestEdge, g: park, 'g-edge': softEdge, r: residential, 'r-edge': softEdge,
  c: commercial, 'c-edge': softEdge, i: industrial, 'i-edge': softEdge, o: open, 'o-edge': open,
};
export function addTerrainPatterns(m: MLMap) {
  for (const [k, f] of Object.entries(DRAW)) { const id = `pat-${k}`; if (!m.hasImage(id)) m.addImage(id, canvasTile(f, [...k].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)), { pixelRatio: PR }); }
}
