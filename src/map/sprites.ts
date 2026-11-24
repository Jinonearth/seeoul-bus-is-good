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
// ── 3/4 집: 지붕 면 + 앞 벽 (R 지붕 밝음 r 지붕 q 지붕 그늘 x 지붕 테두리 w 벽 v 벽 그늘 n 벽 테두리 D 문 W 창) ──
const ROOFS = [
  { R: '#E08A66', r: '#C2603F', q: '#9B4A31', x: '#6E3020' },
  { R: '#7FB0C9', r: '#5A8FAE', q: '#45728D', x: '#2D4E63' },
  { R: '#E6C06A', r: '#C99A42', q: '#A27831', x: '#6E5020' },
  { R: '#B58ACB', r: '#9468AD', q: '#78528E', x: '#4E3460' },
];
const HOUSE = [
  '   xxxxxxxx    ',
  '  xRRRRRRRRx   ',
  ' xRRRRRRRRRrx  ',
  'xrrrrrrrrrrrqx ',
  'xqqqqqqqqqqqqx ',
  ' nwwwwwwwwwwvns',
  ' nwWWwDDwWWwvns',
  ' nwWWwDDwWWwvns',
  ' nnnnnDDnnnnnns',
  '  sssssssssssss'];
const BLOCK = [
  'eeeeeeeeeeee   ',
  'eaaaaaaaaaabe  ',
  'eabbbAAbbbbce  ',
  'eabbbBBbbbbce  ',
  'eabbbbbbbbbce  ',
  'eccccccccccce  ',
  'efGfGfGfGfGfes ',
  'efGfGfGfGfGfes ',
  'effffffffffffss',
  'eeeeeeeeeeeeess',
  '  sssssssssssss'];
const BLOCK_PALS = [
  { a: '#E2DFD8', b: '#C9C5BD', c: '#AAA59C', e: '#6F6A62', A: '#F2F1EE', B: '#8E8A84', f: '#D8D2C4', G: '#8FB8CB', s: 'rgba(30,30,40,0.30)' },
  { a: '#D8DDE2', b: '#BCC4CC', c: '#9DA7B0', e: '#5E6770', A: '#F2F4F6', B: '#848C93', f: '#CDD3D8', G: '#93BFD3', s: 'rgba(30,30,40,0.30)' },
];

function house(pen: Pen, x: number, y: number, k: number) {
  sprite(pen, x, y, HOUSE, { ...ROOFS[k % ROOFS.length], w: '#F1E6CC', v: '#D3C3A2', n: '#8C7A5A', D: '#7A5236', W: '#8FC1D4', s: 'rgba(30,22,12,0.30)' });
}
export function path(pen: Pen, r: () => number, x0: number, y0: number, len: number, horiz: boolean) {
  let x = x0, y = y0;
  for (let i = 0; i < len; i++) {
    pen('#B39A6A')(x - 1, y - 1, horiz ? 1 : 4, horiz ? 4 : 1); pen('#D9C38F')(x, y, horiz ? 1 : 3, horiz ? 3 : 1); pen('#E6D3A3')(x, y, 1, 1);
    if (horiz) { x++; if (r() < 0.15) y += r() < 0.5 ? 1 : -1; } else { y++; if (r() < 0.15) x += r() < 0.5 ? 1 : -1; }
  }
}
function field(pen: Pen, x: number, y: number, w: number, h: number) {
  pen('#7A5A36')(x - 1, y - 1, w + 2, h + 2); pen('#A8814F')(x, y, w, h);
  for (let j = 0; j < h; j += 2) pen('#8E6A40')(x, y + j, w, 1);
  for (let i = 1; i < w; i += 3) pen('#7FAE4F')(x + i, y + 1, 1, 1);
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
const residential = (pen: Pen, r: () => number) => {
  ground(pen, r, '#93C063', GRASS, 380);
  const centers: [number, number][] = [[28, 16], [96, 18], [30, 62], [100, 60], [24, 112], [96, 112]];
  for (const [cx, cy] of centers) { pen('#C9B27E')(cx - 18, cy - 9, 36, 20); pen('#D8C394')(cx - 17, cy - 8, 34, 18); }   // 집 무리 아래 흙마당 (도로와 헷갈리지 않게 길은 안 그려요)
  for (const [x, y] of scatter(r, 16, 17, centers, 16)) house(pen, x - 7, y - 5, Math.floor(r() * 4));
  field(pen, 70 + Math.floor(r() * 20), 70, 16, 10);
  for (const [x, y] of scatter(r, 10, 14)) sprite(pen, x - 4, y - 4, r() < 0.6 ? TREE_S : BUSH, P);
};
const commercial = (pen: Pen, r: () => number) => {
  ground(pen, r, '#CFC8B8', ['#C3BCAC', '#D9D3C5'], 260);
  for (let i = 0; i < T; i += 16) { pen('#C2BBAA')(i, 0, 1, T); pen('#C2BBAA')(0, i, T, 1); }
  for (const [cx, cy] of [[20, 14], [52, 14], [84, 14], [116, 14], [20, 78], [52, 78], [100, 70]] as [number, number][]) if (r() < 0.9) sprite(pen, cx - 7, cy - 4, BLOCK, BLOCK_PALS[Math.floor(r() * BLOCK_PALS.length)]);
  for (const [cx, cy] of [[20, 44], [84, 46], [36, 108], [68, 104], [108, 108]] as [number, number][]) if (r() < 0.8) sprite(pen, cx - 7, cy - 4, BLOCK, BLOCK_PALS[Math.floor(r() * BLOCK_PALS.length)]);
  for (const [x, y] of scatter(r, 8, 20)) sprite(pen, x - 4, y - 4, TREE_S, P);   // 광장 나무
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
