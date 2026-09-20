// AI は2箇所だけ。入口＝客の自由文を項目に分ける。出口＝上位10件から最大5件を選んで理由を1文ずつ書く。
// 呼び出しは必ず OrcaRouter を通す。失敗・時間切れ・検査に落ちたときは、入口は規則で読み、出口は点数順に倒す。
import { ALLERGENS, GENRES, type Candidate, type Prefs } from "./core";

const ENDPOINT = "https://api.orcarouter.ai/v1/chat/completions";

type OrcaResult = { text: string; costUsd: number | null };

const callOrca = async (system: string, user: string, timeoutMs: number): Promise<OrcaResult | null> => {
  const key = process.env.ORCAROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-OrcaRouter-Include-Cost": "true",
      },
      body: JSON.stringify({
        model: "orcarouter/auto",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { cost_usd?: number };
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) return null;
    return { text, costUsd: body.usage?.cost_usd ?? null };
  } catch {
    return null;
  }
};

const firstJson = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

// ---- 入口: 嗜好の構造化 ----

export const rulePrefs = (text: string): Prefs => ({
  genres: GENRES.filter((g) => text.includes(g)),
  budgetMax: (() => {
    const m = text.match(/(\d[\d,]{2,})\s*円/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  })(),
  allergies: ALLERGENS.filter((a) => text.includes(a)).concat(
    /甲殻類|エビ|カニ/.test(text) ? ["えび", "かに"] : [],
  ),
  summary: text.slice(0, 60),
});

const checkPrefs = (value: unknown): Prefs | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const genres = Array.isArray(v.genres) ? v.genres.filter((g): g is string => typeof g === "string") : null;
  const allergies = Array.isArray(v.allergies) ? v.allergies.filter((a): a is string => typeof a === "string") : null;
  if (!genres || !allergies) return null;
  if (genres.some((g) => !GENRES.includes(g as (typeof GENRES)[number]))) return null;
  if (allergies.some((a) => !ALLERGENS.includes(a as (typeof ALLERGENS)[number]))) return null;
  const budget = v.budgetMax;
  const budgetMax = budget === null || budget === undefined ? null : typeof budget === "number" && budget > 0 ? Math.round(budget) : null;
  const summary = typeof v.summary === "string" ? v.summary.slice(0, 60) : "";
  return { genres: [...new Set(genres)], budgetMax, allergies: [...new Set(allergies)], summary };
};

export const structurePrefs = async (text: string): Promise<{ prefs: Prefs; source: "llm" | "rule"; costUsd: number | null }> => {
  const system = [
    "あなたは飲食店の集客サービスの受付です。客が書いた文から、好みを JSON で取り出します。",
    `genres は次からだけ選ぶ: ${GENRES.join("・")}`,
    `allergies は次からだけ選ぶ: ${ALLERGENS.join("・")}`,
    'JSON だけを返す: {"genres":[],"budgetMax":null,"allergies":[],"summary":"40字以内の要約"}',
    "budgetMax は1人あたりの上限の円。書かれていなければ null。",
  ].join("\n");
  const result = await callOrca(system, text, 8000);
  const parsed = result ? checkPrefs(firstJson(result.text)) : null;
  if (!parsed || !result) return { prefs: rulePrefs(text), source: "rule", costUsd: result?.costUsd ?? null };
  return { prefs: parsed, source: "llm", costUsd: result.costUsd };
};

// ---- 出口: 店の選定と理由 ----

export const FALLBACK_REASON = "今の条件で近い順に選びました";

export type Pick = { storeId: string; reason: string };

export const selectStores = async (
  candidates: Candidate[],
  prefs: Prefs,
  party: number,
): Promise<{ picks: Pick[]; aiUsed: boolean; costUsd: number | null }> => {
  const top = candidates.slice(0, 10);
  const fallback = () => ({
    picks: top.slice(0, 5).map((c) => ({ storeId: c.store.id, reason: FALLBACK_REASON })),
    aiUsed: false,
    costUsd: null as number | null,
  });
  if (top.length === 0) return fallback();

  const menuLine = (c: Candidate) => c.menus.slice(0, 5).map((m) => `${m.name}(${m.price}円)`).join("・");
  const user = [
    `客: ${party}人。好み: ${prefs.genres.join("・") || "こだわらない"}。予算の上限: ${prefs.budgetMax ?? "指定なし"}円。アレルギー: ${prefs.allergies.join("・") || "なし"}。ひとこと: ${prefs.summary}`,
    "店の一覧:",
    ...top.map((c) => `- id=${c.store.id} 店名=${c.store.name} ジャンル=${c.store.genre} 徒歩${c.walkMin}分 1人${c.store.price_avg}円 特典=${c.offers.map((o) => o.title).join("・")} メニュー=${menuLine(c)}`),
  ].join("\n");
  const system = [
    "あなたは飲食店のおすすめ係です。客の好みと店のメニューを見比べて、合う店を最大5件選びます。",
    "選ぶのは一覧にある id だけ。客が食べられないもの・予算を超える店は選ばない。",
    '理由は日本語1文（40字以内）。メニューか特典に触れる。JSON だけを返す: {"picks":[{"storeId":"","reason":""}]}',
  ].join("\n");

  const result = await callOrca(system, user, 15000);
  if (!result) return fallback();
  const parsed = firstJson(result.text) as { picks?: { storeId?: unknown; reason?: unknown }[] } | null;
  const ids = new Set(top.map((c) => c.store.id));
  const picks: Pick[] = [];
  for (const p of parsed?.picks ?? []) {
    if (typeof p.storeId !== "string" || !ids.has(p.storeId)) continue;
    if (typeof p.reason !== "string" || p.reason.length === 0 || p.reason.length > 80) continue;
    if (/https?:|\d{2,4}-\d{2,4}-\d{3,4}/.test(p.reason)) continue;
    if (picks.some((x) => x.storeId === p.storeId)) continue;
    picks.push({ storeId: p.storeId, reason: p.reason });
    if (picks.length === 5) break;
  }
  if (picks.length === 0) return { ...fallback(), costUsd: result.costUsd };
  return { picks, aiUsed: true, costUsd: result.costUsd };
};
