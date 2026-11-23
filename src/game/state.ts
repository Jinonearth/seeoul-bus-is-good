// 회사 상태와 시간 흐름: 하루 수송 목표, 05시 정산, 증차, 게임 오버
import { type Demand, NB, binOf, binHours } from './data';
import { type Route, type Bus, RULES, BUS_CAP, SPEED, moveBus, destsOf } from './model';

const HOLD_MAX = 3;   // 간격 맞추려 정류장에서 더 기다리는 최대 시간(게임 분)

export const COHORT = 30;   // 기다리는 사람은 30분마다 한 무리씩 생기고, 두 무리(1시간) 지나면 다른 교통수단으로 떠나요
// 기다리는 사람으로 치는 출발 수요 비율. 전체 대중교통 출발을 다 넣으면 버스가 태워 가도 망점이 3%쯤밖에 안 줄어서,
// 노선 하나가 실제로 태울 만한 몫(약 10%)만 세요
export let POOL_SHARE = 0.1;
export const setPoolShare = (v: number) => { POOL_SHARE = v; };

// 정산 결과: 화면이 아이콘과 숫자로 보여줘요
export type Settle = { day: number; got: number; target: number; ok: boolean; miss: number; hit: number; grow: number };

export class Game {
  dm: Demand;
  min = RULES.startMin;           // 게임 시작부터 흐른 분 (0 = 1일차 0시). 1일차는 06시 시작, 정산은 05시라 조금 짧아요
  speed = 1;                      // 현실 1초에 흐르는 게임 분: 0 정지, 1, 5, 10
  lastSpeed = 1;                  // 정지 뒤 다시 재생할 속도
  static SPEEDS = [1, 5, 10];
  setSpeed(v: number) { this.speed = this.lastSpeed = v; }
  pause() { if (this.speed) this.lastSpeed = this.speed; this.speed = 0; }
  play() { if (!this.speed) { this.speed = this.lastSpeed; return; } const S = Game.SPEEDS; this.speed = this.lastSpeed = S[(S.indexOf(this.speed) + 1) % S.length]; }
  fleet = RULES.fleet0;           // 보유 버스
  goalFleet = RULES.fleet0;       // 오늘 목표를 정하는 버스 수 (증차는 하루 뒤 반영)
  pendingFleet: number | null = null;
  hit = 0;                        // 목표 150% 연속 달성 일수
  miss = 0;                       // 연속 미달 일수
  todayRiders = 0;
  todayMissed = 0;
  over = false;
  routes: Route[] = [];
  onSettle: (s: Settle) => void = () => {};
  onOver: () => void = () => {};

  constructor(dm: Demand) { const n = dm.cells.length; this.dm = dm; this.pool = new Float64Array(n); this.old = new Float64Array(n); this.young = new Float64Array(n); }

  get target() { return this.goalFleet * RULES.perBus; }
  get day() { return Math.floor((this.min - RULES.settleMin) / 1440) + 1; }
  get minuteOfDay() { return this.min % 1440; }
  get bin() { return binOf(this.dm, this.minuteOfDay); }
  usedBuses(except?: Route) { return this.routes.reduce((a, r) => a + (r === except ? 0 : r.buses), 0); }
  get freeBuses() { return this.fleet - this.usedBuses(); }

  // 05시부터 지금까지 하루 수요 중 지나간 비율 (목표 페이스 표시용)
  dayShare(minuteOfDay = this.minuteOfDay) {
    const t = ((minuteOfDay - RULES.settleMin) % 1440 + 1440) % 1440;
    let tot = 0, done = 0;
    for (let m = 0; m < 1440; m += 30) {
      const b = binOf(this.dm, (RULES.settleMin + m) % 1440), w = this.binWeight(b) / (binHours(this.dm.bins[b]) * 2);
      tot += w; if (m < t) done += w;
    }
    return tot ? done / tot : 0;
  }
  private bw: number[] | null = null;
  private binWeight(b: number) { this.bw ??= this.dm.bins.map((_, i) => this.dm.cells.reduce((a, c) => a + c.O[i], 0)); return this.bw[b]; }

  advance(gm: number) {
    if (this.over || gm <= 0) return;
    const before = this.min; this.min += gm;
    this.stepCohorts(before);
    for (const r of this.routes) { this.spacing(r); for (const b of r.bus) moveBus(r, b, gm, this.serve); }
    const S = RULES.settleMin;
    if (Math.floor((this.min - S) / 1440) > Math.floor((before - S) / 1440)) this.settle();
  }

