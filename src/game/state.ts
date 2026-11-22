// 회사 상태와 시간 흐름: 하루 수송 목표, 05시 정산, 증차, 게임 오버
import { type Demand, NB, binOf, binHours } from './data';
import { type Route, type Tally, RULES, moveBus } from './model';

export const POOL_T = 30;   // 기다리다 포기하는 시간(게임 분)
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

  constructor(dm: Demand) { this.dm = dm; this.pool = new Float64Array(dm.cells.length); }

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
    const bin = this.bin, t: Tally = { rode: 0, missed: 0, board: [] };
    for (const r of this.routes) for (const b of r.bus) moveBus(this.dm, r, b, gm, bin, t);
    this.todayRiders += t.rode; this.todayMissed += t.missed;
    this.fillPool(gm, bin);
    for (const [r, i, n] of t.board) this.drainPool(r, i, n);
    const S = RULES.settleMin;
    if (Math.floor((this.min - S) / 1440) > Math.floor((before - S) / 1440)) this.settle();
  }

  private settle() {
    const got = this.todayRiders, t = this.target, d = this.day - 1;
    // 어제 정산에서 늘어난 버스는 오늘 정산이 끝난 뒤부터 목표에 반영 (새 목표는 하루 뒤부터)
    if (this.pendingFleet != null) { this.goalFleet = this.pendingFleet; this.pendingFleet = null; }
    this.todayRiders = 0; this.todayMissed = 0;
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

  // ── 기다리는 사람 (셀마다) ──
  // 출발 수요만큼 쌓이고, 오래 기다리면 포기해서 POOL_T분마다 e분의 1로 줄어요.
  // 버스가 없으면 '시간당 출발 × POOL_T'에 머물러서, 망점 크기 = 지금 기다리는 사람 ÷ 그 값.
  // 버스가 태우면 그 정류장으로 걸어오는 셀들에서 빠져요.
  pool: Float64Array;
  private poolBin = -1;
  rate(i: number, bin = this.bin) { return this.dm.cells[i].O[bin] * POOL_SHARE / (binHours(this.dm.bins[bin]) * 60); }   // 분당
  poolEq(i: number, bin = this.bin) { return this.rate(i, bin) * POOL_T; }
  private fillPool(gm: number, bin: number) {
    const P = this.pool, n = P.length;
    if (this.poolBin < 0) for (let i = 0; i < n; i++) P[i] = this.poolEq(i, bin);
    this.poolBin = bin;
    const f = Math.exp(-gm / POOL_T);
    for (let i = 0; i < n; i++) P[i] = P[i] * f + this.poolEq(i, bin) * (1 - f);
  }
  private drainPool(r: Route, stop: number, n: number) {
    const c = r.catch[stop]; if (!c) return;
    const P = this.pool; let tot = 0;
    for (let k = 0; k < c.cells.length; k++) tot += P[c.cells[k]] * c.walk[k];
    if (tot <= 0) return;
    const take = Math.min(1, n / tot);
    for (let k = 0; k < c.cells.length; k++) P[c.cells[k]] -= P[c.cells[k]] * c.walk[k] * take;
  }
  // 지금 기다리는 사람 ÷ 버스 없을 때 머무는 값 (1 = 평소, 작을수록 버스가 많이 태워 감)
  poolRatio(i: number) { const e = this.poolEq(i); return e > 0 ? this.pool[i] / e : 1; }

  // 하루 전체 수요(노선 합) 대비 지금까지 예상 수송
  get dailyDemand() { let s = 0; for (const r of this.routes) for (let b = 0; b < NB; b++) s += r.demand[b]; return s; }
}

export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
