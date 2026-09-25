// 受け入れ検査の道具のうち、偽の時計と偽の差し替え口（外のサービスの偽物）。場面や入口の道具は _fakes.ts。
// _fakes.ts が全部を export し直すので、検査は今までどおり `./_fakes` から読めばよい。
import type {
  AiSelectInput,
  AiSelectResult,
  AiSelector,
  CardRegistrar,
  Clock,
  FileStore,
  Geocoder,
  HumanCheck,
  Logger,
  PitchInput,
  PitchJudgeInput,
  PitchResult,
  PitchWriter,
  PushSender,
  Rng,
  StoreImageFetcher,
} from "./_types";

/** 2026-09-22 15:00 JST（06:00Z）。偽の時計の起点 */
export const T0 = "2026-09-22T06:00:00.000Z";

// ---------- 偽物の印 ----------
/**
 * このファイルが作った偽物の控え。場面（_fakes.ts の buildCtx）は、差し替え口に渡った物が**本当にここで作った偽物か**を
 * これで見分け、偽物でなければ `ctx.<名前>` を undefined にする（2026-09-25 設計-02 のレビュー。以前は
 * `deps.logger as FakeLogger` と型だけ偽物にしていて、偽物でない物を渡すと `.entries` が実行時に黙って undefined だった）。
 * 形で見分けず、作った物そのもので見分ける（偽物を広げて写した物は、道具の控えが元の偽物と食い違うため）。
 */
const FAKES = new WeakSet<object>();
const markFake = <T extends object>(fake: T): T => {
  FAKES.add(fake);
  return fake;
};
/** このファイルの偽物そのものか */
export const isFake = (port: unknown): boolean => typeof port === "object" && port !== null && FAKES.has(port);

// ---------- 偽の時計 ----------
export type FakeClock = Clock & {
  advance(ms: number): Promise<void>;
  set(iso: string): void;
  /**
   * これから `count` 本の合図（`after`）が作られるまで待つ約束を返す。**要求を送る前に**呼ぶ。
   *
   * 差し替えた時計は「今」を進めたその時に待っている合図しか起こさない。要求を送った直後に
   * `advance` すると、手続きがまだ合図を作っていないことがあり、その合図は二度と鳴らない——
   * 検査は実時計の打ち切り（AbortSignal.timeout の3秒・6秒）で緑になり、偽の時計が効いているかを
   * 何も示さなくなる（2026-09-25 設計-19）。この約束を待ってから進めること。
   * 実時間で `withinMs` のうちに作られなければ、理由つきで落ちる。
   */
  armed(count?: number, withinMs?: number): Promise<void>;
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
export const fakeClock = (startIso = T0): FakeClock => {
  let t = new Date(startIso).getTime();
  let created = 0;
  const waiters: Array<{ at: number; resolve: () => void }> = [];
  const watchers: Array<{ target: number; resolve: () => void }> = [];
  const fire = () => {
    for (const w of [...waiters]) {
      if (w.at <= t) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  };
  const notify = () => {
    for (const w of [...watchers]) {
      if (created >= w.target) {
        watchers.splice(watchers.indexOf(w), 1);
        w.resolve();
      }
    }
  };
  return markFake({
    now: () => new Date(t),
    after: (ms) =>
      new Promise<void>((resolve) => {
        waiters.push({ at: t + ms, resolve });
        created++;
        notify();
      }),
    advance: async (ms) => {
      t += ms;
      fire();
      await flush();
    },
    set: (iso) => {
      t = new Date(iso).getTime();
      fire();
    },
    armed: (count = 1, withinMs = 2_000) => {
      const target = created + count;
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`偽の時計の合図が ${withinMs}ms のうちに ${count} 本作られませんでした（手続きが deps.clock.after を使っていない）`)), withinMs);
        watchers.push({
          target,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        });
        notify();
      });
    },
  });
};
export const MIN = 60_000;
export const HOUR = 60 * MIN;

// ---------- 偽の差し替え口 ----------
export type FakeAi = AiSelector & {
  calls: AiSelectInput[];
  /** 返し方を差し替える。"hang" は永遠に返らない */
  respond: (fn: (input: AiSelectInput) => AiSelectResult | "hang" | Promise<AiSelectResult>) => void;
};
export const selectionText = (items: Array<{ storeId: string; reason: string }>) => JSON.stringify({ selections: items });
export const fakeAi = (): FakeAi => {
  let responder: (input: AiSelectInput) => AiSelectResult | "hang" | Promise<AiSelectResult> = (input) => ({
    ok: true,
    text: selectionText(input.stores.slice(0, 5).map((s) => ({ storeId: s.id, reason: `${s.genres[0] ?? "お店"}で好みに合います` }))),
    costUsd: 0.0012,
  });
  const ai: FakeAi = {
    calls: [],
    respond: (fn) => {
      responder = fn;
    },
    select: async (input, opts) => {
      ai.calls.push(JSON.parse(JSON.stringify(input)));
      const r = responder(input);
      if (r === "hang") {
        return new Promise<AiSelectResult>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }));
        });
      }
      return r;
    },
  };
  return markFake(ai);
};

