// domain/fileType の単体（受け入れ検査 r13 は入口ごしに見るので、境目はここで固める）。
import { describe, expect, it } from "vitest";
import { detectFileType } from "./fileType";

const withPadding = (head: number[], length = 64) => new Uint8Array([...head, ...new Array(length).fill(0x20)]);

describe("detectFileType", () => {
  it("PDF・JPEG・PNG の先頭のバイト列をその種類として返す", () => {
    expect(detectFileType(withPadding([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]))).toBe("application/pdf");
    expect(detectFileType(withPadding([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectFileType(withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  });

  it("GIF・空・印の途中までしかないファイルは null", () => {
    expect(detectFileType(withPadding([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
    // "%PD" までしか無い＝ PDF の印を満たさない（部分一致で通さない）
    expect(detectFileType(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull();
    // PNG の印の8バイト目だけが違う
    expect(detectFileType(withPadding([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))).toBeNull();
  });
});
