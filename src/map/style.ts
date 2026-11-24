// B "인쇄 노선도" 기본 지도: 종이 바탕, 한강, 도로(줌 단계별), 구·동 경계, 라벨
import type { StyleSpecification } from 'maplibre-gl';

export const INK = '#1D1D1B', PAPER = '#F3F1EA', GROUND = '#ECE8DC', WATER = '#BCD6E6', PINK = '#FF48B0';

export const ROAD = '#E2D6B6', ROAD_EDGE = '#A8946C';   // 도로는 모두 한 색(따뜻한 흙길 빛), 크기는 너비로만

export function baseStyle(tilesUrl: string, landUrl: string): StyleSpecification {
  return {
    version: 8,
    // 한글은 기기 글꼴로 그림(localIdeographFontFamily), 숫자·로마자만 글리프 서버에서
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      seoul: { type: 'vector', url: `pmtiles://${tilesUrl}`, attribution: '도로 국토교통부 표준노드링크 · 경계 admdongkor (CC BY 4.0) · 수요 서울시 TOPIS' },
      land: { type: 'vector', url: `pmtiles://${landUrl}`, attribution: '땅 쓰임 © OpenStreetMap 기여자 (ODbL)' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': GROUND } },
      { id: 'river', type: 'line', source: 'seoul', 'source-layer': 'river',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // 한강 폭 약 1km를 줌에 맞춰 픽셀로
        paint: { 'line-color': WATER, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 3, 12, 22, 15, 180] } },
      // 도로: 아스팔트. 줌 13 아래는 굵게 부풀린 선, 13부터는 방향별 차로를 합친 면(land.pmtiles road_area) + 짙은 가장자리
      { id: 'road-case', type: 'line', source: 'seoul', 'source-layer': 'road', maxzoom: 13,
        filter: ['step', ['zoom'], ['==', ['get', 'class'], 0], 11, ['<=', ['get', 'class'], 1], 12, ['<=', ['get', 'class'], 2], 13, true],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['-', 3, ['get', 'class']] },
        paint: { 'line-color': ROAD_EDGE, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 0, 3.2, 1, 2.4, 1.6], 13, ['match', ['get', 'class'], 0, 7, 1, 5.5, 2, 4, 3]] } },
      { id: 'road', type: 'line', source: 'seoul', 'source-layer': 'road', maxzoom: 13,
        filter: ['step', ['zoom'], ['==', ['get', 'class'], 0], 11, ['<=', ['get', 'class'], 1], 12, ['<=', ['get', 'class'], 2], 13, true],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['-', 3, ['get', 'class']] },
        paint: { 'line-color': ROAD, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 0, 2, 1, 1.5, 1], 13, ['match', ['get', 'class'], 0, 5.5, 1, 4.2, 2, 3, 2.2]] } },
      { id: 'road-area-edge', type: 'line', source: 'land', 'source-layer': 'road_area', minzoom: 13,
        paint: { 'line-color': ROAD_EDGE, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 15, 1.4] } },
      { id: 'road-area', type: 'fill', source: 'land', 'source-layer': 'road_area', minzoom: 13,
        paint: { 'fill-color': ROAD } },
      { id: 'dong-line', type: 'line', source: 'seoul', 'source-layer': 'dong', minzoom: 11,
        paint: { 'line-color': '#8A867C', 'line-opacity': 0.6, 'line-width': 1, 'line-dasharray': [3, 3] } },
      { id: 'gu-line', type: 'line', source: 'seoul', 'source-layer': 'gu',
        paint: { 'line-color': '#4A4A4A', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 13, 2.4] } },
    ],
  };
}

// 라벨은 헥사곤·노선 위에 올라가야 해서 따로 추가
export const labelLayers = [
  { id: 'label-gu', type: 'symbol', source: 'seoul', 'source-layer': 'label_gu', maxzoom: 12.5,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 12, 15] },
    paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 2 } },
  { id: 'label-dong', type: 'symbol', source: 'seoul', 'source-layer': 'label_dong', minzoom: 12.5,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 12 },
    paint: { 'text-color': '#3A362F', 'text-halo-color': PAPER, 'text-halo-width': 2 } },
] as const;
