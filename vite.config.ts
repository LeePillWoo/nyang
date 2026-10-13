import { defineConfig } from 'vite';

// 개발 서버 포트는 5180 고정 (2026-10-13 — 5173 은 이 PC 의 다른 프로젝트가 쓰고 있어 그쪽 화면이 떴다). 비어 있지 않으면 다른 포트로 넘어가지 않고 멈춘다. host 127.0.0.1 — 그냥 두면 IPv6(::1)에만 열려 브라우저가 127.0.0.1 로 붙으면 연결이 안 됐다
export default defineConfig({
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
