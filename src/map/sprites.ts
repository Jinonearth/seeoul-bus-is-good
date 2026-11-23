// 헥사곤 지형 무늬: 작고 촘촘한 픽셀 아트. 옛 휴대용 게임기 RPG·농장 게임 같은 위에서 본 마을 느낌만 빌리고,
// 모양·색은 모두 새로 그렸어요. 16×16(나무·집)과 8×8(풀·꽃) 그림을 64×64 무늬 타일에 빽빽하게 모아,
// 헥사곤 면을 fill-pattern으로 채워요. 그림은 논리 픽셀 1칸 = 화면 1 CSS px (기기 픽셀 PR배, 보간 없음).
// 규칙: 1px 테두리는 검정이 아니라 그 물체의 가장 어두운 색, 밝기 3~4단, 빛은 왼쪽 위, 오른쪽 아래로 작은 그림자.
import type { Map as MLMap } from 'maplibre-gl';

const T = 64, PR = 2;
type Px = (x: number, y: number, w?: number, h?: number) => void;
type Pen = (c: string) => Px;

function canvasTile(draw: (pen: Pen, rnd: () => number) => void, seed: number) {
  const c = document.createElement('canvas'); c.width = c.height = T * PR;
  const g = c.getContext('2d')!; g.imageSmoothingEnabled = false;
  // 무늬 가장자리를 넘는 그림은 반대편에서 이어져요(이음매 없이 반복)
  const pen: Pen = col => (x, y, w = 1, h = 1) => { g.fillStyle = col; for (const dx of [0, -T, T]) for (const dy of [0, -T, T]) g.fillRect((Math.round(x) + dx) * PR, (Math.round(y) + dy) * PR, w * PR, h * PR); };
  draw(pen, rng(seed));
  return g.getImageData(0, 0, c.width, c.height);
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 문자열 모양 그리기: 글자마다 색 (공백 = 비움)
function sprite(pen: Pen, x: number, y: number, rows: string[], pal: Record<string, string>) {
  rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) { const k = row[i]; if (k !== ' ' && pal[k]) pen(pal[k])(x + i, y + j); } });
}

// ── 땅 무늬 ──
function ground(pen: Pen, r: () => number, base: string, specks: string[], n: number) {
  pen(base)(0, 0, T, T);
  for (let i = 0; i < n; i++) pen(specks[Math.floor(r() * specks.length)])(Math.floor(r() * T), Math.floor(r() * T), r() < 0.3 ? 2 : 1, 1);
}

// ── 나무 (16×16) ── o 테두리, d 어두운 잎, m 잎, l 밝은 잎, h 빛, t·u 줄기, s 그림자
const TREE_PAL = { o: '#2D5527', d: '#3F7634', m: '#559B42', l: '#73BA55', h: '#A3DB78', t: '#6B4A2B', u: '#4A3220', s: 'rgba(24,48,22,0.32)' };
const TREE_ROUND = [
  '    oooooo      ',
  '  oolllmmmoo    ',
  ' olhhllmmmddo   ',
  ' olhllmmmmddo   ',
  'ollllmmmmmdddo  ',
  'olllmmmmmmdddo  ',
  'olmmmmmmmdddddo ',
  'odmmmmmmdddddo s',
  ' odmmmmddddddoss',
  ' oddddddddddooss',
  '  oodddddddoo ss',
  '    ooouoooo sss',
  '      utu   sss ',
  '      utu  ss   ',
  '       u        '];
const TREE_SMALL = [
  '   oooo   ',
  '  olhlmo  ',
  ' olllmmdo ',
  ' olmmmddos',
  ' odmmdddos',
  '  oddddoss',
  '   oouos s',
  '    ut ss ',
  '    u     '];
const PINE = [
  '     oo     ',
  '    olmo    ',
  '   olmmdo   ',
  '   olmmdo   ',
  '  olhmmddo  ',
  '  olmmmddo  ',
  ' olhmmmmddo ',
  ' olmmmmdddos',
  'odmmmmmddddo',
  ' ooddddddoos',
  '   oouuoo ss',
  '     tu  ss '];
