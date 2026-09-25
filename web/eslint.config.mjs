import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 設計書「依存の向き（lint で強制する）」を反映する。フォルダの粒度に加えて、
// lib/schemas は limits.ts・lib/domain は texts.ts だけが、部品・画面・lib/client から
// 値として読める（ファイルの粒度の指定は第5周のあとの直し）。

const CRYPTO_MESSAGE = "crypto を呼ぶのは lib/adapters だけです（依存の向き）。差し替え口 Rng・Hasher（lib/ports.ts）を使ってください。";
const noRestrictedCrypto = ["error", { name: "crypto", message: CRYPTO_MESSAGE }];

const domainBoundary = {
  files: ["lib/domain/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/adapters/**", "**/usecases/**", "**/repo/**", "**/http/**", "**/client/**", "**/components/**", "next", "next/**", "node:*"],
            message: "lib/domain は自分だけを読めます（依存の向き）。",
          },
        ],
      },
    ],
  },
};

const schemasBoundary = {
  files: ["lib/schemas/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/adapters/**", "**/usecases/**", "**/repo/**", "**/http/**", "**/client/**", "**/components/**", "next", "next/**"],
            message: "lib/schemas は lib/domain の定数だけを読めます（依存の向き）。",
          },
        ],
      },
    ],
  },
};

const repoBoundary = {
  files: ["lib/repo/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/usecases/**", "**/adapters/**", "**/http/**", "**/app/**", "**/components/**", "next", "next/**"],
            message: "lib/repo は lib/domain・lib/schemas だけを読めます（依存の向き）。",
          },
        ],
      },
    ],
  },
};

const usecasesBoundary = {
  files: ["lib/usecases/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/adapters/**", "**/app/**", "**/components/**", "next", "next/**"],
            message: "lib/usecases は lib/adapters（実物）を読めません（依存の向き）。lib/ports.ts の型だけを知って呼びます。",
          },
        ],
      },
    ],
  },
};

const adaptersBoundary = {
  files: ["lib/adapters/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-globals": "off",
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/usecases/**", "**/repo/**"],
            message: "lib/adapters は lib/usecases・lib/repo を読めません（依存の向き）。",
          },
        ],
      },
    ],
  },
};

const httpAndApiBoundary = {
  files: ["lib/http/**/*.{ts,tsx}", "app/api/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/components/**"],
            message: "lib/http・app/api は components を読めません（依存の向き）。",
          },
        ],
      },
    ],
  },
};

// 画面の束に入るファイルは zod（大きい版）を値として読まない（2026-09-25 監査の指摘 設計-09）。
// `import { z } from "zod"` は約40言語の文言を名前空間ごと抱えていて組み立てで削れず、客の画面の JS の約4割を占めた。
const NO_FULL_ZOD = { name: "zod", message: "画面の束に入るファイルは zod（大きい版）を読めません。zod/mini から名前を指定して読んでください（設計-09）。", allowTypeImports: true };

const uiBoundary = {
  files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}", "lib/client/**/*.{ts,tsx}"],
  ignores: ["app/api/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/repo/**", "**/usecases/**", "**/adapters/**", "**/http/**"],
            message: "components・app・lib/client は lib/repo・lib/usecases・lib/adapters・lib/http を読めません（依存の向き）。",
          },
          {
            group: ["**/domain/**", "!**/domain/texts"],
            message: "components・app・lib/client が lib/domain から値として読めるのは domain/texts だけです（依存の向き）。",
          },
          {
            group: ["**/schemas/**", "!**/schemas/limits"],
            message: "components・app・lib/client が lib/schemas から値として読めるのは schemas/limits だけです（依存の向き）。",
          },
        ],
        paths: [NO_FULL_ZOD],
      },
    ],
  },
};

// lib/client だけは、成功した応答の形の表（schemas/responses）を値として読める（2026-09-25 監査の指摘 設計-07）。
// 画面が応答を確かめる形を、サーバーと同じ定義から取るため。表は zod の小さい版（zod/mini）だけで書く
// （設計-09・画面の束に zod の文言を入れない）。部品・画面は lib/client の型を通して名乗る。
const clientBoundary = {
  files: ["lib/client/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["**/repo/**", "**/usecases/**", "**/adapters/**", "**/http/**"],
            message: "lib/client は lib/repo・lib/usecases・lib/adapters・lib/http を読めません（依存の向き）。",
          },
          {
            group: ["**/domain/**", "!**/domain/texts"],
            message: "lib/client が lib/domain から値として読めるのは domain/texts だけです（依存の向き）。",
          },
          {
            group: ["**/schemas/**", "!**/schemas/limits", "!**/schemas/responses"],
            message: "lib/client が lib/schemas から値として読めるのは schemas/limits と schemas/responses だけです（依存の向き）。",
          },
        ],
        paths: [NO_FULL_ZOD],
      },
    ],
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // 組み込みの出力は lint の対象外。`.next/**` は eslint-config-next が既に外しているが、
  // `.open-next/**`（公開用に1つへ束ねた約30MB の worker.js）と `.wrangler/**` は外していないので、
  // 公開の組み立てを1度でも走らせたあとに `eslint .` が記憶を使い切って落ちる。
  { ignores: ["scripts/**", ".open-next/**", ".wrangler/**"] },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    ignores: ["scripts/**", ".open-next/**", ".wrangler/**"],
    rules: {
      "no-console": "error",
      "no-restricted-globals": noRestrictedCrypto,
    },
  },
  {
    // console を呼ぶのは adapters/logger.ts だけ（構造の検査が見張る）。
    files: ["lib/adapters/logger.ts"],
    rules: { "no-console": "off" },
  },
  domainBoundary,
  schemasBoundary,
  repoBoundary,
  usecasesBoundary,
  adaptersBoundary,
  httpAndApiBoundary,
  uiBoundary,
  clientBoundary,
]);
