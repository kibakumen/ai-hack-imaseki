// 全部の入口の一覧（設計書「入口（API）の一覧」）。各タスクが自分の入口を lib/http/endpoints/ の
// 中のまとまりに書き、ここへ並べる。app/api/**/route.ts は、ここに在る同じ定義を実物の Deps で
// 呼ぶだけ（defineRoute( を含み、本文を自分で読まない・構造の検査が見張る）。
import type { RouteDefinition } from "./defineRoute";
import { adminStoreRoutes } from "./endpoints/adminStores";
import { authRoutes } from "./endpoints/auth";
import { configRoutes } from "./endpoints/config";
import { couponRoutes } from "./endpoints/coupons";
import { customerRoutes } from "./endpoints/customer";
import { customerProfileRoutes } from "./endpoints/customerProfile";
import { passwordRoutes } from "./endpoints/password";
import { offerRoutes } from "./endpoints/offers";
import { fetchRoutes } from "./endpoints/fetch";
import { storeRoutes } from "./endpoints/store";
import { storeProfileRoutes } from "./endpoints/storeProfile";
import { storeLicenseRoutes } from "./endpoints/storeLicense";
import { adminMetricsRoutes } from "./endpoints/adminMetrics";
import { pushRoutes } from "./endpoints/push";

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  ...adminStoreRoutes,
  ...authRoutes,
  ...configRoutes,
  ...couponRoutes,
  ...customerRoutes,
  ...customerProfileRoutes,
  ...passwordRoutes,
  ...offerRoutes,
  ...fetchRoutes,
  ...storeRoutes,
  ...storeProfileRoutes,
  ...storeLicenseRoutes,
  ...adminMetricsRoutes,
  ...pushRoutes,
];