// ── 풀·꽃·덤불 (8×8) ──
const TUFT = ['  g  g  ', ' gG gG  ', ' GgGgG  ', '  GGG   '];
const FLOWER = ['  p     ', ' pyp    ', '  p g   ', '   gG   '];
const BUSH = ['  oooo  ', ' olhmdo ', 'olmmmddo', 'odmmddds', ' ooddoss', '   ss   '];

// ── 집 (16×12) ── R 지붕 밝음, r 지붕, q 지붕 어두움, x 지붕 테두리, w 벽, v 벽 그늘, n 벽 테두리, D 문, W 창
const ROOFS = [
  { R: '#E58C6A', r: '#C9654A', q: '#A44E39', x: '#7A3526' },   // 테라코타
  { R: '#D97B76', r: '#B9554F', q: '#953F3B', x: '#6E2C29' },   // 붉은 기와
  { R: '#7FB8B4', r: '#5A9792', q: '#467B77', x: '#2F5755' },   // 청록
  { R: '#EDC874', r: '#D2A24C', q: '#AE8035', x: '#7E5B22' },   // 황토
];
const HOUSE = [
  '  xxxxxxxxxx    ',
  ' xRRRRRRRRRRx   ',
  'xRRRRRRRRRRRrx  ',
  'xrrrrrrrrrrrqx  ',
  'xrrrrrrrrrrrqxs ',
  'xqqqqqqqqqqqqxs ',
  ' xxxxxxxxxxxx ss',
  ' nwwwwwwwwwwvn s',
  ' nwWWwwDDwwWvns ',
  ' nwWWwwDDwwWvns ',
  ' nnnnnnDDnnnnns ',
  '   ssssssssssss '];
// ── 상업 건물 (16×12) ── a 옥상 밝음, b 옥상, c 옥상 어두움, e 테두리, A 실외기, B 실외기 테두리, G 유리
const BLOCK = [
  'eeeeeeeeeeeeee  ',
  'eaaaaaaaaaaabe  ',
  'eabbbbbbbbbbce  ',
  'eabAAbbbbbbbce  ',
  'eabBBbbbbGGbces ',
  'eabbbbbbbGGbces ',
  'eabbbbbbbbbbces ',
  'eabbbbAAbbbbces ',
  'eabbbbBBbbbbces ',
  'eacccccccccccces',
  'eeeeeeeeeeeeeess',
  '  ssssssssssssss'];
const BLOCK_PALS = [
  { a: '#DCDAD6', b: '#C3C0BA', c: '#A6A39D', e: '#7A7772', A: '#EFEFEC', B: '#8E8C88', G: '#9EC4D4', s: 'rgba(30,30,40,0.30)' },
  { a: '#D9D3C6', b: '#C1B8A6', c: '#A39A88', e: '#776F61', A: '#EFEDE6', B: '#8C8578', G: '#A6C9C2', s: 'rgba(30,30,40,0.30)' },
  { a: '#CFD5DA', b: '#B3BCC4', c: '#97A1AA', e: '#68717A', A: '#EEF1F3', B: '#848C93', G: '#AFCFDE', s: 'rgba(30,30,40,0.30)' },
];
// ── 창고 (30×9): 골함석 ──
function shed(pen: Pen, x: number, y: number, light: string, mid: string, dark: string, edge: string) {
  pen('rgba(30,40,40,0.28)')(x + 2, y + 2, 30, 9);
  pen(edge)(x, y, 30, 9); pen(mid)(x + 1, y + 1, 28, 7);
  for (let i = 1; i < 29; i += 2) pen(light)(x + i, y + 1, 1, 7);
  pen(dark)(x + 1, y + 7, 28, 1); pen(light)(x + 1, y + 1, 28, 1);
}

// 격자 자리마다 살짝 흔들어 놓기 (위에서 아래로 그려 겹침이 자연스럽게)
function lattice(r: () => number, step: number, jitter: number, offRow = 0.5) {
  const pts: [number, number][] = [];
  for (let row = 0; row * step < T; row++) for (let col = 0; col * step < T; col++) pts.push([col * step + (row & 1 ? step * offRow : 0) + (r() - 0.5) * jitter, row * step + (r() - 0.5) * jitter]);
  return pts.sort((a, b) => a[1] - b[1]);
}

