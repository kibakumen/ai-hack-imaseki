"use client";

// 店のホーム（要件12の基準 12.6〜12.9）。開いた時にホームの入口を1回呼び、承認の状況の帯と、
// 未承認なら足りないもののチェックリストを出す（設計書「店の画面」の1）。
// 部品は返された値を描くだけで、自分では判断しない。
//
// 並びは 2026-09-21 の本人の指摘で入れ替えた（速成版 sprint/app/store が基準）:
//   **向かっている客がいちばん上**——店が開きっぱなしにするのはこの画面で、いちばん急ぐのは
//   「来た客を完了にする」操作だから。公開の設定はその下（1日に何度も触るものではない）。
// 画面のあいだの行き来はタブに変えた（StoreNav）。新しい客が増えた時は音で知らせる。

import { useCallback, useEffect, useRef } from "react";
import { callApi, type ApiFailure, type StoreHomeDto } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { ARRIVALS_REFRESH_MS } from "../../lib/schemas/limits";
import { LoadView } from "../ui/LoadState";
import { ArrivalsList } from "./ArrivalsList";
import { confirmCardSetup } from "./cardReturn";
import { SoundUnlock } from "./SoundUnlock";
import { useArrivalSignals, type ArrivalSignals } from "./useArrivalSignals";
import { useWakeLock } from "./useWakeLock";
import { PublishForm } from "./PublishForm";
import { OfferPanel } from "./OfferPanel";
import { SetupChecklist } from "./SetupChecklist";
import { StatusBanner } from "./StatusBanner";
import { StoreNav } from "./StoreNav";

/**
 * 入口 `GET /api/store/home` の応答（受け入れ検査の契約 `StoreHomeDto`）。サーバーと同じ定義
 * （schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
 * `mustChangePassword` は仮のパスワードで入っている印（基準 14.14）で、立っていれば新しいパスワードを決める画面へ案内する。
 */
export type StoreHomeView = StoreHomeDto;

const loadHome = (): Promise<StoreHomeView | ApiFailure> => callApi("GET /api/store/home");

type HomeBodyProps = {
  home: StoreHomeView;
  onChanged: () => void;
  /** 新しい客・客の取り消し・人数の変更の印（店-07・横断-08） */
  signals: Pick<ArrivalSignals, "newIds" | "cancelledIds" | "partyChanges">;
  /** 最後に取れた時刻（「最終更新 HH:MM」・店-08） */
  updatedAt: number | null;
};

/** 取れたホームの中身（案内・状況の帯・向かっている客・公開の設定）。 */
const HomeBody = ({ home, onChanged, signals, updatedAt }: HomeBodyProps) => {
  // 仮のパスワードで入った店への案内（基準 14.14）。`app/store/password` の注が「店のホームが
  // ここへ案内する」と言いながら、この道が無かった（2026-09-22 に足した）。
  // 決めるまでは、ホームとパスワードの変更のほかの入口が 403 で断る（2026-09-25 監査の指摘 安全-21）ので、
  // 押しても断られるだけの操作（公開・確保の完了など）は出さず、案内だけを出す。
  if (home.mustChangePassword) {
    return (
      <p className="msg" role="alert" data-testid="must-change-password">
        運営から受け取った仮のパスワードで入っています。<a href="/store/password">新しいパスワードを決めてください。</a>
        決めるまで、ほかの操作はできません。
      </p>
    );
  }
  // 公開の操作を出すのは承認済みのときだけ（未承認・止められている間は入口も断る・基準 17.10）。
  const canPublish = home.status === "approved" && home.offer === null;
  // 「公開を止める」の確かめに出す、向かっている組数（店-03）
  const arriving = (home.arrivals ?? []).filter((row) => row.kind === "active").length;
  return (
    <>
      <StatusBanner status={home.status} />

      {home.status === "pending" && <SetupChecklist checklist={home.checklist} missingProfile={home.missingProfile} />}

      <SoundUnlock />
      <ArrivalsList
        rows={home.arrivals ?? []}
        onChanged={onChanged}
        newIds={signals.newIds}
        cancelledIds={signals.cancelledIds}
        partyChanges={signals.partyChanges}
        updatedAt={updatedAt}
        onRefresh={onChanged}
      />

      {canPublish && <PublishForm coupons={home.coupons} prefill={home.publishPrefill} onPublished={onChanged} />}

      {/* `key` はオファーの番号——止めて新しく公開すると別のオファーになるので、ダイヤルと選択を新しいオファーの
          値から作り直す（同じオファーの取り直しとクーポンの選び直しでは残す・不具合-03） */}
      {home.offer ? <OfferPanel key={home.offer.id} offer={home.offer} coupons={home.coupons} trend={home.trend} arriving={arriving} onChanged={onChanged} /> : null}
    </>
  );
};

