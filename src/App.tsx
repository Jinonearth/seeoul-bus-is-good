import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { latLngToCell, cellToParent, gridDisk, cellToLatLng, gridPathCells } from 'h3-js';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import { type Demand, loadDemand, binHours } from './game/data';
import { type Route, type RouteType, TYPES, RULES, makeRoute, updateRoute, evalRoute, routePath, routeStyle, crowdAt, PATTERNS } from './game/model';
import { Game, fmt, type Toast } from './game/state';
import { GameMap, type Layer, type Flow, setCoverage } from './map/GameMap';

type Sel = { kind: 'hex'; cell: string } | { kind: 'route'; id: number } | { kind: 'draft' } | null;
type Draft = { stops: string[]; type: RouteType; buses: number; editing?: Route };
const LAYER_NAME: Record<Layer, string> = { o: '출발 수요', d: '도착 수요', u: '버스가 닿지 않는 출발 수요' };
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
  const mapEl = useRef<HTMLDivElement>(null);
  const gm = useRef<GameMap | null>(null);
  const game = useMemo(() => new Game(dm), [dm]);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);
  const [sel, setSel] = useState<Sel>(null);
  const [layer, setLayer] = useState<Layer>('o');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sheet, setSheet] = useState<'peek' | 'open'>('peek');
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
    const covered = new Set<string>(); for (const r of game.routes) for (const s of r.stops) for (const c of gridDisk(s, 1)) covered.add(c);
    setCoverage(covered, (id, res) => cellToParent(id, res));
    m.setDemand(layer, game.bin, covered);
  }, [game, layer]);

  // 지도 만들기 + 예시 노선 2개
  useEffect(() => {
    const m = new GameMap(mapEl.current!, dm); gm.current = m;
    game.onToast = toast; game.onOver = rerender;
    // 예시 노선: 지나는 헥사곤 두 칸마다 정류장 (실제 서울 버스 정류장 간격 약 500m)
    const cells = (pts: [number, number][]) => {
      const key = pts.map(([lng, lat]) => latLngToCell(lat, lng, 9)), all: string[] = [key[0]];
      for (let i = 1; i < key.length; i++) all.push(...gridPathCells(key[i - 1], key[i]).slice(1));
      return all.filter((_, i) => i % 2 === 0 || i === all.length - 1);
    };
    game.routes.push(makeRoute(dm, 'trunk', cells([[127.062, 37.655], [127.056, 37.636], [127.047, 37.618], [127.03, 37.602], [127.012, 37.588], [126.998, 37.571], [126.992, 37.566], [127.007, 37.548], [127.017, 37.535], [127.027, 37.519], [127.035, 37.502]]), 18, true));
    game.routes.push(makeRoute(dm, 'branch', cells([[126.93, 37.484], [126.918, 37.486], [126.908, 37.487], [126.896, 37.484], [126.885, 37.48], [126.875, 37.495]]), 6, true));
    m.ready.then(() => { redrawRoutes(); rerender(); });
    return () => m.map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dm]);

  useEffect(() => { gm.current?.map.loaded() && redrawRoutes(); }, [layer, focusId, redrawRoutes]);

  // 시간 흐름: 1배속 = 초당 게임 2분
  useEffect(() => {
    let last = performance.now(), acc = 0, lastBin = game.bin, raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      game.advance(dt * 2 * game.speed);
      const m = gm.current;
      if (m?.map.loaded()) {
        m.setBuses(game.routes, game.bin, selRef.current?.kind === 'route' ? selRef.current.id : null);
        if (game.bin !== lastBin) { lastBin = game.bin; redrawRoutes(); }
      }
      acc += dt; if (acc > 0.25) { acc = 0; rerender(); }
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
        if (!dm.byId.has(c)) return toast({ text: '서울 안에서만 정류장을 만들 수 있어요.', kind: 'warn' });
        if (d.stops[d.stops.length - 1] === c) return;
        setDraft({ ...d, stops: [...d.stops, c] }); return;
      }
      if (route != null) { setSel({ kind: 'route', id: route }); setSheet('open'); return; }
      const c = m.cellAt(lngLat);
      const inSeoul = dm.byId.has(latLngToCell(lngLat[1], lngLat[0], 9));
      if (!inSeoul) { setSel(null); return; }
      setSel({ kind: 'hex', cell: c }); setSheet('open');
    };
  }, [dm, toast]);

  // 선택 셀 테두리 + 수요 흐름
  useEffect(() => {
    const m = gm.current; if (!m?.map.loaded()) return;
    if (sel?.kind === 'hex') { m.setSelected(sel.cell); m.setFlows(flowsOf(dm, sel.cell, game.bin).flows); }
    else { m.setSelected(null); m.setFlows([]); }
  }, [sel, dm, game, game.bin]);

  // 그리는 중인 노선
  const draftEval = useMemo(() => (draft && draft.stops.length >= 2 ? evalRoute(dm, draft.stops, draft.buses, draft.type) : null), [dm, draft]);
  useEffect(() => {
    const m = gm.current; if (!m?.map.loaded()) return;
    if (!draft) { m.setDraft([], [], ''); return; }
    const color = draft.editing?.color ?? routeStyle(game.routes.length).color;
    m.setDraft(draft.stops.length > 1 ? routePath(draft.stops).path : [], draft.stops, color);
  }, [draft, game]);

  const startDraft = (first?: string) => { setDraft({ stops: first ? [first] : [], type: 'trunk', buses: Math.min(4, Math.max(1, game.freeBuses)) }); setSel({ kind: 'draft' }); setSheet('open'); };
  const cancelDraft = () => { setDraft(null); setSel(null); setSheet('peek'); };
  const finishDraft = () => {
    if (!draft || draft.stops.length < 2) return;
    const free = game.fleet - game.usedBuses(draft.editing);
    if (draft.buses > free) return toast({ text: `남은 버스가 ${free}대뿐이에요.`, kind: 'warn' });
    let r: Route;
    if (draft.editing) { r = draft.editing; updateRoute(dm, r, draft.stops, draft.buses); toast({ text: `${r.num}번 노선을 고쳤어요.`, kind: 'good' }); }
    else { r = makeRoute(dm, draft.type, draft.stops, draft.buses); game.routes.push(r); toast({ text: `${r.num}번 ${TYPES[r.type]}버스를 개설했어요. 버스 ${r.buses}대 투입, 배차 ${fmtHw(r.headway)}분.`, kind: 'good' }); }
    setDraft(null); setSel({ kind: 'route', id: r.id }); redrawRoutes();
  };

  const route = sel?.kind === 'route' ? game.routes.find(r => r.id === sel.id) : undefined;
  const bin = game.bin, t = game.target, got = game.todayRiders, share = game.dayShare();
  const full = t * RULES.bonus;

  return (
    <div id="stage"><div id="app" data-sheet={sel?.kind === 'draft' ? 'draft' : sheet}>
      <div id="map" ref={mapEl} className={draft ? 'drawing' : ''} />

      <header className="box" id="hud">
        <div className="r1">
          <div className="when"><span className="clock">{hhmm(game.minuteOfDay)}</span>
            <span className="day">{game.day}일차 <span className="seg-chip">{dm.bins[bin].name} {String(dm.bins[bin].from).padStart(2, '0')}–{String(dm.bins[bin].to).padStart(2, '0')}</span></span></div>
          <div className="speed" role="group" aria-label="시간 속도">
            {[0, 1, 4].map(s => <button key={s} aria-pressed={game.speed === s} aria-label={s ? `${s}배속` : '일시정지'} onClick={() => { game.speed = s; rerender(); }}>
              {s === 0 ? <svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg>
                : s === 1 ? <svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z" /></svg> : <svg viewBox="0 0 16 16"><path d="M1 3v10l7-5zM8 3v10l7-5z" /></svg>}
              {s > 0 && <small>{s}×</small>}</button>)}
          </div>
          <div className="money"><span className="lbl">운행 버스</span><span className="v">{game.usedBuses()}/{game.fleet}</span></div>
        </div>
        <div className="r2">
          <span>오늘 수송 <b>{fmt(got)}</b><span className="muted"> / {fmt(t)}</span></span>
          <span className="satw">
            <span className="meter goal" aria-hidden="true"><i style={{ width: `${Math.min(100, got / full * 100)}%` }} /><u style={{ left: `${Math.min(100, share / RULES.bonus * 100)}%` }} /><s /></span>
            <b className="pace">{got >= t * share ? '페이스 OK' : '페이스 부족'}</b>
            <span className="streak" title="연속 미달 일수 (3일이면 게임 오버)">{Array.from({ length: RULES.maxMiss }, (_, i) => <i key={i} className={i < game.miss ? 'on' : ''} />)}</span>
          </span>
        </div>
      </header>

      <div className="toasts">{toasts.map(x => <div key={x.id} className={`toast ${x.kind ?? ''}`}>{x.text}</div>)}</div>

      <button className="box" id="legend" onClick={() => setLayer(l => (l === 'o' ? 'd' : l === 'd' ? 'u' : 'o'))} aria-label="수요 레이어 바꾸기">
        <div className="lt">{LAYER_NAME[layer]} · 지금 시간대</div>
        <svg viewBox="0 0 320 60" aria-hidden="true"><g fill="none" stroke="#1D1D1B" strokeOpacity="0.3">{[32, 96, 160, 224, 288].map(x => <path key={x} d={`M${x} 6 L${x + 22} 18 L${x + 22} 42 L${x} 54 L${x - 22} 42 L${x - 22} 18 Z`} />)}</g>
          <g fill="#FF48B0">{[4, 8, 12, 16, 20].map((r, i) => <circle key={r} cx={32 + i * 64} cy="30" r={r} />)}</g></svg>
        <div className="ends"><span>적음</span><span>많음</span></div>
        <div className="tapme">탭해서 출발·도착·미충족 ▸</div>
      </button>
      <div className="box" id="helpbox"><button className="zb" aria-pressed={help} aria-label="화면 설명" onClick={() => setHelp(h => !h)}>?</button></div>
      <div className="box" id="zoom">
        <button className="zb" aria-label="축소" onClick={() => gm.current?.map.zoomOut()}><svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg></button>
        <button className="zb" aria-label="확대" onClick={() => gm.current?.map.zoomIn()}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
      </div>

      <section className="box" id="sheet" data-state={sel?.kind === 'draft' ? 'draft' : sheet}>
        <button id="grab" aria-label="패널 펼치기·접기" onClick={() => setSheet(s => (s === 'open' ? 'peek' : 'open'))}><i /></button>
        <div id="routebar">
          {game.routes.map(r => <button key={r.id} className="chip" aria-pressed={focusId === r.id} onClick={() => { setSel({ kind: 'route', id: r.id }); setSheet('open'); }}>
            <span className="n" style={{ background: r.color, color: r.tx }}>{r.num}</span>
            <span className="m"><small>{TYPES[r.type]} · {r.from}↔{r.to}</small><span>{r.buses}대 · {fmtHw(r.headway)}분</span></span></button>)}
          {!draft && <button className="chip add" onClick={() => startDraft()}>+ 새 노선</button>}
        </div>
        <div id="panel">
          {sel?.kind === 'draft' && draft ? <DraftPanel dm={dm} game={game} draft={draft} ev={draftEval} setDraft={setDraft} onCancel={cancelDraft} onDone={finishDraft} />
            : sel?.kind === 'hex' ? <HexPanel dm={dm} cell={sel.cell} bin={bin} onStart={() => startDraft(latLngToCell(...cellToLatLng(sel.cell), 9))} />
            : route ? <RoutePanel dm={dm} game={game} r={route} bin={bin} toast={toast} onEdit={() => { setDraft({ stops: [...route.stops], type: route.type, buses: route.buses, editing: route }); setSel({ kind: 'draft' }); }}
                onDelete={() => { game.routes = game.routes.filter(x => x !== route); setSel(null); redrawRoutes(); toast({ text: `${route.num}번을 폐선했어요. 버스 ${route.buses}대가 돌아왔어요.` }); }}
                onChange={() => { redrawRoutes(); rerender(); }} />
            : <CompanyPanel game={game} />}
        </div>
      </section>

      {help && <div className="help" onClick={() => setHelp(false)}><div className="box">
        <h2>화면 설명</h2>
        <p><b>위:</b> 시각과 속도(정지·1배속·4배속), 운행 중인 버스 / 보유 버스. 아랫줄은 오늘 수송과 목표, 목표 페이스, 연속 미달 표시예요.</p>
        <p><b>지도:</b> 핑크 점이 클수록 지금 시간대 수요가 많아요. 헥사곤을 누르면 그 칸에서 가고 싶은 곳(파랑 실선)과 오고 싶은 곳(주황 점선)이 보여요.</p>
        <p><b>노선:</b> + 새 노선을 누르고 헥사곤을 하나씩 탭하면 그 칸마다 정류장이 생겨요. 투입할 버스 대수를 정하면 배차간격이 계산돼요.</p>
        <p><b>규칙:</b> 매일 05시 정산. 목표의 150%를 3일 연속 넘기면 버스 +10대, 3일 연속 목표를 못 채우면 게임 오버예요.</p>
      </div></div>}

      {game.over && <div className="over"><div className="box">
        <svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z M12 10v5 M12 18h.01" /></svg>
        <h2>게임 오버</h2>
        <p>{RULES.maxMiss}일 연속 하루 수송 목표를 채우지 못했어요. 버스 {game.fleet}대로 {game.day - 1}일을 버텼어요.</p>
        <button className="btn primary" onClick={() => location.reload()}>처음부터 다시</button>
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

function HexPanel({ dm, cell, bin, onStart }: { dm: Demand; cell: string; bin: number; onStart: () => void }) {
  const [lat, lng] = cellToLatLng(cell), c9 = dm.byId.get(latLngToCell(lat, lng, 9));
  const res = parseInt(cell[1], 16) & 15;
  const agg = res === 9 ? c9 : dm.parents[res === 7 ? 0 : 1].get(cell);
  if (!agg || !c9) return null;
  const perH = (v: number[], b: number) => v[b] / binHours(dm.bins[b]);
  const { out } = flowsOf(dm, cell, bin), maxV = Math.max(1, ...out.map(o => o.v));
  const peak = Math.max(...dm.bins.map((_, b) => Math.max(perH(agg.O, b), perH(agg.D, b))));
  return <>
    <div><h2>{dm.dongs[c9.dong].gu} {dm.dongs[c9.dong].n}</h2><div className="sub">헥사곤 {res === 9 ? '정류장 칸' : res === 8 ? '중간 칸' : '큰 칸'} · {cell}</div></div>
    <div className="quick"><div><span>출발 (지금)</span><b>{fmt(perH(agg.O, bin))}명/시</b></div><div><span>도착 (지금)</span><b>{fmt(perH(agg.D, bin))}명/시</b></div><div><span>하루 출발</span><b>{fmt(agg.O.reduce((a, b) => a + b, 0))}</b></div></div>
    <div><h3>시간대별 수요 (시간당)</h3><div className="bins">{dm.bins.map((b, i) => <div key={i} className={i === bin ? 'now' : ''}>
      <span className="bo" style={{ height: `${perH(agg.O, i) / peak * 100}%` }} /><span className="bd" style={{ height: `${perH(agg.D, i) / peak * 100}%` }} /><small>{b.name}</small></div>)}</div>
      <div className="legend-inline"><span><i style={{ background: '#0072B2' }} />출발</span><span><i style={{ background: '#D55E00' }} />도착</span></div></div>
    {(['out', 'in'] as const).map(k => <div key={k}><h3>{k === 'out' ? '→ 여기서 가고 싶은 곳 (파랑 실선)' : '← 여기로 오고 싶은 곳 (주황 점선)'}</h3>
      <div className="list">{out.filter(o => o.out === (k === 'out')).map(o => <div className="it" key={o.name}><span>{o.name}</span><span className="b" style={{ width: `${o.v / maxV * 80}px` }} /><span>{fmt(o.v / binHours(dm.bins[bin]))}</span></div>)}</div></div>)}
    <div className="sub">동 단위 지금 시간대 상위 5곳. 시간대가 바뀌면 출근·퇴근 방향에 따라 달라져요.</div>
    <div className="row"><button className="btn primary" onClick={onStart}>여기서 노선 시작</button></div>
  </>;
}

function RoutePanel({ dm, game, r, bin, toast, onEdit, onDelete, onChange }: { dm: Demand; game: Game; r: Route; bin: number; toast: (t: Toast) => void; onEdit: () => void; onDelete: () => void; onChange: () => void }) {
  const [armed, setArmed] = useState(false);
  const free = game.fleet - game.usedBuses(r), demand = r.demand.reduce((a, b) => a + b, 0), carried = r.carried.reduce((a, b) => a + b, 0);
  const crowd = crowdAt(dm, r, bin);
  const setN = (n: number) => { if (n < 1) return; if (n > free) return toast({ text: `남은 버스가 없어요. 보유 ${game.fleet}대를 모두 쓰고 있어요.`, kind: 'warn' }); updateRoute(dm, r, r.stops, n); onChange(); };
  return <>
    <div className="head"><span className="badge" style={{ background: r.color, color: r.tx }}>{r.num}</span>
      <div><h2>{r.from} ↔ {r.to}</h2><div className="sub">{TYPES[r.type]}버스 · 정류장 {r.stops.length}곳 · {PATTERNS[r.pattern]}{r.example && <span className="ex">예시</span>}</div></div></div>
    <div><h3>투입 버스</h3><div className="hw"><button aria-label="버스 빼기" disabled={r.buses <= 1} onClick={() => setN(r.buses - 1)}>−</button><b>{r.buses}대</b>
      <button aria-label="버스 더 넣기" disabled={free - r.buses <= 0} onClick={() => setN(r.buses + 1)}>+</button>
      <span className="need">배차 <b className="inline">{fmtHw(r.headway)}분</b><br />남은 버스 {free - r.buses}대</span></div></div>
    <div className="quick"><div><span>하루 수요</span><b>{fmt(demand)}</b></div><div><span>하루 수송</span><b>{fmt(carried)}</b></div><div><span>놓침</span><b>{demand - carried > 1 && <span className="warn-i" aria-hidden="true" />}{fmt(demand - carried)}</b></div></div>
    <div><h3>지금 혼잡도</h3><div className="crowd"><i style={{ width: `${Math.min(100, crowd * 100)}%`, background: crowd > 1 ? '#D55E00' : crowd > 0.8 ? '#E69F00' : '#0072B2' }} /></div>
      <div className="sub">{crowd > 1 ? <><span className="warn-i" aria-hidden="true" />정원 초과 {Math.round(crowd * 100)}% · 정류장에 남는 승객이 생겨요</> : crowd > 0.8 ? `붐빔 ${Math.round(crowd * 100)}%` : `여유 ${Math.round(crowd * 100)}%`}</div></div>
    <div><h3>시간대별 처리할 수요 (배차는 하루 종일 {fmtHw(r.headway)}분)</h3>
      <table className="segt"><thead><tr><th>시간대</th><th>수요/시</th><th>정원/시</th><th /></tr></thead><tbody>
        {dm.bins.map((b, i) => { const d = r.demand[i] / binHours(b); return <tr key={i} className={i === bin ? 'now' : ''}><td>{b.name} {b.from}–{b.to}시</td><td>{fmt(d)}</td><td>{fmt(r.capH)}</td><td>{d > r.capH ? <span className="warn-i" aria-label="정원 초과" /> : '✓'}</td></tr>; })}
      </tbody></table></div>
    <dl className="kv"><dt>노선 길이</dt><dd>{r.lenKm.toFixed(1)}km</dd><dt>한 바퀴</dt><dd>{Math.round(r.cyc)}분</dd><dt>시간당 정원</dt><dd>{fmt(r.capH)}명</dd></dl>
    <div className="row"><button className="btn" onClick={onEdit}>노선 수정</button><button className="btn danger" onClick={() => (armed ? onDelete() : setArmed(true))}>{armed ? '한 번 더 누르면 폐선' : '폐선'}</button></div>
  </>;
}

function DraftPanel({ game, draft, ev, setDraft, onCancel, onDone }: { dm: Demand; game: Game; draft: Draft; ev: ReturnType<typeof evalRoute> | null; setDraft: (d: Draft) => void; onCancel: () => void; onDone: () => void }) {
  const free = game.fleet - game.usedBuses(draft.editing), ok = draft.buses <= free;
  const day = ev ? ev.demand.reduce((a, b) => a + b, 0) : 0;
  return <>
    <div className="head" style={{ justifyContent: 'space-between' }}><h2>{draft.editing ? `${draft.editing.num}번 노선 수정` : '새 노선'}</h2><span className="sub">정류장 {draft.stops.length}곳</span></div>
    <div className="quick"><div><span>하루 수요</span><b>{ev ? fmt(day) : '–'}</b></div><div><span>배차간격</span><b>{ev ? `${fmtHw(ev.headway)}분` : '–'}</b></div><div><span>남은 버스</span><b>{free}대</b></div></div>
    <div className="row"><button className="btn" disabled={!draft.stops.length} onClick={() => setDraft({ ...draft, stops: draft.stops.slice(0, -1) })}>되돌리기</button>
      <button className="btn" onClick={onCancel}>취소</button>
      <button className="btn primary" disabled={draft.stops.length < 2 || !ok} onClick={onDone}>{draft.editing ? '수정 완료' : '개설'}</button></div>
    <div><h3>투입 버스</h3><div className="hw"><button aria-label="버스 빼기" disabled={draft.buses <= 1} onClick={() => setDraft({ ...draft, buses: draft.buses - 1 })}>−</button><b>{draft.buses}대</b>
      <button aria-label="버스 더 넣기" disabled={draft.buses >= free} onClick={() => setDraft({ ...draft, buses: draft.buses + 1 })}>+</button>
      <span className="need">{!ok ? '남은 버스가 모자라요.' : ev ? `배차 ${fmtHw(ev.headway)}분 · 한 바퀴 ${Math.round(ev.cyc)}분` : '버스를 많이 넣을수록 배차간격이 짧아져요.'}</span></div></div>
    {!draft.editing && <div><h3>노선 종류</h3><div className="seg" role="group">{(Object.keys(TYPES) as RouteType[]).map(k => <button key={k} aria-pressed={draft.type === k} onClick={() => setDraft({ ...draft, type: k })}>{TYPES[k]}</button>)}</div></div>}
    {ev && <dl className="kv"><dt>길이</dt><dd>{ev.lenKm.toFixed(1)}km</dd><dt>한 바퀴</dt><dd>{Math.round(ev.cyc)}분</dd><dt>하루 수송 (정원 반영)</dt><dd>{fmt(ev.carried.reduce((a, b) => a + b, 0))}명</dd></dl>}
    <div className="hint">헥사곤을 하나 탭할 때마다 그 칸에 정류장이 생겨요. 떨어진 칸을 탭하면 사이 칸을 지나가지만 정류장은 탭한 칸에만 생겨요. 정류장은 걸어서 닿는 이웃 칸(약 350m)까지 승객을 모아요.</div>
  </>;
}

function CompanyPanel({ game }: { game: Game }) {
  const used = game.usedBuses();
  return <>
    <div><h2>회사 현황</h2><div className="sub">한강운수 · {game.day}일차</div></div>
    <div className="quick"><div><span>운행 버스</span><b>{used}/{game.fleet}대</b></div><div><span>오늘 수송</span><b>{fmt(game.todayRiders)}</b></div><div><span>오늘 놓침</span><b>{fmt(game.todayMissed)}</b></div></div>
    <dl className="kv"><dt>하루 목표</dt><dd>{fmt(game.target)}명 (버스 {game.goalFleet}대 × {RULES.perBus})</dd><dt>연속 미달</dt><dd>{game.miss}/{RULES.maxMiss}일</dd><dt>증차 기준</dt><dd>150% 넘김 {game.hit}/{RULES.bonusDays}일</dd><dt>노선</dt><dd>{game.routes.length}개</dd></dl>
    <div className="hint"><b>규칙</b> 매일 05시 정산. 목표의 150%를 {RULES.bonusDays}일 연속 넘기면 버스 +{RULES.fleetStep}대(새 목표는 하루 뒤부터), {RULES.maxMiss}일 연속 목표 미달이면 게임 오버예요.</div>
    <div className="hint"><b>노선 만들기</b> + 새 노선을 누르고 헥사곤을 하나씩 탭하면 그 칸에 정류장이 생겨요. 노선마다 투입할 버스 대수를 정하면 배차간격이 계산돼요. 정류장이 많을수록 한 바퀴가 길어져 간격이 벌어져요.</div>
  </>;
}

