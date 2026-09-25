// 種データのスクリプト（seed-admin.mjs・seed-demo.mjs）の `--print` が共有する道具。
// 本番の D1 を、確かめの無いスクリプトから黙って書き換えないため、`--print` は何も実行せず、そのまま貼れる
// `wrangler d1 execute … --remote` のコマンドを出す。ここはその「書き込みの文を集める D1 の代わり」と、文の組み立て。
// 2つのスクリプトに同じ写しがあったのを、2026-09-25（安全-01 のレビュー）にここへ寄せた。

export const DATABASE = "ai-hack-v2";

/** 本番の運営の一覧を出す文（`--print` の先頭に出す。読むだけ）。 */
export const LIST_ADMINS_SQL = "SELECT id, email FROM accounts WHERE role = 'admin' ORDER BY email";

/** SQL の文字列の値を1つの引用の中へ入れる（引用符は2つにして閉じない）。 */
const literal = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

/**
 * ?1 ?2 … を値で埋めた1つの文にする（wrangler d1 execute は束縛の値を取らないため）。
 * 空白をつめるのは文の側だけ（値の中の空白や改行はそのまま残す）。
 */
const inlined = (sql, args) =>
  sql
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\?(\d+)/g, (_, n) => literal(args[Number(n) - 1]));

/**
 * シェルの1語にする（単一引用で囲み、中の ' は '\'' にする）。二重引用だと、パスワードの保存の値
 * `pbkdf2-sha256$100000$…` の `$1…` や `$<塩>` を bash が変数として展開し、壊れた値が本番に入る。
 */
const shellWord = (text) => `'${text.replace(/'/g, `'\\''`)}'`;

/** 本番の D1 へ1つのコマンドとして流す形（bash にそのまま貼る。ここでは実行しない）。 */
export const remoteCommand = (sql) => `pnpm --dir web exec wrangler d1 execute ${DATABASE} --remote --command ${shellWord(sql)}`;

/** 書き込みの文か（`first` で書く repo の文を、読み取りと分けて集めるため）。 */
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE)\b/i;

/**
 * `--print` のときの D1 の代わり。書き込みの文を `statements` に集め、読み取りは「まだ無い」を返す。
 * ただし `knownAdminId`（`--account-id` で指した番号）だけは「その番号の運営が在る」と答える（取り返しの文を
 * 組むため。在るかどうかは、先頭に出す一覧の文で人が確かめる）。
 * `run` は変わった行を1で返す（条件つきの1文の当たり外れを見て分岐する repo があるため）。
 * `first` でも、書き込みの文（`INSERT … RETURNING` など）は集める。repo には `run` でなく `first` で書いて、
 * 返ってきた行を読むものがある（オファーの公開は、実際に付けたクーポンを返す・不具合-13）。返す行は組めないので
 * null（読み取りと同じ「無い」）を返す——呼ぶ側の結果は捨てられ、ここで要るのは出す文だけ。
 * `batch` の文は1つのコマンドへ `; ` でつなぐ（まとまりで書く文を、貼る側で別々のコマンドに分けない）。
 */
export const collectingDb = (statements, knownAdminId) => {
  const changedOne = { success: true, results: [], meta: { changes: 1 } };
  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        sql: inlined(sql, args),
        first: async () => {
          if (WRITE_SQL.test(sql)) {
            statements.push(inlined(sql, args));
            return null;
          }
          return knownAdminId && /WHERE id = \?1/.test(sql) && args[0] === knownAdminId
            ? { id: knownAdminId, email: "", password_hash: "", role: "admin", store_id: null, must_change_password: 0 }
            : null;
        },
        run: async () => {
          statements.push(inlined(sql, args));
          return changedOne;
        },
        all: async () => ({ success: true, results: [], meta: {} }),
      }),
    }),
    batch: async (stmts) => {
      statements.push(stmts.map((s) => s.sql).join("; "));
      return stmts.map(() => changedOne);
    },
  };
};
