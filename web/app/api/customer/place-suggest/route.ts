// 入口 GET /api/customer/place-suggest（設計書「入口（API）の一覧」）。
// 中身は書かない——同じ定義を実物の Deps で呼ぶだけ（構造の検査 29.1）。定義の正本は lib/http/endpoints/customer.ts。
import { app } from "../../../../lib/entry";

// 束縛（D1・R2）と秘密は要求のたびに読む。組み込みのときには無いので、静的に作らせない。
export const dynamic = "force-dynamic";

export const GET = app;
