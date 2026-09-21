// 構造の検査（ソースと設定のファイルを走査する。「無いこと」の確かめ）。
// 設計書「要件ごとの検査の割り当て」の構造の行と、「要件に基準が無い、設計の決めの検査」の構造の行。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { describeTask, REPO, TASKS_MD, taskStates } from "./_tasks";

const WEB = path.join(REPO, "web");
const HERE = path.dirname(new URL(import.meta.url).pathname);

const walk = (dir: string, filter: (f: string) => boolean = () => true): string[] => {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".open-next", ".wrangler", ".git"].includes(entry.name)) continue;
      out.push(...walk(p, filter));
    } else if (filter(p)) out.push(p);
  }
  return out;
};
const isSource = (f: string) => /\.(ts|tsx|js|mjs)$/.test(f) && !/\.d\.ts$/.test(f);
const read = (f: string) => fs.readFileSync(f, "utf8");
const rel = (f: string) => path.relative(REPO, f);
const webSources = () => walk(WEB, isSource).filter((f) => !f.includes(`${path.sep}scripts${path.sep}`));
const srcUnder = (sub: string) => walk(path.join(WEB, sub), isSource);
/** `import ... from "…"`（値の import）だけを拾う。`import type` は除く */
const valueImports = (text: string): string[] =>
  [...text.matchAll(/^\s*import\s+(?!type\s)[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]).concat([...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]));
const readJsonc = (f: string) => JSON.parse(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
const gitTracked = (): string[] => execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean);

