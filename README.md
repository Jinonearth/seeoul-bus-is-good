# 서울 버스 운수회사 (가제)

빈 서울에서 버스 회사를 차려 노선을 그리고 버스를 투입하는 경영 시뮬레이션. 모바일 세로 화면 기준 웹 게임.

## 실행

Node.js 20.19 이상 또는 22.12 이상이 필요해요(Vite 8). 더 낮은 버전이면 설치 때 빌드 도구(rolldown)의 기기별 바이너리가 빠져서 `Cannot find native binding` 오류가 나요. `nvm use`로 `.nvmrc`의 22를 쓰면 돼요.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/
```

`main`에 머지되면 GitHub Actions가 GitHub Pages로 배포해요(저장소 Settings → Pages → Source를 "GitHub Actions"로 한 번 설정).

## 게임 규칙 (1차 임시값)

- 시작 버스 40대. 하루 수송 목표 = 보유 버스 × 550명, 매일 05시 정산
- 목표의 150%를 3일 연속 넘기면 버스 +10대(늘어난 목표는 하루 뒤부터)
- 3일 연속 목표 미달이면 게임 오버
- 노선: 헥사곤(H3 res9)을 탭할 때마다 그 칸에 정류장. 정류장은 그 칸 안 도로(간선·2차로·1차로, 고속도로 제외) 위에 서고, 쓸 도로가 없는 칸엔 둘 수 없어요(그리는 중 회색). 정류장 사이는 실제 도로 중 가장 짧은 길(큰 길을 조금 더 좋아함)로 다니고, 노선 길이·배차간격도 이 도로 거리로 계산해요. 일방통행은 아직 무시해요(버스가 같은 길로 오감). 노선마다 투입 버스 대수를 정하면 배차간격 = 한 바퀴 시간 ÷ 대수
- 버스는 정류장마다 타고 내리는 사람 수만큼 정차(15초 + 1명당 약 2초)
- 수요는 시간대 5구간(출근 6–9, 낮 9–17, 퇴근 17–20, 저녁 20–24, 심야 0–6)마다 다름

규칙 값은 `src/game/model.ts`의 `RULES`, 수요 보정은 `CAPTURE`.

## 구조

| 경로 | 내용 |
|---|---|
| `src/game/data.ts` | 수요 데이터 로드. 셀 a→c 통행 = od(A,C) × dongShare[A][b] × o_a[b] × d_c[b] |
| `src/game/model.ts` | 규칙, 노선 평가(정류장 걸어서 닿는 범위 = 3칸(약 1km)까지, 셀마다 가장 가까운 정류장 하나, 멀수록 덜 탐), 버스 운행·정차 |
| `src/game/state.ts` | 시간 흐름, 정산, 증차, 게임 오버 |
| `src/map/` | MapLibre 지도(B "인쇄 노선도" 스타일)와 게임 레이어 |
| `src/App.tsx` | 화면: 상단 HUD, 범례, 줌, 아래 시트(노선 칩 + 패널) |
| `public/tiles/seoul.pmtiles` | 도로·구·동 경계·한강 벡터 타일 (줌 9–14) |
| `public/data/` | `demand.json`(res9 셀 비중, 동 목록), `od.json`(평일 동→동 통행), `snap.json`(정류장 둘 수 있는 셀 → 도로 위 점), `roads.json`(버스 길 찾기 도로 그래프) |
| `scripts/` | 위 데이터를 만드는 스크립트 |

## 데이터 다시 만들기

```bash
pip install -r scripts/requirements.txt
python3 scripts/build_tiles.py "<[날짜]NODELINKDATA.zip>" <seoul.json> public/tiles/seoul.pmtiles
python3 scripts/build_game_data.py <seoul.json> <hex_weights.json> <od_dong.json> public/data
python3 scripts/build_stop_snap.py "<[날짜]NODELINKDATA.zip>" public/data/demand.json public/data   # snap.json + roads.json
node scripts/build_seed_routes.mjs   # 예시 노선 정류장 → src/game/seeds.ts (도로 데이터를 바꾸면 다시)
```

`seoul.json`, `hex_weights.json`, `od_dong.json`은 데이터 파이프라인 산출물이에요.

## 출처

- 도로: 국토교통부 표준노드링크 (2026-11-11)
- 행정동 경계: vuski/admdongkor (CC BY 4.0)
- 수요: 서울시 TOPIS 대중교통 O/D, 서울 열린데이터광장 정류장 위치·시간대별 승하차
