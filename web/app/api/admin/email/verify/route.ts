// 入口 POST /api/admin/email/verify（2026-09-22 追加・メールアドレスの確認。メールを送る口が無ければ 404）と、
// 確認の状態を読む GET /api/admin/email/verify（2026-09-26 追加・運営のアカウントの画面の確認の案内。同じく口が無ければ 404）。
// 中身は書かない——同じ定義を実物の Deps で呼ぶだけ（構造の検査 29.1）。定義の正本は lib/http/endpoints。
import { app } from "../../../../../lib/entry";

// 束縛（D1・R2）と秘密は要求のたびに読む。組み込みのときには無いので、静的に作らせない。
export const dynamic = "force-dynamic";

export const GET = app;
export const POST = app;
