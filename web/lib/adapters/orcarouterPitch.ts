// 人格つきの紹介文の書き手と検査官（差し替え口 PitchWriter の OrcaRouter 版）。2026-09-25 監査の指摘 設計-16 で
// adapters/orcarouter.ts から分けた（文面と呼び方は変えていない）。AI を呼ぶ URL と呼び出しの形は orcarouter.ts が持ち、
// ここはその `callOrcaRouter` に注文を渡すだけ。AI は道具（tool）を1つも持たない（設計書「AI まわりの守り」の1段目）。

import { unfoundedPraiseList } from "../domain/claims";
import type { PitchInput, PitchJudgeInput, PitchResult, PitchWriter } from "../ports";
import { callOrcaRouter, dataBlock, DATA_RULE, FALLBACK_MODEL, JUDGE_MODEL, PITCH_MAX_TOKENS, JUDGE_MAX_TOKENS, type CallOutcome, type OrcaRouterConfig } from "./orcarouter";

/** 判定役が鍵の scope で 403 になったとき、次に試すまで覚えておく時間（店ごとに毎回踏まない） */
const JUDGE_DENIED_MEMO_MS = 10 * 60 * 1000;
/** 鍵の scope で断られた印（OrcaRouter が返す語） */
const MODEL_ACCESS_DENIED = "model_access_denied";

/**
 * 判定役が鍵の scope で断られた覚え（鍵と判定役ごとの「次に試す時刻」）。**モジュールの外側**に置く——Deps（とこの口）は
 * 要求ごとに作り直すので、口を作る関数の中に置くと1つの要求の中でしか残らず、店ごとに毎回 403 を踏みに行っていた
 * （2026-09-25 監査の指摘 設計-11）。Workers の isolate が生きている間だけ残る（落ちたら、また1回試すだけ）。
 */
const judgeDeniedUntil = new Map<string, number>();
const judgeMemoKey = (apiKey: string, judgeModel: string): string => `${judgeModel}\u0000${apiKey}`;

// ---------- 人格つきの紹介文（書き手と検査官） ----------

/**
 * ペルソナ（2026-09-22 に本人の指摘で作り直した）。指摘の原文:
 *
 *   「AIの紹介文が**絶品だよなど根拠のない感想**を述べていて、**ステマ臭い**です。
 *     あくまでも状況情報から**その客がその店の近くにいて、その店はこんなメニューを勧めていて、
 *     提示した好みにあってそうでクーポンが選べる**などの情報から誘い文句を考えてほしいです。
 *     それと、口調は**アメリカ人の友人のような言い回し**が好みです」
 *
 * 初版（速成版 `lib/personaPitch.ts:16` の「地元の常連」）との違いは**何を言ってよいかの線**。
 * 旧版は「店の魅力を一言で」としか言っておらず、味の良し悪しを勝手に断定する余地が開いていた。
 * 書き手が知っているのは**状況**だけで、**味は知らない**——この一点を人格の中心に置く。
 */
export const PERSONA_SYSTEM =
  "あなたは東京に住んで長いアメリカ人の友人です。日本語は流暢で、くだけた話し方をします。" +
  "友達に「今ここ空いてるよ」と教えるときの、気さくでまっすぐな調子で話してください。";

const writeSystem = (charLimit: number, rewriting: boolean): string =>
  [
    PERSONA_SYSTEM,
    DATA_RULE,
    `${charLimit}字以内の日本語で書く（1〜2文）。`,
    // ここが作り直しの中心。「褒める」のではなく「状況を並べて誘う」。
    "**味や品質を評価しない。** あなたはその店で食べたことがありません。",
    "使ってよいのは渡された状況だけです——(a) 今いる場所からの近さ (b) その店が今すすめているメニュー (c) 客が言った好みや予算との重なり (d) 今使えるクーポン。",
    "この4つを組み合わせて「だから今ちょうどいい」と伝えてください。褒め言葉で持ち上げない。",
    // 一覧は検査（domain/pitch → domain/claims）が落とす語と同じ1つの定数から作る（不具合-07: 以前は食い違っていた）
    `**使ってはいけない言い方**: ${unfoundedPraiseList()}——渡されていない評価の断定はすべて禁止。`,
    "クーポンは店が今出している特典として触れてよい。ただし「全部もらえる」とは書かない。",
    "口コミ・レビュー・点数・星の数など、渡されていない情報には一切触れない（このシステムにそのデータは存在しないため）。",
    "渡された情報にないメニューや価格を作らない。URLや電話番号は書かない。",
    // 思考を止めていても、指示の側でも短く切り上げさせる（速成版 2026-09-21 の実測）。
    "考えや手順・下書き・言い換え案は書かない。完成した紹介文だけを、そのまま返す。",
    "前置き・見出し・箇条書き・記号・引用符は付けない。",
    // 却下の理由には検査官（AI）の答えが混じる。指示の側には置かず、データの側に入れる（安全-11）
    rewriting ? "直前の案は却下された。理由はデータの「直前の案が却下された理由」にある。同じ問題を避けて書き直す。" : "",
  ]
    .filter(Boolean)
    .join("\n");

