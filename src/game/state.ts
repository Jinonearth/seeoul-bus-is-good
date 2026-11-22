// 회사 상태와 시간 흐름: 하루 수송 목표, 05시 정산, 증차, 게임 오버
import { type Demand, NB, binOf, binHours } from './data';
import { type Route, RULES, moveBus } from './model';

export type Toast = { text: string; kind?: 'good' | 'warn' };

export class Game {
  dm: Demand;
  min = RULES.settleMin;          // 게임 시작부터 흐른 분 (0 = 1일차 0시)
  speed = 1;                      // 0 정지, 1, 4
  fleet = RULES.fleet0;           // 보유 버스
  goalFleet = RULES.fleet0;       // 오늘 목표를 정하는 버스 수 (증차는 하루 뒤 반영)
  pendingFleet: number | null = null;
  hit = 0;                        // 목표 150% 연속 달성 일수
  miss = 0;                       // 연속 미달 일수
  todayRiders = 0;
  todayMissed = 0;
  over = false;
  routes: Route[] = [];
  onToast: (t: Toast) => void = () => {};
  onOver: () => void = () => {};

  constructor(dm: Demand) { this.dm = dm; }

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
    const bin = this.bin, mins = binHours(this.dm.bins[bin]) * 60;
    for (const r of this.routes) {
      for (const b of r.bus) moveBus(this.dm, r, b, gm, bin);
      const dem = r.demand[bin] / mins * gm, cap = r.capH / 60 * gm, c = Math.min(dem, cap);
      this.todayRiders += c; this.todayMissed += dem - c;
    }
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
      this.onToast({ text: `${d}일차 정산: ${fmt(got)} / ${fmt(t)}명, 목표 미달 ${this.miss}일째예요. ${RULES.maxMiss}일 연속이면 게임 오버예요.`, kind: 'warn' });
      return;
    }
    this.miss = 0; this.hit = got >= t * RULES.bonus ? this.hit + 1 : 0;
    if (this.hit >= RULES.bonusDays) {
      this.hit = 0; this.fleet += RULES.fleetStep; this.pendingFleet = this.fleet;
      this.onToast({ text: `목표의 150%를 ${RULES.bonusDays}일 연속 넘겼어요. 버스 ${RULES.fleetStep}대가 늘었어요. 늘어난 목표는 모레부터예요.`, kind: 'good' });
    } else this.onToast({ text: `${d}일차 정산: ${fmt(got)}명 수송, 목표 달성!${this.hit ? ` 150% 넘김 ${this.hit}/${RULES.bonusDays}일` : ''}`, kind: 'good' });
  }

  // 하루 전체 수요(노선 합) 대비 지금까지 예상 수송
  get dailyDemand() { let s = 0; for (const r of this.routes) for (let b = 0; b < NB; b++) s += r.demand[b]; return s; }
}

export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
