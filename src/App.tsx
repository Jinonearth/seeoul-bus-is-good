import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { latLngToCell, cellToParent, cellToChildren, gridDisk, cellToLatLng } from 'h3-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { type Demand, loadDemand, binHours, stopable, snapped } from './game/data';
import { loadRoads } from './game/roads';
import { SEED_TRUNK, SEED_BRANCH, SEED_CIRC } from './game/seeds';
import { type Route, type RouteType, TYPES, RULES, BUS_CAP, routeName, resetRouteIds, makeRoute, updateRoute, setBusCount, evalRoute, routePath, routeStyle, WALK } from './game/model';
import { Game, fmt, fmtK, type Settle } from './game/state';

type Toast = { text: React.ReactNode; kind?: 'good' | 'warn' };
import { Icon } from './ui/Icon';
import { GameMap, type Layer, type Flow, setCoverage, resForZoom } from './map/GameMap';

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
  // 노선 캐러셀: 양 끝 흐림(더 있음), 고른 노선은 보이게 스크롤
  const carEl = useRef<HTMLDivElement>(null), [fade, setFade] = useState('');
  const onCarScroll = useCallback(() => {
    const c = carEl.current; if (!c) return;
    setFade(`${c.scrollLeft > 4 ? 'fl' : ''} ${c.scrollLeft + c.clientWidth < c.scrollWidth - 4 ? 'fr' : ''}`.trim());
  }, []);
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
    game.onSettle = (x: Settle) => toast({ kind: x.ok ? 'good' : 'warn', text: <>D{x.day} <Icon n={x.ok ? 'ok' : 'x'} s={14} /> <Icon n="person" s={14} />{fmtK(x.got)}/{fmtK(x.target)}{!x.ok && <> <Icon n="warn" s={14} />{x.miss}/{RULES.maxMiss}</>}{x.ok && x.hit > 0 && <> <Icon n="up" s={14} />{x.hit}/{RULES.bonusDays}</>}{x.grow > 0 && <> <Icon n="bus" s={14} />+{x.grow}</>}</> }); game.onOver = rerender;
    // 개발 모드(StrictMode)는 이 effect를 두 번 실행해요. 예시 노선이 두 벌 생기면 버스가 모자라 새 노선을 못 만들어요
    if (!game.routes.length) {
      // 예시 노선 3개(간선·지선·순환), 버스 40대 중 31대. 남은 9대로 바로 새 노선을 만들 수 있어요
      resetRouteIds();
      game.routes.push(makeRoute(dm, 'trunk', SEED_TRUNK.filter(stopable), 16, true));
      game.routes.push(makeRoute(dm, 'branch', SEED_BRANCH.filter(stopable), 7, true));
      game.routes.push(makeRoute(dm, 'circ', SEED_CIRC.filter(stopable), 8, true));
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
      game.advance(dt * game.speed); game.fade(dt);
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
    m.onTap = ({ lngLat, route, stop }) => {
      const d = draftRef.current;
      if (d) {   // 노선 그리기: 탭한 헥사곤(res9)마다 정류장 하나
        let c = latLngToCell(lngLat[1], lngLat[0], 9);
        // 탭한 칸에 정류장을 둘 수 없으면: 지금 줌에서 보이는 헥사곤(res7·8) 안 res9 칸, res9 줌이면 탭한 칸과 이웃 6칸 중
        // 정류장 자리(도로 위 점)가 탭한 점에 가장 가까운 칸으로. 바로 앞 정류장과 같은 칸은 빼요
        const res = resForZoom(m.map.getZoom()), prev = d.stops[d.stops.length - 1];
        if (!stopable(c)) {
          const cand = res < 9 ? cellToChildren(cellToParent(c, res), 9) : gridDisk(c, 1);
          const near = cand.filter(x => stopable(x) && x !== prev)
            .map(x => { const p = snapped(x); return [x, ((p[0] - lngLat[0]) * 0.79) ** 2 + (p[1] - lngLat[1]) ** 2] as const; })
            .sort((a, b) => a[1] - b[1])[0];
          if (near) { c = near[0]; m.flash(c); }
        }
        if (!dm.byId.has(c) || !stopable(c)) return toast({ text: <><Icon n="x" s={14} /><Icon n="stop" s={14} /></>, kind: 'warn' });
        if (d.stops[d.stops.length - 1] === c) return;
        setDraft({ ...d, stops: [...d.stops, c] }); return;
      }
      if (stop) { setSel({ kind: 'hex', cell: stop, at: snapped(stop) }); return; }   // 정류장을 누르면 그 칸 카드 (지나는 노선 번호)
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
      const rp = routePath(draft.stops, (draft.editing?.type ?? draft.type) === 'circ');
      m.setDraft(rp.path, rp.outN, draft.stops.map(snapped), color);   // 정류장 표시는 셀마다 하나
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

  const nRoutes = game.routes.length;
  // 마우스로도 넘기기: 세로 휠 → 가로, 끌어서 넘기기(5px 넘게 움직이면 끌기, 그때는 칩 누름 무시)
  useEffect(() => {
    const c = carEl.current; if (!c) return;
    const wheel = (e: WheelEvent) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && c.scrollWidth > c.clientWidth) { e.preventDefault(); c.scrollLeft += e.deltaY; } };
    let x0 = 0, s0 = 0, down = false, drag = false;
    const pd = (e: PointerEvent) => { if (e.pointerType !== 'mouse' || e.button !== 0) return; down = true; drag = false; x0 = e.clientX; s0 = c.scrollLeft; };
    const pm = (e: PointerEvent) => { if (!down) return; const dx = e.clientX - x0; if (!drag && Math.abs(dx) > 5) { drag = true; c.style.scrollSnapType = 'none'; c.setPointerCapture(e.pointerId); } if (drag) c.scrollLeft = s0 - dx; };
    const pu = (e: PointerEvent) => { if (!down) return; down = false; if (drag) { c.releasePointerCapture?.(e.pointerId); c.style.scrollSnapType = ''; } };
    const click = (e: MouseEvent) => { if (drag) { e.stopPropagation(); e.preventDefault(); drag = false; } };
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('pointerdown', pd); c.addEventListener('pointermove', pm); c.addEventListener('pointerup', pu); c.addEventListener('pointercancel', pu); c.addEventListener('click', click, true);
    return () => { c.removeEventListener('wheel', wheel); c.removeEventListener('pointerdown', pd); c.removeEventListener('pointermove', pm); c.removeEventListener('pointerup', pu); c.removeEventListener('pointercancel', pu); c.removeEventListener('click', click, true); };
  }, []);
  useEffect(() => { onCarScroll(); }, [nRoutes, onCarScroll]);
  useEffect(() => {
    if (focusId == null) return;
    carEl.current?.querySelector(`[data-rid="${focusId}"]`)?.scrollIntoView({ inline: 'start', block: 'nearest', behavior: 'smooth' });
  }, [focusId, nRoutes]);
  // 노선 팝업은 노선 맨 위(가장 북쪽) 점에 붙여서, 위로 뜬 카드가 노선을 덮지 않게
  const routeAt = route ? route.path.reduce((a, p) => (p[1] > a[1] ? p : a), route.path[0]) : null;
  // 노선을 고르면 한 바퀴 전체가 위 상태 막대·팝업과 아래 막대 사이에 보이게 (같은 노선을 다시 고르면 그대로)
  useEffect(() => {
    const m = gm.current?.map, r = game.routes.find(x => x.id === focusId), app = appEl.current;
    if (!m || !r || !app || r.path.length < 2) return;
    const cs = getComputedStyle(app), topH = parseFloat(cs.getPropertyValue('--top-h')) || 50, barH = parseFloat(cs.getPropertyValue('--bar-h')) || 110;
    const popH = (app.querySelector('.popup') as HTMLElement | null)?.offsetHeight ?? 120;
    let w = 180, so = 90, e = -180, n = -90; for (const [x, y] of r.path) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); }
    m.fitBounds([[w, so], [e, n]], { padding: { top: topH + 8 + popH + 36, bottom: barH + 24, left: 28, right: 28 }, maxZoom: 15, duration: 600 });
  }, [focusId, game]);
  const speedName = (n: number) => `1초에 게임 ${n}분`;

  return (
    <div id="stage"><div id="app" ref={appEl} data-draw={draft ? '1' : undefined}>
      <div id="map" ref={mapEl} className={draft ? 'drawing' : ''} />

      {/* 위: 회사 상태 (수송·목표, 페이스, 연속 미달, 버스). 누르면 회사 현황 */}
      <header className="box" id="topbar">
        <div className="r2" onClick={() => setStats(x => !x)}>
          <span className="got" aria-label={`오늘 수송 ${fmt(got)}명, 목표 ${fmt(t)}명`}><Icon n="person" s={14} /><b>{fmtK(got)}</b><span className="muted">/{fmtK(t)}</span></span>
            <span className="satw">
              <span className="meter goal" aria-hidden="true"><i style={{ width: `${Math.min(100, got / full * 100)}%` }} /><u style={{ left: `${Math.min(100, share / RULES.bonus * 100)}%` }} /><s /></span>
              {got >= t * share ? <b className="pace ok"><Icon n="up" s={14} label="목표 페이스 넘김" /></b> : <b className="pace bad"><Icon n="down" s={14} label="목표 페이스 부족" /></b>}
              <span className="streak" role="img" aria-label={`연속 미달 ${game.miss}일 (3일이면 게임 오버)`}>{Array.from({ length: RULES.maxMiss }, (_, i) => <i key={i} className={i < game.miss ? 'on' : ''} />)}</span>
            </span>
            <div className="money" aria-label={`운행 버스 ${game.usedBuses()}대, 보유 ${game.fleet}대`}><Icon n="bus" s={18} /><span className="v">{game.usedBuses()}<span className="muted">/{game.fleet}</span></span></div>
            <button className="more" aria-expanded={stats} aria-label={stats ? '회사 현황 접기' : '회사 현황 펼치기'}><svg viewBox="0 0 16 16"><path d={stats ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'} /></svg></button>
        </div>
        {stats && <div className="panel"><CompanyPanel game={game} /></div>}
      </header>

      <div className="toasts">{toasts.map(x => <div key={x.id} className={`toast ${x.kind ?? ''}`}>{x.text}</div>)}</div>

      {/* 지도 위 버튼: 아래 노선 막대 바로 위 */}
      <button className="box" id="legend" onClick={() => setLayer(l => (l === 'o' ? 'd' : l === 'd' ? 'u' : 'o'))} aria-label={`수요 레이어 바꾸기, 지금 ${LAYER_NAME[layer]}`}>
        <i className="dot" aria-hidden="true" /><Icon n={LAYER_ICON[layer]} s={20} />
      </button>
      <div className="box" id="helpbox"><button className="zb" aria-pressed={help} aria-label="화면 설명" onClick={() => setHelp(h => !h)}>?</button></div>
      <div className="box" id="zoom">
        <button className="zb" aria-label="확대" onClick={() => gm.current?.map.zoomIn()}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
        <button className="zb" aria-label="축소" onClick={() => gm.current?.map.zoomOut()}><svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg></button>
      </div>

      {/* 지도 위 팝업: 노선 / 헥사곤 */}
      {gm.current && route && routeAt && <MapPopup map={gm.current.map} at={routeAt} wide={more} onClose={() => setSel(null)}>
        <RoutePanel dm={dm} game={game} r={route} bin={bin} toast={toast} onClose={() => setSel(null)} more={more} setMore={setMore} onEdit={() => { setDraft({ stops: [...route.stops], type: route.type, buses: route.buses, editing: route }); setSel({ kind: 'draft' }); }}
          onDelete={() => { game.routes = game.routes.filter(x => x !== route); setSel(null); redrawRoutes(); toast({ text: <><Icon n="trash" s={14} />{route.num} <Icon n="bus" s={14} />+{route.buses}</> }); }}
          onChange={() => { redrawRoutes(); rerender(); }} />
      </MapPopup>}
      {gm.current && sel?.kind === 'hex' && <MapPopup map={gm.current.map} at={sel.at} wide={more} onClose={() => setSel(null)}>
        <HexPanel dm={dm} cell={sel.cell} bin={bin} routes={game.routes.filter(r => r.stops.includes(sel.cell))} onRoute={id => setSel({ kind: 'route', id })} more={more} setMore={setMore} onClose={() => setSel(null)} onStart={() => startDraft(latLngToCell(...cellToLatLng(sel.cell), 9))} />
      </MapPopup>}

      {/* 아래: 노선 막대 + 재생 줄 (그리는 중엔 노선 그리기 패널) */}
      <footer id="bottom" ref={barEl}>
        {draft ? <div className="box panel"><DraftPanel dm={dm} game={game} draft={draft} ev={draftEval} setDraft={setDraft} onCancel={cancelDraft} onDone={finishDraft} /></div> : <>
        {/* + 는 왼쪽 고정, 노선은 옆으로 넘기는 캐러셀 */}
        <div className="box" id="routebar">
          <button className="chip add" onClick={() => startDraft()} aria-label="새 노선 만들기">+</button>
          <i className="divider" aria-hidden="true" />
          <div className={`carousel ${fade}`} ref={carEl} onScroll={onCarScroll}>
          {game.routes.map(r => <button key={r.id} data-rid={r.id} className="chip" aria-pressed={focusId === r.id} aria-label={`${r.num}번 ${TYPES[r.type]}, ${r.type === 'circ' ? `${routeName(r)} 순환` : `${r.from}에서 ${r.to}`}, 버스 ${r.buses}대, 배차 ${fmtHw(r.headway)}분`} onClick={() => setSel(focusId === r.id ? null : { kind: 'route', id: r.id })}>
            <span className="n" style={{ background: r.color, color: r.tx }}>{r.num}</span>
            <span className="m"><span><Icon n="bus" s={13} />{r.buses}</span><span><Icon n="clock" s={13} />{fmtHw(r.headway)}′</span></span></button>)}
          </div>
        </div>
          <div className="box r1">
            <div className="when" aria-label={`${game.day}일차 ${hhmm(game.minuteOfDay)}`}><span className="day">D{game.day}</span><span className="bar" aria-hidden="true">|</span><span className="clock">{hhmm(game.minuteOfDay)}</span></div>
            <div className="seg speed" role="group" aria-label="시간 속도">
              <button aria-pressed={game.speed === 0} aria-label="일시정지" onClick={() => { game.pause(); rerender(); }}><svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg></button>
              {Game.SPEEDS.map((v, i) => <button key={v} aria-pressed={game.speed === v} aria-label={speedName(v)} onClick={() => { game.setSpeed(v); rerender(); }}><Tri n={i + 1} /></button>)}
            </div>
          </div>
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
          <dt><Icon n="bus" /></dt><dd>버스 (운행/보유)</dd><dt><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" fill="#fff" stroke="#1D1D1B" strokeWidth="2" /><rect x="2" y="2" width="4" height="12" fill="#009E73" /><rect x="6" y="2" width="4" height="12" fill="#F0E442" /><rect x="10" y="2" width="4" height="12" fill="#D55E00" /></svg></dt><dd>버스 채움 = 탄 사람 (초록 여유 · 노랑 붐빔 · 빨강 만원)</dd><dt><Icon n="person" /></dt><dd>수송 인원 (오늘/목표)</dd><dt><Icon n="miss" /></dt><dd>못 태운 승객</dd>
          <dt><Icon n="clock" /></dt><dd>배차간격 (′ = 분)</dd><dt><Icon n="loop" /></dt><dd>한 바퀴 시간 (가는 길 + 오는 길)</dd><dt><Icon n="ruler" /></dt><dd>노선 길이 (편도 = 한 바퀴의 절반)</dd><dt><Icon n="cap" /></dt><dd>시간당 정원</dd>
          <dt><Icon n="up" /><Icon n="down" /></dt><dd>목표 페이스 넘김/부족</dd><dt><span className="streak"><i className="on" /><i /><i /></span></dt><dd>연속 미달 (3칸이면 게임 오버)</dd>
          <dt><Icon n="trunk" /><Icon n="branch" /><Icon n="circ" /></dt><dd>간선 · 지선 · 순환</dd>
          <dt><Icon n="b0" /><Icon n="b1" /><Icon n="b2" /><Icon n="b3" /><Icon n="b4" /></dt><dd>출근 · 낮 · 퇴근 · 저녁 · 심야</dd>
        </dl>
        <p><b>노선:</b> 아래 노선 막대의 + 를 누르고 헥사곤을 하나씩 탭하면 그 칸마다 정류장이 생겨요. 그리는 동안 노선 막대와 재생 줄이 노선 그리기 패널로 바뀌어요. 투입할 버스 대수를 정하면 배차간격이 계산돼요. 정류장이 많을수록 한 바퀴가 길어져 간격이 벌어져요.</p>
        <p><b>지도:</b> 헥사곤이나 노선을 누르면 지도 위에 카드가 떠요. 헥사곤 카드에서는 그 칸에서 가고 싶은 곳(파랑 실선)과 오고 싶은 곳(주황 점선)이 보여요. 멀리서 보면 노선은 단순한 선 하나로 보여요.</p>
        <p><b>화면:</b> 위는 회사 상태(오늘 수송/목표, 페이스, 연속 미달, 버스)예요. 누르면 회사 현황이 펼쳐져요. 아래는 노선 막대(+로 새 노선)와 날짜·시각·속도 줄이에요. 지금 시간대는 위 막대를 펼치면 보여요.</p>
        <p><b>시간:</b> 아래 줄 오른쪽에서 속도를 골라요: ❚❚ 멈춤, ▶·▶▶·▶▶▶ = 현실 1초에 게임 1분·5분·10분.</p>
        <p><b>지하철:</b> 지도의 흐린 색 선이 지하철이에요(줌을 당기면 보여요). 지하철이 빠른 구간은 버스 수요가 줄어요.</p>
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

// 헥사곤 팝업: 동 이름(구) ⌄ ✕ / 지금 시간당 출발·도착 / + 여기서 노선. ⌄로 시간대 그래프와 가고 싶은 곳·오고 싶은 곳
function HexPanel({ dm, cell, bin, routes, onRoute, onStart, onClose, more, setMore }: { dm: Demand; cell: string; bin: number; routes: Route[]; onRoute: (id: number) => void; onStart: () => void; onClose: () => void; more: boolean; setMore: (v: boolean) => void }) {
  const [lat, lng] = cellToLatLng(cell), c9 = dm.byId.get(latLngToCell(lat, lng, 9));
  const res = parseInt(cell[1], 16) & 15;
  const agg = res === 9 ? c9 : dm.parents[res === 7 ? 0 : 1].get(cell);
  if (!agg || !c9) return null;
  const perH = (v: number[], b: number) => v[b] / binHours(dm.bins[b]);
  const { out } = flowsOf(dm, cell, bin), maxV = Math.max(1, ...out.map(o => o.v));
  const peak = Math.max(...dm.bins.map((_, b) => Math.max(perH(agg.O, b), perH(agg.D, b))));
  return <>
    <div className="ph"><b className="pt">{dm.dongs[c9.dong].n}<small>{dm.dongs[c9.dong].gu}</small></b>
      <MoreBtn more={more} setMore={setMore} /><button className="pb" onClick={onClose} aria-label="닫기"><Icon n="x" s={14} /></button></div>
    <div className="pg"><span aria-label="지금 시간당 출발"><Icon n="out" s={14} /><b>{fmt(perH(agg.O, bin))}</b><small>/h</small></span><span aria-label="지금 시간당 도착"><Icon n="in" s={14} /><b>{fmt(perH(agg.D, bin))}</b><small>/h</small></span></div>
    {routes.length > 0 && <div className="proutes" aria-label="이 정류장에 서는 노선">{routes.map(r => <button key={r.id} className="badge" style={{ background: r.color, color: r.tx }} onClick={() => onRoute(r.id)} aria-label={`${r.num}번`}>{r.num}</button>)}</div>}
    <button className="pgo" onClick={onStart} aria-label="여기서 노선 시작">+ <Icon n="route" s={16} /></button>
    {more && <>
      <div className="psec"><div className="bins">{dm.bins.map((b, i) => <div key={i} className={i === bin ? 'now' : ''} aria-label={`${b.name} 출발 ${fmt(perH(agg.O, i))}, 도착 ${fmt(perH(agg.D, i))} (시간당)`}>
        <span className="bo" style={{ height: `${perH(agg.O, i) / peak * 100}%` }} /><span className="bd" style={{ height: `${perH(agg.D, i) / peak * 100}%` }} /><small><Icon n={`b${i}`} s={13} /></small></div>)}</div></div>
      {(['out', 'in'] as const).map(k => <div className="psec" key={k}><div className="ih"><Icon n={k} s={14} label={k === 'out' ? '여기서 가고 싶은 곳' : '여기로 오고 싶은 곳'} /><span className={`swatch ${k}`} aria-hidden="true" /></div>
        <div className="plist">{out.filter(o => o.out === (k === 'out')).map(o => <div key={o.name}><span>{o.name}</span><i style={{ width: `${o.v / maxV * 48}px` }} /><b>{fmt(o.v / binHours(dm.bins[bin]))}</b></div>)}</div></div>)}
    </>}
  </>;
}

const MoreBtn = ({ more, setMore }: { more: boolean; setMore: (v: boolean) => void }) =>
  <button className="pb" aria-expanded={more} aria-label={more ? '자세히 접기' : '자세히'} onClick={() => setMore(!more)}><svg className="chev" viewBox="0 0 16 16"><path d={more ? 'M3 10l5-5 5 5' : 'M3 6l5 5 5-5'} /></svg></button>;

// 버스 대수: 숫자 뒤에 [−|+] 한 덩어리 (보이는 칸 22px, 누르는 범위 40px)
const PM = ({ dec, inc, onDec, onInc }: { dec: boolean; inc: boolean; onDec: () => void; onInc: () => void }) =>
  <span className="pm" role="group" aria-label="버스 대수"><button aria-label="버스 빼기" disabled={dec} onClick={onDec}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6" /></svg></button><button aria-label="버스 더 넣기" disabled={inc} onClick={onInc}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5h6M5 2v6" /></svg></button></span>;

function Stepper({ n, min, max, onSet, free }: { n: number; min: number; max: number; onSet: (n: number) => void; free: number }) {
  return <div className="hw"><b aria-label={`투입 버스 ${n}대`}><Icon n="bus" s={18} />{n}</b>
    <PM dec={n <= min} inc={n >= max} onDec={() => onSet(n - 1)} onInc={() => onSet(n + 1)} />
    <span className="need" aria-label={`남은 버스 ${free}대`}><Icon n="bus" s={13} />{free}</span></div>;
}

// 노선 팝업: 노선색 띠 / 번호·이름·종류 ⌄ ✕ / 🚌 −N+ | 🕒 배차 / 👤 오늘 | 탑승률. ⌄로 한 바퀴·길이, 정원·놓침, 시간대 표, 수정·폐선
function RoutePanel({ dm, game, r, bin, toast, onEdit, onDelete, onChange, onClose, more, setMore }: { dm: Demand; game: Game; r: Route; bin: number; toast: (t: Toast) => void; onEdit: () => void; onDelete: () => void; onChange: () => void; onClose: () => void; more: boolean; setMore: (v: boolean) => void }) {
  const [armed, setArmed] = useState(false);
  const free = game.fleet - game.usedBuses(r), demand = r.demand.reduce((a, b) => a + b, 0), carried = r.carried.reduce((a, b) => a + b, 0);
  const crowd = r.bus.length ? r.bus.reduce((a, b) => a + b.on, 0) / r.bus.length / BUS_CAP : 0;   // 지금 버스들 평균 탑승률
  const full = r.bus.some(b => b.full);
  const setN = (n: number) => { if (n < 1) return; if (n > free) return toast({ text: <><Icon n="bus" s={14} />0</>, kind: 'warn' }); setBusCount(dm, r, n); onChange(); };
  return <>
    <span className={`pstrip p${r.pattern}`} style={{ '--rc': r.color } as React.CSSProperties} aria-hidden="true" />
    <div className="ph"><span className="badge" style={{ background: r.color, color: r.tx }} aria-label={`${r.num}번, ${r.type === 'circ' ? `${routeName(r)} 순환` : `${r.from}에서 ${r.to}`}`}>{r.num}</span><Icon n={r.type} s={14} label={TYPES[r.type]} className="mut" /><span className="pt" />
      <MoreBtn more={more} setMore={setMore} /><button className="pb" onClick={onClose} aria-label="닫기"><Icon n="x" s={14} /></button></div>
    <div className="pg">
      <span><Icon n="bus" s={14} /><b aria-label={`투입 버스 ${r.buses}대`}>{r.buses}</b><PM dec={r.buses <= 1} inc={r.buses >= free} onDec={() => setN(r.buses - 1)} onInc={() => setN(r.buses + 1)} /></span>
      <span aria-label="배차간격"><Icon n="clock" s={14} /><b>{fmtHw(r.headway)}′</b></span>
      <span aria-label="오늘 탄 사람"><Icon n="person" s={14} /><b>{fmtK(r.today ?? 0)}</b></span>
      <span className={full ? 'bad' : ''} aria-label={`지금 버스 평균 탑승률 ${Math.round(crowd * 100)}%${full ? ', 만차로 못 탄 사람 있음' : ''}`}><i className="pmeter"><i style={{ width: `${Math.min(100, crowd * 100)}%` }} /></i><b>{Math.round(crowd * 100)}%</b>{full && <Icon n="warn" s={14} />}</span>
      {more && <>
        <span aria-label="한 바퀴"><Icon n="loop" s={14} /><b>{Math.round(r.cyc)}′</b></span>
        <span aria-label="노선 길이 (편도)"><Icon n="ruler" s={14} /><b>{r.lenKm.toFixed(1)}</b><small>km</small></span>
        <span aria-label="시간당 정원"><Icon n="cap" s={14} /><b>{fmt(r.capH)}</b><small>/h</small></span>
        <span className={demand - carried > 1 ? 'bad' : ''} aria-label="하루 놓침 예상"><Icon n="miss" s={14} /><b>~{fmt(demand - carried)}</b></span>
        <span aria-label="정류장"><Icon n="stop" s={14} /><b>{r.stops.length}</b></span>
        <span aria-label="남은 버스"><Icon n="bus" s={14} /><small>+</small><b>{free - r.buses}</b>{r.example && <small className="ex">EX</small>}</span>
      </>}
    </div>
    {more && <>
      <table className="ptab"><thead><tr><th /><th><Icon n="person" s={12} label="수요" />/h</th><th><Icon n="cap" s={12} label="정원" />/h</th><th /></tr></thead><tbody>
        {dm.bins.map((b, i) => { const d = r.demand[i] / binHours(b); return <tr key={i} className={i === bin ? 'now' : ''}><td><Icon n={`b${i}`} s={12} label={b.name} /> {hh(b.from)}–{hh(b.to)}</td><td>{fmt(d)}</td><td>{fmt(r.capH)}</td><td>{d > r.capH ? <Icon n="warn" s={12} label="정원 초과" className="bad" /> : <Icon n="ok" s={12} label="여유" className="good" />}</td></tr>; })}
      </tbody></table>
      <div className="pacts"><button onClick={onEdit} aria-label="노선 수정"><Icon n="edit" s={16} /></button>
        <button className={`danger ${armed ? 'armed' : ''}`} onClick={() => (armed ? onDelete() : setArmed(true))} aria-label={armed ? '한 번 더 누르면 폐선' : '폐선'}><Icon n="trash" s={16} />{armed && '?'}</button></div>
    </>}
  </>;
}

// 속도 아이콘: 삼각형 1·2·3개 (1분·5분·10분 / 현실 1초)
const Tri = ({ n }: { n: number }) => <svg viewBox={`0 0 ${7 * n + 2} 16`} style={{ width: 7 * n + 2, height: 16 }}>{Array.from({ length: n }, (_, i) => <path key={i} d={`M${1 + i * 7} 2.5v11l7-5.5z`} />)}</svg>;

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
    <div className="quick"><Stat i="clock" v={ev ? `${fmtHw(ev.headway)}′` : '–'} label="배차간격" /><Stat i="loop" v={ev ? `${Math.round(ev.cyc)}′` : '–'} label="한 바퀴" /><Stat i="person" v={ev ? `~${fmt(day)}` : '–'} label="하루 수송 예상" /></div>
    {!draft.editing && <div className="seg" role="group" aria-label="노선 종류">{(Object.keys(TYPES) as RouteType[]).map(k => <button key={k} aria-pressed={draft.type === k} aria-label={TYPES[k]} onClick={() => setDraft({ ...draft, type: k })}><Icon n={k} s={20} /></button>)}</div>}
  </>;
}

function CompanyPanel({ game }: { game: Game }) {
  return <>
    <div className="quick"><Stat i="flag" v={fmtK(game.target)} label={`하루 목표 (버스 ${game.goalFleet}대 × ${RULES.perBus})`} /><Stat i="person" v={fmtK(game.todayRiders)} label="오늘 수송" /><Stat i="miss" v={fmtK(game.todayMissed)} label="오늘 놓침" /></div>
    <div className="quick"><Stat i="route" v={game.routes.length} label="노선 수" /><Stat i="up" v={`${game.hit}/${RULES.bonusDays}`} label="목표 150% 연속 달성 일수" /><Stat i="warn" v={`${game.miss}/${RULES.maxMiss}`} label="연속 미달 일수" warn={game.miss > 0} /></div>
    <div className="quick"><Stat i={`b${game.bin}`} v={`${hh(game.dm.bins[game.bin].from)}–${hh(game.dm.bins[game.bin].to)}`} label={`지금 시간대: ${game.dm.bins[game.bin].name}`} /></div>
  </>;
}
