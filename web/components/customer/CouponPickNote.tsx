// クーポンの札の下に添える1行（2026-09-22 の本人の指摘）。
//
//   「3つあるクーポンの全てを受け取れると勘違いしかねません。…いずれか一つを選べることを
//     小さくてもいいから明記してほしい」
//   （補足）「選ぶというのはこのアプリではなく、来店したときに実際にどのクーポンを使うのかという場面です」
//
// ⚠️ **この部品は操作を持たない。** 要件4の基準 4.11 が「客の画面はクーポンを選ぶ操作を置かない」
// と定めており、受け入れ検査もそれを見ている。ここで伝えるのは**店頭で起きること**であって、
// アプリの中に選択を持ち込むわけではない。だから文だけ。
//
// ⚠️ **置き場所は `<ul data-testid="coupon-list">` の外**。受け入れ記録が
// 「クーポン0個のとき、その `<ul>` の中身は空文字」を見ているため、中に入れると落ちる
// （`r04-fetch-result.ui.test.tsx` 58行・`r09-reservation-view.ui.test.tsx` 45行）。

/** 2枚以上あるときだけ出す。1枚なら選ぶ余地が無く、0枚なら出すものが無い。 */
export const CouponPickNote = ({ count }: { count: number }) => {
  if (count < 2) return null;
  return (
    <p className="coupon-pick-note" data-testid="coupon-pick-note">
      お店ではこの中から<strong>1つ</strong>を選んで使えます
    </p>
  );
};

export default CouponPickNote;
