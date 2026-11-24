// 기본 지도: 요즘 웹 지도처럼 깔끔하게 (참고한 지도에서 색만 뽑아 우리 데이터로 다시 그렸어요).
// 밝은 회백색 땅, 연초록 녹지, 옅은 파랑 물, 흰 도로 + 회청색 테두리(등급별 너비), 옅은 구·동 경계, 짙은 회색 글자
import type { StyleSpecification } from 'maplibre-gl';

export const INK = '#1D1D1B', PAPER = '#F3F1EA', GROUND = '#ECE8DC', WATER = '#BCD6E6', PINK = '#FF48B0';

// 뽑은 색: 땅 #F5F5F3, 주거 #F1EEEA, 상업 #F4F2EF, 공원 #DCEDC9, 숲 #D5E9C8, 도로 #FFFFFF, 도로 테두리 #D6DBDD, 글자 #2A3038
export const MAP = { land: '#F5F5F3', res: '#F1EEEA', com: '#F4F2EF', ind: '#EEEFEF', park: '#DCEDC9', forest: '#D3E7C4', water: '#CDE3EE', road: '#FFFFFF', roadEdge: '#D6DBDD', major: '#FFFFFF', majorEdge: '#C9CFD3', text: '#2A3038' };

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
      { id: 'bg', type: 'background', paint: { 'background-color': MAP.land } },
      // 땅 쓰임 (OSM 면): 녹지·숲은 연초록, 주거·상업·공업은 바탕보다 아주 조금 다른 회백색
      { id: 'land', type: 'fill', source: 'land', 'source-layer': 'land',
        paint: { 'fill-color': ['match', ['get', 'class'], 'forest', MAP.forest, 'green', MAP.park, 'res', MAP.res, 'com', MAP.com, MAP.ind] } },
      { id: 'river', type: 'line', source: 'seoul', 'source-layer': 'river',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // 한강 폭 약 1km를 줌에 맞춰 픽셀로
        paint: { 'line-color': MAP.water, 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 9, 3, 12, 22, 15, 180] } },
      // 도로: 흰 채움 + 회청색 테두리, 등급별 너비 (큰 길이 굵게). 줌 13 아래는 선, 13부터는 방향별 차로를 합친 면
      { id: 'road-case', type: 'line', source: 'seoul', 'source-layer': 'road', maxzoom: 13,
        filter: ['step', ['zoom'], ['==', ['get', 'class'], 0], 11, ['<=', ['get', 'class'], 1], 12, ['<=', ['get', 'class'], 2], 13, true],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['-', 3, ['get', 'class']] },
        paint: { 'line-color': ['match', ['get', 'class'], 0, MAP.majorEdge, 1, MAP.majorEdge, MAP.roadEdge], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 0, 3, 1, 2.2, 1.4], 13, ['match', ['get', 'class'], 0, 7, 1, 5.5, 2, 4, 3]] } },
      { id: 'road', type: 'line', source: 'seoul', 'source-layer': 'road', maxzoom: 13,
        filter: ['step', ['zoom'], ['==', ['get', 'class'], 0], 11, ['<=', ['get', 'class'], 1], 12, ['<=', ['get', 'class'], 2], 13, true],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['-', 3, ['get', 'class']] },
        paint: { 'line-color': MAP.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'class'], 0, 1.8, 1, 1.2, 0.7], 13, ['match', ['get', 'class'], 0, 5.5, 1, 4.2, 2, 3, 2.2]] } },
      { id: 'road-area-edge', type: 'line', source: 'land', 'source-layer': 'road_area', minzoom: 13,
        paint: { 'line-color': ['match', ['get', 'class'], 0, MAP.majorEdge, 1, MAP.majorEdge, MAP.roadEdge], 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 16, 1.6] } },
      { id: 'road-area', type: 'fill', source: 'land', 'source-layer': 'road_area', minzoom: 13,
        paint: { 'fill-color': MAP.road } },
      // 경계: 참고 지도처럼 옅게 (게임에 필요해서 보이게는 둬요)
      { id: 'dong-line', type: 'line', source: 'seoul', 'source-layer': 'dong', minzoom: 11,
        paint: { 'line-color': '#B8BEC4', 'line-opacity': 0.8, 'line-width': 1, 'line-dasharray': [3, 3] } },
      { id: 'gu-line', type: 'line', source: 'seoul', 'source-layer': 'gu',
        paint: { 'line-color': '#8C949B', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 13, 1.8] } },
    ],
  };
}

// 라벨은 헥사곤·노선 위에 올라가야 해서 따로 추가
export const labelLayers = [
  { id: 'label-gu', type: 'symbol', source: 'seoul', 'source-layer': 'label_gu', maxzoom: 12.5,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 12, 15] },
    paint: { 'text-color': MAP.text, 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 } },
  { id: 'label-dong', type: 'symbol', source: 'seoul', 'source-layer': 'label_dong', minzoom: 12.5,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 12 },
    paint: { 'text-color': '#5B636B', 'text-halo-color': '#FFFFFF', 'text-halo-width': 2 } },
] as const;