function forest(pen: Pen, r: () => number) {
  ground(pen, r, '#6FA34E', ['#5E9443', '#7FB45A', '#548A3C'], 260);
  for (const [x, y] of lattice(r, 10, 4)) { const k = r(); if (k < 0.5) sprite(pen, x - 7, y - 7, TREE_ROUND, TREE_PAL); else if (k < 0.8) sprite(pen, x - 6, y - 7, PINE, TREE_PAL); else sprite(pen, x - 5, y - 4, TREE_SMALL, TREE_PAL); }
}
function park(pen: Pen, r: () => number) {
  ground(pen, r, '#9ACB6C', ['#8BBE5E', '#AEDB82', '#86B85A'], 320);
  for (const [x, y] of lattice(r, 9, 7)) {
    const k = r();
    if (k < 0.12) sprite(pen, x - 7, y - 7, TREE_ROUND, TREE_PAL);
    else if (k < 0.2) sprite(pen, x - 4, y - 3, BUSH, TREE_PAL);
    else if (k < 0.55) sprite(pen, x - 3, y - 3, TUFT, { g: '#6FA54C', G: '#4F8636' });
    else if (k < 0.75) sprite(pen, x - 2, y - 2, FLOWER, { p: r() < 0.5 ? '#F28FB3' : '#F6F0F2', y: '#F2C94E', g: '#5F9A43', G: '#4F8636' });
  }
}
function houses(pen: Pen, r: () => number) {
  ground(pen, r, '#C9C28F', ['#B9B47F', '#D6CF9E', '#A9C27A'], 220);   // 마당 흙·풀
  for (const [x, y] of lattice(r, 16, 2, 0.5)) {
    const pal = ROOFS[Math.floor(r() * ROOFS.length)];
    pen('#B49E78')(x - 8, y + 6, 16, 1);   // 울타리
    sprite(pen, x - 8, y - 6, HOUSE, { ...pal, w: '#F1E6CC', v: '#D5C6A6', n: '#9C8A6A', D: '#7A5236', W: '#8FC1D4', s: 'rgba(40,30,20,0.25)' });
  }
}
function city(pen: Pen, r: () => number) {
  ground(pen, r, '#C9C6BE', ['#BDBAB2', '#D4D1CA'], 160);   // 포장
  for (let i = 0; i < T; i += 8) { pen('#BFBCB4')(i, 0, 1, T); pen('#BFBCB4')(0, i, T, 1); }   // 보도블록 줄
  for (const [x, y] of lattice(r, 16, 1, 0)) sprite(pen, x - 7, y - 6, BLOCK, BLOCK_PALS[Math.floor(r() * BLOCK_PALS.length)]);
}
function industry(pen: Pen, r: () => number) {
  ground(pen, r, '#BFC3BE', ['#B2B6B1', '#CBCFCA'], 160);
  for (let row = 0; row < 4; row++) {
    const off = Math.floor(r() * 32), blue = r() < 0.5;
    shed(pen, off, row * 16 + 3, blue ? '#A4BAC4' : '#A9C0A6', blue ? '#8AA2AE' : '#8EA690', blue ? '#6F8794' : '#728A74', blue ? '#4F6470' : '#526A55');
    shed(pen, off + 32, row * 16 + 3, '#A4BAC4', '#8AA2AE', '#6F8794', '#4F6470');
  }
}
function bare(pen: Pen, r: () => number) {
  ground(pen, r, '#D3CDB4', ['#C6BFA3', '#DDD8C2', '#B9C493'], 200);
  for (const [x, y] of lattice(r, 16, 10)) if (r() < 0.35) sprite(pen, x - 3, y - 3, TUFT, { g: '#8DB063', G: '#6F9150' });
}

const DRAW: Record<string, (pen: Pen, r: () => number) => void> = { f: forest, g: park, r: houses, c: city, i: industry, o: bare };
export const VARIANTS = 3;
export function addTerrainPatterns(m: MLMap) {
  for (const [k, f] of Object.entries(DRAW)) for (let v = 0; v < VARIANTS; v++) {
    const id = `pat-${k}-${v}`;
    if (!m.hasImage(id)) m.addImage(id, canvasTile(f, k.charCodeAt(0) * 131 + v * 977), { pixelRatio: PR });
  }
}
