// 客に出る AI の文（選定の理由・紹介文）に共通の、語と連絡先の決定論の検査（2026-09-25 監査の指摘 不具合-07）。
// 以前は紹介文の層にだけあり、禁止語の一覧も指示文と検査で食い違っていた。
import { describe, expect, it } from "vitest";
import { claimProblem, UNFOUNDED_PRAISE_TERMS, unfoundedPraiseList } from "../../lib/domain/claims";

describe("語と連絡先の検査（選定の理由と紹介文で共通）", () => {
  it("状況を述べただけの文は通る", () => {
    for (const text of ["歩いて4分、今日は刺身盛りを出してるよ", "和食好きにちょうどいい距離です", "予算3,000円に収まりそう", "予算3.000円で入れます", "1人2000-3000円で、今ならクーポンが1つ使えます", "0時まで空いてます", "予算 10000 20000 30000 円のどれでも入れます"]) {
      expect(claimProblem(text), text).toBeNull();
    }
  });

  it("食べたことがないと言えない断定は落ちる（前は指示にだけあって検査をすり抜けた語も含む）", () => {
    for (const text of ["絶品の刺身です", "最高の一杯が待ってる", "人気店です", "美味いラーメン", "美味しい和食", "名物の刺身です", "間違いなし", "旨いつけ麺"]) {
      expect(claimProblem(text), text).toBe("unfounded_praise");
    }
  });

  it("このシステムに無いデータ（口コミ・レビュー・評価・星の数）に触れた文は落ちる", () => {
    for (const text of ["口コミでも評判", "レビューが高い店", "高評価の一軒", "星4つの実力", "★4.5の店"]) {
      expect(claimProblem(text), text).not.toBeNull();
    }
    expect(claimProblem("口コミが多い")).toBe("nonexistent_data");
  });

  it("URL と電話番号は、全角・区切りなし・www. ・メールまで落ちる", () => {
    for (const text of [
      "詳しくは https://example.com へ",
      "詳しくは ｈｔｔｐｓ：／／example.com へ",
      "www.example.jp を見てね",
      "ｗｗｗ．example．jp を見てね",
      "example.com から予約できます",
      "予約は 03-1234-5678 まで",
      "予約は ０３－１２３４－５６７８ まで",
      "予約は0312345678まで",
      "予約は 090 1234 5678 まで",
      "予約は +81-3-1234-5678 まで",
      "連絡は shop@example.jp へ",
    ]) {
      expect(claimProblem(text), text).toBe("contact");
    }
  });

  it("書き手への指示に並べる語の一覧は、検査が落とす語と同じ1つの定数から作る", () => {
    const list = unfoundedPraiseList();
    for (const term of UNFOUNDED_PRAISE_TERMS) {
      expect(list).toContain(term.word);
      // 指示に並べた語をそのまま書けば、検査が落とす
      expect(claimProblem(`${term.word}です`), term.word).toBe("unfounded_praise");
    }
  });
});

// 店が自分で書いた語を AI がそのまま引くのは「店の書いた事実を写す」ことで、AI 自身の評価の断定ではない
// （2026-09-25 不具合-07 のレビュー: メニュー名「名物もつ煮」を引いた選定の理由で、選定の全件が点数順に倒れていた）。
describe("店が自分で書いた語（メニュー名・店名・クーポン名）を引いた文", () => {
  it("店が登録したメニュー名に禁止語が入っていても、それをそのまま引いただけなら落ちない", () => {
    const cases: Array<[string, string]> = [
      ["名物もつ煮を出している居酒屋です", "名物もつ煮"],
      ["自慢の餃子が食べられる中華です", "自慢の餃子"],
      ["こだわりの醤油ラーメンを出すラーメン屋です", "こだわりの醤油ラーメン"],
      ["人気の唐揚げ定食がある和食です", "人気の唐揚げ定食"],
      ["本格的四川麻婆豆腐のある中華です", "本格的四川麻婆豆腐"],
    ];
    for (const [text, menu] of cases) {
      // 店の語を渡さなければ、今までどおり落ちる
      expect(claimProblem(text), text).toBe("unfounded_praise");
      expect(claimProblem(text, [menu]), text).toBeNull();
    }
  });

  it("引いた語の外で AI 自身が断定した語や、無いデータに触れた語は落ちる", () => {
    expect(claimProblem("名物もつ煮が絶品の居酒屋です", ["名物もつ煮"])).toBe("unfounded_praise");
    expect(claimProblem("人気の唐揚げ定食は口コミで評判です", ["人気の唐揚げ定食"])).toBe("nonexistent_data");
  });

  it("禁止語だけでできた店の語は、断定の言い訳にならない（「絶品」というメニュー名で「絶品」を通さない）", () => {
    expect(claimProblem("絶品の店です", ["絶品"])).toBe("unfounded_praise");
    expect(claimProblem("最高の一杯です", ["最高！"])).toBe("unfounded_praise");
    expect(claimProblem("星4つの店です", ["★4"])).toBe("nonexistent_data");
    // 外すのは店の語そのものの現れだけ（店名「人気屋」を外しても「人気店」は残る）
    expect(claimProblem("人気屋は人気店です", ["人気屋"])).toBe("unfounded_praise");
    expect(claimProblem("人気屋で一杯どう", ["人気屋"])).toBeNull();
  });

  it("連絡先は、店の語の中にあっても落ちる（店の書いた語でも客の画面へ電話番号と URL は出さない）", () => {
    expect(claimProblem("03-1234-5678定食のある店です", ["03-1234-5678定食"])).toBe("contact");
    expect(claimProblem("example.com丼のある店です", ["example.com丼"])).toBe("contact");
  });

  it("全角と半角の違いがあっても、同じ店の語として外す", () => {
    expect(claimProblem("名物ＢＬＴサンドのあるカフェです", ["名物BLTサンド"])).toBeNull();
    expect(claimProblem("名物BLTサンドのあるカフェです", ["名物ＢＬＴサンド"])).toBeNull();
  });

  it("空の語・空白だけの語は無視する", () => {
    expect(claimProblem("名物の刺身です", ["", "  "])).toBe("unfounded_praise");
  });
});
