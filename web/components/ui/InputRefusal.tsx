// 入力の断り（形・範囲の誤りと、項目や操作に帰せる規則の断り）を描くただ1つの部品
// （設計書「入力の誤りの出し方」）。断りの語（error.kind・error.fields）を読むのはこのファイルだけで、
// 自分では判断しない——受け取った語を domain/texts の文にして、項目の直下か操作の直下に出す。
// 文の雛形に入れる数字は、呼ぶ側のフォームが schemas/limits から渡す。

import type { ApiFailure } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";

/** 文の雛形に入れる値（項目の名前・上下の数・形の補足など）。 */
export type RefusalContext = Record<string, unknown>;

type FieldMessageProps = {
  /** 入力のスキーマの項目名（nickname・phone など） */
  name: string;
  failure: ApiFailure | null;
  ctx?: RefusalContext;
};

/** その項目の断りが返っているときだけ、入力欄の直下に文を出す。 */
export const FieldMessage = ({ name, failure, ctx }: FieldMessageProps) => {
  const field = failure?.error?.fields?.find((f) => f.name === name);
  if (!field) return null;
  return (
    <p className="msg" role="alert" data-testid={`msg-${name}`}>
      {TEXTS.fieldReason(field.reason, ctx)}
    </p>
  );
};

type FormMessageProps = {
  failure: ApiFailure | null;
  /** このフォームが持っている項目名。ここに在る項目の断りは、項目の直下に出るのでここでは出さない。 */
  fieldNames?: string[];
  ctx?: RefusalContext;
  /**
   * 断りの種類ごとに、文の後ろへ足す行き先（例: `profile_incomplete` → 店の情報の画面）。
   * どこへ送るかは画面の話なので呼ぶ側が決め、この部品は語で引いて描くだけ（判断はしない）。
   */
  links?: Record<string, { href: string; label: string }>;
};

/** 項目に帰せない断り（人かどうかの確かめ・規則の断り・通信の失敗）を、押した操作の直下に出す。 */
export const FormMessage = ({ failure, fieldNames = [], ctx, links }: FormMessageProps) => {
  const error = failure?.error;
  if (!error) return null;
  const fields = error.fields ?? [];
  if (fields.some((f) => fieldNames.includes(f.name))) return null;
  const link = links?.[error.kind];
  return (
    <p className="msg" role="alert" data-testid="msg-form">
      {TEXTS.inputRefusal(error.kind, ctx)}
      {link ? <a href={link.href}>{link.label}</a> : null}
    </p>
  );
};
