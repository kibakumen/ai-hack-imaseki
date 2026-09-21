// 全部の入口の一覧（設計書「入口（API）の一覧」）。各タスクが自分の入口を lib/http/endpoints/ の
// 中のまとまりに書き、ここへ並べる。app/api/**/route.ts は、ここに在る同じ定義を実物の Deps で
// 呼ぶだけ（defineRoute( を含み、本文を自分で読まない・構造の検査が見張る）。
import type { RouteDefinition } from "./defineRoute";
import { authRoutes } from "./endpoints/auth";
import { configRoutes } from "./endpoints/config";
import { customerRoutes } from "./endpoints/customer";
import { customerProfileRoutes } from "./endpoints/customerProfile";
import { passwordRoutes } from "./endpoints/password";
import { storeRoutes } from "./endpoints/store";

export const ROUTE_DEFINITIONS: RouteDefinition[] = [...configRoutes, ...customerRoutes, ...authRoutes, ...storeRoutes, ...customerProfileRoutes, ...passwordRoutes];
