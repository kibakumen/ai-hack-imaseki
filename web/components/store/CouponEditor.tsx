"use client";

// クーポンの入力（要件16の基準 16.1〜16.5・16.7）。打つ欄は2つだけ——名前と特記事項。
// 人数・公開の設定・件数の欄は持たない（基準 16.7。それらはオファーの公開の側にある）。
//
// 送る前に自分では検査せず、入口が返した断りを描く（設計書「入力の誤りの出し方」の規則5）。
// 断られたときは、打った値も一覧もそのまま残す——書き直す場所を見失わせないため。
//
// ⚠️ 断りは一度に1か所にだけ出す（作る側か、どれか1つの行か）。同じ `msg-name` が2か所に
//    同時に出ると、どちらの操作の話なのかが読めなくなる。

import { useRef, useState, type FormEvent } from "react";
import { callApi, isFailure, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { COUPON_TEXTS } from "../../lib/domain/texts";
import { COUPON_MAX, COUPON_NAME_MAX, COUPON_NAME_MIN, COUPON_NOTE_MAX } from "../../lib/schemas/limits";
import { FieldMessage, fieldAria } from "../ui/InputRefusal";
import { LoadView } from "../ui/LoadState";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type Coupon = ResponseOf<"GET /api/store/coupons">["items"][number];
type Draft = { name: string; note: string };

/** 作る側の断りの置き場を表す印（行の断りは、その行の番号を使う） */
const CREATE_SCOPE = "create";
const NAME_CTX = { field: "名前", min: COUPON_NAME_MIN, max: COUPON_NAME_MAX };
const NOTE_CTX = { field: "特記事項", min: 0, max: COUPON_NOTE_MAX };

/** 断りと、それがどの操作のものか。 */
type ScopedFailure = { scope: string; failure: ApiFailure };

const draftOf = (coupon: Coupon): Draft => ({ name: coupon.name, note: coupon.note ?? "" });

const sameDraft = (a: Draft, b: Draft): boolean => a.name === b.name && a.note === b.note;

/**
 * 取り直した一覧から書きかけを作り直す（2026-09-25 監査の指摘 店-19）。**書きかけ（前に取れた値から直した行）は残し**、
 * 今の操作で保存・削除した行（`reset`）と、直していない行と、新しい行だけをサーバーの値にする。消えた行は落とす。
 * それまでは全部の行を作り直していたので、A を直している途中で B を保存すると A の書きかけが黙って元に戻った。
 */
const mergeDrafts = (
  previous: Record<string, Draft>,
  previousServer: Record<string, Draft>,
  list: Coupon[],
  reset: ReadonlySet<string>,
): Record<string, Draft> =>
  Object.fromEntries(
    list.map((coupon) => {
      const draft = previous[coupon.id];
      const server = previousServer[coupon.id];
      const editing = draft !== undefined && server !== undefined && !sameDraft(draft, server) && !reset.has(coupon.id);
      return [coupon.id, editing ? draft : draftOf(coupon)];
    }),
  );

/**
 * 一覧を取る。取れなかったときは断りをそのまま返す——読み込みの部品（useLoad）が、1度も取れていなければ
 * 「読めなかった」を、取れたあとなら前の一覧を残して「更新できていない」を出す（空にすると消えたように見え、
 * 0件の「まだありません」と区別もつかない・2026-09-25 監査の指摘 横断-01）。
 */
const fetchCoupons = async (): Promise<Coupon[] | ApiFailure> => {
  const result = await callApi("GET /api/store/coupons");
  return isFailure(result) ? result : result.items;
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
  /** この行の保存が通った直後か（「保存しました」を出す・店-19） */
  saved: boolean;
  onChange: (values: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
};

/**
 * 削除の確かめ（2026-09-25 監査の指摘 店-03）。消したクーポンは戻せないので、同じ画面の完了・取り消しと同じ形で
 * 1段挟む（それまでは押した瞬間に消えた）。
 */
const DeleteConfirm = ({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) => (
  <div className="store-confirm" role="dialog" aria-label="クーポンを削除する確かめ" data-testid="confirm-delete-coupon">
    <p>「{name}」を削除します。元に戻せません。</p>
    <div className="store-confirm__buttons">
      <button type="button" className="store-btn store-btn--danger" data-testid="btn-confirm-delete-coupon" onClick={onConfirm}>
        削除する
      </button>
      <button type="button" className="store-btn store-btn--quiet" onClick={onCancel}>
        やめる
      </button>
    </div>
  </div>
);

/**
 * 1つのクーポン。今の中身を見せたまま、その場で直せる（基準 16.4）。
 * 見た目は**1枚ずつの札**（2026-09-22 の本人の指摘「1枚ずつのカードにして、ボタンの余白を空ける」）:
 * 上段が券面（客に見える名前と特記事項・客の画面の `.offer-coupon` と同じ点線の縁の語彙）、
 * 下段が直す欄と、離して置いた2つのボタン。「削除」は確かめを1段挟む（店-03）。
 */
const CouponRow = ({ coupon, draft, failure, saved, onChange, onSave, onDelete }: CouponRowProps) => {
  const [askingDelete, setAskingDelete] = useState(false);
  return (
    <li className="store-coupon-card" data-testid={`row-${coupon.id}`}>
      <div className="store-coupon-card__face">
        <span className="store-coupon-card__mark" aria-hidden="true">
          ✓
        </span>
        <div className="store-coupon-card__text">
          <h3>{coupon.name}</h3>
          {coupon.note !== "" && <p className="store-coupon-card__note">{coupon.note}</p>}
        </div>
      </div>

      <div className="store-coupon-card__fields">
        <div className="store-field">
          <label htmlFor={`coupon-name-${coupon.id}`}>名前</label>
          <input
            id={`coupon-name-${coupon.id}`}
            data-testid={`field-name-${coupon.id}`}
            type="text"
            value={draft.name}
            maxLength={COUPON_NAME_MAX}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            {...fieldAria("name", failure, `coupon-name-${coupon.id}`)}
          />
          <FieldMessage inputId={`coupon-name-${coupon.id}`} name="name" failure={failure} ctx={NAME_CTX} />
        </div>

        <div className="store-field">
          <label htmlFor={`coupon-note-${coupon.id}`}>特記事項</label>
          <input
            id={`coupon-note-${coupon.id}`}
            data-testid={`field-note-${coupon.id}`}
            type="text"
            value={draft.note}
            maxLength={COUPON_NOTE_MAX}
            onChange={(event) => onChange({ ...draft, note: event.target.value })}
            {...fieldAria("note", failure, `coupon-note-${coupon.id}`)}
          />
          <FieldMessage inputId={`coupon-note-${coupon.id}`} name="note" failure={failure} ctx={NOTE_CTX} />
        </div>
      </div>

      <div className="store-actions">
        <button type="button" className="store-btn store-btn--primary" data-testid="btn-save-coupon" onClick={onSave}>
          保存する
        </button>
        <button type="button" className="store-btn store-btn--danger" data-testid="btn-delete-coupon" aria-expanded={askingDelete} onClick={() => setAskingDelete(true)}>
          削除
        </button>
      </div>
      {askingDelete ? (
        <DeleteConfirm
          name={coupon.name}
          onConfirm={() => {
            setAskingDelete(false);
            onDelete();
          }}
          onCancel={() => setAskingDelete(false)}
        />
      ) : null}
      <CouponFormMessage failure={failure} />
      {saved ? (
        <p className="store-note" role="status" data-testid="msg-saved">
          保存しました。
        </p>
      ) : null}
    </li>
  );
};

type CreateFormProps = {
  name: string;
  note: string;
  failure: ApiFailure | null;
  onName: (value: string) => void;
  onNote: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** 新しいクーポンを作る欄（名前と特記事項の2つだけ・基準 16.7）。 */
const CouponCreateForm = ({ name, note, failure, onName, onNote, onSubmit }: CreateFormProps) => (
  <form className="store-coupon-new" data-testid="form-coupon" noValidate onSubmit={onSubmit}>
    <h3>クーポンを作る</h3>
    <p className="store-note">名前は客の画面の札に大きく、特記事項はその下に小さく出ます。</p>

    <div className="store-field">
      <label htmlFor="coupon-new-name">名前</label>
      <input
        id="coupon-new-name"
        data-testid="field-name"
        type="text"
        placeholder="例: 生ビール1杯"
        value={name}
        maxLength={COUPON_NAME_MAX}
        onChange={(event) => onName(event.target.value)}
        {...fieldAria("name", failure, "coupon-new-name")}
      />
      <FieldMessage inputId="coupon-new-name" name="name" failure={failure} ctx={NAME_CTX} />
    </div>

    <div className="store-field">
      <label htmlFor="coupon-new-note">特記事項（任意）</label>
      <input
        id="coupon-new-note"
        data-testid="field-note"
        type="text"
        placeholder="例: 1組1回まで"
        value={note}
        maxLength={COUPON_NOTE_MAX}
        onChange={(event) => onNote(event.target.value)}
        {...fieldAria("note", failure, "coupon-new-note")}
      />
      <FieldMessage inputId="coupon-new-note" name="note" failure={failure} ctx={NOTE_CTX} />
    </div>

    <button type="submit" data-testid="btn-create-coupon">
      作る
    </button>
    <CouponFormMessage failure={failure} />
  </form>
);

export const CouponEditor = () => {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [refused, setRefused] = useState<ScopedFailure | null>(null);
  /** 保存が通った直後の行（その行に「保存しました」を出す。その行を直し始めたら消す・店-19） */
  const [savedId, setSavedId] = useState<string | null>(null);
  /** 前に取れたサーバーの値（書きかけかどうかを見分けるため） */
  const serverDrafts = useRef<Record<string, Draft>>({});
  /** 次に取れたときにサーバーの値へ戻す行（今の操作で保存・削除した行） */
  const resetIds = useRef<Set<string>>(new Set());

  // 画面を開いた時に一度だけ取る（離れたあとに返ってきた答えは useLoad が捨てる）。取れたたびに、書きかけを残して
  // 下書きを作り直す（店-19）。
  const absorb = (list: Coupon[]) => {
    const previousServer = serverDrafts.current;
    const reset = resetIds.current;
    serverDrafts.current = Object.fromEntries(list.map((coupon) => [coupon.id, draftOf(coupon)]));
    resetIds.current = new Set();
    setDrafts((prev) => mergeDrafts(prev, previousServer, list, reset));
  };
  const { state, reload } = useLoad(fetchCoupons, { onLoaded: absorb });

  /** 断られたらその場に文を出して終わる。通ったら一覧を取り直す（一覧の正本は入口の側）。 */
  const apply = async (scope: string, call: () => Promise<unknown>, onDone: () => void) => {
    const result = await call();
    if (isFailure(result)) {
      setRefused({ scope, failure: result });
      setSavedId(null);
      return;
    }
    setRefused(null);
    if (scope !== CREATE_SCOPE) resetIds.current = new Set([...resetIds.current, scope]);
    onDone();
    await reload();
  };

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await apply(CREATE_SCOPE, () => callApi("POST /api/store/coupons", { body: { name, note } }), () => {
      setName("");
      setNote("");
      setSavedId(null);
    });
  };

  const failureOf = (scope: string): ApiFailure | null => (refused?.scope === scope ? refused.failure : null);

  const renderList = (items: Coupon[]) => (
    <>
      {/* 「まだありません」は**取れて0件のときだけ**（読めなかったときは読み込みの部品が断りの文を出す・横断-01）。 */}
      {items.length === 0 ? <p className="store-empty">クーポンはまだありません。下の欄から作れます。</p> : null}

      <ul className="store-coupon-cards">
        {items.map((coupon) => (
          <CouponRow
            key={coupon.id}
            coupon={coupon}
            draft={drafts[coupon.id] ?? { name: coupon.name, note: coupon.note ?? "" }}
            failure={failureOf(coupon.id)}
            saved={savedId === coupon.id}
            onChange={(values) => {
              if (savedId === coupon.id) setSavedId(null);
              setDrafts((prev) => ({ ...prev, [coupon.id]: values }));
            }}
            onSave={() => {
              const draft = drafts[coupon.id] ?? draftOf(coupon);
              void apply(coupon.id, () => callApi("PUT /api/store/coupons/:id", { params: { id: coupon.id }, body: draft }), () => setSavedId(coupon.id));
            }}
            onDelete={() => {
              void apply(coupon.id, () => callApi("DELETE /api/store/coupons/:id", { params: { id: coupon.id } }), () => setSavedId(null));
            }}
          />
        ))}
      </ul>

      <CouponCreateForm
        name={name}
        note={note}
        failure={failureOf(CREATE_SCOPE)}
        onName={setName}
        onNote={setNote}
        onSubmit={(event) => {
          void create(event);
        }}
      />
    </>
  );

  return (
    <section className="store-stack" data-testid="coupon-list">
      <div className="store-head">
        <h1>クーポン</h1>
        {state.status === "ready" ? (
          <span className="store-count">
            {state.data.length}/{COUPON_MAX}
          </span>
        ) : null}
      </div>
      <p className="store-lead">お客さまに見せる特典を{COUPON_MAX}つまで用意できます。公開するオファーにどれを付けるかは、オファーの画面で選びます。</p>

      <LoadView state={state} onRetry={() => void reload()}>
        {renderList}
      </LoadView>
    </section>
  );
};

export default CouponEditor;
