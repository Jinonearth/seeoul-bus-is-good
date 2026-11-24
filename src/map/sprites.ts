// 전략 지도 같은 판(보드) 바탕: 헥사곤 하나하나가 지형 색의 납작한 타일이고, 안에는 손으로 그린 듯한 옅은 무늬만.
// 전략 게임 2D 지도의 바탕 개념만 빌리고 모양·색은 인쇄 노선도 톤(종이, 먹, 옅은 단색)으로 새로 그렸어요.
// 숲 = 작은 나무 갓 낙서, 산 = 숲 + 봉우리 선, 녹지 = 풀 점묘, 주거 = 가는 블록 격자, 상업 = 더 촘촘한 격자, 공업 = 빗금, 빈 땅 = 드문 점.
// 무늬 색은 타일 색보다 조금만 짙어서 차분하고, 지형은 색이 아니라 무늬 모양으로도 구분돼요.
import type { Map as MLMap } from 'maplibre-gl';

export const TERRAIN_COLOR: Record<string, string> = { f: '#B4C79D', m: '#A9BD93', g: '#D2E2B4', r: '#EBDFC2', c: '#E8CFB8', i: '#CDD4D8', o: '#E3E3C6' };
const INKS: Record<string, string> = { f: '#7E9A66', m: '#71895C', g: '#97B579', r: '#C4B38F', c: '#BE9D82', i: '#98A4AC', o: '#B9BC92' };
const S = 48, PR = 2;

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
type G = CanvasRenderingContext2D;
function tile(k: string, draw: (g: G, r: () => number) => void) {
  const c = document.createElement('canvas'); c.width = c.height = S * PR;
  const g = c.getContext('2d')!; g.scale(PR, PR);
  g.fillStyle = TERRAIN_COLOR[k]; g.fillRect(0, 0, S, S);
  g.strokeStyle = INKS[k]; g.fillStyle = INKS[k]; g.lineWidth = 1; g.lineCap = 'round'; g.lineJoin = 'round';
  // 가장자리를 넘는 낙서는 반대편에도 그려 이음매 없이 반복
  for (const dx of [0, -S]) for (const dy of [0, -S]) { g.save(); g.translate(dx, dy); draw(g, rng(k.charCodeAt(0) * 977)); g.restore(); }
  return g.getImageData(0, 0, c.width, c.height);
}
// 나무 갓: 조금 찌그러진 반원 두세 개를 이은 낙서
function crown(g: G, x: number, y: number, s: number) {
  g.beginPath(); g.arc(x - s * 0.5, y, s * 0.55, Math.PI * 0.9, Math.PI * 1.9); g.arc(x + s * 0.3, y - s * 0.2, s * 0.6, Math.PI * 1.1, Math.PI * 2.1); g.stroke();
  g.beginPath(); g.moveTo(x - s * 0.1, y + s * 0.25); g.lineTo(x - s * 0.1, y + s * 0.75); g.stroke();
}
const DRAW: Record<string, (g: G, r: () => number) => void> = {
  f: (g, r) => { for (let y = 4; y < S + 4; y += 9) for (let x = 2; x < S + 4; x += 10) crown(g, x + (y % 18 ? 5 : 0) + r() * 2, y + r() * 2, 4 + r()); },
  m: (g, r) => {
    for (let y = 4; y < S + 4; y += 10) for (let x = 2; x < S + 4; x += 12) crown(g, x + (y % 20 ? 6 : 0) + r() * 2, y + r() * 2, 3.5);
    g.lineWidth = 1.2; g.beginPath(); g.moveTo(8, 40); g.lineTo(18, 26); g.lineTo(24, 33); g.lineTo(31, 22); g.lineTo(42, 40); g.stroke();   // 봉우리 선
  },
  g: (g, r) => { for (let i = 0; i < 70; i++) { const x = r() * S, y = r() * S; if (r() < 0.25) { g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + 1, y - 1); g.moveTo(x + 2, y + 2); g.lineTo(x + 3, y); g.stroke(); } else g.fillRect(x, y, 1, 1); } },
  r: g => { g.globalAlpha = 0.8; for (let y = 3; y < S; y += 8) for (let x = 3; x < S; x += 8) g.strokeRect(x + 0.5, y + 0.5, 5, 4); },
  c: g => { for (let y = 2; y < S; y += 6) for (let x = 2; x < S; x += 6) g.strokeRect(x + 0.5, y + 0.5, 4, 4); for (let x = 0; x < S; x += 12) g.fillRect(x + 3, 2, 1, S - 4); },
  i: g => { g.beginPath(); for (let i = -S; i < S * 2; i += 6) { g.moveTo(i, 0); g.lineTo(i + S, S); } g.stroke(); },
  o: (g, r) => { for (let i = 0; i < 24; i++) g.fillRect(r() * S, r() * S, 1, 1); },
};
export function addTerrainPatterns(m: MLMap) {
  for (const [k, f] of Object.entries(DRAW)) { const id = `pat-${k}`; if (!m.hasImage(id)) m.addImage(id, tile(k, f), { pixelRatio: PR }); }
}
