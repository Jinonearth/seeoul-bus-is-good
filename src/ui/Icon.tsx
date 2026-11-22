// 글자 대신 쓰는 선 아이콘 (24×24, 현재 글자색). 뜻은 aria-label과 ? 설명에서 풀어 줘요.
const P: Record<string, string> = {
  bus: 'M5 4h14v13H5z M5 11h14 M8 17v3 M16 17v3 M8 14h.01 M16 14h.01',
  person: 'M12 4a3 3 0 1 1 0 6a3 3 0 1 1 0-6 M5 20c0-4 3-6 7-6s7 2 7 6',
  miss: 'M10 4a3 3 0 1 1 0 6a3 3 0 1 1 0-6 M3 20c0-4 3-6 7-6c1.5 0 2.8.3 3.8.8 M16 15l5 5 M21 15l-5 5',
  clock: 'M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18 M12 7v5l3 2',
  flag: 'M5 21V4 M5 4h12l-3 4l3 4H5',
  route: 'M6 18a2 2 0 1 1 0 .01 M18 6a2 2 0 1 1 0 .01 M8 18h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6',
  stop: 'M12 3a5 5 0 0 1 5 5c0 4-5 10-5 10S7 12 7 8a5 5 0 0 1 5-5z M12 7v2',
  ruler: 'M3 16l13-13l5 5L8 21z M7 12l2 2 M10 9l2 2 M13 6l2 2',
  loop: 'M4 12a8 8 0 0 1 14-5 M18 3v4h-4 M20 12a8 8 0 0 1-14 5 M6 21v-4h4',
  cap: 'M4 7h16v10H4z M8 7v10 M12 7v10 M16 7v10',
  out: 'M12 3l7 4v6 M5 7l7-4 M5 7v10l7 4 M12 13h9 M17 9l4 4l-4 4',
  in: 'M12 3l7 4v4 M5 7l7-4 M5 7v10l7 4l7-4v-2 M21 12h-9 M16 8l-4 4l4 4',
  gap: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M8 8l8 8',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  x: 'M6 6l12 12 M18 6L6 18',
  ok: 'M4 12l5 5L20 6',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  warn: 'M12 3l10 18H2z M12 10v5 M12 18h.01',
  up: 'M6 15l6-6l6 6',
  down: 'M6 9l6 6l6-6',
  again: 'M4 12a8 8 0 1 0 3-6.2 M4 4v5h5',
  // 노선 종류
  trunk: 'M3 12h18 M3 9h18 M3 15h18',
  branch: 'M3 12h9l6-6 M12 12l6 6',
  circ: 'M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16 M15 2l-3 2l3 2',
  // 시간대: 출근(해 뜸) 낮 퇴근(해 짐) 저녁 심야
  b0: 'M3 18h18 M6 18a6 6 0 0 1 12 0 M12 4v4 M9.5 6.5L12 4l2.5 2.5',
  b1: 'M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.4 1.4 M17.6 17.6L19 19 M5 19l1.4-1.4 M17.6 6.4L19 5',
  b2: 'M3 18h18 M6 18a6 6 0 0 1 12 0 M12 4v4 M9.5 5.5L12 8l2.5-2.5',
  b3: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  b4: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z M17 3v4 M15 5h4',
};
export type IconName = keyof typeof P;
export function Icon({ n, s = 16, label, className }: { n: string; s?: number; label?: string; className?: string }) {
  return <svg className={`ic ${className ?? ''}`} width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><path d={P[n]} /></svg>;
}
