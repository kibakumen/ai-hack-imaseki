// 形と範囲の数字のただ1つの置き場（設計書「どの判断をどこに置くか」）。数字の定数だけを持ち、
// 何も import しない（domain/texts.ts と同じ性質）。全部の入口と、部品の入力欄の属性がここを読む。
// 各タスクが自分の要件の数字をここへ足す（要件ごとに割り当てられた基準が持つ・要件29の補足）。

// 要件1（客の登録）の基準1.2・1.3・1.4・1.7
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 20;
export const PHONE_PATTERN = /^0\d{9,10}$/;
/** 入力欄の補助の属性に使う桁数（正本は上の形。基準 1.3） */
export const PHONE_MAX_LENGTH = 11;
/**
 * 自動の登録（`components/customer/GuestEntry`）が入れる**仮の電話番号**（2026-09-22）。
 * 客に聞かずに登録を済ませるための、形だけを満たす実在しない番号。取得の画面の電話番号の欄は、
 * 登録がこの値のままなら**空で見せ**、入れられたら本物に差し替える。1か所に置くのは、
 * 「仮かどうか」の見分けを2つの部品が同じ値で行うため。
 */
export const GUEST_PHONE_PLACEHOLDER = "0000000000";
export const CUSTOMER_GENRES_MAX = 12;
export const BUDGET_MAX_MIN = 0;
export const BUDGET_MAX_MAX = 100_000;

// 要件2（客の識別子）の基準2.2
export const TOKEN_BYTES = 16;

// 内部の番号（customers.id など。Cookie の値とは別物・設計書「客の識別子」）の乱数の長さ（AI判断）
export const ID_BYTES = 16;

// 要件3（取得の入力）の基準 3.3・3.10・3.11
/** 場所の文字の上限（基準 3.3・値は AI判断） */
export const PLACE_MAX = 50;
/** 人数の範囲（基準 3.10・範囲は AI判断） */
export const PARTY_MIN = 1;
export const PARTY_MAX = 10;
/**
 * ブラウザの現在地の打ち切り（基準 3.8・値は AI判断）。取得の全体の時間（基準 4.13）とは
 * 切り離してあり、起点が決まってから8秒を数える（要件3の補足）。`client/geolocation.ts` が使う。
 */
export const GEOLOCATION_TIMEOUT_MS = 5000;

// 要件12（店の登録）の基準 12.3・12.4・12.5
export const STORE_NAME_MIN = 1;
/** 店名の上限は要件15の基準 15.2 と同じ範囲（基準 12.5 がそれを指す） */
export const STORE_NAME_MAX = 50;
export const EMAIL_MAX = 254;
/** @ をちょうど1つ含み、その前後に1字以上ある（基準 12.4。空白は認めない） */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// 要件14（ログインとセッション）
/** パスワードの塩の長さ（AI判断） */
export const PASSWORD_SALT_BYTES = 16;
/** PBKDF2-SHA256 の繰り返しの回数（Workers の上限は100,000・設計書「比べた案」）。値は password_hash に一緒に保存する */
export const PASSWORD_ITERATIONS = 100_000;
/** セッションの Cookie に載せる乱数の長さ */
export const SESSION_TOKEN_BYTES = 16;
/**
 * セッションの寿命は25時間で、アクセスのたびに残りが1時間を切っていたら、そこから25時間先へ延ばす
 * （スライディングウィンドウ・本人選択／AI提示 2026-09-21。旧: 14日）。
 * ⚠️ この2つの数字を変えると、偽の時計を大きく進める受け入れ検査の見え方が変わる（実行者の報告を参照）。
 * ⚠️ 数字の正本はこの2行。ほかのファイルのコメントに写した数字は、ここを変えたら一緒に直す
 *    （2026-09-22 タスク25 で6か所が「2時間」「残りが半分」のままずれていたのを揃えた）。
 */
export const SESSION_MAX_AGE_SECONDS = 25 * 60 * 60;
export const SESSION_RENEW_WITHIN_SECONDS = 60 * 60;

// 要件16（クーポン）の基準 16.2・16.3
/** 1つの店が持てるクーポンの数（基準 16.2） */
export const COUPON_MAX = 3;
export const COUPON_NAME_MIN = 1;
export const COUPON_NAME_MAX = 40;
/** 特記事項は無くてよい（下限は無い）。上限だけを持つ（基準 16.3） */
export const COUPON_NOTE_MAX = 100;
/**
 * 【最終日】運営が発行する仮のパスワードの乱数の長さ（要件14の基準 14.11: 16字以上）。
 * 16バイトを base64url へ直すと22字になり、基準の16字を満たす（値は AI判断）。
 */
