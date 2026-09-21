// 紙吹雪（2026-09-22。第1回の指摘「受け取った瞬間にファンファーレみたいなエフェクトが欲しい」。
// 速成版 `sprint/app/me/page.tsx` の `ConfettiBurst` を v2 へ移した）。
//
// 画像も外部の部品も足さない——絵文字を CSS の落下（`@keyframes confetti-fall`）で流すだけ。
// 片の位置・遅れ・速さは **並びの番号から決める**（乱数を使わない）。サーバーで描いた形と
// 客の端末で描いた形が食い違わず、見た目は十分ばらける。
// 色は持たない（要件32の基準 32.3。動きと形だけを .tsx が持ち、色は `app/globals.css` の変数）。

/** 落ちてくる片の絵柄。4種を順に配る */
const PIECES = ["🎊", "✨", "🎉", "⭐"];
/** 黄金比でずらすと、少ない数でも横の並びに規則が見えない */
const GOLDEN_RATIO = 0.618_033_988_7;

type ConfettiProps = {
  /** 片の数（既定は18。画面いっぱいの祝いなら増やす） */
  count?: number;
};

export const Confetti = ({ count = 18 }: ConfettiProps) => (
  <div aria-hidden className="confetti">
    {Array.from({ length: count }, (_, index) => (
      <span
        key={index}
        className="confetti__piece"
        style={{
          left: `${Math.round(((index + 1) * GOLDEN_RATIO * 100) % 100)}%`,
          animationDelay: `${(index % 6) * 70}ms`,
          animationDuration: `${900 + (index % 5) * 140}ms`,
        }}
      >
        {PIECES[index % PIECES.length]}
      </span>
    ))}
  </div>
);

export default Confetti;
