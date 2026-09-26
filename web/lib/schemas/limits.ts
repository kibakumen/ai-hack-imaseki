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
 * 自動の登録（`components/customer/GuestEntry`）の仮の値の**写し**（2026-09-25 のレビューで正本を移した）。
 * 正本と「仮かどうか」の見分けは `domain/guest.ts` に在り、店の一覧（`domain/storeHome`）はそちらを読む。
 * 部品は lib/domain のうち texts.ts しか値として読めない（依存の向き）ので、部品が要る2つの定数だけを
 * ここに写す——自動の登録が作る値（`client/guestIdentity`・`GuestEntry` と受け皿の `RegisterForm` が使う）と、
 * 取得の画面の電話番号の欄（`PhoneField` の `phoneToShow`・`phoneToStore`）が読む。写しと部品の見分けが正本とずれないことは
 * `tests/domain/guest.test.ts` が固定する。ここには判断の関数を置かない（定数だけ・何も import しない）。
 */
export const GUEST_PHONE_PLACEHOLDER = "0000000000";
export const GUEST_NICKNAME_PREFIX = "guest-";
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
/**
 * セッションの絶対の寿命（2026-09-25 監査の指摘 安全-08・AI判断・値は本人の確認待ち）。上の延長を何度重ねても、
 * 作った時刻（sessions.created_at・migration 0008）からこの長さで必ず切る。それまでは使い続ける限り切れず、
 * 盗まれたり置き忘れたりしたセッションを持ち主が止める手段が無かった。14日は監査の例の値で、
 * 店が2週に1度は入り直す程度の手間に収まる長さとして選んだ。
 */
export const SESSION_ABSOLUTE_MAX_SECONDS = 14 * 24 * 60 * 60;

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
/**
 * おすすめメニューの並びの、入力の形としての緩い上限（2026-09-25 監査の指摘 安全-13・AI判断）。
 * 件数の上限（基準 15.7 の MENUS_MAX）は手続きが too_many で返すので、ここはそれより十分に広く取り、
 * 大きすぎる並びを形の検査の段で早く切るためだけに置く。
 */
export const MENUS_INPUT_MAX = 50;
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
 * 同じ接続元からの候補の問い合わせは、客をまたいで1分に120回まで（2026-09-26 のレビュー・安全-03 の残り・AI判断。客2人ぶん）。
 * 客ごとの上限だけだと、客の登録（接続元ごとに1時間60人）で識別子を作り直し、1つの回線から毎分およそ3600回
 * Places Autocomplete（有料）を呼ばせられた。アプリ全体の1日の天井は MAPS_DAILY_CALL_LIMIT。
 */
export const PLACE_SUGGEST_IP_RATE_LIMIT = 120;
export const PLACE_SUGGEST_IP_RATE_WINDOW_MS = 60 * 1000;
/**
 * 同じ接続元からの候補の問い合わせは、1時間にも200回まで（2026-09-26 の第2周のレビュー・安全-03 の残り・AI判断）。
 * 1分の天井（120回）だけだと1時間に7200回踏めて、地図の1日の上限（MAPS_DAILY_CALL_LIMIT＝2000回）に1つの回線から
 * 約17分で届き、その日の全員の場所の候補と場所の文字での検索が止まった。200回は1日の上限の1割で、1つの回線が
 * この入口だけで上限に届くには10時間かかる。打つたびに呼ぶ入口（間を置いて1語に2〜3回）なので、1つの回線から
 * 1時間におよそ70語ぶんの場所を探せる。会場や携帯の CGNAT で同じ回線の客が多い場面との釣り合いは本人が決める。
 */
export const PLACE_SUGGEST_IP_HOURLY_LIMIT = 200;
/**
 * 店のホームページから雰囲気画像を取る打ち切り（2026-09-22 移植。地図と同じ3秒・値は AI判断）。
 * 差し替えた時計と AbortSignal の両方で使う（usecases/storeImage）。
 */
