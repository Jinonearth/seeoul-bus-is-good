import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { latLngToCell, cellToParent, gridDisk, cellToLatLng } from 'h3-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { type Demand, loadDemand, binHours, stopable } from './game/data';
import { loadRoads } from './game/roads';
import { SEED_TRUNK, SEED_BRANCH } from './game/seeds';
import { type Route, type RouteType, TYPES, RULES, makeRoute, updateRoute, evalRoute, routePath, routeStyle, crowdAt, WALK } from './game/model';
import { Game, fmt, type Settle } from './game/state';

type Toast = { text: React.ReactNode; kind?: 'good' | 'warn' };
import { Icon } from './ui/Icon';
import { GameMap, type Layer, type Flow, setCoverage } from './map/GameMap';

// at: 팝업을 붙일 지도 위 점 (경도, 위도)
type Sel = { kind: 'hex'; cell: string; at: [number, number] } | { kind: 'route'; id: number; at?: [number, number] } | { kind: 'draft' } | null;
type Draft = { stops: string[]; type: RouteType; buses: number; editing?: Route };
const LAYER_NAME: Record<Layer, string> = { o: '출발 수요', d: '도착 수요', u: '버스가 닿지 않는 출발 수요' };
const LAYER_ICON: Record<Layer, string> = { o: 'out', d: 'in', u: 'gap' };
const hh = (h: number) => String(h).padStart(2, '0');
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
const fmtHw = (h: number) => (h < 10 ? h.toFixed(1) : String(Math.round(h)));

export default function App() {
  const [dm, setDm] = useState<Demand | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { loadDemand().then(setDm).catch(e => setErr(String(e))); }, []);
  if (err) return <div className="loading">데이터를 불러오지 못했어요: {err}</div>;
  if (!dm) return <div className="loading">서울 수요 데이터를 불러오는 중…</div>;
  return <GameView dm={dm} />;
}

