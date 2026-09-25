// 接続元（Cloudflare の cf-connecting-ip）を、連打の抑止が「数える単位」へ丸める（2026-09-25 監査の指摘 不具合-04）。
// lib/domain は自分だけを読む（依存の向き）。
//
// IPv6 の利用者は /64 をまるごと1つ持つのがふつうで、アドレス1つずつで数えると、末尾の64ビットを
// 変えるだけで上限が外れる。だから IPv6 は /64（先頭の4つの区切り）で数える。IPv4 はそのまま。

const IPV6_GROUPS = 8;
const PREFIX_GROUPS = 4;
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/** `a:b::c` を8つの区切りへ広げる。形が合わなければ null。 */
const expandIpv6 = (address: string): string[] | null => {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];
  const missing = IPV6_GROUPS - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => "0"), ...tail];
  return groups.every((group) => HEX_GROUP.test(group)) ? groups : null;
};

/**
 * 数える単位。IPv4 はそのまま、IPv6 は `<先頭4区切り>::/64`、IPv4 を埋め込んだ IPv6 は中の IPv4。
 * 読めない値はそのまま（小文字）を返す——落とす（数えない）と上限が外れ、1つへまとめると無関係な人が数を分け合う。
 */
export const ipCountingUnit = (ip: string): string => {
  const address = ip.trim().toLowerCase().replace(/%.*$/, "");
  if (!address.includes(":")) return address;
  const mapped = MAPPED_IPV4.exec(address);
  if (mapped) return mapped[1];
  const groups = expandIpv6(address);
  if (!groups) return address;
  return `${groups
    .slice(0, PREFIX_GROUPS)
    .map((group) => parseInt(group, 16).toString(16))
    .join(":")}::/64`;
};
