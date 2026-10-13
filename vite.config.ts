import { defineConfig } from 'vite';

// 개발 서버 포트는 5180 고정 (2026-10-13 — 5173 은 이 PC 의 다른 프로젝트가 쓰고 있어 그쪽 화면이 떴다). 비어 있지 않으면 다른 포트로 넘어가지 않고 멈춘다
export default defineConfig({
  server: { port: 5180, strictPort: true },
});
