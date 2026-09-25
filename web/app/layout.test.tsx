// 画面全体の殻（app/layout）の検査（2026-09-25 監査の指摘 設計-21）。
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

describe("画面全体の殻", () => {
  // 明暗を選んだ端末では、水和の前に同期スクリプトが <html data-theme> を足す。サーバーの HTML には無い属性なので、
  // 抑えないと開発時に毎回「属性が食い違う」警告が出て、本物の水和の誤りが紛れる。抑えるのはこの要素自身の属性だけ。
  it("<html> は水和の属性の食い違いを抑える（明暗の同期スクリプトが data-theme を足すため）", () => {
    const html = RootLayout({ children: null }) as ReactElement<{ suppressHydrationWarning?: boolean; lang?: string }>;
    expect(isValidElement(html)).toBe(true);
    expect(html.type).toBe("html");
    expect(html.props.lang).toBe("ja");
    expect(html.props.suppressHydrationWarning).toBe(true);
  });
});
