// LLM は入口（嗜好の構造化）と出口（通知文）の2箇所だけ。どちらも OrcaRouter 経由。
// 出力は必ず検査し、入口で落ちたら書き直しを求め、出口で落ちたら定型文に切り替える。
import type { Prefs } from "./matching";

export const GENRES = ["居酒屋", "焼肉", "ラーメン", "カフェ", "イタリアン", "和食", "中華", "エスニック"];
export const ALLERGENS = ["えび", "かに", "小麦", "卵", "乳", "そば", "落花生", "くるみ"];

const ORCA_URL = "https://api.orcarouter.ai/v1/chat/completions";
const TIMEOUT_MS = 8000;

type LlmResult = { text: string; costUsd: number | null; model: string | null };

const apiKey = () => process.env.ORCAROUTER_API_KEY?.trim() || null;

export const llmAvailable = () => apiKey() !== null;

const callOrca = async (system: string, user: string): Promise<LlmResult> => {
  const key = apiKey();
  if (!key) throw new Error("ORCAROUTER_API_KEY が未設定");
  const res = await fetch(ORCA_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OrcaRouter-Include-Cost": "true" },
    body: JSON.stringify({
      model: process.env.ORCAROUTER_MODEL ?? "orcarouter/auto",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OrcaRouter HTTP ${res.status}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost_usd?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? "",
    costUsd: body.usage?.cost_usd ?? null,
    model: res.headers.get("X-Orca-Resolved-Model"),
  };
};

const extractJson = (text: string): unknown => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON が見つからない");
  return JSON.parse(match[0]);
};

// ---- 入口: 嗜好の構造化 ----

const ALLERGY_HINTS: [RegExp, string[]][] = [
  [/甲殻|えび|エビ|海老/, ["えび"]],
  [/甲殻|かに|カニ|蟹/, ["かに"]],
  [/小麦|グルテン/, ["小麦"]],
  [/卵|たまご|タマゴ/, ["卵"]],
  [/乳|牛乳|乳製品/, ["乳"]],
  [/そば|蕎麦/, ["そば"]],
  [/落花生|ピーナッツ/, ["落花生"]],
  [/くるみ|クルミ/, ["くるみ"]],
];
const GENRE_HINTS: [RegExp, string[]][] = [
  [/がっつり|ガッツリ|肉/, ["焼肉", "ラーメン"]],
  [/居酒屋|飲み|酒|ビール/, ["居酒屋"]],
  [/焼肉/, ["焼肉"]],
  [/ラーメン|らーめん/, ["ラーメン"]],
  [/カフェ|コーヒー|甘い/, ["カフェ"]],
  [/イタリアン|パスタ|ピザ/, ["イタリアン"]],
  [/和食|寿司|すし|刺身/, ["和食"]],
  [/中華|餃子/, ["中華"]],
  [/エスニック|タイ|カレー/, ["エスニック"]],
];

const ALLERGY_CONTEXT = /アレルギー|苦手|食べられない|ダメ|NG/;
const segments = (text: string) => text.split(/[。\n、,]/);
const allergyLine = (text: string) => segments(text).filter((s) => ALLERGY_CONTEXT.test(s)).join(" ");
const likingLine = (text: string) => segments(text).filter((s) => !ALLERGY_CONTEXT.test(s)).join(" ");

/** 規則による読み取り（OrcaRouter が使えないときの逃げ道。LLM ではないことを画面に出す） */
export const rulePrefs = (text: string): Prefs => {
  const hits = (hints: [RegExp, string[]][], source: string) => [...new Set(hints.flatMap(([re, v]) => (re.test(source) ? v : [])))];
  const yen = text.match(/(\d[\d,]*)\s*円/);
  return {
    genres: hits(GENRE_HINTS, likingLine(text)),
    budgetMax: yen ? Number(yen[1].replaceAll(",", "")) : null,
    allergies: hits(ALLERGY_HINTS, allergyLine(text)),
  };
};

/** 検査: 語彙の外の値・型の崩れ・「本文にアレルギーの語があるのに空」を落とす */
export const checkPrefs = (raw: unknown, text: string): { ok: true; prefs: Prefs } | { ok: false; reason: string } => {
  const v = raw as Partial<Record<keyof Prefs, unknown>>;
  if (!v || !Array.isArray(v.genres) || !Array.isArray(v.allergies)) return { ok: false, reason: "形が崩れていた" };
  const genres = v.genres.filter((g): g is string => typeof g === "string");
  const allergies = v.allergies.filter((a): a is string => typeof a === "string");
  if (genres.some((g) => !GENRES.includes(g))) return { ok: false, reason: "ジャンルが決まった語彙の外だった" };
  if (allergies.some((a) => !ALLERGENS.includes(a))) return { ok: false, reason: "アレルギーが決まった語彙の外だった" };
  const budgetMax = typeof v.budgetMax === "number" && v.budgetMax > 0 ? Math.round(v.budgetMax) : null;
  const mentioned = ALLERGY_HINTS.some(([re]) => re.test(allergyLine(text)));
  if (mentioned && allergies.length === 0) return { ok: false, reason: "アレルギーが書かれているのに読み取れなかった" };
  return { ok: true, prefs: { genres, budgetMax, allergies } };
};

export type PrefsOutcome =
  | { ok: true; prefs: Prefs; source: "llm" | "rule"; costUsd: number | null; note?: string }
  | { ok: false; reason: string };

export const structurePrefs = async (text: string): Promise<PrefsOutcome> => {
  if (!llmAvailable()) {
    const checked = checkPrefs(rulePrefs(text), text);
    return checked.ok ? { ok: true, prefs: checked.prefs, source: "rule", costUsd: null, note: "OrcaRouter のキーが未設定のため規則で読み取った" } : checked;
  }
  const system = [
    "あなたは飲食の好みを JSON に変換する係です。JSON だけを返します。",
    `形: {"genres": string[], "budgetMax": number|null, "allergies": string[]}`,
    `genres は次の語彙からだけ選ぶ: ${GENRES.join(", ")}（「がっつり系」は焼肉・ラーメン）`,
    `allergies は次の語彙からだけ選ぶ: ${ALLERGENS.join(", ")}（「甲殻類」は えび と かに）`,
    "budgetMax は1人あたりの上限の円。書かれていなければ null。",
  ].join("\n");
  try {
    const r = await callOrca(system, text);
    const checked = checkPrefs(extractJson(r.text), text);
    return checked.ok ? { ok: true, prefs: checked.prefs, source: "llm", costUsd: r.costUsd } : checked;
  } catch (error) {
    const checked = checkPrefs(rulePrefs(text), text);
    const why = error instanceof Error ? error.message : "不明";
    return checked.ok ? { ok: true, prefs: checked.prefs, source: "rule", costUsd: null, note: `LLM が失敗したため規則で読み取った（${why}）` } : checked;
  }
};

// ---- 出口: 通知文 ----

export const templateMessage = (storeName: string, perk: string, seats: number, expiresAt: number) => {
  const hhmm = new Date(expiresAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
  return `${storeName}：今なら${seats}席空いています。${perk}（${hhmm}まで）`;
};

/** 検査: 長さ・URL・電話番号やメールアドレス・特典名の欠落 */
export const checkMessage = (message: string, perk: string): string | null => {
  if (message.length === 0 || message.length > 80) return "長さが1〜80字の外";
  if (/https?:\/\/|www\./i.test(message)) return "URL を含む";
  if (/\d{2,4}-\d{2,4}-\d{3,4}|@[\w.-]+\./.test(message)) return "電話番号かメールアドレスを含む";
  if (!message.includes(perk)) return "特典の名前が入っていない";
  return null;
};

export type MessageOutcome = { message: string; source: "llm" | "template"; costUsd: number | null; note?: string };

export const generateMessage = async (storeName: string, genre: string, perk: string, seats: number, expiresAt: number): Promise<MessageOutcome> => {
  const fallback = (note: string): MessageOutcome => ({ message: templateMessage(storeName, perk, seats, expiresAt), source: "template", costUsd: null, note });
  if (!llmAvailable()) return fallback("OrcaRouter のキーが未設定のため定型文");
  try {
    const r = await callOrca(
      "飲食店の空席をお知らせするプッシュ通知の文を1つだけ書きます。60字以内。URL・電話番号は入れない。特典の名前はそのまま入れる。文だけを返す。",
      `店名: ${storeName}\nジャンル: ${genre}\n空席: ${seats}席\n特典: ${perk}\n有効: 30分`,
    );
    const message = r.text.trim().replace(/^["「]|["」]$/g, "");
    const problem = checkMessage(message, perk);
    return problem ? fallback(`LLM の文が検査に落ちたため定型文（${problem}）`) : { message, source: "llm", costUsd: r.costUsd };
  } catch (error) {
    return fallback(`LLM が失敗したため定型文（${error instanceof Error ? error.message : "不明"}）`);
  }
};
