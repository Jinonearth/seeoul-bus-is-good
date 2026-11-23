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
- 노선: 헥사곤(H3 res9)을 탭할 때마다 그 칸에 정류장. 정류장은 그 칸 안 도로(간선·2차로·1차로, 고속도로 제외) 위에 서고, 쓸 도로가 없는 칸엔 둘 수 없어요(그리는 중 회색). 노선은 한 바퀴(고리)예요: 가는 길 1→N, 오는 길 N→1을 실제 도로로 잇고, 일방통행을 지키고 제자리 유턴 없이 종점에서는 블록을 돌아(P턴) 돌아와요. 오는 길 정류장은 길 건너편 도로 위 자리에 서요. 노선 길이는 한 바퀴의 절반(편도), 배차간격 = 한 바퀴 시간 ÷ 대수.
- 버스는 정류장마다 타고 내리는 사람 수만큼 정차(15초 + 1명당 약 2초)
- 수요는 시간대 5구간(출근 6–9, 낮 9–17, 퇴근 17–20, 저녁 20–24, 심야 0–6)마다 다름

규칙 값은 `src/game/model.ts`의 `RULES`, 수요 보정은 `CAPTURE_BASE`. 정류장 쌍마다 버스 시간(걷기 + 배차간격/2 + 차 안)과 지하철 시간(걷기 + 기다림 3분 + 역↔역 + 걷기)을 견줘 버스 몫 = 1 / (1 + e^(0.12 × (버스 − 지하철)))을 곱해요.

## 구조

| 경로 | 내용 |
|---|---|
| `src/game/data.ts` | 수요 데이터 로드. 셀 a→c 통행 = od(A,C) × dongShare[A][b] × o_a[b] × d_c[b] |
| `src/game/model.ts` | 규칙, 노선 평가(정류장 걸어서 닿는 범위 = 3칸(약 1km)까지, 셀마다 가장 가까운 정류장 하나, 멀수록 덜 탐), 버스 운행·정차 |
| `src/game/state.ts` | 시간 흐름, 정산, 증차, 게임 오버 |
| `src/map/` | MapLibre 지도(B "인쇄 노선도" 스타일)와 게임 레이어 |
| `src/App.tsx` | 화면: 상단 HUD, 범례, 줌, 아래 시트(노선 칩 + 패널) |
| `public/tiles/seoul.pmtiles` | 도로·구·동 경계·한강 벡터 타일 (줌 9–14) |
| `public/tiles/land.pmtiles` | 부풀린 도로 면 (줌 13–14) |
| `public/data/terrain.json` | 헥사곤(res7·8·9)마다 가장 넓은 땅 쓰임(OSM). 지도에선 `src/map/sprites.ts`에서 직접 그린 픽셀 아트 무늬로 칠해요 |
| `public/data/` | `demand.json`(res9 셀 비중, 동 목록), `od.json`(평일 동→동 통행), `snap.json`(정류장 둘 수 있는 셀 → 도로 위 점), `roads.json`(버스 길 찾기 도로 그래프, 한 방향 간선) |
| `scripts/` | 위 데이터를 만드는 스크립트 |

## 데이터 다시 만들기

```bash
pip install -r scripts/requirements.txt
python3 scripts/build_tiles.py "<[날짜]NODELINKDATA.zip>" <seoul.json> public/tiles/seoul.pmtiles
python3 scripts/build_game_data.py <seoul.json> <hex_weights.json> <od_dong.json> public/data
python3 scripts/build_stop_snap.py "<[날짜]NODELINKDATA.zip>" public/data/demand.json public/data   # snap.json + roads.json
curl -s --data-urlencode data@scripts/overpass_land.txt https://overpass-api.de/api/interpreter -o osm_land.json   # OSM 땅 쓰임
python3 scripts/build_land.py "<[날짜]NODELINKDATA.zip>" osm_land.json public/tiles/land.pmtiles --no-land   # 부풀린 도로 면
python3 scripts/build_terrain.py osm_land.json public/data/demand.json public/data/terrain.json   # 헥사곤마다 지형(숲·녹지·주거·상업·공업)
python3 scripts/build_subway.py "<서울시 역사마스터 정보.csv>" public/data/demand.json public/data/subway.json
node scripts/build_seed_routes.mjs   # 예시 노선 정류장 → src/game/seeds.ts (도로 데이터를 바꾸면 다시)
```

`seoul.json`, `hex_weights.json`, `od_dong.json`은 데이터 파이프라인 산출물이에요.

## 출처

- 도로: 국토교통부 표준노드링크 (2026-11-11)
- 행정동 경계: vuski/admdongkor (CC BY 4.0)
- 수요: 서울시 TOPIS 대중교통 O/D, 서울 열린데이터광장 정류장 위치·시간대별 승하차
- 땅 쓰임(숲·공원·주거·상업·공업): © OpenStreetMap 기여자, ODbL (Overpass로 받음)
- 지하철 역: 서울 열린데이터광장 「서울시 역사마스터 정보」(역사_ID·역사명·호선·위도·경도)