const writeUser = (input: PitchInput): string =>
  [
    "客と店の状況:",
    dataBlock({
      客: {
        人数: input.party,
        好み: input.genres.length > 0 ? input.genres : "こだわらない",
        予算の上限: input.budgetMax === null ? "指定なし" : `${input.budgetMax}円`,
      },
      店: {
        店名: input.store.name,
        ジャンル: input.store.genres.length > 0 ? input.store.genres : "ジャンル不明",
        徒歩: `${input.store.walkMinutes}分`,
        "1人あたりの価格帯": `${input.store.budgetMin}〜${input.store.budgetMax}円`,
        おすすめメニュー: input.store.menus.length > 0 ? input.store.menus : "情報なし",
        現在のクーポン: input.store.couponName ? { 名前: input.store.couponName, 特記事項: input.store.couponNote ?? "" } : "なし",
      },
      ...(input.critique ? { 直前の案が却下された理由: input.critique } : {}),
    }),
  ].join("\n");

/**
 * 検査官への指示。
 *
 * ⚠️ **2026-09-22 に向きを変えた。** それまでは「褒め言葉だけでは不合格にしない」と明記していた——
 * 速成版 2026-09-21 の実測で、検査官が「美味しい」を〈存在しないデータ〉とみなして真っ当な文まで
 * 落としていたため、緩める方向へ2行足してあった。
 *
 * ところが本人から逆向きの指摘が来た——「**絶品だよなど根拠のない感想**を述べていて**ステマ臭い**」。
 * 緩めた結果が、まさにその状態だった。そこで**味や品質の断定を不合格の理由に格上げ**した。
 *
 * ただし前の失敗を繰り返さないために、**落とすのは「渡していない評価の断定」だけ**に絞る。
 * 「近いよ」「好みに合いそう」「今ならクーポンが使える」といった**状況の言い換えは落とさない**——
 * ここを曖昧にすると、また全部が不合格になって決定論の文へ倒れる。
 */
const JUDGE_SYSTEM = [
  "あなたは飲食店の紹介文の検査官です。**合格が既定**で、次の4つのどれかに当たるときだけ不合格にします。",
  // 検査する文は AI が書いたもの、事実は店が書いたもの。どちらにも「合格にせよ」を書き込める（安全-11）
  DATA_RULE,
  "(1) 口コミサイトの点数・星の数・レビュー件数・受賞歴など、渡されていないデータを根拠として挙げている",
  "(2) 渡していないメニュー名・価格・設備（個室・掘りごたつ・駐車場など）を、事実として書いている",
  "(3) 押し売り・不快・倫理的におかしい表現がある",
  // ⚠️ 本人の指摘（2026-09-22）で足した4つ目。ここが今回の作り直しの中心。
  // ⚠️ この行に**「評価」という語そのものを書かない**——2026-09-21 の実測で、検査官はその語を見ると
  // 「美味しい」を〈存在しないデータ〉とみなし、通すべき文まで落とした。狙いは同じでも語を変える。
  "(4) **その店で食べた人にしか言えないことを、断定して書いている**（絶品・自慢の一品・本格的・極上・最高・名物・人気・評判・こだわりの・間違いない・外れない・美味しい・うまい など）",
  "店名・ジャンル・メニュー名・クーポン・徒歩分数・価格帯は渡した事実なので、触れて構いません。",
  // ⚠️ この2行を削らない。(4) を足したことで「主観っぽい」を何でも落とす方へ振れやすくなった。
  // 落とすのは**味や品質の断定**だけで、状況の言い換えは通す。
  "**状況を述べただけの文は合格です**——「歩いて4分」「ラーメン好きにちょうどいい」「今ならクーポンが1つ使える」「予算に収まりそう」などは、渡した事実の言い換えなので落としません。",
  "文がくだけている・親しげであることを理由に不合格にしてはいけません。見るのは上の4つだけです。",
  '考えを書かず、JSON だけを返します: {"ok":true|false,"reason":"不合格なら短い理由（40字以内）。合格なら空文字"}',
].join("\n");

