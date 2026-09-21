// クーポンの画面（設計書「店の画面」の下のナビの「クーポン」）。
// ⚠️ 2026-09-22 に足した——店のホームが `/store/coupons` を指しているのに、この道が無かった。
import { StoreNav } from "../../../components/store/StoreNav";
import { CouponEditor } from "../../../components/store/CouponEditor";

export default function StoreCouponsPage() {
  return (
    <main className="store-main">
      <StoreNav active="coupons" />
      <CouponEditor />
    </main>
  );
}