export const StoreHome = () => {
  // 新しい客・人数の変更を、音（鳴らせなければ振動）・カードの印・タブのタイトルの件数で知らせる（店-07・横断-08）。
  // **初めの読み込みでは鳴らさない**（開いた瞬間に全員ぶん鳴るのを避ける）。比べ方は useArrivalSignals。
  const signals = useArrivalSignals();
  const { absorb: absorbArrivals } = signals;
  // 開いている間は画面の消灯を防ぐ（消えると取り直しも音も止まる・店-07）
  useWakeLock();

  /**
   * 取り直した中身を受け取ったときの1手ぶん。描く途中ではなく**受け取った時**に済ませる（描き直しの連鎖を作らない）。
   * 「今日の動き」は入口が15分ごとの数を返すので、ここでは溜めない（店-15。溜めた点は開き直すと消えていた）。
   */
  const absorb = useCallback((next: StoreHomeView) => absorbArrivals(next.arrivals ?? []), [absorbArrivals]);

  // 確保の追加と状態の変化を30秒以内に一覧へ映す（基準 20.4）。間隔は10秒で、画面に戻ったときはすぐ取り直す（店-08）。
  // 画面が隠れていても止めない（隠れている間こそ新しい客の音が要る）。
  // 取れなかった回は前の値のまま残し（一覧が空に落ちて、向かっている客が消えないように）、
  // **失敗していることは帯で出す**（「最終更新 HH:MM・更新できていません」・2026-09-25 監査の指摘 横断-01。
  // それまでは失敗を黙って捨て、開きっぱなしのタブレットが古い一覧のまま音も鳴らなかった）。
  const { state, reload } = useLoad(loadHome, { onLoaded: absorb, pollMs: ARRIVALS_REFRESH_MS });
  const refresh = () => {
    void reload();
  };

  // カードの登録を始めたまま確かめていない店（決済会社の画面から戻る前にタブを閉じた店）は、ホームを開いたときにも
  // 確かめを1回送る（2026-09-25 カード登録が画面から完了しない件（不具合-01））。通らなくても文は出さない
  // （入力を終えていないだけかもしれない。やり直しは書類の画面から）。
  const cardChecked = useRef(false);
  const pendingCard = state.status === "ready" && state.data.cardSetupPending && !state.data.checklist.card;
  useEffect(() => {
    if (!pendingCard || cardChecked.current) return;
    cardChecked.current = true;
    void (async () => {
      if ((await confirmCardSetup()) === null) await reload();
    })();
  }, [pendingCard, reload]);

  // 読めなかった・ログインが切れたときも、見出しとタブは出す（空の main で止めない・横断-01）。
  return (
    <main className="store-main" aria-busy={state.status === "loading"}>
      {/* 上部は**タブだけ**にする（2026-09-25 監査の指摘 店-14・本人の第2回の指摘「上部の方に不要な情報が多い」）。
          見出しは読み上げのために残し、目には出さない（タブの「オファー」と同じことを言うので） */}
      <StoreNav active="home" />
      <h1 className="store-sr-only">今日のオファー</h1>

      <LoadView state={state} onRetry={refresh}>
        {(home) => <HomeBody home={home} onChanged={refresh} signals={signals} updatedAt={state.status === "ready" ? state.updatedAt : null} />}
      </LoadView>
    </main>
  );
};

export default StoreHome;
