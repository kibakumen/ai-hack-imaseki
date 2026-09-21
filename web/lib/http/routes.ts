// 全部の入口の一覧（設計書「入口（API）の一覧」）。各タスクが自分の入口の defineRoute(...) の
// 結果をここへ足す。app/api/**/route.ts は、ここに在る同じ定義を実物の Deps で呼ぶだけ
// （defineRoute( を含み、本文を自分で読まない・構造の検査が見張る）。
import type { RouteDefinition } from "./defineRoute";

export const ROUTE_DEFINITIONS: RouteDefinition[] = [];
