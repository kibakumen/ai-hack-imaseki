import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "preserve-acceptance-import-meta-url",
      enforce: "pre",
      transform(code, id) {
        const sourceId = id.split("?", 1)[0];
        if (!sourceId.endsWith("/tests/acceptance/v2/_tasks.ts")) return;
        const staticUrl = 'new URL("../../../", import.meta.url)';
        if (!code.includes(staticUrl)) {
          throw new Error("_tasks.ts のリポジトリ URL 式が見つかりません");
        }
        // Vite の静的 asset URL 変換を避け、jsdom でもモジュール自身の file URL を保つ。
        return code.replace(
          staticUrl,
          'new URL(["../../../"].join(""), import.meta.url)',
        );
      },
    },
  ],
  test: {
    environment: "node",
    // 受け入れ検査は1ファイルごとに手元の D1（miniflare）を立て、1本あたり約0.5GB を使う。既定（CPU の数−1）で
    // 全部を並べると、手元（メモリ10GB）では負荷で打ち切りに当たる検査が出て、main が赤のまま積まれていた（設計-02）。
    // 速い機械では VITEST_MAX_WORKERS で広げる。
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 2),
    include: ["web/**/*.test.{ts,tsx}", "tests/acceptance/v2/**/*.test.{ts,tsx}"],
    // `acceptance-globals.ts` は、直下の `acceptance-globals.d.ts` が型で宣言している
    // 場面の準備の5つを、実行時にも globalThis へ置く（2026-09-22 タスク25 が足した）。
    setupFiles: ["tests/acceptance/v2/_setup.ts", "tests/acceptance-globals.ts"],
  },
});