  private settle() {
    const got = this.todayRiders, t = this.target, d = this.day - 1;
    // 어제 정산에서 늘어난 버스는 오늘 정산이 끝난 뒤부터 목표에 반영 (새 목표는 하루 뒤부터)
    if (this.pendingFleet != null) { this.goalFleet = this.pendingFleet; this.pendingFleet = null; }
    this.todayRiders = 0; this.todayMissed = 0; for (const r of this.routes) r.today = 0;
    if (got < t) {
      this.miss++; this.hit = 0;
      if (this.miss >= RULES.maxMiss) { this.over = true; this.onOver(); return; }
      this.onSettle({ day: d, got, target: t, ok: false, miss: this.miss, hit: 0, grow: 0 });
      return;
    }
    this.miss = 0; this.hit = got >= t * RULES.bonus ? this.hit + 1 : 0;
    let grow = 0;
    if (this.hit >= RULES.bonusDays) { this.hit = 0; grow = RULES.fleetStep; this.fleet += grow; this.pendingFleet = this.fleet; }
    this.onSettle({ day: d, got, target: t, ok: true, miss: 0, hit: this.hit, grow });
  }

  // ── 기다리는 사람 (셀마다, 30분 무리 둘) ──
  // :00과 :30마다 그 30분 동안의 출발 수요(그때 시간대 비율 × POOL_SHARE)가 새 무리로 생기고,
  // 1시간 된 무리는 다른 교통수단으로 떠나요. 그중 노선 손님(그 노선이 갈 곳에 가려던 사람)이 못 타고 떠나면 그날 놓침.
  // 버스가 태우면 그 정류장으로 걸어오는 셀들에서, 오래 기다린 무리부터 빠져요. 망점 = 두 무리 합 ÷ 지금 1시간 수요.
  pool: Float64Array;                 // 두 무리 합 (지도 망점용)
  private old: Float64Array;          // 30~60분 된 무리
  private young: Float64Array;        // 0~30분 된 무리
  private seeded = false;
  rate(i: number, bin = this.bin) { return this.dm.cells[i].O[bin] * POOL_SHARE / (binHours(this.dm.bins[bin]) * 60); }   // 분당
  poolEq(i: number, bin = this.bin) { return this.rate(i, bin) * 60; }   // 지금 시간대 1시간치
  private cohortAt(m: number) { const b = binOf(this.dm, ((m % 1440) + 1440) % 1440), n = this.pool.length, a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = this.rate(i, b) * COHORT; return a; }
  private stepCohorts(before: number) {
    if (!this.seeded) {   // 시작하면 지난 1시간이 있었던 것처럼
      const h = Math.floor(before / COHORT) * COHORT;
      this.old = this.cohortAt(h - COHORT); this.young = this.cohortAt(h); this.seeded = true;
    }
    for (let h = Math.floor(before / COHORT) + 1; h <= Math.floor(this.min / COHORT); h++) {
      this.old = this.young; this.young = this.cohortAt(h * COHORT);
      for (const r of this.routes) if (r.claim) { for (const x of r.claim.old) this.todayMissed += x; r.claim.old = r.claim.young; r.claim.young = this.claimOf(r, this.young, binOf(this.dm, (h * COHORT) % 1440)); }
    }
    const P = this.pool; for (let i = 0; i < P.length; i++) P[i] = this.old[i] + this.young[i];
  }
  private drainPool(r: Route, stop: number, n: number) {
    const c = r.catch[stop]; if (!c) return;
    for (const A of [this.old, this.young]) {   // 오래 기다린 무리부터
      let tot = 0;
      for (let k = 0; k < c.cells.length; k++) tot += A[c.cells[k]] * c.walk[k];
      if (tot <= 0) continue;
      const take = Math.min(1, n / tot);
      for (let k = 0; k < c.cells.length; k++) A[c.cells[k]] -= A[c.cells[k]] * c.walk[k] * take;
      n -= Math.min(n, tot); if (n <= 0) break;
    }
    const P = this.pool; for (const i of c.cells) P[i] = this.old[i] + this.young[i];
  }
  // ── 배차 간격 맞추기 ──
  // 정차가 길어진 버스 뒤로 다음 버스가 따라붙어 몰려다니지 않게, 앞차와의 간격이 뒤차와의 간격보다 좁으면
  // 정류장에서 그 차이의 절반만큼(최대 HOLD_MAX분) 더 기다려요
  private gapAhead = new Map<Bus, number>(); private gapBehind = new Map<Bus, number>();
  private spacing(r: Route) {
    const L = 2 * r.lenKm, B = [...r.bus].sort((a, b) => a.s - b.s), n = B.length;
    if (n < 2 || L <= 0) return;
    B.forEach((b, i) => { this.gapAhead.set(b, ((B[(i + 1) % n].s - b.s) % L + L) % L); this.gapBehind.set(b, ((b.s - B[(i - 1 + n) % n].s) % L + L) % L); });
  }
  private holdFor(b: Bus) {
    const a = this.gapAhead.get(b), be = this.gapBehind.get(b);
    if (a == null || be == null || be <= a) return 0;
    return Math.min(HOLD_MAX, (be - a) / 2 / SPEED);
  }

