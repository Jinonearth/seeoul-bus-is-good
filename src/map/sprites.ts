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
export function path(pen: Pen, r: () => number, x0: number, y0: number, len: number, horiz: boolean) {
  let x = x0, y = y0;
  for (let i = 0; i < len; i++) {
    pen('#B39A6A')(x - 1, y - 1, horiz ? 1 : 4, horiz ? 4 : 1); pen('#D9C38F')(x, y, horiz ? 1 : 3, horiz ? 3 : 1); pen('#E6D3A3')(x, y, 1, 1);
    if (horiz) { x++; if (r() < 0.15) y += r() < 0.5 ? 1 : -1; } else { y++; if (r() < 0.15) x += r() < 0.5 ? 1 : -1; }
  }
}
const GRASS = ['#7FB451', '#8DC05C', '#73A847', '#9ACB68'];

// ── 지형 무늬 ──
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

// ════ 줌별 무늬 ════
// 멀리서(줌 11–13.5): 전략 지도처럼 납작한 색 면 위에 작은 기호(나무·건물·풀)를 고르고 촘촘하게. 기호 크기는 화면에서 늘 같아요.
// 가까이(줌 14·15·16): 실제 크기 픽셀 아트. 아파트 60–100 m, 빌라 15 m, 업무 빌딩 30–60 m, 나무 수관 7 m를
// 그 줌의 미터/픽셀(MPP)로 바꿔 그려서, 줌을 당기면 지도처럼 커지고 멀어지면 촘촘해져요. (fill-pattern은 화면 픽셀 고정이라 줌마다 따로 구워요)
export const MPP: Record<number, number> = { 14: 7.58, 15: 3.79, 16: 1.89 };   // 위도 37.55° 미터/CSS px
const KINDS = ['f', 'f-edge', 'g', 'g-edge', 'r', 'r-edge', 'c', 'c-edge', 'i', 'i-edge', 'o', 'o-edge'];

// 나무 한 그루 (지름 d px): 1px는 점, 2px는 빛·그늘 2×2, 3px 이상은 둥근 수관 + 테두리 + 왼쪽 위 빛
function blob(pen: Pen, x: number, y: number, d: number) {
  if (d <= 1) { pen(P.m)(x, y); return; }
  if (d === 2) { pen(P.l)(x, y); pen(P.m)(x + 1, y); pen(P.d)(x, y + 1); pen(P.o)(x + 1, y + 1); return; }
  const r = d / 2;
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
    const dx = i + 0.5 - r, dy = j + 0.5 - r, q = dx * dx + dy * dy;
    if (q > r * r) continue;
    const edge = q > (r - 1) * (r - 1);
    pen(edge ? P.o : dx + dy < -r * 0.4 ? P.h : dx + dy < 0 ? P.l : dx + dy < r * 0.6 ? P.m : P.d)(x + i, y + j);
  }
  pen(P.s)(x + d, y + Math.round(r), 1, Math.round(r));
}
// 실제 크기 건물 (미터 → px). 작으면 옥상 + 벽 한 줄 + 그림자만
function bldM(pen: Pen, mpp: number, xm: number, ym: number, wm: number, dm: number, hm: number, c: Bld, glass = false) {
  const x = xm / mpp, y = ym / mpp, w = Math.max(1, Math.round(wm / mpp)), d = Math.max(1, Math.round(dm / mpp)), h = Math.max(1, Math.round(hm * 0.32 / mpp));
  if (w >= 8 && d + h >= 6) { building(pen, x, y, w, d, h, c, glass); return; }
  pen('rgba(25,30,25,0.30)')(x + 1, y + 1, w, d + h);
  pen(c.roof)(x, y, w, d); pen(c.wallSh)(x, y + d, w, h);
}
function grassGround(pen: Pen, r: () => number, base = '#93C063', n = 340) { ground(pen, r, base, GRASS, n); }

