// 営業許可書とカードの入口（要件13の基準 13.1〜13.6・13.8・13.9）。
// 読む入口は2つ（上げた店・運営）だけで、どちらも同じ手続き `readLicense` を通る（基準 13.5）。
// URL を知っているだけでは読めない——見分けは defineRoute が済ませ、店の入口は自分の店しか指せない。

import { confirmCardSetup, startCardSetup } from "../../usecases/card";
import { readLicense, uploadLicense, type LicenseContent } from "../../usecases/license";
import { cardConfirmSchema, licenseUploadSchema } from "../../schemas/documents";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";

/** 店が戻ってくる先（外のカードの画面から）。要求そのものの URL を起点にする（環境ごとに書き分けない）。 */
const DOCUMENTS_PATH = "/store/documents";

/**
 * ファイルの応答。**保存させない・種類を勝手に読み替えさせない**（設計書「秘密情報と個人データの扱い」）。
 * 個人が特定できる書類なので、途中の置き場にも利用者の端末にも残さない。
 */
const licenseResponse = (file: LicenseContent): RouteHandlerResult => ({
  status: 200,
  body: null,
  raw: {
    body: file.body,
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  },
});

const notFound = (): RouteHandlerResult => ({ status: 404, body: { ok: false, error: { kind: "invalid_input" } } });

const uploadLicenseRoute = defineRoute({
  method: "POST",
  path: "/api/store/license",
  auth: "store",
  input: licenseUploadSchema,
  handler: async ({ input, deps, ctx }) => {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const result = await uploadLicense(deps, ctx.storeId, { bytes, declaredSize: input.file.size });
    if (!result.ok) {
      const reason = result.kind === "file_too_large" ? "too_long" : "not_allowed";
      return { status: 400, body: { ok: false, error: { kind: result.kind, fields: [{ name: "file", reason }] } } };
    }
    return { status: 200, body: { ok: true } };
  },
});

const readOwnLicenseRoute = defineRoute({
  method: "GET",
  path: "/api/store/license",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const file = await readLicense(deps, ctx.storeId);
    return file ? licenseResponse(file) : notFound();
  },
});

const readLicenseAsAdminRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores/:id/license",
  auth: "admin",
  handler: async ({ params, deps }) => {
    const file = await readLicense(deps, params.id);
    return file ? licenseResponse(file) : notFound();
  },
});

const cardSetupRoute = defineRoute({
  method: "POST",
  path: "/api/store/card/setup",
  auth: "store",
  handler: async ({ req, deps, ctx }) => {
    const returnUrl = new URL(DOCUMENTS_PATH, req.url).toString();
    const result = await startCardSetup(deps, ctx.storeId, returnUrl);
    if (!result.ok) return { status: 409, body: { ok: false, error: { kind: "card_setup_failed" } } };
    return { status: 200, body: { ok: true, url: result.url } };
  },
});

const cardConfirmRoute = defineRoute({
  method: "POST",
  path: "/api/store/card/confirm",
  auth: "store",
  input: cardConfirmSchema,
  handler: async ({ input, deps, ctx }) => {
    const result = await confirmCardSetup(deps, ctx.storeId, input.sessionId);
    if (!result.ok) return { status: 409, body: { ok: false, error: { kind: "card_setup_failed" } } };
    // 応答に在るのは登録済みかどうかだけ（基準 13.8。受け皿の番号も外の識別子も返さない）。
    return { status: 200, body: { ok: true, cardRegistered: true } };
  },
});

export const storeLicenseRoutes: RouteDefinition[] = [uploadLicenseRoute, readOwnLicenseRoute, readLicenseAsAdminRoute, cardSetupRoute, cardConfirmRoute];