export const STORE_IMAGE_TIMEOUT_MS = 3000;
/**
 * 置き場にまだ画像が無い承認済みの店の画像を、客が開いたときに取りに行く（埋め戻し）のは、店ごとにこの時間に1回まで
 * （2026-09-25 のレビュー・AI判断）。画像を置くのは店が情報を保存したときだけになったので、それより前に URL を
 * 保存していた店（ダミーデータの店を含む）の画像が、店が保存し直すまで出なかった。取れない店（画像の無いページ）を
 * 客が開くたびに取りに行かないよう、1日に1回で止める。
 */
export const STORE_IMAGE_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * 店の画像1枚の大きさの上限（2MB・AI判断・安全-19）。保存のときに1回だけ取って置き場に置くので、
 * 超える画像は取らない（途中で読むのをやめる）。ホームページの og:image はふつう数百KB。
 */
export const STORE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
// 要件13（営業許可書とカード）の基準 13.3
/** 営業許可書の大きさの上限（10MB・値は AI判断）。ちょうど10MB は通り、1バイト超えると断る */
export const LICENSE_MAX_BYTES = 10 * 1024 * 1024;
/**
 * 要求の本文の大きさの既定の上限（2026-09-25 監査の指摘 安全-13・値は AI判断）。どの入口の JSON も数KB に収まる
 * （いちばん大きいのは通報の理由500字や店の情報で、UTF-8 でも数KB）。超えた本文は読み切る前に 413 で断る。
 */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
/**
 * 営業許可書の入口だけの本文の上限。ファイルの上限（LICENSE_MAX_BYTES）に multipart の包みの分を足す
 * （ちょうど10MB を1バイト超えるファイルは、今までどおり手続きが file_too_large で断る）。
 */
export const LICENSE_UPLOAD_MAX_BODY_BYTES = LICENSE_MAX_BYTES + 64 * 1024;
/** 画面の「◯MB まで」の文と、入力欄の補助に使う表示用の数（正本は上のバイト数） */
export const LICENSE_MAX_MEGABYTES = 10;
// 要件24（運営の店の一覧）の基準 24.5
/** 検索の語の上限（AI判断。店名50字・住所・メールアドレス254字のどれにも当てられる長さ） */
export const ADMIN_SEARCH_MAX = 254;
// 運営の操作の記録（2026-09-25 監査の指摘 運営-01・運営-05）。字数は AI判断（通報の理由の500字と揃えた）
/** 取り消し・戻すの理由の上限 */
export const ADMIN_REASON_MAX = 500;
/** 店ごとの運営のメモの上限 */
export const ADMIN_NOTE_MAX = 1000;
/**
 * 承認に載せる「運営が見た許可書の時刻」の長さの上限（運営-02 のレビュー）。ISO 8601 の時刻（24字）が入れば足りる。
 * 突き合わせるだけの値なので形は見ない（AI判断）。
 */
export const ADMIN_SEEN_TIME_MAX = 40;
/** 店の詳細に出す操作の履歴の件数 */
export const ADMIN_HISTORY_MAX = 20;
/** 店の詳細に出す、その店への通報の直近の件数（運営-03） */
export const ADMIN_STORE_REPORTS_LATEST = 3;
/** 通報した客の短い印の字数（運営-09。客の内部の番号のハッシュの先頭） */
export const REPORTER_MARK_LENGTH = 6;
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
/**
 * 同じ接続元からの取得は、少しずつ届く取得と合わせて1分に30回まで（2026-09-26 のレビュー・安全-03 の残り・AI判断）。
 * 客ごとの上限（1分5回）だけだと、客の登録（接続元ごとに1時間60人）で識別子を作り直し、1つの回線から毎分およそ300回
 * 取得できた。30 は「同じ回線の客6人が同時に上限まで探す」幅（値は仮）。
 * ⚠️ この1分の天井だけでは、まだ1つの回線から1時間に1800回取れて、AI の1日の上限（選定だけで2000回）が1時間ほどで
 * 尽きた（第2周のレビュー）。1日の上限を守るのは下の FETCH_IP_HOURLY_LIMIT。
 */
