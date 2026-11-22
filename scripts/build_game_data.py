"""게임용 수요 데이터 묶기 (데이터 파이프라인 산출물 → public/data)

python3 scripts/build_game_data.py <seoul.json> <hex_weights.json> <od_dong.json> public/data

- demand.json: 시간대(bins), 동 목록(이름·구·중심), 동별 시간대 출발 비율, res9 셀 [H3, 동, o[5], d[5]], 지하철역
- od.json: 평일 하루 평균 동→동 통행을 [출발 동, 도착 동, 통행, ...] 한 줄 배열로
"""
import sys, json, os
seoul, hexw, odp, out = sys.argv[1:5]
S = json.load(open(seoul)); P = S['proj']; H = json.load(open(hexw)); O = json.load(open(odp))
ll = lambda x, y: [round(x / P['kx'] + P['lon0'], 5), round(P['lat0'] - y / P['ky'], 5)]
os.makedirs(out, exist_ok=True)
r4 = lambda v: [round(a, 5) for a in v]
demand = {
  'bins': H['bins'],
  'dongs': [{'n': d['n'], 'gu': d['gu'], 'c': ll(d['x'], d['y'])} for d in S['dong']],
  'dongShare': [r4(v) for v in H['dong_bin_share']],
  'cells': [[c[0], c[1], r4(c[2]), r4(c[3])] for c in H['cells']],
  'stations': [[s[0], round(s[1], 5), round(s[2], 5), s[3]] for s in H.get('stations', [])],
}
json.dump(demand, open(os.path.join(out, 'demand.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
flat = []
for a, c, n in O['od']: flat += [a, c, round(n, 1)]
json.dump(flat, open(os.path.join(out, 'od.json'), 'w'), separators=(',', ':'))
print({k: os.path.getsize(os.path.join(out, k)) for k in ['demand.json', 'od.json']})
