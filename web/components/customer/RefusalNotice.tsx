"use client";

// 受け取り・受け取り直しが断られたことを描くただ1つの部品（要件8の基準 8.6・要件11の基準 11.9。
// 設計書「受け取りが断られたとき」の5）。結果のカードの中（`ResultList`）と、期限切れの表示の
// 操作の場所（`ExpiredView`）の両方がこれを使う——断りの表示を画面ごとに書かない。
//
// ⚠️ **自分では何も決めない**。理由（`kind`）と次の一手（`nextStep`）はどちらも手続き
// （`usecases/receiveOffer`）が決めて応答に載せたもので、ここは `domain/texts` の文にして出すだけ。
// 同じ理由でも渡された `nextStep` が違えば違うボタンが出る（受け入れ検査がそれを見る）。
// 次の一手を押したときに**どこへ行くか**は画面の話なので、入れ物（`CustomerApp`）が決める。

import { TEXTS } from "../../lib/domain/texts";
import type { ReceiveRefusal } from "./home";

type RefusalNoticeProps = {
  refusal: ReceiveRefusal;
  /** 次の一手を押したときの受け皿（行き先は `CustomerApp` が `nextStep` で決める）。 */
  onNextStep: () => void;
};

export const RefusalNotice = ({ refusal, onNextStep }: RefusalNoticeProps) => (
  <div className="refusal-notice" role="alert" data-testid="refusal-notice">
    <p className="msg">{TEXTS.receiveRefusal(refusal.kind, refusal)}</p>
    <button type="button" data-testid="btn-next-step" onClick={onNextStep}>
      {TEXTS.nextStep(refusal.nextStep, refusal)}
    </button>
  </div>
);

export default RefusalNotice;
