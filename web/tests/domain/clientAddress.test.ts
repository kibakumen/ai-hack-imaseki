// 接続元を「数える単位」へ丸める（不具合-04: IPv6 は /64 に丸めて数える）。
// IPv6 の利用者は /64 を丸ごと持つのがふつうで、1つのアドレスごとに数えると末尾を変えるだけで上限が外れる。
import { describe, expect, it } from "vitest";
import { ipCountingUnit } from "../../lib/domain/clientAddress";

describe("ipCountingUnit", () => {
  it("IPv4 はそのまま（前後の空白だけ落とす）", () => {
    expect(ipCountingUnit(" 203.0.113.5 ")).toBe("203.0.113.5");
  });

  it("同じ /64 の IPv6 は、末尾の64ビットが違っても同じ単位になる", () => {
    const a = ipCountingUnit("2001:db8:abcd:12::1");
    const b = ipCountingUnit("2001:0db8:abcd:0012:ffff:ffff:ffff:ffff");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
  });

  it("違う /64 は別の単位になる", () => {
    expect(ipCountingUnit("2001:db8:abcd:13::1")).not.toBe(ipCountingUnit("2001:db8:abcd:12::1"));
  });

  it("省略（::）が先頭・途中・末尾のどこにあっても読む。大文字も小文字へ揃える", () => {
    expect(ipCountingUnit("::1")).toBe("0:0:0:0::/64");
    expect(ipCountingUnit("2001:DB8::")).toBe("2001:db8:0:0::/64");
    expect(ipCountingUnit("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("IPv4 を埋め込んだ IPv6（::ffff:a.b.c.d）は、中の IPv4 として数える", () => {
    expect(ipCountingUnit("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });

  it("読めない値は、そのまま（小文字にして）単位にする——落とさない・まとめない", () => {
    expect(ipCountingUnit("not-an-ip")).toBe("not-an-ip");
    expect(ipCountingUnit("1:2:3")).toBe("1:2:3");
  });
});