/** 打ち切りの合図が来るまで返らない（偽物の「返らない外のサービス」の共通の形） */
const hangUntilAbort = <T>(signal: AbortSignal | undefined, onAbort: T): Promise<T> =>
  new Promise<T>((resolve) => {
    signal?.addEventListener("abort", () => resolve(onAbort));
  });

type ReverseAnswer = { label: string } | "none" | "fail" | "hang";
export type FakeGeocoder = Required<Geocoder> & {
  /** 地名 → 位置（geocode）の呼ばれた文字 */
  calls: string[];
  set: (text: string, result: { lat: number; lng: number } | "none" | "fail" | "hang") => void;
  /** 位置 → 地名（reverse）の呼ばれた位置 */
  reverseCalls: Array<{ lat: number; lng: number }>;
  /** 逆引きの返し方（既定は、どこでも「渋谷駅周辺」） */
  setReverse: (result: ReverseAnswer) => void;
  /** 場所の候補（suggest）の呼ばれた文字 */
  suggestCalls: string[];
  setSuggest: (text: string, suggestions: string[] | "fail" | "hang") => void;
};
/**
 * 偽の地図。本番の口（`web/lib/ports.ts` の Geocoder）と同じく、逆引き（reverse）と場所の候補（suggest）も持つ。
 * 2026-09-25 設計-03: 以前は geocode だけで、客の画面が開いた瞬間に通る逆引きと候補の道を、
 * 受け入れ検査が一度も通っていなかった。無い形を試したいときは `{ reverse: false, suggest: false }`。
 */
export const fakeGeocoder = (opts: { reverse?: boolean; suggest?: boolean } = {}): FakeGeocoder => {
  const table = new Map<string, { lat: number; lng: number } | "none" | "fail" | "hang">();
  const suggestTable = new Map<string, string[] | "fail" | "hang">();
  let reverseAnswer: ReverseAnswer = { label: "渋谷駅周辺" };
  const g: FakeGeocoder = {
    calls: [],
    reverseCalls: [],
    suggestCalls: [],
    set: (text, result) => {
      table.set(text, result);
    },
    setReverse: (result) => {
      reverseAnswer = result;
    },
    setSuggest: (text, suggestions) => {
      suggestTable.set(text, suggestions);
    },
    geocode: async (text, opts) => {
      g.calls.push(text);
      const r = table.get(text) ?? "none";
      if (r === "none") return { ok: false };
      if (r === "fail") throw new Error("geocoder failure");
      if (r === "hang") return hangUntilAbort(opts?.signal, { ok: false } as const);
      return { ok: true, lat: r.lat, lng: r.lng };
    },
    reverse: async (point, opts) => {
      g.reverseCalls.push({ lat: point.lat, lng: point.lng });
      const r = reverseAnswer;
      if (r === "none") return { ok: false };
      if (r === "fail") throw new Error("reverse geocoder failure");
      if (r === "hang") return hangUntilAbort(opts?.signal, { ok: false } as const);
      return { ok: true, label: r.label };
    },
    suggest: async (text, opts) => {
      g.suggestCalls.push(text);
      const r = suggestTable.get(text) ?? [];
      if (r === "fail") throw new Error("suggest failure");
      if (r === "hang") return hangUntilAbort(opts?.signal, { ok: false } as const);
      return { ok: true, suggestions: [...r], source: "geocoding" };
    },
  };
  // 口そのものを持たない場面（usecases の「口が無ければ外へ聞かない」の枝）を作るため
  const shaped: Partial<FakeGeocoder> = { ...g };
  if (opts.reverse === false) delete shaped.reverse;
  if (opts.suggest === false) delete shaped.suggest;
  return markFake((opts.reverse === false || opts.suggest === false ? shaped : g) as FakeGeocoder);
};