export const FETCH_IP_RATE_LIMIT = 30;
export const FETCH_IP_RATE_WINDOW_MS = 60 * 1000;
/**
 * 同じ接続元からの取得は、少しずつ届く取得と合わせて1時間にも120回まで（2026-09-26 の第2周のレビュー・安全-03 の残り・AI判断）。
 * 天井に届くと、届いた回から1時間断る（窓の数え方は repo/rateCounters）。120回は AI の1日の回数上限の6%。
 * 1つの回線が上限に届くまでの時間（AI の1日の上限 AI_DAILY_CALL_LIMIT＝2000回に対して）:
 * - 選定の AI（候補がある取得1回に1回）だけなら約17時間
 * - 少しずつ届く取得は、返す店（最大5件）ごとに紹介文と検査の AI が重なる（1店に最大4回・writePitch の
 *   PITCH_CALLS_PER_STORE_MAX）。紹介文が1回で検査に通れば1回の取得で11回＝約1.5時間、書き直しが続くいちばん重い形では
 *   21回＝1時間足らずで届く（1日の予算の額 AI_DAILY_BUDGET_USD が先に効くこともある）
 * ⚠️ だから、この天井は選定の AI と地図には効くが、紹介文まで含めた AI の1日の上限を、1つの回線の小さな取り分に
 * 抑えきるものではない。抑えきるには、接続元ごとのその日の AI の取り分（超えた回線は点数順と決まった文へ倒す）を
 * 足す手がある。ただし会場の Wi-Fi のように同じ回線の客が多い場面では、その回線だけ AI が先に止まる——発表の場で
 * 見せたい機能が止まりうるので、値と入れるかどうかは本人が決める（CHANGES-2026-09-25 の6節）。
 */
export const FETCH_IP_HOURLY_LIMIT = 120;
/**
 * 同じ接続元からの**店の**登録は1時間に10回まで（基準 30.2）。
 * ⚠️ 2026-09-25 監査の指摘 不具合-04 で、客の登録とは**別に数える**ようにした（AI判断・要件30.2 の変更として
 * 仕様へ返す）。合わせて数えていた頃は、会場の Wi-Fi のように同じ回線から11人目が来ると、客の自動の登録も
 * 店の登録も止まった。数えるのは人かどうかの確かめが通った要求だけ（空振りで回数を減らさない）。
 */
export const REGISTER_RATE_LIMIT = 10;
export const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;
/**
 * 同じ接続元からの**客の**登録は1時間に60回まで（不具合-04・AI判断。指摘の例示「60〜100回」の下の端）。
 * /me を開くたびに裏で登録が走るので、同じ回線の客が多い場面（会場・会社・携帯の CGNAT）に合わせて広げた。
 * 1回ごとに人かどうかの確かめ（Turnstile）が要るので、上限の役目は機械の大量の登録を遅らせることだけ。
 */
export const CUSTOMER_REGISTER_RATE_LIMIT = 60;
/** 同じ客の通報は1時間に5回まで（基準 30.3） */
export const REPORT_RATE_LIMIT = 5;
export const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;
/**
 * 同じアカウントへの、**同じ接続元からの**ログインの失敗が10回続くと、15分そこからのログインを断る（基準 30.4）。
 * ⚠️ 2026-09-25 監査の指摘 安全-10 の案1（AI判断）で、鍵を「メールアドレス × 接続元」にした。メールアドレスだけで
 * 数えていた頃は、他人が狙いのアドレスで10回間違えるだけで、本人（運営・店）が15分ずつ締め出された。
 */
export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
/**
 * 同じ接続元からのログインの失敗は、アカウントをまたいで15分に30回まで（安全-10 の案1・AI判断）。
 * 1つの接続元から多数のアカウントへ1回ずつ試す手口（パスワードスプレー）を数える。通ったログインは
 * その1回ぶんだけを返す（消さない）——自分のアカウントへの成功を挟んで数を戻す手を塞ぐため。
 */
export const LOGIN_IP_FAILURE_LIMIT = 30;
/**
 * 端末の印（ログインに通ったブラウザに配る Cookie）を信じる期間（30日・2026-09-25 のレビュー・安全-10 の続き・AI判断）。
 * 前にこの端末でそのアカウントに通った要求だけ、上の接続元ごとの上限を数えない——会場の Wi-Fi や携帯の CGNAT で、
 * 同じ回線の他人が30回間違えても、その回線の店と運営が締め出されないように。通るたびに期間を延ばす。
 */
