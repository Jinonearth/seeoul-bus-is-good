// 땅 쓰임 무늬: 직접 그린 작은 픽셀 그림 (32×32 타일, 반복). 숲은 나무가 빽빽하게, 공원은 드문드문,
// 주거는 작은 집 지붕, 상업은 키 큰 건물 옥상, 공업은 긴 창고 지붕. 모두 흐린 색이라 망점·노선·버스가 먼저 보여요.
import type { Map as MLMap } from 'maplibre-gl';

const S = 32;
type Px = (x: number, y: number, w: number, h: number, c: string) => void;

function tile(draw: (px: Px) => void) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  draw((x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); });
  return g.getImageData(0, 0, S, S);
}

// 나무 세 가지: 둥근 수관(어두운 테두리 + 밝은 빛), 줄기 한 점
const TREE_DARK = '#86A872', TREE = '#9CBC86', TREE_LIGHT = '#B4CE9E', TRUNK = '#A08A6C';
function tree(px: Px, x: number, y: number, kind: number) {
  if (kind === 0) {        // 작은 둥근 나무 5×5
    px(x + 1, y, 3, 1, TREE_DARK); px(x, y + 1, 5, 3, TREE_DARK); px(x + 1, y + 4, 3, 1, TREE_DARK);
    px(x + 1, y + 1, 3, 3, TREE); px(x + 1, y + 1, 1, 1, TREE_LIGHT); px(x + 2, y + 5, 1, 1, TRUNK);
  } else if (kind === 1) { // 뾰족한 나무
    px(x + 2, y, 1, 1, TREE_DARK); px(x + 1, y + 1, 3, 2, TREE_DARK); px(x, y + 3, 5, 2, TREE_DARK);
    px(x + 2, y + 1, 1, 3, TREE); px(x + 2, y + 5, 1, 1, TRUNK);
  } else {                 // 큰 둥근 나무 6×6
    px(x + 1, y, 4, 1, TREE_DARK); px(x, y + 1, 6, 4, TREE_DARK); px(x + 1, y + 5, 4, 1, TREE_DARK);
    px(x + 1, y + 1, 4, 3, TREE); px(x + 1, y + 1, 2, 1, TREE_LIGHT); px(x + 3, y + 6, 1, 1, TRUNK);
  }
}

export function addLandSprites(m: MLMap) {
  const add = (id: string, d: ImageData) => { if (!m.hasImage(id)) m.addImage(id, d); };
  add('pat-forest', tile(px => {
    const T: [number, number, number][] = [[2, 2, 2], [12, 1, 0], [21, 3, 1], [27, 10, 0], [6, 11, 1], [16, 12, 2], [1, 20, 0], [10, 22, 2], [20, 21, 1], [26, 25, 0], [14, 28, 0]];
    for (const [x, y, k] of T) tree(px, x % S, y % S, k);
  }));
  add('pat-green', tile(px => {
    tree(px, 4, 5, 0); tree(px, 20, 18, 2);
    for (const [x, y] of [[14, 6], [26, 4], [8, 24], [28, 28], [16, 14]]) { px(x, y, 1, 2, '#B9CDA4'); px(x + 2, y + 1, 1, 1, '#B9CDA4'); }   // 풀
  }));
  add('pat-res', tile(px => {
    // 작은 집: 지붕 + 처마 그림자 (지붕색 세 가지)
    const H: [number, number, string][] = [[3, 4, '#D3B7A0'], [17, 3, '#C6B6A6'], [9, 17, '#C9BCA6'], [23, 18, '#D3B7A0'], [2, 27, '#C6B6A6']];
    for (const [x, y, c] of H) { px(x, y, 8, 5, c); px(x, y + 2, 8, 1, '#BBA48E'); px(x, y + 5, 8, 1, '#D8CDBC'); }
  }));
  add('pat-com', tile(px => {
    // 키 큰 건물 옥상: 회청색 사각 + 옥상 설비 점 + 그림자
    const B: [number, number, number, number][] = [[2, 2, 11, 9], [17, 3, 12, 12], [4, 17, 9, 12], [18, 20, 10, 9]];
    for (const [x, y, w, h] of B) { px(x + 1, y + h, w, 1, '#CFC9BE'); px(x + w, y + 1, 1, h, '#CFC9BE'); px(x, y, w, h, '#C9C6CF'); px(x + 2, y + 2, 2, 2, '#B9B5C0'); px(x + w - 4, y + h - 4, 2, 2, '#B9B5C0'); }
  }));
  add('pat-ind', tile(px => {
    // 긴 창고 지붕: 줄무늬
    for (const [x, y] of [[2, 3], [4, 18]]) { px(x, y, 24, 9, '#CDCAC1'); for (let i = 0; i < 24; i += 3) px(x + i, y, 1, 9, '#C2BFB5'); px(x, y + 9, 24, 1, '#D7D4CB'); }
  }));
}
