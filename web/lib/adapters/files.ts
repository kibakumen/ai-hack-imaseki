// ファイル置き場（差し替え口 FileStore）の実物。営業許可書を R2 の非公開のバケットに置く
// （設計書「技術構成」: D1 の1行には10MB のファイルが入らない）。R2 は Worker の束縛から読むので
// API の鍵は要らない（設計書「秘密情報と個人データの扱い」）。
//
// ⚠️ ここは「置く・取る・消す」だけを知っている。どの店のどの鍵か・種類が何かの判断は
// lib/usecases と lib/domain が持つ（依存の向き）。

import type { FileStore } from "../ports";

/** R2 の束縛のうち、この差し替え口が使う分だけの形（@cloudflare/workers-types を持ち込まないため）。 */
export type PermitBucket = {
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
};

/** 束縛の名前は wrangler.jsonc の `PERMITS`（`adapters/env.ts` と同じく、束縛を知るのは lib/adapters だけ）。 */
export const createFileStore = (bucket: PermitBucket): FileStore => ({
  put: async (key, body, contentType) => {
    // Uint8Array そのものではなく、その分だけを切り出した ArrayBuffer を渡す
    // （同じ緩衝領域を分け合っている場合に、余計な範囲まで書かれるのを防ぐ）。
    const buffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    await bucket.put(key, buffer, { httpMetadata: { contentType } });
  },
  get: async (key) => {
    const object = await bucket.get(key);
    if (!object) return null;
    return {
      body: new Uint8Array(await object.arrayBuffer()),
      // R2 が種類を覚えていないことがあるので、呼ぶ側が持っている値へ倒せるよう空文字を返す
      // （正本は stores.license_mime＝上げたときに先頭のバイト列で確かめた値）。
      contentType: object.httpMetadata?.contentType ?? "",
    };
  },
  delete: async (key) => {
    await bucket.delete(key);
  },
});