function GameView({ dm }: { dm: Demand }) {
  const mapEl = useRef<HTMLDivElement>(null), appEl = useRef<HTMLDivElement>(null), barEl = useRef<HTMLElement>(null);
  // 지도 위 버튼과 팝업이 아래 막대 높이를 알도록 --bar-h, 위 노선 막대 높이는 --top-h
  useLayoutEffect(() => {
    const app = appEl.current, bar = barEl.current, top = app?.querySelector<HTMLElement>('#topbar'); if (!app || !bar || !top) return;
    const set = () => { app.style.setProperty('--bar-h', `${bar.offsetHeight}px`); app.style.setProperty('--top-h', `${top.offsetHeight}px`); };
    const ro = new ResizeObserver(set); ro.observe(bar); ro.observe(top); set();
    return () => ro.disconnect();
  }, []);
  const gm = useRef<GameMap | null>(null);
  const game = useMemo(() => new Game(dm), [dm]);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);
  const [sel, setSel] = useState<Sel>(null);
  const [layer, setLayer] = useState<Layer>('o');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stats, setStats] = useState(false);   // 아래 상태 막대 펼침(회사 현황)
  const [more, setMore] = useState(false);     // 팝업 자세히
  useEffect(() => setMore(false), [sel]);
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const [help, setHelp] = useState(false);
  const selRef = useRef(sel); selRef.current = sel;
  const draftRef = useRef(draft); draftRef.current = draft;

  const toast = useCallback((t: Toast) => {
    const id = Math.random();
    setToasts(x => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts(x => x.filter(y => y.id !== id)), 5000);
  }, []);

  const focusId = sel?.kind === 'route' ? sel.id : null;
  const redrawRoutes = useCallback(() => {
    const m = gm.current; if (!m) return;
    m.setRoutes(game.routes, selRef.current?.kind === 'route' ? selRef.current.id : null);
    const covered = new Set<string>(); for (const r of game.routes) for (const s of r.stops) for (const c of gridDisk(s, WALK.length - 1)) covered.add(c);
    setCoverage(covered, (id, res) => cellToParent(id, res));
    m.setDemand(layer, game.bin, covered);
  }, [game, layer]);

  // 지도 만들기 + 예시 노선 2개
  useEffect(() => {
    const m = new GameMap(mapEl.current!, dm); gm.current = m;
    game.onSettle = (x: Settle) => toast({ kind: x.ok ? 'good' : 'warn', text: <>D{x.day} <Icon n={x.ok ? 'ok' : 'x'} s={14} /> <Icon n="person" s={14} />{fmt(x.got)}/{fmt(x.target)}{!x.ok && <> <Icon n="warn" s={14} />{x.miss}/{RULES.maxMiss}</>}{x.ok && x.hit > 0 && <> <Icon n="up" s={14} />{x.hit}/{RULES.bonusDays}</>}{x.grow > 0 && <> <Icon n="bus" s={14} />+{x.grow}</>}</> }); game.onOver = rerender;
    // 개발 모드(StrictMode)는 이 effect를 두 번 실행해요. 예시 노선이 두 벌 생기면 버스가 모자라 새 노선을 못 만들어요
    if (!game.routes.length) {
      game.routes.push(makeRoute(dm, 'trunk', SEED_TRUNK.filter(stopable), 18, true));
      game.routes.push(makeRoute(dm, 'branch', SEED_BRANCH.filter(stopable), 6, true));
    }
    m.ready.then(() => { redrawRoutes(); rerender(); });
    return () => m.map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dm]);

  useEffect(() => { if (gm.current?.isReady) redrawRoutes(); }, [layer, focusId, redrawRoutes]);
  const redrawRef = useRef(redrawRoutes); redrawRef.current = redrawRoutes;

  // 도로 그래프는 첫 화면 뒤에 읽어요. 다 읽으면 노선을 실제 도로 길로 다시 계산
  useEffect(() => {
    let live = true;
    loadRoads().then(() => {
      if (!live) return;
      for (const r of game.routes) updateRoute(dm, r, r.stops, r.buses);
      setDraft(d => (d ? { ...d } : d));
      gm.current?.ready.then(() => { redrawRef.current(); rerender(); });
    }).catch(() => { /* 못 읽으면 셀을 잇는 선으로 */ });
    return () => { live = false; };
  }, [dm, game, rerender]);

  // 시간 흐름: 현실 1초에 게임 speed분 (1, 5, 10). 한 프레임 최대 0.1초 = 10배속에서 게임 1분
  useEffect(() => {
    let last = performance.now(), acc = 0, lastBin = game.bin, raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      game.advance(dt * game.speed);
      const m = gm.current;
      if (m?.isReady) {
        m.setBuses(game.routes, game.bin, selRef.current?.kind === 'route' ? selRef.current.id : null);
        if (game.bin !== lastBin) { lastBin = game.bin; redrawRoutes(); }
      }
      acc += dt; if (acc > 0.25) { acc = 0; rerender(); if (m?.isReady) m.setLive(game.pool, i => game.poolEq(i)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game, rerender, redrawRoutes]);

  // 지도 탭
  useEffect(() => {
    const m = gm.current; if (!m) return;
    m.onTap = ({ lngLat, route }) => {
      const d = draftRef.current;
      if (d) {   // 노선 그리기: 탭한 헥사곤(res9)마다 정류장 하나
        const c = latLngToCell(lngLat[1], lngLat[0], 9);
        if (!dm.byId.has(c) || !stopable(c)) return toast({ text: <><Icon n="x" s={14} /><Icon n="stop" s={14} /></>, kind: 'warn' });
        if (d.stops[d.stops.length - 1] === c) return;
        setDraft({ ...d, stops: [...d.stops, c] }); return;
      }
      if (route != null) { setSel({ kind: 'route', id: route, at: lngLat }); return; }
      const c = m.cellAt(lngLat);
      const inSeoul = dm.byId.has(latLngToCell(lngLat[1], lngLat[0], 9));
      if (!inSeoul) { setSel(null); return; }
      const [la, ln] = cellToLatLng(c); setSel({ kind: 'hex', cell: c, at: [ln, la] });
    };
  }, [dm, toast]);

  // 선택 셀 테두리 + 수요 흐름
  useEffect(() => {
    const m = gm.current; if (!m?.isReady) return;
    if (sel?.kind === 'hex') { m.setSelected(sel.cell); m.setFlows(flowsOf(dm, sel.cell, game.bin).flows); }
    else { m.setSelected(null); m.setFlows([]); }
  }, [sel, dm, game, game.bin]);

  // 그리는 중인 노선
  const draftEval = useMemo(() => (draft && draft.stops.length >= 2 ? evalRoute(dm, draft.stops, draft.buses, draft.type) : null), [dm, draft]);
  useEffect(() => {
    const m = gm.current; if (!m) return;
    let live = true;
    // 타일을 읽는 동안엔 map.loaded()가 false라서, 레이어가 준비됐는지만 기다려요
    m.ready.then(() => {
      if (!live) return;
      m.setDrawing(!!draft);
      if (!draft) { m.setDraft([], 0, [], ''); return; }
      const color = draft.editing?.color ?? routeStyle(game.routes.length).color;
      const rp = routePath(draft.stops);
      m.setDraft(rp.path, rp.outN, rp.stopPts, color);
    });
    return () => { live = false; };
  }, [draft, game]);

  const startDraft = (first?: string) => { setDraft({ stops: first && stopable(first) ? [first] : [], type: 'trunk', buses: Math.min(4, Math.max(1, game.freeBuses)) }); setSel({ kind: 'draft' }); };
  const cancelDraft = () => { setDraft(null); setSel(null); };
  const finishDraft = () => {
    if (!draft || draft.stops.length < 2) return;
    const free = game.fleet - game.usedBuses(draft.editing);
    if (draft.buses > free) return toast({ text: <><Icon n="bus" s={14} />{free}</>, kind: 'warn' });
    let r: Route;
    if (draft.editing) { r = draft.editing; updateRoute(dm, r, draft.stops, draft.buses); toast({ text: <><Icon n="edit" s={14} />{r.num} <Icon n="ok" s={14} /></>, kind: 'good' }); }
    else { r = makeRoute(dm, draft.type, draft.stops, draft.buses); game.routes.push(r); toast({ text: <>+{r.num} <Icon n="bus" s={14} />{r.buses} <Icon n="clock" s={14} />{fmtHw(r.headway)}′</>, kind: 'good' }); }
    setDraft(null); setSel({ kind: 'route', id: r.id }); redrawRoutes();
  };

  const route = sel?.kind === 'route' ? game.routes.find(r => r.id === sel.id) : undefined;
  const bin = game.bin, t = game.target, got = game.todayRiders, share = game.dayShare();
  const full = t * RULES.bonus;

  const routeAt = route ? ((sel as { at?: [number, number] }).at ?? route.path[Math.floor(route.outN / 2)] ?? route.path[0]) : null;
  const speedName = (n: number) => `1초에 게임 ${n}분`;

  return (
    <div id="stage"><div id="app" ref={appEl} data-draw={draft ? '1' : undefined}>
      <div id="map" ref={mapEl} className={draft ? 'drawing' : ''} />

      {/* 위: 노선 막대만 */}
      <header className="box" id="topbar">
        <div id="routebar">
          {!draft && <button className="chip add" onClick={() => startDraft()} aria-label="새 노선 만들기">+</button>}
          {game.routes.map(r => <button key={r.id} className="chip" aria-pressed={focusId === r.id} aria-label={`${r.num}번 ${TYPES[r.type]}, ${r.from}에서 ${r.to}, 버스 ${r.buses}대, 배차 ${fmtHw(r.headway)}분`} onClick={() => setSel(focusId === r.id ? null : { kind: 'route', id: r.id })}>
            <span className="n" style={{ background: r.color, color: r.tx }}>{r.num}</span>
            <span className="m"><span><Icon n="bus" s={13} />{r.buses}</span><span><Icon n="clock" s={13} />{fmtHw(r.headway)}′</span></span></button>)}
        </div>
      </header>

      <div className="toasts">{toasts.map(x => <div key={x.id} className={`toast ${x.kind ?? ''}`}>{x.text}</div>)}</div>

      {/* 지도 위 버튼: 아래 막대 바로 위 */}
      <button className="box" id="legend" onClick={() => setLayer(l => (l === 'o' ? 'd' : l === 'd' ? 'u' : 'o'))} aria-label={`수요 레이어 바꾸기, 지금 ${LAYER_NAME[layer]}`}>
        <i className="dot" aria-hidden="true" /><Icon n={LAYER_ICON[layer]} s={20} />
      </button>
      <div className="box" id="helpbox"><button className="zb" aria-pressed={help} aria-label="화면 설명" onClick={() => setHelp(h => !h)}>?</button></div>
      <div className="box" id="zoom">
        <button className="zb" aria-label="축소" onClick={() => gm.current?.map.zoomOut()}><svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg></button>
        <button className="zb" aria-label="확대" onClick={() => gm.current?.map.zoomIn()}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
      </div>

      {/* 지도 위 팝업: 노선 / 헥사곤 */}
      {gm.current && route && routeAt && <MapPopup map={gm.current.map} at={routeAt} wide={more} onClose={() => setSel(null)}>
        <RoutePanel dm={dm} game={game} r={route} bin={bin} toast={toast} onClose={() => setSel(null)} more={more} setMore={setMore} onEdit={() => { setDraft({ stops: [...route.stops], type: route.type, buses: route.buses, editing: route }); setSel({ kind: 'draft' }); }}
          onDelete={() => { game.routes = game.routes.filter(x => x !== route); setSel(null); redrawRoutes(); toast({ text: <><Icon n="trash" s={14} />{route.num} <Icon n="bus" s={14} />+{route.buses}</> }); }}
          onChange={() => { redrawRoutes(); rerender(); }} />
      </MapPopup>}
      {gm.current && sel?.kind === 'hex' && <MapPopup map={gm.current.map} at={sel.at} wide={more} onClose={() => setSel(null)}>
        <HexPanel dm={dm} cell={sel.cell} bin={bin} more={more} setMore={setMore} onClose={() => setSel(null)} onStart={() => startDraft(latLngToCell(...cellToLatLng(sel.cell), 9))} />
      </MapPopup>}

      {/* 아래: 상태 막대 (그리는 중엔 노선 그리기 패널) */}
      <footer className="box" id="bottom" ref={barEl}>
        {draft ? <div className="panel"><DraftPanel dm={dm} game={game} draft={draft} ev={draftEval} setDraft={setDraft} onCancel={cancelDraft} onDone={finishDraft} /></div> : <>
          <div className="r1">
            <div className="when"><span className="clock">{hhmm(game.minuteOfDay)}</span>
              <span className="day" aria-label={`${game.day}일차, ${dm.bins[bin].name} 시간대`}>D{game.day} <span className="seg-chip"><Icon n={`b${bin}`} s={12} />{hh(dm.bins[bin].from)}–{hh(dm.bins[bin].to)}</span></span></div>
            <div className="speed" role="group" aria-label="시간 속도">
              <button aria-pressed={game.speed === 0} aria-label="일시정지" onClick={() => { game.pause(); rerender(); }}><svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg></button>
              <button aria-pressed={game.speed > 0} aria-label={game.speed ? `${speedName(game.speed)}, 누르면 ${speedName(Game.SPEEDS[(Game.SPEEDS.indexOf(game.speed) + 1) % 3])}` : `재생, ${speedName(game.lastSpeed)}`} onClick={() => { game.play(); rerender(); }}>
                <PlayIcon n={Game.SPEEDS.indexOf(game.speed || game.lastSpeed) + 1} /></button>
            </div>
            <div className="money" aria-label={`운행 버스 ${game.usedBuses()}대, 보유 ${game.fleet}대`}><Icon n="bus" s={18} /><span className="v">{game.usedBuses()}<span className="muted">/{game.fleet}</span></span></div>
            <button className="more" aria-expanded={stats} aria-label={stats ? '회사 현황 접기' : '회사 현황 펼치기'} onClick={() => setStats(x => !x)}><svg viewBox="0 0 16 16"><path d={stats ? 'M3 6l5 5 5-5' : 'M3 10l5-5 5 5'} /></svg></button>
          </div>
          <div className="r2" onClick={() => setStats(x => !x)}>
            <span className="got" aria-label={`오늘 수송 ${fmt(got)}명, 목표 ${fmt(t)}명`}><Icon n="person" s={14} /><b>{fmt(got)}</b><span className="muted">/{fmt(t)}</span></span>
            <span className="satw">
              <span className="meter goal" aria-hidden="true"><i style={{ width: `${Math.min(100, got / full * 100)}%` }} /><u style={{ left: `${Math.min(100, share / RULES.bonus * 100)}%` }} /><s /></span>
              {got >= t * share ? <b className="pace ok"><Icon n="up" s={14} label="목표 페이스 넘김" /></b> : <b className="pace bad"><Icon n="down" s={14} label="목표 페이스 부족" /></b>}
              <span className="streak" role="img" aria-label={`연속 미달 ${game.miss}일 (3일이면 게임 오버)`}>{Array.from({ length: RULES.maxMiss }, (_, i) => <i key={i} className={i < game.miss ? 'on' : ''} />)}</span>
            </span>
          </div>
          {stats && <div className="panel"><CompanyPanel game={game} /></div>}
        </>}
      </footer>

      {help && <div className="help" onClick={() => setHelp(false)}><div className="box">
        <h2>화면 설명</h2>
        <div className="legend-big"><div className="lt"><Icon n={LAYER_ICON[layer]} s={12} /> {LAYER_NAME[layer]} · 지금 시간대</div>
          <svg viewBox="0 0 320 60" aria-hidden="true"><g fill="none" stroke="#1D1D1B" strokeOpacity="0.3">{[32, 96, 160, 224, 288].map(x => <path key={x} d={`M${x} 6 L${x + 22} 18 L${x + 22} 42 L${x} 54 L${x - 22} 42 L${x - 22} 18 Z`} />)}</g>
          <g fill="#FF48B0">{[4, 8, 12, 16, 20].map((r, i) => <circle key={r} cx={32 + i * 64} cy="30" r={r} />)}</g></svg>
          <div className="ends"><span>적음</span><span>많음</span></div></div>
        <dl className="icons">
          <dt><Icon n="out" /></dt><dd>점 = 최근 1시간 동안 버스를 기다린 사람, 30분마다 새로 생기고 1시간 지나면 다른 교통수단으로 떠나요 (버스가 태워 가면 작아져요)</dd><dt><Icon n="in" /></dt><dd>도착 수요</dd><dt><Icon n="gap" /></dt><dd>못 탄 채 기다리는 사람 (버스가 안 닿거나 모자란 곳)</dd>
          <dt><Icon n="bus" /></dt><dd>버스 (운행/보유)</dd><dt><Icon n="person" /></dt><dd>수송 인원 (오늘/목표)</dd><dt><Icon n="miss" /></dt><dd>못 태운 승객</dd>
          <dt><Icon n="clock" /></dt><dd>배차간격 (′ = 분)</dd><dt><Icon n="loop" /></dt><dd>한 바퀴 시간 (가는 길 + 오는 길)</dd><dt><Icon n="ruler" /></dt><dd>노선 길이 (편도 = 한 바퀴의 절반)</dd><dt><Icon n="cap" /></dt><dd>시간당 정원</dd>
          <dt><Icon n="up" /><Icon n="down" /></dt><dd>목표 페이스 넘김/부족</dd><dt><span className="streak"><i className="on" /><i /><i /></span></dt><dd>연속 미달 (3칸이면 게임 오버)</dd>
          <dt><Icon n="trunk" /><Icon n="branch" /><Icon n="circ" /></dt><dd>간선 · 지선 · 순환</dd>
          <dt><Icon n="b0" /><Icon n="b1" /><Icon n="b2" /><Icon n="b3" /><Icon n="b4" /></dt><dd>출근 · 낮 · 퇴근 · 저녁 · 심야</dd>
        </dl>
        <p><b>노선:</b> 위 막대의 + 를 누르고 헥사곤을 하나씩 탭하면 그 칸마다 정류장이 생겨요. 그리는 동안 아래 막대가 노선 그리기 패널로 바뀌어요. 투입할 버스 대수를 정하면 배차간격이 계산돼요. 정류장이 많을수록 한 바퀴가 길어져 간격이 벌어져요.</p>
        <p><b>지도:</b> 헥사곤이나 노선을 누르면 지도 위에 카드가 떠요. 헥사곤 카드에서는 그 칸에서 가고 싶은 곳(파랑 실선)과 오고 싶은 곳(주황 점선)이 보여요. 멀리서 보면 노선은 단순한 선 하나로 보여요.</p>
        <p><b>화면:</b> 위는 노선 막대(+로 새 노선), 아래는 상태 막대예요. 아래 막대를 누르면 회사 현황이 펼쳐져요.</p>
        <p><b>시간:</b> ▶를 누를 때마다 현실 1초에 게임 1분(▶) → 5분(▶▶) → 10분(▶▶▶). ❚❚는 멈춤.</p>
        <p><b>규칙:</b> 매일 05시 정산. 목표의 150%를 3일 연속 넘기면 버스 +10대, 3일 연속 목표를 못 채우면 게임 오버예요.</p>
      </div></div>}

      {game.over && <div className="over"><div className="box" aria-label="게임 오버">
        <Icon n="warn" s={40} />
        <div className="big">D{game.day - 1}</div>
        <div className="stat"><Icon n="bus" s={18} />{game.fleet}</div>
        <button className="btn primary" onClick={() => location.reload()} aria-label="처음부터 다시"><Icon n="again" s={20} /></button>
      </div></div>}
    </div></div>
  );
}

// 헥사곤 수요 흐름: 이 셀이 속한 동에서 나가는/들어오는 통행 상위 5곳 (지금 시간대)
function flowsOf(dm: Demand, cell: string, bin: number) {
  const res = cell.length ? (parseInt(cell[1], 16) & 15) : 9;
  const [lat, lng] = cellToLatLng(cell), base = dm.byId.get(latLngToCell(lat, lng, 9));
  const out: { name: string; v: number; to: [number, number]; out: boolean }[] = [];
  if (!base) return { flows: [] as Flow[], out };
  const A = base.dong, sh = dm.dongShare[A][bin];
  const top = (list: [number, number][] | undefined, isOut: boolean) => (list ?? [])
    .filter(([d]) => d !== A).map(([d, n]) => ({ d, v: n * (isOut ? sh : dm.dongShare[d][bin]) })).sort((a, b) => b.v - a.v).slice(0, 5)
    .map(({ d, v }) => { const c = dm.dongs[d].c; const cc = cellToLatLng(latLngToCell(c[1], c[0], res)); return { name: `${dm.dongs[d].gu.replace(/구$/, '')} ${dm.dongs[d].n}`, v, to: [cc[1], cc[0]] as [number, number], out: isOut }; });
  out.push(...top(dm.outOf.get(A), true), ...top(dm.into.get(A), false));
  const flows: Flow[] = out.map(f => ({ from: f.out ? [lng, lat] : f.to, to: f.out ? f.to : [lng, lat], v: f.v, out: f.out }));
  return { flows, out };
}

const Stat = ({ i, v, label, warn }: { i: string; v: React.ReactNode; label: string; warn?: boolean }) =>
  <div className={warn ? 'warn' : ''} aria-label={label}><Icon n={i} s={15} /><b>{v}</b></div>;

// 헥사곤 팝업: 기본은 동 이름, 지금 시간당 출발·도착, + 노선. ⋯로 시간대 그래프와 가고 싶은 곳·오고 싶은 곳
function HexPanel({ dm, cell, bin, onStart, onClose, more, setMore }: { dm: Demand; cell: string; bin: number; onStart: () => void; onClose: () => void; more: boolean; setMore: (v: boolean) => void }) {
  const [lat, lng] = cellToLatLng(cell), c9 = dm.byId.get(latLngToCell(lat, lng, 9));
  const res = parseInt(cell[1], 16) & 15;
  const agg = res === 9 ? c9 : dm.parents[res === 7 ? 0 : 1].get(cell);
  if (!agg || !c9) return null;
  const perH = (v: number[], b: number) => v[b] / binHours(dm.bins[b]);
  const { out } = flowsOf(dm, cell, bin), maxV = Math.max(1, ...out.map(o => o.v));
  const peak = Math.max(...dm.bins.map((_, b) => Math.max(perH(agg.O, b), perH(agg.D, b))));
  return <>
    <div className="ph"><b className="pt">{dm.dongs[c9.dong].n}</b>
      <MoreBtn more={more} setMore={setMore} /><button className="pb" onClick={onClose} aria-label="닫기"><Icon n="x" s={16} /></button></div>
    <div className="pr"><span className="ps" aria-label="지금 시간당 출발"><Icon n="out" s={14} />{fmt(perH(agg.O, bin))}/h</span><span className="ps" aria-label="지금 시간당 도착"><Icon n="in" s={14} />{fmt(perH(agg.D, bin))}/h</span>
      <button className="pb primary" onClick={onStart} aria-label="여기서 노선 시작">+<Icon n="route" s={16} /></button></div>
    {more && <>
      <div className="sub">{dm.dongs[c9.dong].gu} · <Icon n="person" s={12} label="하루 출발" />Σ {fmt(agg.O.reduce((a, b) => a + b, 0))}</div>
      <div><div className="bins">{dm.bins.map((b, i) => <div key={i} className={i === bin ? 'now' : ''} aria-label={`${b.name} 출발 ${fmt(perH(agg.O, i))}, 도착 ${fmt(perH(agg.D, i))} (시간당)`}>
        <span className="bo" style={{ height: `${perH(agg.O, i) / peak * 100}%` }} /><span className="bd" style={{ height: `${perH(agg.D, i) / peak * 100}%` }} /><small><Icon n={`b${i}`} s={13} /></small></div>)}</div></div>
      {(['out', 'in'] as const).map(k => <div key={k}><h3 className="ih"><Icon n={k} s={13} label={k === 'out' ? '여기서 가고 싶은 곳' : '여기로 오고 싶은 곳'} /><span className={`swatch ${k}`} aria-hidden="true" /></h3>
        <div className="list">{out.filter(o => o.out === (k === 'out')).map(o => <div className="it" key={o.name}><span>{o.name}</span><span className="b" style={{ width: `${o.v / maxV * 60}px` }} /><span>{fmt(o.v / binHours(dm.bins[bin]))}</span></div>)}</div></div>)}
    </>}
  </>;
}

const MoreBtn = ({ more, setMore }: { more: boolean; setMore: (v: boolean) => void }) =>
  <button className="pb" aria-expanded={more} aria-label={more ? '자세히 접기' : '자세히'} onClick={() => setMore(!more)}><svg className="chev" viewBox="0 0 16 16"><path d={more ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'} /></svg></button>;

function Stepper({ n, min, max, onSet, free }: { n: number; min: number; max: number; onSet: (n: number) => void; free: number }) {
  return <div className="hw"><button aria-label="버스 빼기" disabled={n <= min} onClick={() => onSet(n - 1)}>−</button>
    <b aria-label={`투입 버스 ${n}대`}><Icon n="bus" s={18} />{n}</b>
    <button aria-label="버스 더 넣기" disabled={n >= max} onClick={() => onSet(n + 1)}>+</button>
    <span className="need" aria-label={`남은 버스 ${free}대`}><Icon n="bus" s={13} />{free}</span></div>;
}

// 노선 팝업: 기본은 번호·구간·닫기 / 버스 −N+ 배차간격 / 하루 수송·혼잡. ⋯로 나머지(한 바퀴, 길이, 정원, 놓침, 시간대 표, 수정·폐선)
function RoutePanel({ dm, game, r, bin, toast, onEdit, onDelete, onChange, onClose, more, setMore }: { dm: Demand; game: Game; r: Route; bin: number; toast: (t: Toast) => void; onEdit: () => void; onDelete: () => void; onChange: () => void; onClose: () => void; more: boolean; setMore: (v: boolean) => void }) {
  const [armed, setArmed] = useState(false);
  const free = game.fleet - game.usedBuses(r), demand = r.demand.reduce((a, b) => a + b, 0), carried = r.carried.reduce((a, b) => a + b, 0);
  const crowd = crowdAt(dm, r, bin);
  const setN = (n: number) => { if (n < 1) return; if (n > free) return toast({ text: <><Icon n="bus" s={14} />0</>, kind: 'warn' }); updateRoute(dm, r, r.stops, n); onChange(); };
  return <>
    <div className="ph"><span className="badge" style={{ background: r.color, color: r.tx }}>{r.num}</span><b className="pt">{r.from}↔{r.to}</b>
      <MoreBtn more={more} setMore={setMore} /><button className="pb" onClick={onClose} aria-label="닫기"><Icon n="x" s={16} /></button></div>
    <div className="pr"><button className="pb" aria-label="버스 빼기" disabled={r.buses <= 1} onClick={() => setN(r.buses - 1)}>−</button>
      <b className="ps" aria-label={`투입 버스 ${r.buses}대`}><Icon n="bus" s={14} />{r.buses}</b>
      <button className="pb" aria-label="버스 더 넣기" disabled={r.buses >= free} onClick={() => setN(r.buses + 1)}>+</button>
      <span className="ps" aria-label="배차간격"><Icon n="clock" s={14} />{fmtHw(r.headway)}′</span></div>
    <div className="pr small"><span className="ps" aria-label="하루 수송"><Icon n="person" s={13} />{fmt(carried)}</span>
      <span className={`ps ${crowd > 1 ? 'bad' : ''}`} aria-label={`지금 혼잡도 ${Math.round(crowd * 100)}%`}>{crowd > 1 && <Icon n="warn" s={13} label="정원 초과" />}<Icon n="cap" s={13} />{Math.round(crowd * 100)}%</span></div>
    {more && <>
      <div className="sub"><Icon n={r.type} s={13} label={TYPES[r.type]} /> <Icon n="stop" s={12} label="정류장" />{r.stops.length} · <Icon n="bus" s={12} label="남은 버스" />{free - r.buses}{r.example && <span className="ex">EX</span>}</div>
      <div className="quick"><Stat i="loop" v={`${Math.round(r.cyc)}′`} label="한 바퀴" /><Stat i="ruler" v={`${r.lenKm.toFixed(1)}km`} label="노선 길이 (편도)" /><Stat i="cap" v={`${fmt(r.capH)}/h`} label="시간당 정원" /></div>
      <div className="quick"><Stat i="miss" v={fmt(demand - carried)} label="하루 놓침" warn={demand - carried > 1} /></div>
      <table className="segt"><thead><tr><th /><th><Icon n="person" s={12} label="수요" />/h</th><th><Icon n="cap" s={12} label="정원" />/h</th><th /></tr></thead><tbody>
        {dm.bins.map((b, i) => { const d = r.demand[i] / binHours(b); return <tr key={i} className={i === bin ? 'now' : ''}><td><Icon n={`b${i}`} s={13} label={b.name} /> {hh(b.from)}–{hh(b.to)}</td><td>{fmt(d)}</td><td>{fmt(r.capH)}</td><td>{d > r.capH ? <Icon n="warn" s={13} label="정원 초과" className="bad" /> : <Icon n="ok" s={13} label="여유" className="good" />}</td></tr>; })}
      </tbody></table>
      <div className="row"><button className="btn icon" onClick={onEdit} aria-label="노선 수정"><Icon n="edit" s={18} /></button>
        <button className={`btn icon danger ${armed ? 'armed' : ''}`} onClick={() => (armed ? onDelete() : setArmed(true))} aria-label={armed ? '한 번 더 누르면 폐선' : '폐선'}><Icon n="trash" s={18} />{armed && '?'}</button></div>
    </>}
  </>;
}

// 재생 아이콘: 속도 단계만큼 삼각형 (▶ 1분, ▶▶ 5분, ▶▶▶ 10분 / 현실 1초)
function PlayIcon({ n }: { n: number }) {
  const w = n > 2 ? 5 : 7, x0 = (16 - w * n) / 2 + (n > 1 ? 0 : 0.5);
  return <svg viewBox="0 0 16 16">{Array.from({ length: n }, (_, i) => <path key={i} d={`M${x0 + i * w} ${n > 2 ? 4 : 2.5}v${n > 2 ? 8 : 11}l${w} ${n > 2 ? -4 : -5.5}z`} />)}</svg>;
}

// 지도 위 팝업 카드: 지도 점 at에 붙어서 지도를 움직이면 따라가고, 화면 밖으로 나가지 않게 위·아래 막대 사이에 맞춰요
function MapPopup({ map, at, wide, onClose, children }: { map: MLMap; at: [number, number]; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null), tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const card = el.current, app = card?.parentElement; if (!card || !app) return;
      const cs = getComputedStyle(app), topH = parseFloat(cs.getPropertyValue('--top-h')) || 0, barH = parseFloat(cs.getPropertyValue('--bar-h')) || 0;
      const W = app.clientWidth, H = app.clientHeight, lo = topH + 18, hi = H - barH - 10;
      card.style.maxHeight = `${Math.max(120, hi - lo)}px`;
      const p = map.project(at), w = card.offsetWidth, h = card.offsetHeight;
      const left = Math.min(Math.max(8, p.x - w / 2), W - w - 8);
      const G = 24;   // 탭한 점(노선·셀)을 가리지 않게 띄우는 거리
      let top = p.y - h - G, below = false;
      if (top < lo) { top = p.y + G; below = true; }
      top = Math.max(lo, Math.min(top, hi - h));   // 기준점이 화면 밖이어도 카드는 화면 안에
      card.style.left = `${left}px`; card.style.top = `${top}px`;
      const t = tip.current; if (t) {
        const tx = p.x - left, ok = tx > 12 && tx < w - 12 && (below ? Math.abs(top - p.y - G) < 1 : Math.abs(top + h - p.y + G) < 1);
        t.style.display = ok ? '' : 'none'; t.style.left = `${tx}px`; t.dataset.below = below ? '1' : '';
      }
    };
    place();
    map.on('move', place); const ro = new ResizeObserver(place); if (el.current) ro.observe(el.current);
    return () => { map.off('move', place); ro.disconnect(); };
  }, [map, at, wide]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return <div className={`box popup ${wide ? 'wide' : ''}`} ref={el} role="dialog"><span className="tip" ref={tip} aria-hidden="true" /><div className="pbody">{children}</div></div>;
}

