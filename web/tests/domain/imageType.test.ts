// 店の画像の種類を先頭のバイトだけで決める（安全-19: 画像を自分のオリジンから配るので、名乗りを信じない）。
import { describe, expect, it } from "vitest";
import { detectImageType } from "../../lib/domain/imageType";

const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0, 0, 0, 0, 0]);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("detectImageType", () => {
  it("JPEG・PNG・GIF・WebP を先頭のバイトで見分ける", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectImageType(ascii("GIF89a......"))).toBe("image/gif");
    expect(detectImageType(ascii("GIF87a......"))).toBe("image/gif");
    expect(detectImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  });

  it("SVG・HTML・PDF・空・短すぎる値は画像として受け取らない（自分のオリジンから配ると、中の script が動きうる）", () => {
    for (const value of [ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), ascii("<!doctype html><html>"), ascii("%PDF-1.7"), new Uint8Array(), new Uint8Array([0xff, 0xd8])]) {
      expect(detectImageType(value)).toBeNull();
    }
  });

  it("RIFF でも WEBP でないもの（WAV など）は受け取らない", () => {
    expect(detectImageType(ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBeNull();
  });
});