// 실제 크기 무늬 하나 (타일 = 128 px = 128·mpp 미터)
function realTile(kind: string, mpp: number) {
  const W = T * mpp;   // 타일 한 변 미터
  return (pen: Pen, r: () => number) => {
    const trees = (n: number, gapM: number, size = 7) => { for (const [x, y] of scatter(r, n, gapM / mpp)) blob(pen, x, y, Math.max(1, Math.round((size + (r() - 0.5) * 3) / mpp))); };
    const area = (perHa: number) => Math.round(perHa * (W * W) / 10000);   // 헥타르당 개수 → 타일 안 개수
    switch (kind) {
      case 'f': ground(pen, r, '#3E7330', ['#356629', '#4A8238'], 400); trees(Math.min(2500, area(220)), 5.5); break;
      case 'f-edge': grassGround(pen, r, '#86BA57'); trees(Math.min(800, area(30)), 12); break;
      case 'g': grassGround(pen, r, '#8EC25E'); trees(Math.min(600, area(15)), 14, 9); break;
      case 'o': case 'o-edge': grassGround(pen, r, '#A3C873', 260); trees(Math.min(300, area(4)), 25); break;
      case 'r': {
        grassGround(pen, r);
        // 아파트 단지 (가로 180 m × 세로 160 m 칸): 판상형 동 두 줄 × 세 줄, 동 사이 녹지·주차장. 남은 칸은 빌라 골목
        for (let by = 0; by < W; by += 160) for (let bx = 0; bx < W; bx += 180) {
          if (r() < 0.7) {
            for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
              const L = 60 + r() * 30, H = (12 + Math.floor(r() * 10)) * 2.8, c = APT[Math.floor(r() * APT.length)];
              bldM(pen, mpp, bx + 10 + col * 88, by + 10 + row * 50, L, 13, H, c);
              if (r() < 0.5) { const px = (bx + 12 + col * 88) / mpp, py = (by + 34 + row * 50 + H * 0.32) / mpp; pen('#A9A79F')(px, py, Math.max(1, Math.round(50 / mpp)), Math.max(1, Math.round(8 / mpp))); }
            }
            for (const [x, y] of scatter(r, 6, 20 / mpp, [[(bx + 90) / mpp, (by + 80) / mpp]], 70 / mpp)) blob(pen, x, y, Math.max(1, Math.round(7 / mpp)));
          } else {
            pen('#C9C2AE')(bx / mpp, by / mpp, 180 / mpp, 160 / mpp);   // 빌라 골목 바닥
            for (let yy = 6; yy < 150; yy += 22) for (let xx = 6; xx < 170; xx += 19) if (r() < 0.85) bldM(pen, mpp, bx + xx + (r() - 0.5) * 3, by + yy, 14 + r() * 4, 10, (3 + Math.floor(r() * 2)) * 3, VILLA[Math.floor(r() * VILLA.length)]);
          }
        }
        break;
      }
      case 'c': {
        ground(pen, r, '#CFC8B8', ['#C3BCAC', '#D9D3C5'], 260);
        for (let by = 0; by < W; by += 90) for (let bx = 0; bx < W; bx += 90) {
          if (r() < 0.15) { for (const [x, y] of scatter(r, 3, 12 / mpp, [[(bx + 45) / mpp, (by + 45) / mpp]], 30 / mpp)) blob(pen, x, y, Math.max(1, Math.round(7 / mpp))); continue; }   // 광장
          const t = TOWER[Math.floor(r() * TOWER.length)], s2 = 30 + r() * 30;
          bldM(pen, mpp, bx + 8 + r() * 10, by + 6, s2, s2 * 0.6, 40 + r() * 110, t, t !== TOWER[2]);
        }
        break;
      }
      case 'i': {
        ground(pen, r, '#BFC3BC', ['#B1B5AE', '#CBCFC8'], 220);
        const shedC: Bld = { roof: '#8AA2AE', roofHi: '#A4BAC4', edge: '#4F6470', wall: '#D6D1C4', wallSh: '#B9B3A4', win: '#6F8794' };
        for (let by = 0; by < W; by += 60) for (let bx = 0; bx < W; bx += 110) if (r() < 0.8) bldM(pen, mpp, bx + 6, by + 6, 80 + r() * 20, 30, 12, shedC);
        break;
      }
      default: grassGround(pen, r); trees(Math.min(300, area(6)), 20, 6);   // 다른 지형 둘레 띠
    }
  };
}

// 멀리서 보는 기호 무늬 (화면 고정 크기): 납작한 색 + 고르게 흩은 작은 기호
const FLAT: Record<string, string> = { f: '#6F9C55', g: '#A8CE7C', r: '#D8CDB3', c: '#CFC6B8', i: '#C2C6C2', o: '#C5D6A2' };
const ICON_TREE = [' o ', 'olm', 'odd', ' t '];
const ICON_HOUSE = ['xx', 'ww'];
const ICON_TOWER = ['xx', 'gg', 'ww', 'ww'];
const ICON_SHED = ['xxxx', 'wwww'];
const ICON_GRASS = ['g g', ' g '];
function strategicTile(kind: string) {
  const t = kind.replace('-edge', ''), edge = kind.endsWith('-edge');
  return (pen: Pen, r: () => number) => {
    pen(edge ? FLAT.o : FLAT[t] ?? FLAT.o)(0, 0, T, T);
    const step = { f: 6, g: 9, r: 6, c: 6, i: 9, o: 14 }[t] ?? 10, keep = edge ? 0.25 : 1;
    for (let y = 0; y < T; y += step) for (let x = 0; x < T; x += step) {
      if (r() > keep * (t === 'o' ? 0.5 : 0.95)) continue;
      const px = x + ((y / step) & 1 ? step / 2 : 0) + Math.floor(r() * 2), py = y + Math.floor(r() * 2);
      if (t === 'f' || (edge && t === 'f')) sprite(pen, px, py, ICON_TREE, { o: '#2F5A27', l: '#6FAE52', m: '#4F8A3B', d: '#3B6E2F', t: '#6B4A2B' });
      else if (t === 'g' || t === 'o') sprite(pen, px, py, r() < 0.3 ? ICON_TREE : ICON_GRASS, { o: '#3B6E2F', l: '#7FBA5C', m: '#5E9A44', d: '#4B8238', t: '#6B4A2B', g: '#7BAA55' });
      else if (t === 'r') sprite(pen, px, py, ICON_HOUSE, { x: '#B7AC96', w: '#8E8371' });
      else if (t === 'c') sprite(pen, px, py, ICON_TOWER, { x: '#B3B9BE', g: '#86A0B2', w: '#6E7E8A' });
      else if (t === 'i') sprite(pen, px, py, ICON_SHED, { x: '#9FB0B8', w: '#76858C' });
    }
  };
}

export function addTerrainPatterns(m: MLMap) {
  const seed = (k: string) => [...k].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  for (const k of KINDS) {
    const add = (id: string, f: (pen: Pen, r: () => number) => void) => { if (!m.hasImage(id)) m.addImage(id, canvasTile(f, seed(id)), { pixelRatio: PR }); };
    add(`pat-${k}-s`, strategicTile(k));
    for (const z of Object.keys(MPP)) add(`pat-${k}-z${z}`, realTile(k, MPP[+z]));
  }
}