export const LOGIN_DEVICE_TRUST_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * 数えの表 rate_counters の行を残す長さ（2026-09-26 独立したレビューの指摘・AI判断）。1日1回の定期実行（lib/scheduled）が、
 * 窓の始まりがこれより古い行を消す。**実際に使われている規則のいちばん長い窓**にする——今は端末の印の信頼期間（30日）で、
 * 入口の抑止（最長1時間）・回線ごとの AI の取り分と地図の上限（2日）・間引き（1日）はどれもこれより短い。
 * これより短くすると、窓の中の数え（まだ効いている端末の印）まで消える。一致は web/tests/rateCounterSweep.test.ts が見張る。
 */
export const RATE_COUNTER_RETENTION_MS = LOGIN_DEVICE_TRUST_MS;
/** 端末の印のバイト数（16バイト＝22字の base64url。セッションと同じ強さ） */
export const LOGIN_DEVICE_BYTES = 16;
/**
 * 同じ客の、現在地を地名に直す問い合わせ（GET /api/customer/place）は1分に10回まで（安全-03・AI判断）。
 * 1回ごとに地図のサービス（有料）を呼ぶ。画面が開いた瞬間に1回呼ぶだけの入口なので、10回は十分に広い。
 */
export const PLACE_RATE_LIMIT = 10;
export const PLACE_RATE_WINDOW_MS = 60 * 1000;
/** 同じ接続元からの、現在地を地名に直す問い合わせは1分に60回まで（2026-09-26 のレビュー・安全-03 の残り・AI判断。客6人ぶん） */
export const PLACE_IP_RATE_LIMIT = 60;
export const PLACE_IP_RATE_WINDOW_MS = 60 * 1000;
/**
 * 同じ接続元からの、現在地を地名に直す問い合わせは1時間にも120回まで（2026-09-26 の第2周のレビュー・安全-03 の残り・AI判断）。
 * 1分の天井（60回）だけだと1時間に3600回踏めて、地図の1日の上限（2000回）に1つの回線から約33分で届いた（場所の候補と同じ形）。
 * 画面を開いたときに1回呼ぶだけの入口なので、120回は「同じ回線から1時間に120回開く」幅。
 * 地図を呼ぶ客の入口3つ（場所の候補200・地名120・取得120）を合わせても1時間に440回で、1つの回線が地図の1日の上限に
 * 届くには4時間半かかる。
 */
export const PLACE_IP_HOURLY_LIMIT = 120;
/**
 * 同じ店の、店の情報の保存（PUT /api/store/profile）は1時間に30回まで（安全-03・AI判断）。
 * 保存のたびに住所を地図へ問い合わせ、ホームページから画像を1回取る。
 */
export const STORE_PROFILE_RATE_LIMIT = 30;
export const STORE_PROFILE_RATE_WINDOW_MS = 60 * 60 * 1000;
/**
 * アプリ全体の1日（日本時間）の AI の予算（米ドル・安全-03 の「選ぶ部分」の第一の案・AI判断）。その日の ai_calls の
 * 実費の合計がこれに届いたら、その日の残りは AI（選定も紹介文も）を呼ばずに点数順と決まった文で返す。
 * OrcaRouter の鍵に付けた1日の予算の上限（額は公開の文書に書かない・安全-25）より手前で止め、使い切られて全員が AI の失敗を待つ形を避ける。
 */