  // ── 노선 손님 ──
  // 자리 k(정류장 i, 방향)의 시간대 b 하루 통행 T = Σ_j pair[b][i][j] (이 방향 뒤쪽 정류장 j), 걸어오는 출발 수요 합 E = catch[i].E[b].
  // 이 노선 몫 f = T / E. 기다리는 사람은 출발의 POOL_SHARE만 모이니, 새 무리 중 이 자리 손님 = min(1, f / POOL_SHARE) × Σ(걷기 가중 × 셀의 새 무리).
  // 노선마다 자리별로 이 손님도 30분 무리 둘로 들고 있다가(1시간 지나면 떠남) 버스가 오면 태워요.
  private shareOf(r: Route, k: number, bin: number) {
    const n = r.stops.length, i = r.visits[k].i, E = r.catch[i]?.E[bin] ?? 0, base = bin * n * n + i * n;
    let T = 0; for (const [j] of destsOf(r, k)) T += r.pair[base + j];
    return E > 0 ? Math.min(1, T / E / POOL_SHARE) : 0;
  }
  private claimOf(r: Route, cohort: Float64Array, bin: number) {
    const out = new Float64Array(r.visits.length);
    r.visits.forEach((q, k) => { const c = r.catch[q.i]; if (!c) return; let w = 0; for (let x = 0; x < c.cells.length; x++) w += cohort[c.cells[x]] * c.walk[x]; out[k] = this.shareOf(r, k, bin) * w; });
    return out;
  }

  // ── 버스가 정류장에 설 때: 내릴 사람 다 내리고, 이 자리 손님을 빈자리만큼 (명 단위) ──
  // 탈 사람 = min(⌊min(이 자리 손님, 걸어오는 셀에 실제로 기다리는 사람)⌋, 75 − 탄 사람). 다른 노선이 같은 셀에서 먼저 태워 가면 줄어요.
  // 내릴 곳은 pair 비율대로(큰 나머지 순). 손님과 셀의 기다리는 사람에서 오래된 무리부터 빼요. 못 탄 사람은 1시간 지나면 떠나요(놓침).
  private serve = (r: Route, b: Bus, k: number) => {
    const off = b.load[k]; b.load[k] = 0; b.on -= off; b.hold = this.holdFor(b);
    if (!r.claim || r.claim.old.length !== r.visits.length) r.claim = { old: this.claimOf(r, this.old, this.bin), young: this.claimOf(r, this.young, this.bin) };
    const n = r.stops.length, i = r.visits[k].i, bin = this.bin, c = r.catch[i], cl = r.claim;
    let on = 0; b.full = false;
    if (c) {
      let w = 0; for (let x = 0; x < c.cells.length; x++) w += this.pool[c.cells[x]] * c.walk[x];
      const want = Math.min(cl.old[k] + cl.young[k], w), room = BUS_CAP - b.on;
      on = Math.max(0, Math.min(Math.floor(want), room));
      b.full = b.on + on >= BUS_CAP && want - on >= 1;
      if (on > 0) {
        const dests = destsOf(r, k), base = bin * n * n + i * n;
        let T = 0; for (const [j] of dests) T += r.pair[base + j];
        const parts = dests.map(([j, kk]) => { const x = T > 0 ? on * r.pair[base + j] / T : on / dests.length; return [kk, Math.floor(x), x - Math.floor(x)]; });
        let left = on - parts.reduce((a, p) => a + p[1], 0);
        parts.sort((a, b2) => b2[2] - a[2]);
        for (const p of parts) { b.load[p[0]] += p[1] + (left > 0 ? 1 : 0); if (left > 0) left--; }
        b.on += on; this.todayRiders += on; r.today = (r.today ?? 0) + on;
        const t1 = Math.min(cl.old[k], on); cl.old[k] -= t1; cl.young[k] = Math.max(0, cl.young[k] - (on - t1));
        this.drainPool(r, i, on);
      }
    }
    return off + on;
  };

  // 지금 기다리는 사람 ÷ 지금 1시간치 (버스가 없으면 1 근처, 작을수록 버스가 많이 태워 감)
  poolRatio(i: number) { const e = this.poolEq(i); return e > 0 ? this.pool[i] / e : 1; }

  // 하루 전체 수요(노선 합) 대비 지금까지 예상 수송
  get dailyDemand() { let s = 0; for (const r of this.routes) for (let b = 0; b < NB; b++) s += r.demand[b]; return s; }
}

export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
// 큰 사람 수는 K로: 1,000 아래는 그대로, 100K 아래는 소수 한 자리(.0은 빼고), 그 위는 정수 K
export const fmtK = (n: number) => { const r = Math.round(n); if (Math.abs(r) < 1000) return String(r); const k = r / 1000; return `${Math.abs(k) < 100 ? (Math.round(k * 10) / 10).toString() : Math.round(k)}K`; };
