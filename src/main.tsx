import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// 실제로 보이는 화면 높이를 --app-h로 (휴대폰 브라우저 주소창·도구 막대가 나타나고 사라질 때도 따라가요)
const setH = () => document.documentElement.style.setProperty('--app-h', `${Math.round(window.visualViewport?.height ?? window.innerHeight)}px`);
setH(); window.visualViewport?.addEventListener('resize', setH); window.addEventListener('resize', setH); window.addEventListener('orientationchange', setH);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