const judgeUser = (input: PitchJudgeInput): string =>
  [
    "検査対象の文と、渡した事実:",
    dataBlock({
      検査対象の文: input.text,
      渡した事実: {
        店名: input.store.name,
        ジャンル: input.store.genres.length > 0 ? input.store.genres : "不明",
        メニュー: input.store.menus.length > 0 ? input.store.menus : "なし",
        クーポン: input.store.couponName ?? "なし",
      },
    }),
  ].join("\n");

const toPitchResult = (outcome: CallOutcome): PitchResult =>
  outcome.ok
    ? { ok: true, text: outcome.text, costUsd: outcome.costUsd, truncated: outcome.truncated, resolvedModel: outcome.resolvedModel, requestId: outcome.requestId, fallbackLevel: outcome.fallbackLevel }
    : { ok: false, error: outcome.error, costUsd: outcome.costUsd };

/**
 * 人格つきの紹介文を書く口と、それを検査する口（設計書の後段——店の選定とは別の層）。
 *
 * ⚠️ **実物の Deps を組む場所（`app/api` の入口）で渡すこと**:
 * `pitch: createOrcaRouterPitchWriter({ apiKey: env.ORCAROUTER_API_KEY, model: env.ORCAROUTER_MODEL })`
 * 渡さないと紹介文の層は丸ごと走らず、店の選定が書いた理由だけが客に出る（落ちはしない）。
 *
 * 検査官は別ベンダー（JUDGE_MODEL）に頼むが、**本番の鍵の scope では 403 になることがある**。
 * そのときは生成と同じ Named Router で検査し直す——独立性は落ちるが、機能が1度も出ないよりは良い。
 * 本人が OrcaRouter コンソールで scope を足せば、この経路は使われなくなる（再デプロイ不要）。
 */
export const createOrcaRouterPitchWriter = (config: OrcaRouterConfig & { judgeModel?: string }): PitchWriter => {
  const judgeModel = config.judgeModel ?? JUDGE_MODEL;
  // 403 を店ごとに何度も踏まない（1回 約0.2〜0.4秒の無駄）。一定時間だけ覚えて、また試す（覚えは上の judgeDeniedUntil）。
  const memoKey = judgeMemoKey(config.apiKey, judgeModel);

  /**
   * 検査官を1回呼ぶ。⚠️ `noThinking` は**判定役のときだけ false**——`orcarouter/akiseki-judge` は
   * `openai/gpt-4o-mini` で、思考を止める指定を送ると 400 で丸ごと落ちる（2026-09-22 実測）。
   * 生成と同じ Named Router（google 系）へ倒したときは付けてよい。
   */
  const judgeWith = (model: string, user: string, opts: { signal?: AbortSignal }, noThinking: boolean): Promise<CallOutcome> =>
    callOrcaRouter(config, { model, models: [model], system: JUDGE_SYSTEM, user, temperature: 0.1, maxTokens: JUDGE_MAX_TOKENS, noThinking }, opts);

  return {
    write: async (input, opts): Promise<PitchResult> =>
      toPitchResult(
        await callOrcaRouter(
          config,
          {
            model: config.model,
            models: [config.model, FALLBACK_MODEL],
            system: writeSystem(input.charLimit, input.critique !== null),
            user: writeUser(input),
            // 人格を出すので温度を上げる（後ろに決定論のガードと検査官が居る）
            temperature: 0.75,
            maxTokens: PITCH_MAX_TOKENS,
            noThinking: true,
          },
          opts,
        ),
      ),

    judge: async (input, opts): Promise<PitchResult> => {
      const user = judgeUser(input);
      if (Date.now() < (judgeDeniedUntil.get(memoKey) ?? 0)) return toPitchResult(await judgeWith(config.model, user, opts, true));
      const first = await judgeWith(judgeModel, user, opts, false);
      if (first.ok || first.error !== MODEL_ACCESS_DENIED) return toPitchResult(first);
      judgeDeniedUntil.set(memoKey, Date.now() + JUDGE_DENIED_MEMO_MS);
      return toPitchResult(await judgeWith(config.model, user, opts, true));
    },
  };
};