export const TEMP_PASSWORD_BYTES = 16;
// 要件15（店の情報）の基準 15.2・15.4・15.5・15.6・15.7・15.8
// 店名の範囲は STORE_NAME_MIN・STORE_NAME_MAX をそのまま使う（要件12と同じ範囲・基準 15.2）。
export const STORE_ADDRESS_MIN = 1;
export const STORE_ADDRESS_MAX = 200;
/** ホームページの URL の長さの上限（AI判断。断るためではなく、長すぎる本文を早く切るため） */
export const STORE_URL_MAX = 2048;
/** ホームページの URL は http か https で始まる（基準 15.4）。空のままは通る（基準 15.3） */
export const HTTP_URL_PATTERN = /^https?:\/\//;
/** 店のジャンルは1個以上3個以下（本人選択・要件15の補足） */
export const STORE_GENRES_MIN = 1;
export const STORE_GENRES_MAX = 3;
export const MENU_NAME_MIN = 1;
export const MENU_NAME_MAX = 40;
export const MENUS_MAX = 5;
// 店の予算の幅の範囲は、客の予算の上限と同じ 0〜100,000（基準 15.8）。同じ数を2度書かないため
// BUDGET_MAX_MIN・BUDGET_MAX_MAX をそのまま使う（schemas/store.ts がこの2つを読む）。

/** 地図のサービスの打ち切り（設計書「時間の割り振り」: 地図3秒）。差し替えた時計と AbortSignal の両方で使う */
export const GEOCODE_TIMEOUT_MS = 3000;
// 場所の候補（入口 GET /api/customer/place-suggest・2026-09-22 本人の指摘「場所入力欄に渋谷駅などを
// 打っても候補がでません」）。値はどれも AI判断・要件に無い。
/** 候補を聞きに行く最小の字数。これより短い文字では画面も入口も外へ聞かない */
export const PLACE_SUGGEST_MIN_CHARS = 2;
/** 返す候補の上限 */
export const PLACE_SUGGEST_MAX = 5;
/** 打つ手が止まってから聞きに行くまでの待ち（打鍵ごとに呼ばない） */
export const PLACE_SUGGEST_DEBOUNCE_MS = 250;
/**
 * 同じ客の候補の問い合わせは1分に60回まで。打つたびに呼ぶ入口なので店の画像（30回）より多めに取る
 * （1文字ごとに1回としても、1分に60文字は打たない見込み。実測の裏付けは無い）
 */
export const PLACE_SUGGEST_RATE_LIMIT = 60;
export const PLACE_SUGGEST_RATE_WINDOW_MS = 60 * 1000;
/**
 * 店のホームページから雰囲気画像を取る打ち切り（2026-09-22 移植。地図と同じ3秒・値は AI判断）。
 * 差し替えた時計と AbortSignal の両方で使う（usecases/storeImage）。
 */
