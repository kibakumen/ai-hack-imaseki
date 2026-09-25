// 客の入口（設計書「入口（API）の一覧」）。GET /api/customer/store-image。
// 店の雰囲気画像を、**自分のオリジンから**返す（2026-09-22 本人の指摘「お店の画像もほしい」）。
//
// 2026-09-25 監査の指摘 安全-12・安全-19 で形を変えた。入力は店の番号で、返すのは承認済みの店の、
// 店が情報を保存したときに置き場へ置いた画像のバイト（usecases/storeImage）。客の要求で外へは出ない。
// 入力の検査・見分けは defineRoute が済ませているので、ここは手続きを呼んで応答の形に直すだけ。

import type { StoreImageFile } from "../../ports";
import { storeImageQuerySchema } from "../../schemas/storeImage";
import { readStoreImage } from "../../usecases/storeImage";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";
import { notFound } from "../refusals";

/**
 * 画像の応答。種類を勝手に読み替えさせず（nosniff）、直接開かれても何も動かない（CSP で全部を止める）。
 * 同じ店の画像は店が保存し直すまで変わらないので、利用者の端末にだけ1時間置かせる（共有の置き場には置かない）。
 */
const imageResponse = (file: StoreImageFile): RouteHandlerResult => ({
  status: 200,
  body: null,
  raw: {
    body: file.body,
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  },
});

const customerStoreImageRoute = defineRoute({
  method: "GET",
  path: "/api/customer/store-image",
  auth: "customer",
  input: storeImageQuerySchema,
  handler: async ({ input, deps }) => {
    const file = await readStoreImage(deps, input.storeId);
    // 無い番号・承認前・止められた店・画像の無い店を分けて見せない
    return file ? imageResponse(file) : notFound();
  },
});

export const storeImageRoutes: RouteDefinition[] = [customerStoreImageRoute];