export const AI_DAILY_BUDGET_USD = 0.9;
/** 実費が記録されない呼び出し（失敗・打ち切り）もあるので、その日の回数でも止める（AI判断） */
export const AI_DAILY_CALL_LIMIT = 2000;
/**
 * 1つの接続元（回線。IPv6 は /64 に丸める・domain/clientAddress）が、その日（日本時間）に使ってよい AI の取り分
 * ＝アプリ全体の1日の回数上限の2割（2026-09-26 本人選択・安全-03 の残り）。使い切った回線からの取得は、紹介文の AI を
 * 呼ばずに決まった文へ倒す（選定の AI はアプリ全体の上限にだけ従う）。数えは usecases/aiLineShare。
 * 紹介文の AI は取得1回に最大20回重なるので、接続元ごとの取得の天井（FETCH_IP_HOURLY_LIMIT）だけでは、少しずつ届く取得で
 * 1つの回線が1〜2時間でアプリ全体の上限に届きえた。会場の Wi-Fi のように同じ回線の客が多い場面では、その回線だけ
 * 紹介文が先に決まった文になる——その釣り合いを承知で本人が2割を選んだ。
 */
export const AI_LINE_DAILY_SHARE = 0.2;
/** 上の取り分を回数にしたもの（2000回の2割＝400回）。実費の額は回線ごとには数えない（AI判断・下の注は usecases/aiLineShare） */
export const AI_LINE_DAILY_CALL_LIMIT = Math.floor(AI_DAILY_CALL_LIMIT * AI_LINE_DAILY_SHARE);
/**
 * アプリ全体の1日（日本時間）の、地図のサービス（Geocoding・Places）を呼ぶ回数の上限（2026-09-26 のレビュー・安全-03 の残り・AI判断）。
 * 連打の抑止は客ごと・接続元ごとなので、接続元を替えれば天井が無い。届いたら、その日の残りは地図を呼ばずに
 * 「直せなかった」と同じ倒れ方をする（候補は空・地名は出さない・場所の文字では探せず現在地で探す）。
 * Google Cloud の割り当て（README 6.2 の手順8）は二重の備えとして残す。2000 回は Geocoding の単価で1日およそ10米ドルの天井。
 */
export const MAPS_DAILY_CALL_LIMIT = 2000;
/** 同じ店の、カードの登録の開始と確かめ（Stripe を呼ぶ）は、合わせて10分に10回まで（安全-03 の構造の検査・AI判断） */
export const CARD_RATE_LIMIT = 10;
export const CARD_RATE_WINDOW_MS = 10 * 60 * 1000;
/**
 * 同じアカウントの、今のパスワードを確かめる操作（メールアドレスの変更・パスワードの変更）の失敗は15分に10回まで
 * （2026-09-25 監査の指摘 安全-22 の案1・AI判断）。今のパスワードの総当たりと、409 と 200 の違いでほかの
 * アカウントのアドレスを割り出す手口を遅らせる。通った操作はその1回ぶんだけを返す。
 */
export const ACCOUNT_SECRET_FAILURE_LIMIT = 10;
export const ACCOUNT_SECRET_WINDOW_MS = 15 * 60 * 1000;
/**
 * 同じ客の受け取り・受け取り直し（POST /api/customer/reservations）は10分に10回まで
 * （2026-09-25 監査の指摘 安全-06 の案A・AI判断）。
 */
export const RECEIVE_RATE_LIMIT = 10;
export const RECEIVE_RATE_WINDOW_MS = 10 * 60 * 1000;
/**
 * 同じ接続元からの受け取り・受け取り直しは、客をまたいで1時間に20回まで（2026-09-26 のレビュー・安全-06 の残り・AI判断）。
 * 1回の受け取りが席を押さえるのは平均20分なので、1つの回線が同時に押さえ続けられる席はおよそ 20 × 20 / 60 ≒ 7。
 * 配信数10以上の店を1人で埋め続けることはできなくなるが、配信数の小さい店は1つの回線でも押さえ続けられる——そこは
 * 店の側の対抗手段（「来ない」で枠を戻す・要件21の基準 21.8）が持つ（2026-09-26 本人選択で決着・CHANGES-2026-09-25 の9節）。
 * 会場や携帯の CGNAT で同じ回線の客が多い場面では、21人目の受け取りが1時間断られうる（この釣り合いは 2026-09-26 本人選択（AI提示）で20回に確定）。
 */
