// 保存するパスワードの値（方式・繰り返しの回数・塩・ハッシュを1つにした文字列）の組み立てと読み取り。
// 受け入れ検査（14.4）は保存された値を parsePasswordRecord で読むので、壊れた値で null になる道も固定する。
import { describe, expect, it } from "vitest";
import { buildPasswordRecord, constantTimeEqual, parsePasswordRecord, saltFromBytes } from "../../lib/domain/password";

const RECORD = buildPasswordRecord({ iterations: 100_000, salt: "c2FsdA==", hashB64: "aGFzaA==" });

describe("保存する値の組み立てと読み取り", () => {
  it("組んだ値をそのまま読み戻せる。平文は入らない", () => {
    expect(RECORD.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(parsePasswordRecord(RECORD)).toEqual({ algorithm: "pbkdf2-sha256", iterations: 100_000, salt: "c2FsdA==", hashB64: "aGFzaA==" });
  });

  it("形が違う値は null（区切りの数・方式・回数・欠けた部分）", () => {
    for (const broken of ["", "pbkdf2-sha256$100000$c2FsdA==", "sha1$100000$c2FsdA==$aGFzaA==", "pbkdf2-sha256$ゼロ$c2FsdA==$aGFzaA==", "pbkdf2-sha256$0$c2FsdA==$aGFzaA==", "pbkdf2-sha256$100000$$aGFzaA=="]) {
      expect(parsePasswordRecord(broken), broken).toBeNull();
    }
  });

  it("塩はバイト列から base64 にする（同じバイト列なら同じ値）", () => {
    expect(saltFromBytes(new Uint8Array([115, 97, 108, 116]))).toBe("c2FsdA==");
    expect(saltFromBytes(new Uint8Array([0, 255]))).toBe(saltFromBytes(new Uint8Array([0, 255])));
  });

  it("比べるのは同じ長さでも違う長さでも、合うときだけ true", () => {
    expect(constantTimeEqual("aGFzaA==", "aGFzaA==")).toBe(true);
    expect(constantTimeEqual("aGFzaA==", "aGFzaB==")).toBe(false);
    expect(constantTimeEqual("aGFzaA==", "aGFzaA")).toBe(false);
  });
});
