// 客に見せる「個人データがどこに出るか」の説明が、実際の店の一覧の振る舞いと合っていること
// （2026-09-25 監査の指摘 安全-16・安全-17 の案3 とそのレビュー）。
//
// 安全-16: 登録の画面が「呼び名はお店に伝わりません」と書いていたが、客が入れた呼び名は受け取った店の一覧に出る
//          （基準 20.1）。
// 安全-17: 電話番号の欄の説明が、どの店にいつまで見えるかを書いていなかった。店の一覧に出るのは、
//          受け取った店だけ（受け取った時点の写し）で、いちばん長い完了済みの行は完了済みから24時間。
import { describe, expect, it } from "vitest";
import { COMPLETED_ROW_VIEW_MS, STORE_CANCELLED_ROW_VIEW_MS } from "../../lib/domain/storeHome";
import { EXPIRED_GRACE_MS } from "../../lib/domain/reservation";
import { PERSONAL_DATA_TEXTS } from "../../lib/domain/texts";

const HOUR_MS = 60 * 60 * 1000;

describe("個人データの見え方の説明（安全-16・安全-17）", () => {
  it("登録の画面は、呼び名と電話番号が受け取ったお店の画面に出ると書く（伝わらないとは書かない）", () => {
    expect(PERSONAL_DATA_TEXTS.registerNotice).toMatch(/呼び名と電話番号は、席を受け取ったお店の画面に表示されます/);
    expect(PERSONAL_DATA_TEXTS.registerNotice).toMatch(/本名でなくてかまいません/);
    expect(PERSONAL_DATA_TEXTS.registerNotice).not.toMatch(/伝わりません/);
  });

  it("取得の画面の電話番号の欄は、受け取ったお店の画面に出ることと、いつまで出るかを書く", () => {
    expect(PERSONAL_DATA_TEXTS.fetchPhoneNote).toMatch(/緊急時に連絡/);
    expect(PERSONAL_DATA_TEXTS.fetchPhoneNote).toMatch(/受け取ったお店の画面に表示されます/);
    expect(PERSONAL_DATA_TEXTS.fetchPhoneNote).toMatch(/入れなくても探せます/);
  });

  it("書いた「◯時間」は店の一覧の完了済みの行が消えるまでの時間と同じで、ほかの行はそれより早く消える", () => {
    const hours = COMPLETED_ROW_VIEW_MS / HOUR_MS;
    expect(PERSONAL_DATA_TEXTS.registerNotice).toContain(`完了済みになってから${hours}時間まで`);
    expect(PERSONAL_DATA_TEXTS.fetchPhoneNote).toContain(`完了済みになってから${hours}時間まで`);
    expect(STORE_CANCELLED_ROW_VIEW_MS).toBeLessThanOrEqual(COMPLETED_ROW_VIEW_MS);
    expect(EXPIRED_GRACE_MS).toBeLessThanOrEqual(COMPLETED_ROW_VIEW_MS);
  });
});
