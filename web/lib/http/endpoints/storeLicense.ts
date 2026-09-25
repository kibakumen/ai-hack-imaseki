// 営業許可書とカードの入口（要件13の基準 13.1〜13.6・13.8・13.9）。
// 読む入口は2つ（上げた店・運営）だけで、どちらも同じ手続き `readLicense` を通る（基準 13.5）。
// URL を知っているだけでは読めない——見分けは defineRoute が済ませ、店の入口は自分の店しか指せない。

import { confirmCardSetup, startCardSetup } from "../../usecases/card";
import { readLicense, readLicenseAsAdmin, uploadLicense, withdrawLicense, type LicenseContent } from "../../usecases/license";
import { adminLicenseQuerySchema } from "../../schemas/admin";
import { cardConfirmSchema, licenseUploadSchema } from "../../schemas/documents";
import { LICENSE_UPLOAD_MAX_BODY_BYTES } from "../../schemas/limits";
import { respond } from "../respond";
import { defineRoute, type RouteDefinition, type RouteHandlerResult } from "../defineRoute";
import { notFound, refusal, stateConflict } from "../refusals";

/**
 * 店が戻ってくる先（外のカードの画面から）。要求そのものの URL を起点にする（環境ごとに書き分けない）。
 * 戻ったことだけを印（`card=returned`）で伝え、番号は載せない——書類の画面はこの印を見て確かめを送り、
 * 確かめの入口はサーバーが控えた番号を照会する（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）。
 */
const CARD_RETURN_PATH = "/store/documents?card=returned";

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

const uploadLicenseRoute = defineRoute({
  method: "POST",
  path: "/api/store/license",
  auth: "store",
  input: licenseUploadSchema,
  // ファイルを受け取る唯一の入口。10MB のファイルが multipart の包みごと入る大きさまで広げる（安全-13）。
  maxBodyBytes: LICENSE_UPLOAD_MAX_BODY_BYTES,
  handler: async ({ input, deps, ctx }) => {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const result = await uploadLicense(deps, ctx.storeId, { bytes, declaredSize: input.file.size });
    if (!result.ok) {
      const reason = result.kind === "file_too_large" ? "too_long" : "not_allowed";
      return refusal(result.kind, { fields: [{ name: "file", reason }] });
    }
    return respond("POST /api/store/license", { ok: true });
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

/**
 * 承認の前の店が、自分の許可書を消す（2026-09-25 監査の指摘 安全-20）。承認済みの店は 409 で今の状況を返して断る
 * （承認の根拠なので店からは消せない。退会は運営への連絡で受け、運営が止めると消える）。
 */
const withdrawLicenseRoute = defineRoute({
  method: "DELETE",
  path: "/api/store/license",
  auth: "store",
  handler: async ({ deps, ctx }) => {
    const result = await withdrawLicense(deps, ctx.storeId);
    if (result.ok) return respond("DELETE /api/store/license", { ok: true });
    if (result.kind === "not_found") return notFound();
    return stateConflict(result.state);
  },
});

/**
 * 運営が許可書を開く。`?version=approved` なら承認した時点の写し（2026-09-25 監査の指摘 運営-02）。
 * 開いたことは「誰が・いつ」つきで記録に残す（個人が特定できる書類なので・運営-01）。
 */
const readLicenseAsAdminRoute = defineRoute({
  method: "GET",
  path: "/api/admin/stores/:id/license",
  auth: "admin",
  input: adminLicenseQuerySchema,
  handler: async ({ params, input, deps, ctx }) => {
    const file = await readLicenseAsAdmin(deps, params.id, { accountId: ctx.accountId }, input.version ?? "current");
    return file ? licenseResponse(file) : notFound();
  },
});

const cardSetupRoute = defineRoute({
  method: "POST",
  path: "/api/store/card/setup",
  auth: "store",
  handler: async ({ req, deps, ctx }) => {
    const returnUrl = new URL(CARD_RETURN_PATH, req.url).toString();
    const result = await startCardSetup(deps, ctx.storeId, returnUrl);
    if (!result.ok) return refusal("card_setup_failed");
    return respond("POST /api/store/card/setup", { ok: true, url: result.url });
  },
});

const cardConfirmRoute = defineRoute({
  method: "POST",
  path: "/api/store/card/confirm",
  auth: "store",
  input: cardConfirmSchema,
  handler: async ({ deps, ctx }) => {
    const result = await confirmCardSetup(deps, ctx.storeId);
    if (!result.ok) return refusal("card_setup_failed");
    // 応答に在るのは登録済みかどうかだけ（基準 13.8。受け皿の番号も外の識別子も返さない）。
    return respond("POST /api/store/card/confirm", { ok: true, cardRegistered: true });
  },
});

export const storeLicenseRoutes: RouteDefinition[] = [uploadLicenseRoute, readOwnLicenseRoute, withdrawLicenseRoute, readLicenseAsAdminRoute, cardSetupRoute, cardConfirmRoute];