describeTask("1", "骨組み: 34.1・34.5・34.6・31.2・受け入れ検査のブロックの見張り", () => {
  it("34.1 web/package.json の依存に Next.js があり、web/app/ が在る", () => {
    const pkg = JSON.parse(read(path.join(WEB, "package.json")));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty("next");
    expect(fs.existsSync(path.join(WEB, "app"))).toBe(true);
    expect(fs.existsSync(path.join(WEB, "app", "page.tsx"))).toBe(true);
  });

  it("34.5 web/ の中から demo/ と sprint/ を読んでいない", () => {
    for (const f of webSources()) {
      const bad = valueImports(read(f)).filter((s) => /(^|\/)(demo|sprint)(\/|$)/.test(s) || /\.\.\/\.\.\/(demo|sprint)/.test(s));
      expect(bad, rel(f)).toEqual([]);
    }
  });

  it("34.6 git が追跡しているファイルに、鍵の形の文字列・秘密のファイル・個人データの種・営業許可書が無い", () => {
    const tracked = gitTracked();
    // Turnstile のサイトキーと秘密鍵は値の形が同じなので、値では見ず名前で見る（下の vars の検査）
    const KEY_SHAPES = [/sk_(live|test)_[A-Za-z0-9]{16,}/, /AIza[0-9A-Za-z_-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    for (const f of tracked) {
      expect(path.basename(f), f).not.toMatch(/^\.dev\.vars$|\.local$/);
      expect(f, f).not.toMatch(/\.(pdf|jpe?g|png)$/i);
      if (!/\.(ts|tsx|js|mjs|json|jsonc|sql|md|toml|yaml|yml|txt|css|html|example)$/.test(f)) continue;
      const text = read(path.join(REPO, f));
      for (const re of KEY_SHAPES) expect(text, `${f}: ${re}`).not.toMatch(re);
      if (/\.sql$/.test(f)) {
        expect(text, f).not.toMatch(/0[789]0-?\d{4}-?\d{4}/);
        expect(text, f).not.toMatch(/[\w.+-]+@(?!example\.)[\w-]+\.[\w.]+/);
      }
    }
  });

  it("34.6 web/wrangler.jsonc の vars は ORCAROUTER_MODEL・VAPID_PUBLIC_KEY・TURNSTILE_SITE_KEY だけで、秘密の名前もメールアドレスも無い", () => {
    const text = read(path.join(WEB, "wrangler.jsonc"));
    const cfg = readJsonc(path.join(WEB, "wrangler.jsonc"));
    const vars = Object.keys(cfg.vars ?? {});
    expect(new Set(vars)).toEqual(new Set(["ORCAROUTER_MODEL", "VAPID_PUBLIC_KEY", "TURNSTILE_SITE_KEY"]));
    for (const name of vars) expect(name).not.toMatch(/SECRET|PRIVATE|API_KEY|PASSWORD|EMAIL/);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(cfg.name).toBe("ai-hack-v2");
    expect((cfg.d1_databases ?? []).map((d: any) => d.binding)).toContain("DB");
    expect((cfg.r2_buckets ?? []).map((b: any) => b.binding)).toContain("PERMITS");
  });

  it("34.6 web/.dev.vars.example の値は全部空で、直下の .gitignore と web/.gitignore に要る行が在る", () => {
    const example = read(path.join(WEB, ".dev.vars.example"));
    for (const line of example.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"))) {
      expect(line, line).toMatch(/^[A-Z0-9_]+=\s*$/);
    }
    for (const name of ["ORCAROUTER_API_KEY", "GOOGLE_MAPS_API_KEY", "STRIPE_SECRET_KEY", "VAPID_PRIVATE_KEY", "TURNSTILE_SECRET_KEY", "ADMIN_CONTACT_EMAIL"]) expect(example).toContain(name);
    const root = read(path.join(REPO, ".gitignore")).split(/\r?\n/).map((l) => l.trim());
    for (const line of [".dev.vars", "*.local", ".env"]) expect(root).toContain(line);
    const web = read(path.join(WEB, ".gitignore"));
    for (const line of [".next", ".open-next", ".wrangler"]) expect(web).toContain(line);
  });

  it("31.2 直下の vitest.config.ts が受け入れ検査と _setup.ts を含み、ゲートの3つのコマンドが直下で動く形になっている", () => {
    const cfg = read(path.join(REPO, "vitest.config.ts"));
    expect(cfg).toMatch(/tests\/acceptance\/v2/);
    expect(cfg).toMatch(/_setup/);
    const pkg = JSON.parse(read(path.join(REPO, "package.json")));
    const dev = { ...pkg.devDependencies, ...pkg.dependencies };
    for (const dep of ["vitest", "typescript", "wrangler", "@testing-library/react", "jsdom", "react", "react-dom"]) expect(dev, dep).toHaveProperty(dep);
    expect(fs.existsSync(path.join(REPO, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(REPO, "pnpm-workspace.yaml"))).toBe(true);
  });

  it("受け入れ検査の最上位のブロックは全部 describeTask で、名乗る番号は tasks.md に在る", () => {
    const states = taskStates();
    expect(states.size).toBeGreaterThan(0);
    for (const file of fs.readdirSync(HERE).filter((f) => /\.test\.tsx?$/.test(f))) {
      const text = read(path.join(HERE, file));
      const topLevel = text.split(/\r?\n/).filter((l) => /^(describe|test|it)(\.|\()/.test(l));
      expect(topLevel, `${file}: 最上位に素の describe/test/it`).toEqual([]);
      const named = [...text.matchAll(/describeTask\(\s*["'](\d+(?:\.\d+)?)["']/g)].map((m) => m[1]);
      expect(named.length, `${file}: describeTask が無い`).toBeGreaterThan(0);
      for (const n of named) expect(states.has(n), `${file}: タスク ${n} は ${path.relative(REPO, TASKS_MD)} に無い`).toBe(true);
    }
  });
});

describeTask("2", "横断の土台: ログの出口・crypto の場所・ports・texts と limits が何も import しない", () => {
  it("console を呼ぶのは adapters/logger.ts だけ。public/sw.js も呼ばない", () => {
    for (const f of webSources()) {
      if (rel(f).endsWith(path.join("lib", "adapters", "logger.ts"))) continue;
      expect(read(f), rel(f)).not.toMatch(/\bconsole\.(log|error|warn|info|debug)\(/);
    }
    const sw = path.join(WEB, "public", "sw.js");
    if (fs.existsSync(sw)) expect(read(sw)).not.toMatch(/\bconsole\./);
    expect(read(path.join(WEB, "lib", "adapters", "logger.ts"))).toMatch(/\bconsole\./);
  });

  it("crypto を呼ぶのは lib/adapters の中だけ。lib/ports.ts に Rng と Hasher が在る", () => {
    for (const f of [...srcUnder("lib"), ...srcUnder("app"), ...srcUnder("components")]) {
      if (rel(f).includes(path.join("lib", "adapters"))) continue;
      const text = read(f);
      expect(text, rel(f)).not.toMatch(/\bcrypto\./);
      expect(valueImports(text), rel(f)).not.toContain("node:crypto");
      expect(valueImports(text), rel(f)).not.toContain("crypto");
    }
    const ports = read(path.join(WEB, "lib", "ports.ts"));
    expect(ports).toMatch(/\bRng\b/);
    expect(ports).toMatch(/\bHasher\b/);
    expect(ports).toMatch(/\bLogger\b/);
    expect(ports).toMatch(/\bHumanCheck\b/);
    expect(ports).toMatch(/\bAiSelector\b/);
  });

  it("domain/texts.ts と schemas/limits.ts は何も import しない。lint の設定に境界の指定が在る", () => {
    expect(valueImports(read(path.join(WEB, "lib", "domain", "texts.ts")))).toEqual([]);
    expect(valueImports(read(path.join(WEB, "lib", "schemas", "limits.ts")))).toEqual([]);
    const eslint = read(path.join(WEB, "eslint.config.mjs"));
    expect(eslint).toMatch(/no-restricted-imports/);
    expect(eslint).toMatch(/no-console/);
    expect(eslint).toMatch(/no-restricted-globals/);
  });
});

describeTask("11", "取得の手続き: AI の口を呼ぶ場所・道具を持たない・OrcaRouter の URL の場所", () => {
  it("7.12 AiSelector（deps.ai）を呼ぶのが usecases/fetchOffers.ts の1か所だけ", () => {
    const callers = webSources().filter((f) => /\bai\.select\(/.test(read(f)) || /deps\.ai\b/.test(read(f)));
    expect(callers.map(rel).filter((r) => !r.includes(path.join("lib", "http")))).toEqual([path.join("web", "lib", "usecases", "fetchOffers.ts")]);
  });

  it("AI に道具が無い: web/ の全ソースに tools: と tool_choice が無い", () => {
    for (const f of webSources()) {
      expect(read(f), rel(f)).not.toMatch(/\btools\s*:/);
      expect(read(f), rel(f)).not.toMatch(/tool_choice/);
    }
  });

  it("34.4 OrcaRouter の URL は adapters/orcarouter.ts にだけ在り、ほかの AI の提供元のホスト名・SDK・Workers AI の束縛が無い", () => {
    const orca = path.join(WEB, "lib", "adapters", "orcarouter.ts");
    expect(read(orca)).toMatch(/api\.orcarouter\.ai/);
    for (const f of webSources()) {
      const text = read(f);
      if (f !== orca) expect(text, rel(f)).not.toMatch(/orcarouter\.ai/);
      expect(text, rel(f)).not.toMatch(/api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai/);
      expect(valueImports(text), rel(f)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(openai|@anthropic-ai\/sdk|@google\/generative-ai|@ai-sdk\/|ai$)/)]));
    }
    const pkg = JSON.parse(read(path.join(WEB, "package.json")));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) expect(dep).not.toMatch(/^(openai|@anthropic-ai\/sdk|@google\/generative-ai)$/);
    const cfg = readJsonc(path.join(WEB, "wrangler.jsonc"));
    expect(cfg.ai).toBeUndefined();
  });
});

describeTask("12", "取得の画面: 現在地を取る呼び出しの場所（3.9）", () => {
  it("3.9 geolocation を呼ぶのは client/geolocation.ts の1か所だけで、watchPosition は使わず、Service Worker の中にも無い", () => {
    const geo = path.join(WEB, "lib", "client", "geolocation.ts");
    expect(read(geo)).toMatch(/getCurrentPosition/);
    expect(read(geo)).not.toMatch(/watchPosition/);
    for (const f of webSources()) {
      if (f === geo) continue;
      expect(read(f), rel(f)).not.toMatch(/navigator\.geolocation|getCurrentPosition|watchPosition/);
    }
    const sw = path.join(WEB, "public", "sw.js");
    expect(read(sw)).not.toMatch(/geolocation/);
  });
});

describeTask("25", "全入口の横断: 入口の一覧・依存の向き・断りを描く部品・記録は追加だけ・カードの項目が無い・検査のファイルが在る", () => {
  const routeFiles = () => walk(path.join(WEB, "app", "api"), (f) => f.endsWith("route.ts"));
  const routePath = (f: string) => "/" + path.relative(path.join(WEB, "app"), path.dirname(f)).split(path.sep).join("/");

  it("29.1 app/api/**/route.ts の全部が defineRoute を呼び、要求の本文を自分で読んでいない", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = read(f);
      expect(text, rel(f)).toMatch(/defineRoute\(|\bapp\b/);
      expect(text, rel(f)).not.toMatch(/\.(json|formData|text)\(\)/);
      expect(text, rel(f)).not.toMatch(/\bz\.(object|string|number)\(/);
    }
  });

  it("11.4・20.10・17.15・14.8・25.3 無いはずの入口が無い（延長・完了済みを戻す・再開・運営の作成・承認を断る）", () => {
    const paths = routeFiles().map(routePath);
    for (const p of paths) {
      expect(p).not.toMatch(/extend|prolong|reopen|resume|restart|uncomplete|revert|reject|deny/);
      expect(p).not.toMatch(/^\/api\/(register|admin)\/admin/);
    }
    expect(paths).toContain("/api/customer/reservations");
    expect(paths).toContain("/api/store/offers");
    expect(paths).toContain("/api/admin/stores/[id]/approve");
    expect(paths).toContain("/api/admin/stores/[id]/ban");
    expect(paths).toContain("/api/config/public");
  });

  it("29.4 画面と部品が fetch を直接呼ばず、client/api.ts が応答をスキーマで検査している", () => {
    const apiFile = path.join(WEB, "lib", "client", "api.ts");
    expect(read(apiFile)).toMatch(/\bfetch\(/);
    expect(read(apiFile)).toMatch(/\.safeParse\(|\.parse\(/);
    for (const f of [...srcUnder("components"), ...srcUnder("app"), ...srcUnder("lib/client")]) {
      if (f === apiFile) continue;
      expect(read(f), rel(f)).not.toMatch(/\bfetch\(/);
    }
  });

  it("依存の向き: components・app・lib/client が lib/domain から値として読むのは domain/texts だけ、lib/schemas は limits だけ。repo・usecases・adapters・http を読まない", () => {
    const DOMAIN_FILES = /domain\/(filter|score|selection|customerHome|storeHome|reservation|remaining|until|receiveRefusal|inputRefusal|offer|geo|token|password|code|genres|fileType|customer)\b/;
    for (const f of [...srcUnder("components"), ...srcUnder("app"), ...srcUnder("lib/client")]) {
      const imports = valueImports(read(f));
      for (const s of imports) {
        expect(s, `${rel(f)} → ${s}`).not.toMatch(/lib\/(repo|usecases|adapters|http)\b|\/(repo|usecases|adapters|http)\//);
        if (/domain/.test(s)) expect(s, `${rel(f)} → ${s}`).toMatch(/domain\/texts$/);
        expect(s, `${rel(f)} → ${s}`).not.toMatch(DOMAIN_FILES);
        if (/schemas/.test(s)) expect(s, `${rel(f)} → ${s}`).toMatch(/schemas\/limits$/);
      }
    }
    for (const f of srcUnder("lib/domain")) {
      for (const s of valueImports(read(f))) expect(s, `${rel(f)} → ${s}`).toMatch(/^\.\.?\//);
      expect(read(f), rel(f)).not.toMatch(/Date\.now\(\)|new Date\(\)/);
    }
    for (const f of srcUnder("lib/usecases")) for (const s of valueImports(read(f))) expect(s, `${rel(f)} → ${s}`).not.toMatch(/adapters|^next\b|\/app\/|components/);
    for (const f of srcUnder("lib/repo")) for (const s of valueImports(read(f))) expect(s, `${rel(f)} → ${s}`).not.toMatch(/usecases|adapters|\/app\/|components/);
  });

  it("入力の断りを描く部品は InputRefusal だけ。全部のフォームが使う。語は domain/inputRefusal、文は domain/texts にだけ", () => {
    const ui = [...srcUnder("components"), ...srcUnder("app")];
    const readers = ui.filter((f) => /error\.(kind|fields)\b/.test(read(f))).map((f) => path.basename(f));
    expect(readers).toEqual(["InputRefusal.tsx"]);
    const forms = ["RegisterForm", "FetchForm", "ReservationView", "LoginForm", "PasswordForm", "ProfileForm", "CouponEditor", "PublishForm", "OfferPanel", "DocumentsPanel", "ReportForm", "StoreDetail"];
    for (const name of forms) {
      const files = ui.filter((f) => path.basename(f) === `${name}.tsx`);
      expect(files.length, `${name}.tsx が無い`).toBeGreaterThan(0);
      for (const f of files) expect(read(f), rel(f)).toMatch(/InputRefusal/);
    }
    const inputRefusal = read(path.join(WEB, "lib", "domain", "inputRefusal.ts"));
    expect(inputRefusal).toMatch(/invalid_input/);
    for (const f of ui) expect(read(f), rel(f)).not.toMatch(/["'](too_long|too_short|out_of_range|invalid_input|party_over_max)["']\s*:/);
  });

  it("受け取りの断りを描く部品は RefusalNotice だけ。ResultList と ExpiredView が使う。receiveRefusal を値として読むのは usecases/receiveOffer だけ", () => {
    const ui = [...srcUnder("components"), ...srcUnder("app")];
    const readers = ui.filter((f) => /refusal\.kind\b/.test(read(f))).map((f) => path.basename(f));
    expect(readers).toEqual(["RefusalNotice.tsx"]);
    for (const name of ["ResultList.tsx", "ExpiredView.tsx"]) {
      const f = ui.find((x) => path.basename(x) === name)!;
      expect(f, `${name} が無い`).toBeTruthy();
      expect(read(f)).toMatch(/RefusalNotice/);
    }
    const domain = read(path.join(WEB, "lib", "domain", "receiveRefusal.ts"));
    for (const k of ["sold_out", "offer_ended", "store_banned", "party_over_max", "has_active_reservation", "search_again", "search_again_with_party", "back_to_reservation", "retry_same_party"]) expect(domain).toContain(k);
    const valueReaders = webSources().filter((f) => valueImports(read(f)).some((s) => /domain\/receiveRefusal$/.test(s))).map(rel);
    expect(valueReaders).toEqual([path.join("web", "lib", "usecases", "receiveOffer.ts")]);
  });

  it("27.7 記録の5つの表に対する UPDATE と DELETE の文がリポジトリに無い。repo/logs.ts は insert だけ", () => {
    const LOG_TABLES = ["fetch_logs", "fetch_items", "selections", "reservation_events", "ai_calls"];
    for (const f of [...srcUnder("lib"), ...srcUnder("app")]) {
      const text = read(f);
      for (const t of LOG_TABLES) {
        expect(text, `${rel(f)}: ${t}`).not.toMatch(new RegExp(`(UPDATE|DELETE\\s+FROM)\\s+"?${t}"?\\b`, "i"));
      }
    }
    const logs = read(path.join(WEB, "lib", "repo", "logs.ts"));
    expect(logs).toMatch(/INSERT/i);
    expect(logs).not.toMatch(/\bUPDATE\b|\bDELETE\b/i);
  });

  it("13.7・13.10 テーブルとスキーマにカードの番号・有効期限・セキュリティコードが無く、Stripe を呼ぶのは adapters/stripe.ts だけで請求の API を呼ばない", () => {
    const sql = walk(path.join(WEB, "migrations"), (f) => f.endsWith(".sql")).map(read).join("\n");
    expect(sql).not.toMatch(/card_number|card_no|pan\b|cvc|cvv|security_code|exp_month|exp_year|card_exp/i);
    for (const f of srcUnder("lib/schemas")) expect(read(f), rel(f)).not.toMatch(/cardNumber|cvc|cvv|expMonth|expYear|securityCode/i);
    const stripe = path.join(WEB, "lib", "adapters", "stripe.ts");
    expect(read(stripe)).toMatch(/stripe\.com/);
    expect(read(stripe)).not.toMatch(/payment_intents|charges|invoices|subscriptions|checkout\.sessions.*mode.*payment/);
    for (const f of webSources()) if (f !== stripe) expect(read(f), rel(f)).not.toMatch(/stripe\.com|from ["']stripe["']/);
  });

  it("Turnstile と公開値の名前は adapters/turnstile.ts と adapters/env.ts にだけ", () => {
    for (const f of webSources()) {
      const r = rel(f);
      const text = read(f);
      if (!r.endsWith(path.join("adapters", "turnstile.ts")) && !r.endsWith(path.join("adapters", "env.ts"))) {
        expect(text, r).not.toMatch(/challenges\.cloudflare\.com\/turnstile\/v0\/siteverify|TURNSTILE_SECRET_KEY/);
        expect(text, r).not.toMatch(/TURNSTILE_SITE_KEY|VAPID_PUBLIC_KEY/);
      }
    }
    const sw = path.join(WEB, "public", "sw.js");
    expect(read(sw)).not.toMatch(/TURNSTILE_SITE_KEY|VAPID_PUBLIC_KEY/);
    expect(read(path.join(WEB, "lib", "adapters", "env.ts"))).toMatch(/TURNSTILE_SITE_KEY/);
    expect(read(path.join(WEB, "lib", "adapters", "env.ts"))).toMatch(/VAPID_PUBLIC_KEY/);
  });

  it("31.1 8つの検査のファイルが在り、それぞれ検査を1つ以上持つ", () => {
    for (const prefix of ["r05-", "r06-", "r07-", "r08-", "r11-", "r18-", "r19-", "r20-"]) {
      const files = fs.readdirSync(HERE).filter((f) => f.startsWith(prefix) && /\.test\.tsx?$/.test(f));
      expect(files.length, prefix).toBeGreaterThan(0);
      const tests = files.reduce((n, f) => n + (read(path.join(HERE, f)).match(/^\s+it\(/gm) ?? []).length, 0);
      expect(tests, prefix).toBeGreaterThan(0);
    }
  });

  it("31.3 _setup.ts が fetch を外へ出たら落とす関数に差し替えている", () => {
    const setup = read(path.join(HERE, "_setup.ts"));
    expect(setup).toMatch(/globalThis\.fetch\s*=/);
    expect(setup).toMatch(/外へ出る通信を止めました/);
  });
});

describeTask("26", "README: 動かし方と提出前の確かめの手順が在る", () => {
  it("34.7 直下の README.md に、手元で動かす手順・秘密の入れ方・公開の手順・提出前の確かめ（10回の取得と auto／Named Router の比べ）が在る", () => {
    const readme = read(path.join(REPO, "README.md"));
    for (const word of ["pnpm install", ".dev.vars", "wrangler", "提出前の確かめ", "ORCAROUTER_MODEL", "orcarouter/auto", "orcarouter/ai-sekitori", "8秒", "seed-admin", "vitest"]) expect(readme, word).toContain(word);
    expect(readme).toMatch(/10\s*回/);
  });
});

describeTask("34", "明暗の両対応: 色は変数でだけ指す", () => {
  it("32.3 globals.css に暗い設定の分岐が在り、部品が色の値を直接持たない", () => {
    const css = read(path.join(WEB, "app", "globals.css"));
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toMatch(/--color-/);
    for (const f of [...srcUnder("components"), ...srcUnder("app")].filter((x) => x.endsWith(".tsx"))) {
      expect(read(f), rel(f)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(read(f), rel(f)).not.toMatch(/\b(bg|text|border)-(white|black|gray|slate|zinc|neutral|red|blue|green)-?\d*\b/);
    }
  });
});