export const STORE_IMAGE_TIMEOUT_MS = 3000;
// 要件13（営業許可書とカード）の基準 13.3
/** 営業許可書の大きさの上限（10MB・値は AI判断）。ちょうど10MB は通り、1バイト超えると断る */
export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;
/** 画面の「◯MB まで」の文と、入力欄の補助に使う表示用の数（正本は上のバイト数） */
export const LICENSE_MAX_MEGABYTES = 10;
/** カードの登録の口が返す受け皿の番号の長さの上限（外の値をそのまま持ち歩かないため・AI判断） */
export const CARD_SESSION_ID_MAX = 255;
// 要件24（運営の店の一覧）の基準 24.5
/** 検索の語の上限（AI判断。店名50字・住所・メールアドレス254字のどれにも当てられる長さ） */
export const ADMIN_SEARCH_MAX = 254;
// 要件17（オファーの公開）の基準 17.3・17.4・17.5／要件19（公開中の変更）の基準 19.1・19.2・19.6
/** 募集する組数（基準 17.3・範囲は AI判断） */
export const OFFER_CAPACITY_MIN = 1;
export const OFFER_CAPACITY_MAX = 20;
/** 何名まで（基準 17.4・範囲は AI判断） */
export const OFFER_PARTY_MAX_MIN = 1;
export const OFFER_PARTY_MAX_MAX = 10;
/** 「何名まで」の用意した選択肢（基準 17.4・AI判断） */
export const OFFER_PARTY_MAX_CHOICES = [2, 4, 6] as const;
/** 見せるクーポンは店が持てるクーポンの数まで（要件16の基準 16.2） */
export const OFFER_COUPONS_MAX = 3;
/** 「何時まで」の入力の形（時分だけ。解釈の正本は domain/until.ts） */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// 【最終日】要件30（連打の抑止）の基準 30.1・30.2・30.3・30.4。
// 回数と時間の値はどれも要件の側で AI判断として決まったもの（requirements.md の補足）。
// 窓の長さをミリ秒で持つのは、判定が `deps.clock.now()` との差でしか行われないため（秒の単位を挟まない）。
/** 同じ客の取得は1分に5回まで（基準 30.1） */
export const FETCH_RATE_LIMIT = 5;
export const FETCH_RATE_WINDOW_MS = 60 * 1000;
/** 同じ接続元からの客の登録と店の登録は、合わせて1時間に10回まで（基準 30.2） */
export const REGISTER_RATE_LIMIT = 10;
export const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;
/** 同じ客の通報は1時間に5回まで（基準 30.3） */
export const REPORT_RATE_LIMIT = 5;
export const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;
/** 同じアカウントへのログインの失敗が10回続くと、15分そのアカウントへのログインを断る（基準 30.4） */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
/**
 * 同じ客の店の画像の取得は1分に30回まで（AI判断 2026-09-22・要件に無い・要確認）。
 *
 * **なぜ要件に無いのに置くか**: この入口は**客が渡した URL へ Worker が自分で出ていく**唯一の道で、
 * 抑止が無いと、ログインした客1人が外向きの取得を好きな回数踏ませられる（外の相手への迷惑にもなる）。
 * 30 は「1画面に出るオファーが最大5件 × 画面の作り直し数回」を見込んだ値で、実測の裏付けは無い。
 */
export const STORE_IMAGE_RATE_LIMIT = 30;
export const STORE_IMAGE_RATE_WINDOW_MS = 60 * 1000;
// 要件26（通報）の基準 26.2・26.3（タスク23が足した）
/**
 * 通報の理由の字数（基準 26.2・26.3。500字は値が AI判断・要件26の補足）。
 * 空と空白だけを断るのは手続き（`usecases/reportStore`）——空欄は `required`、
 * 長すぎは `too_long` で返す（設計書「入力の誤りの出し方」の 26.3 の行が指定した2つの語）。
 */
export const REPORT_REASON_MIN = 1;
export const REPORT_REASON_MAX = 500;
// 要件8（受け取りと確保）の基準 8.2・8.3（タスク13が足した）
/** コードのもとになる乱数の長さ（domain/code.ts が先頭4バイトを8桁に直す） */
export const CODE_BYTES = 4;
/**
 * 空きのコードを探す回数の上限。前半は乱数の引き直し、それで見つからなければ隣の値を見る
 * （`domain/code.nextCode`）。値は AI判断——1億通りに対し、引き直し4回で当たらない見込みは無い。
 */
export const CODE_DRAW_ATTEMPTS = 4;
export const CODE_SEARCH_ATTEMPTS = 12;
/**
 * 入力で受ける番号（オファー・確保・取得の記録）の長さの上限（AI判断）。
 * 断るためではなく、長すぎる本文を早く切るため（実際の番号は16バイトを base64url にした22字）。
 */
export const ID_MAX_LENGTH = 64;

// 要件22（客への知らせ・Web プッシュ）。2026-09-21 タスク19 が足した。
/**
 * プッシュの寿命（TTL）。確保の期限と同じ20分（AI判断・設計書「比べた案」のプッシュの行）。
 * これより後に配信元から届いても、確保はもう無いので意味が無い。
 */
export const PUSH_TTL_SECONDS = 20 * 60;
/** 購読の配信元の URL の長さの上限（AI判断。長すぎる本文を早く切るためで、断るためではない） */
export const PUSH_ENDPOINT_MAX = 2048;
/** 購読の鍵（p256dh は65バイト・auth は16バイトを base64url にしたもの）の長さの上限（AI判断） */
export const PUSH_KEY_MAX = 255;
// 要件20（向かっている客と完了済み）の基準 20.4（タスク17が足した）
/**
 * 店のホームが開いている間、ホームを取り直す間隔（30秒）。基準 20.4 の「30秒以内に映す」の
 * 上限そのものなので、**これより長くしない**（値は基準のまま・AI判断ではない）。
 */
export const ARRIVALS_REFRESH_MS = 30_000;
