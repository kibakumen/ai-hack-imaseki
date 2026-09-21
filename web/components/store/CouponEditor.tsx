"use client";

// クーポンの入力（要件16の基準 16.1〜16.5・16.7）。打つ欄は2つだけ——名前と特記事項。
// 人数・公開の設定・件数の欄は持たない（基準 16.7。それらはオファーの公開の側にある）。
//
// 送る前に自分では検査せず、入口が返した断りを描く（設計書「入力の誤りの出し方」の規則5）。
// 断られたときは、打った値も一覧もそのまま残す——書き直す場所を見失わせないため。
//
// ⚠️ 断りは一度に1か所にだけ出す（作る側か、どれか1つの行か）。同じ `msg-name` が2か所に
//    同時に出ると、どちらの操作の話なのかが読めなくなる。

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { COUPON_TEXTS } from "../../lib/domain/texts";
import { COUPON_MAX, COUPON_NAME_MAX, COUPON_NAME_MIN, COUPON_NOTE_MAX } from "../../lib/schemas/limits";
import { FieldMessage } from "../ui/InputRefusal";

type Coupon = { id: string; name: string; note: string };
type Draft = { name: string; note: string };

const COUPONS_PATH = "/api/store/coupons";
/** 作る側の断りの置き場を表す印（行の断りは、その行の番号を使う） */
const CREATE_SCOPE = "create";
const NAME_CTX = { field: "名前", min: COUPON_NAME_MIN, max: COUPON_NAME_MAX };
const NOTE_CTX = { field: "特記事項", min: 0, max: COUPON_NOTE_MAX };

/** 断りと、それがどの操作のものか。 */
type ScopedFailure = { scope: string; failure: ApiFailure };

const couponPath = (id: string) => `${COUPONS_PATH}/${encodeURIComponent(id)}`;

const draftsOf = (list: Coupon[]): Record<string, Draft> => Object.fromEntries(list.map((coupon) => [coupon.id, { name: coupon.name, note: coupon.note ?? "" }]));

/** 一覧を取り直す。取れなかったときは null——呼ぶ側は前の一覧を出したままにする（空にすると消えたように見える）。 */
const fetchCoupons = async (): Promise<Coupon[] | null> => {
  const result = await apiCall<{ items?: Coupon[] }>("GET", COUPONS_PATH);
  return isFailure(result) ? null : (result.items ?? []);
};

type FormMessageProps = { failure: ApiFailure | null };

/** 項目に帰せない断り（3つまで・公開中）を、押した操作の直下に出す。 */
const CouponFormMessage = ({ failure }: FormMessageProps) => {
  const text = COUPON_TEXTS.formMessage(failure, COUPON_MAX);
  if (text === null) return null;
  return (
    <p className="msg" role="alert" data-testid="msg-form">
      {text}
    </p>
  );
};

type CouponRowProps = {
  coupon: Coupon;
  draft: Draft;
  failure: ApiFailure | null;
  onChange: (values: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
};

/** 1つのクーポン。今の中身を見せたまま、その場で直せる（基準 16.4）。 */
const CouponRow = ({ coupon, draft, failure, onChange, onSave, onDelete }: CouponRowProps) => (
  <li data-testid={`row-${coupon.id}`}>
    <h3>{coupon.name}</h3>
    {coupon.note !== "" && <p>{coupon.note}</p>}

    <label htmlFor={`coupon-name-${coupon.id}`}>名前</label>
    <input
      id={`coupon-name-${coupon.id}`}
      data-testid={`field-name-${coupon.id}`}
      type="text"
      value={draft.name}
      maxLength={COUPON_NAME_MAX}
      onChange={(event) => onChange({ ...draft, name: event.target.value })}
    />
    <FieldMessage name="name" failure={failure} ctx={NAME_CTX} />

    <label htmlFor={`coupon-note-${coupon.id}`}>特記事項</label>
    <input
      id={`coupon-note-${coupon.id}`}
      data-testid={`field-note-${coupon.id}`}
      type="text"
      value={draft.note}
      maxLength={COUPON_NOTE_MAX}
      onChange={(event) => onChange({ ...draft, note: event.target.value })}
    />
    <FieldMessage name="note" failure={failure} ctx={NOTE_CTX} />

    <button type="button" data-testid="btn-save-coupon" onClick={onSave}>
      保存する
    </button>
    <button type="button" data-testid="btn-delete-coupon" onClick={onDelete}>
      削除
    </button>
    <CouponFormMessage failure={failure} />
  </li>
);

export const CouponEditor = () => {
  const [items, setItems] = useState<Coupon[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [refused, setRefused] = useState<ScopedFailure | null>(null);

  // 画面を開いた時に一度だけ取る。離れたあとに返ってきた答えは捨てる。
  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await fetchCoupons();
      if (!alive || !list) return;
      setItems(list);
      setDrafts(draftsOf(list));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const list = await fetchCoupons();
    if (!list) return;
    setItems(list);
    setDrafts(draftsOf(list));
  }, []);

  /** 断られたらその場に文を出して終わる。通ったら一覧を取り直す（一覧の正本は入口の側）。 */
  const apply = async (scope: string, call: () => Promise<unknown>, onDone: () => void) => {
    const result = await call();
    if (isFailure(result)) {
      setRefused({ scope, failure: result });
      return;
    }
    setRefused(null);
    onDone();
    await reload();
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await apply(CREATE_SCOPE, () => apiCall("POST", COUPONS_PATH, { name, note }), () => {
      setName("");
      setNote("");
    });
  };

  const failureOf = (scope: string): ApiFailure | null => (refused?.scope === scope ? refused.failure : null);

  return (
    <section data-testid="coupon-list">
      <h2>クーポン</h2>
      <p>お客さまに見せる特典を{COUPON_MAX}つまで用意できます。</p>

      <ul>
        {items.map((coupon) => (
          <CouponRow
            key={coupon.id}
            coupon={coupon}
            draft={drafts[coupon.id] ?? { name: coupon.name, note: coupon.note ?? "" }}
            failure={failureOf(coupon.id)}
            onChange={(values) => setDrafts((prev) => ({ ...prev, [coupon.id]: values }))}
            onSave={() => {
              const draft = drafts[coupon.id] ?? { name: coupon.name, note: coupon.note ?? "" };
              void apply(coupon.id, () => apiCall("PUT", couponPath(coupon.id), draft), () => undefined);
            }}
            onDelete={() => {
              void apply(coupon.id, () => apiCall("DELETE", couponPath(coupon.id)), () => undefined);
            }}
          />
        ))}
      </ul>

      <form
        data-testid="form-coupon"
        noValidate
        onSubmit={(event) => {
          void create(event);
        }}
      >
        <h3>クーポンを作る</h3>

        <label htmlFor="coupon-new-name">名前</label>
        <input id="coupon-new-name" data-testid="field-name" type="text" value={name} maxLength={COUPON_NAME_MAX} onChange={(event) => setName(event.target.value)} />
        <FieldMessage name="name" failure={failureOf(CREATE_SCOPE)} ctx={NAME_CTX} />

        <label htmlFor="coupon-new-note">特記事項</label>
        <input id="coupon-new-note" data-testid="field-note" type="text" value={note} maxLength={COUPON_NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
        <FieldMessage name="note" failure={failureOf(CREATE_SCOPE)} ctx={NOTE_CTX} />

        <button type="submit" data-testid="btn-create-coupon">
          作る
        </button>
        <CouponFormMessage failure={failureOf(CREATE_SCOPE)} />
      </form>
    </section>
  );
};

export default CouponEditor;