function DraftPanel({ game, draft, ev, setDraft, onCancel, onDone }: { dm: Demand; game: Game; draft: Draft; ev: ReturnType<typeof evalRoute> | null; setDraft: (d: Draft) => void; onCancel: () => void; onDone: () => void }) {
  const free = game.fleet - game.usedBuses(draft.editing), ok = draft.buses <= free;
  const day = ev ? ev.carried.reduce((a, b) => a + b, 0) : 0;
  return <>
    <div className="head" style={{ justifyContent: 'space-between' }}>
      <h2 aria-label={draft.editing ? `${draft.editing.num}번 수정` : '새 노선'}>{draft.editing ? <><Icon n="edit" s={18} /> {draft.editing.num}</> : <>+<Icon n="route" s={20} /></>} <span className="sub"><Icon n="stop" s={14} label="정류장" />{draft.stops.length}{(ev?.broken || ev?.uturn) && <> <Icon n="warn" s={14} label="도로로 잇지 못한 구간" className="bad" /></>}</span></h2>
      <div className="acts">
        <button className="btn icon" disabled={!draft.stops.length} onClick={() => setDraft({ ...draft, stops: draft.stops.slice(0, -1) })} aria-label="되돌리기"><Icon n="undo" s={18} /></button>
        <button className="btn icon" onClick={onCancel} aria-label="취소"><Icon n="x" s={18} /></button>
        <button className="btn icon primary" disabled={draft.stops.length < 2 || !ok} onClick={onDone} aria-label={draft.editing ? '수정 완료' : '개설'}><Icon n="ok" s={20} /></button></div></div>
    <Stepper n={draft.buses} min={1} max={free} free={free - draft.buses} onSet={n => setDraft({ ...draft, buses: n })} />
    <div className="quick"><Stat i="clock" v={ev ? `${fmtHw(ev.headway)}′` : '–'} label="배차간격" /><Stat i="loop" v={ev ? `${Math.round(ev.cyc)}′` : '–'} label="한 바퀴" /><Stat i="person" v={ev ? fmt(day) : '–'} label="하루 수송 예상" /></div>
    {!draft.editing && <div className="seg" role="group" aria-label="노선 종류">{(Object.keys(TYPES) as RouteType[]).map(k => <button key={k} aria-pressed={draft.type === k} aria-label={TYPES[k]} onClick={() => setDraft({ ...draft, type: k })}><Icon n={k} s={20} /></button>)}</div>}
  </>;
}

function CompanyPanel({ game }: { game: Game }) {
  return <>
    <div className="quick"><Stat i="flag" v={fmt(game.target)} label={`하루 목표 (버스 ${game.goalFleet}대 × ${RULES.perBus})`} /><Stat i="person" v={fmt(game.todayRiders)} label="오늘 수송" /><Stat i="miss" v={fmt(game.todayMissed)} label="오늘 놓침" /></div>
    <div className="quick"><Stat i="route" v={game.routes.length} label="노선 수" /><Stat i="up" v={`${game.hit}/${RULES.bonusDays}`} label="목표 150% 연속 달성 일수" /><Stat i="warn" v={`${game.miss}/${RULES.maxMiss}`} label="연속 미달 일수" warn={game.miss > 0} /></div>
  </>;
}