export const RECEIVE_IP_RATE_LIMIT = 20;
export const RECEIVE_IP_RATE_WINDOW_MS = 60 * 60 * 1000;
/**
 * 同じ客が同じオファーを押さえられる件数（受け取り1回＋受け取り直し1回・安全-06 の案A と案C・AI判断）。
 * 受け取り直しの道でも、もう一度受け取る道でも、**取得をまたいで**合わせてこの件数まで（状態を問わず数える）。
 *
 * 取得ごと（fetchId ごと）に数えていた頃は、探し直して新しい fetchId を取るだけで数え直しになり、40分ごとに
 * 取得を1回足せば同じ席を押さえ続けられた（2026-09-25 のレビュー）。今は押さえ続けるには識別子を作り直すしかなく、
 * そこに人かどうかの確かめ（Turnstile）が1回ずつ要る。ただし客の登録の上限は接続元ごとに1時間60人（不具合-04 で広げた）で、
 * 識別子の作り直しの歯止めにはならない（配信数10の店を埋め続けるのに要る新しい識別子は1時間に約15個）。1つの回線の天井は
 * 受け取りの接続元ごとの上限（下の RECEIVE_IP_RATE_LIMIT）が持つ（2026-09-26 のレビュー）。
 * 時間の窓は置かない——オファーは公開から12時間以内に終わる（要件17の基準 17.5・要件19の基準 19.8）ので、オファーの番号がそのまま窓になる。
 * 窓を短く置くと、窓が明けた古い識別子を使い回して押さえ続けられる。
 */
export const RECEIVES_PER_OFFER_MAX = 2;
/**
 * 取得の結果から新しく受け取れる時間（60分・安全-06 の案B の一部・AI判断）。古い fetchId を貯めておいて
 * 後から使い回す手を塞ぐ。受け取り直し（期限切れから20分以内）はこの時間を見ない——受け取り直しの回数は上で数える。
 */
export const FETCH_RESULT_RECEIVE_WINDOW_MS = 60 * 60 * 1000;
/**
 * 同じ客の店の画像の取得は1分に30回まで（AI判断 2026-09-22。2026-09-25 の監査の直しで、要件30の補足の
 * 「外のサービスを呼ぶ入口の抑止」の表に載せた・安全-03・設計-06）。
 *
 * **置いた理由**: 置いた当時（2026-09-22）、この入口は客が渡した URL へ Worker が自分で出ていく道だった。
 * 2026-09-25 の直し（安全-12・安全-19）で、客の要求は置き場の画像を読むだけになり、外へ出るのは画像の
 * まだ無い店の埋め戻し（店ごとに1日1回・店の登録の URL だけ・usecases/storeImage）に限られた。それでも
 * 置き場を読む回数の天井として数え続ける（AI判断）。
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
 * 店のホームが開いている間、ホームを取り直す間隔（10秒・AI判断）。基準 20.4 の「30秒以内に映す」は上限で、
 * 10秒なら取り直しが1回失敗しても間に合う（客の側の取り直し `usePolling` の10秒と揃えた）。
 * 2026-09-25 監査の指摘 店-08: それまでは上限と同じ30秒で、1回の失敗で約60秒かかり、客が店頭で番号を見せても
 * スリープから戻ったばかりの一覧にはまだ行が無いことがあった。画面に戻ったときは、間隔を待たずにすぐ取り直す。
 */
export const ARRIVALS_REFRESH_MS = 10_000;

/**
 * 期限切れのあと、店が完了済みにできる長さ（20分・本人選択）の画面の側の写し。遅れている客の「HH:MM まで
 * 完了にできます」（店-02）が読む。判断の正本は `domain/reservation` の `EXPIRED_GRACE_MS`（画面は lib/domain の
 * うち texts しか読めない）。2つが同じ値であることは web/tests/domain/reservation.test.ts が固定する。
 */
export const ARRIVAL_COMPLETE_GRACE_MS = 20 * 60 * 1000;

/**
 * 承認されないまま置かれた営業許可書を置いておく長さ（上げてから30日・2026-09-26 のレビュー・安全-20 の案1 の残り・AI判断）。
 * 承認を断る操作は置かない（要件25の基準 25.3）ので、承認されないまま30日たったら審査は終わったものとして許可書を消す
 * （usecases/licenseSweep）。店は上げ直せばまた審査に入る。書類の画面と店向けの利用規約も同じ日数を書く。
 */
