import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// 화면 높이를 --app-h로 (휴대폰 브라우저 주소창·도구 막대가 나타나고 사라질 때도 따라가요)
// visualViewport.height는 쓰지 않아요: 데스크톱에서 트랙패드로 페이지를 핀치 확대하면 그 값이 줄어 화면 전체가 엉뚱하게 작아져요.
// innerHeight(레이아웃 높이)는 휴대폰에서도 주소창이 나타나고 사라질 때 따라가요. 0이면 CSS의 100dvh를 그대로 써요
const setH = () => { const h = window.innerHeight; if (h > 0) document.documentElement.style.setProperty('--app-h', `${h}px`); else document.documentElement.style.removeProperty('--app-h'); };
setH(); window.addEventListener('resize', setH); window.addEventListener('orientationchange', () => setTimeout(setH, 50));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