/** 偽の紹介文の書き手と検査官（本番の `deps.pitch`）。既定は1回で書けて検査も通る */
export type FakePitch = PitchWriter & {
  writes: PitchInput[];
  judges: PitchJudgeInput[];
  /** 書き方を差し替える。"hang" は打ち切りまで返らない */
  respondWrite: (fn: (input: PitchInput) => PitchResult | "hang") => void;
  respondJudge: (fn: (input: PitchJudgeInput) => PitchResult | "hang") => void;
  /** 書き手と検査官の呼ばれた合計（取得1回あたりの AI の呼び出しを数える・要件7.2） */
  total: () => number;
};
export const fakePitch = (): FakePitch => {
  let writer: (input: PitchInput) => PitchResult | "hang" = (input) => ({ ok: true, text: `${input.store.menus[0] ?? input.store.name}が近くで味わえます`, costUsd: 0.0004, truncated: false });
  let judge: (input: PitchJudgeInput) => PitchResult | "hang" = () => ({ ok: true, text: JSON.stringify({ ok: true, reason: "" }), costUsd: 0.0002, truncated: false });
  const p: FakePitch = {
    writes: [],
    judges: [],
    respondWrite: (fn) => {
      writer = fn;
    },
    respondJudge: (fn) => {
      judge = fn;
    },
    total: () => p.writes.length + p.judges.length,
    write: async (input, opts) => {
      p.writes.push(JSON.parse(JSON.stringify(input)));
      const r = writer(input);
      return r === "hang" ? hangUntilAbort(opts?.signal, { ok: false, error: "aborted" } as PitchResult) : r;
    },
    judge: async (input, opts) => {
      p.judges.push(JSON.parse(JSON.stringify(input)));
      const r = judge(input);
      return r === "hang" ? hangUntilAbort(opts?.signal, { ok: false, error: "aborted" } as PitchResult) : r;
    },
  };
  return markFake(p);
};

/** 偽の店の画像の口（本番の `deps.storeImage`）。呼ばれた URL を控える */
export type FakeStoreImage = StoreImageFetcher & { calls: string[]; result: { ok: true; imageUrl: string } | { ok: false } };
export const fakeStoreImage = (): FakeStoreImage => {
  const s: FakeStoreImage = {
    calls: [],
    result: { ok: true, imageUrl: "https://images.example.com/store.jpg" },
    fetch: async (homepageUrl) => {
      s.calls.push(homepageUrl);
      return s.result;
    },
  };
  return markFake(s);
};

/**
 * 偽の Web プッシュの口。`result` で返し方を替える: 既定は届いた／`{ ok: false, gone }`／"throw"（例外）／
 * "hang"（**打ち切りの合図まで返らない**＝応答しない配信先。合図が無ければ永遠に返らない・通知の送信の打ち切りの件（不具合-08））。
 */
export type FakePush = PushSender & { calls: Array<{ subscription: unknown; ttlSeconds: number }>; result: { ok: true } | { ok: false; gone: boolean } | "throw" | "hang" };
export const fakePush = (): FakePush => {
  const p: FakePush = {
    calls: [],
    result: { ok: true },
    send: async (subscription, opts) => {
      p.calls.push({ subscription, ttlSeconds: opts.ttlSeconds });
      if (p.result === "throw") throw new Error("push failure");
      if (p.result === "hang") return hangUntilAbort(opts.signal, { ok: false, gone: false } as const);
      return p.result;
    },
  };
  return markFake(p);
};

/** Stripe の側が持つ1件（番号・どの店のものか・戻り先・入力を終えたか） */
export type FakeCheckoutSession = { sessionId: string; storeId: string; returnUrl: string; completed: boolean };
export type FakeCard = CardRegistrar & {
  /** Stripe の側が知っている番号 → 中身。**画面はこれを知らない**（検査が「番号を知っている要求」を作るときだけ使う） */
  sessions: Map<string, FakeCheckoutSession>;
  setupOk: boolean;
  confirmOk: boolean;
  /**
   * 店が Stripe の画面で入力を終える。Stripe と同じく、戻り先（success_url）の `{CHECKOUT_SESSION_ID}` を
   * 番号で埋めた URL を返す——戻り先に置き場が無ければ、番号はどこにも載らない。
   */
  complete: (checkoutUrl: string) => string;
  /** 移り先の URL から番号を引く（Stripe の側の控え。画面の道ではない） */
  sessionIdOf: (checkoutUrl: string) => string | null;
};
/** 偽の Stripe の画面の URL → その持ち主（場面づくりが、入口の応答の URL だけから完了させるため） */
const checkoutPages = new Map<string, { card: FakeCard; sessionId: string }>();
let checkoutSeq = 0;
/**
 * 偽のカードの口。移り先の URL は**番号で終わらない**（本物の Checkout の URL も番号をそのまま見せない）。
 * 2026-09-25 設計-03: 以前は URL の末尾が番号で、場面づくりが `url.split("/").pop()` で番号を取り出して
 * confirm を呼んでいた。本物の画面は番号を受け取れないので、画面から登録が完了しないカード登録が完了しないの件（不具合-01）を
 * 検査が一度も示さなかった。
 */