export const PENDING_LICENSE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// 人かどうかの確かめ（Turnstile）の用途（2026-09-25 監査の指摘 安全-23）
/**
 * 部品（components/ui/HumanCheck）が Turnstile に名乗る用途と、入口（http/defineRoute）が答えに求める用途。
 * 画面とサーバーが同じ値を使うので、両方が読めるここに置く。Turnstile の決まりで英数字・_・- の32字以内。
 * 登録の部品で解いた値をログインに流す、のような使い回しを入口が断れるようにする。
 */
export const HUMAN_CHECK_ACTIONS = {
  login: "login",
  registerStore: "register-store",
  registerCustomer: "register-customer",
} as const;
export type HumanCheckAction = (typeof HUMAN_CHECK_ACTIONS)[keyof typeof HUMAN_CHECK_ACTIONS];

// 店向けの利用規約の版（2026-09-25 監査の指摘 店-21 のレビュー）
/**
 * 今の店向けの利用規約の版（日付）。登録の入口（schemas/account の agreedTermsVersion）が今の版への同意を求め、
 * 通った登録は版と同意の時刻を店の行に残す（migration 0010 の stores.terms_version・terms_agreed_at）。登録の画面
 * （components/store/RegisterForm）と規約のページ（app/store/terms）も読むので、両方が読めるここに置く。
 *
 * それまで同意は画面の中だけで持ち、入口は同意なしでも登録を通し、同意したことも版も残らなかった（争いになったとき
 * 運営に拠り所が無い）。
 *
 * ⚠️ 規約の文面（app/store/terms）を変えたら、この版を上げる。上げると、開いたままの古い画面から送られた登録は断られ
 *    （読み込み直せば通る）、以後の登録は新しい版で残る。受け入れ検査の場面づくり（tests/acceptance/v2/_fakes の
 *    STORE_TERMS_AGREEMENT）も同じ値に上げる（schemas/storeTermsVersion.test.ts が見張る）。
 * ⚠️ すでに登録した店に新しい版へ同意し直してもらう仕組みは無い（AI判断・今は請求しないので、版を上げる予定が無い）。
 */
export const STORE_TERMS_VERSION = "2026-09-26";

// メールアドレスの確認（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ・要件14の基準 14.23〜14.28。値はどれも AI判断）
/** 確認のリンクに載せる乱数の長さ（16バイト→base64url 22字。セッションの値と同じ） */
export const EMAIL_VERIFY_TOKEN_BYTES = 16;
/** 確認のリンクの期限（24時間） */
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** リンクの token として受ける値の長さの上限（断るためではなく、長すぎる値を早く切るため） */
export const EMAIL_VERIFY_TOKEN_MAX_LENGTH = 128;
/**
 * 確認メールを外（Resend）へ送る打ち切り（5秒）。枝では打ち切りを渡さずに呼んでいて、Resend が答えなければ要求が
 * 止まり続けた（取り込みで足した・2026-09-25 監査の指摘 設計-11 と同じ raceDeadline で打ち切る）。
 */
export const MAIL_SEND_TIMEOUT_MS = 5000;
/**
 * 確認メールの送り直しは、同じアカウントで1時間に5回まで・同じ接続元で1時間に20回まで。外へメールを出す入口なので、
 * 抑止が無いと1つのアカウントが送信元の評判と送信の枠を好きなだけ削れる（実測の裏付けは無い）。
 * 取り込みのとき（2026-09-26）、枝の「接続元だけ」をアカウントごと＋接続元ごとの2つに改めた——枝を作った時点では
 * アカウントで数える鍵が無かったが、監査の直し（安全-03）で `by: "account"` ができた。接続元の天井は、店の登録
 * （接続元ごとに1時間10件）で作ったアカウントを替えながら送る形の上限（10件×5回を下回る20回）。
 */
export const EMAIL_VERIFY_RATE_LIMIT = 5;
export const EMAIL_VERIFY_IP_RATE_LIMIT = 20;
export const EMAIL_VERIFY_RATE_WINDOW_MS = 60 * 60 * 1000;
