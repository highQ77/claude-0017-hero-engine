import { defineConfig } from 'vitest/config';

// 測試在引擎根目錄執行（vite.config.ts 的 root 是遊戲專案，測試不用它）
export default defineConfig({
  esbuild: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