export const fakeCard = (): FakeCard => {
  let n = 0;
  const c: FakeCard = {
    sessions: new Map(),
    setupOk: true,
    confirmOk: true,
    createSetupSession: async ({ storeId, returnUrl }) => {
      if (!c.setupOk) return { ok: false };
      const sessionId = `cs_test_${++n}`;
      c.sessions.set(sessionId, { sessionId, storeId, returnUrl, completed: false });
      const url = `https://checkout.stripe.test/c/pay/page-${++checkoutSeq}`;
      checkoutPages.set(url, { card: c, sessionId });
      return { ok: true, url, sessionId };
    },
    confirmSetup: async (sessionId) => {
      const session = c.sessions.get(sessionId);
      // 本物は status が complete のときだけ（web/lib/adapters/stripe.ts）
      if (!c.confirmOk || !session || !session.completed) return { ok: false };
      return { ok: true, clientReference: session.storeId };
    },
    complete: (checkoutUrl) => {
      const page = checkoutPages.get(checkoutUrl);
      if (!page || page.card !== c) throw new Error(`偽の Stripe の画面ではない URL です: ${checkoutUrl}`);
      const session = c.sessions.get(page.sessionId)!;
      session.completed = true;
      return session.returnUrl.split("{CHECKOUT_SESSION_ID}").join(session.sessionId);
    },
    sessionIdOf: (checkoutUrl) => {
      const page = checkoutPages.get(checkoutUrl);
      return page && page.card === c ? page.sessionId : null;
    },
  };
  return markFake(c);
};
/** 入口の応答の URL から、その偽のカードの口を引く */
export const cardOfCheckout = (checkoutUrl: string): FakeCard => {
  const page = checkoutPages.get(checkoutUrl);
  if (!page) throw new Error(`偽の Stripe の画面ではない URL です: ${checkoutUrl}`);
  return page.card;
};

export type FakeHuman = HumanCheck & { mode: "human" | "bot" | "fail" | "hang"; tokens: Array<string | null> };
export const fakeHuman = (): FakeHuman => {
  const h: FakeHuman = {
    mode: "human",
    tokens: [],
    verify: async (token, opts) => {
      h.tokens.push(token);
      if (h.mode === "fail") return { ok: false };
      if (h.mode === "hang") {
        return new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ ok: false }));
        });
      }
      return { ok: true, human: h.mode === "human" };
    },
  };
  return markFake(h);
};

export type FakeFiles = FileStore & { store: Map<string, { body: Uint8Array; contentType: string }> };
export const fakeFiles = (): FakeFiles => {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();
  return markFake({
    store,
    put: async (key, body, contentType) => {
      store.set(key, { body: new Uint8Array(body), contentType });
    },
    get: async (key) => store.get(key) ?? null,
    delete: async (key) => {
      store.delete(key);
    },
  });
};

export type FakeLogger = Logger & { entries: unknown[] };
export const fakeLogger = (): FakeLogger => {
  const l: FakeLogger = { entries: [], log: (entry) => l.entries.push(entry) };
  return markFake(l);
};

/**
 * 決め打ちの乱数（コードの引き直しの検査など）。`onlyLength` を渡すと、その長さの引きだけを決め打ち、
 * ほかの長さの引き（識別子・セッションの番号など）は本物の乱数にする——決め打ちの値を識別子が食って、
 * 見たい引きに届かない・識別子どうしが重なる、を避ける（2026-09-25 設計-02）。`calls` は決め打った引きの回数。
 */
export const fakeRng = (sequence: Uint8Array[], opts: { onlyLength?: number } = {}): Rng & { calls: number } => {
  let i = 0;
  const r = {
    calls: 0,
    bytes: (n: number) => {
      if (opts.onlyLength !== undefined && n !== opts.onlyLength) return crypto.getRandomValues(new Uint8Array(n));
      r.calls++;
      const next = sequence[Math.min(i, sequence.length - 1)];
      i++;
      const out = new Uint8Array(n);
      out.set(next.subarray(0, n));
      return out;
    },
  };
  return r;
};
