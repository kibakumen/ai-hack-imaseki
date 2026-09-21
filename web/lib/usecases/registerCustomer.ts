// 客の登録（要件1の基準 1.1・要件2の基準 2.1・2.2）。識別子を求めずに登録を1件作り、
// 客の識別子を1つ発行する。乱数は差し替え口 Rng、SHA-256 は差し替え口 Hasher から受け取る
// （crypto を呼ぶのは lib/adapters だけ・依存の向き）。Cookie に載せるのは呼び出し元の入口の仕事。

import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { insertCustomer } from "../repo/customers";
import type { CustomerRegisterInput } from "../schemas/customer";
import { ID_BYTES, TOKEN_BYTES } from "../schemas/limits";

export type RegisteredCustomer = {
  /** 記録と通報が客を指す内部の番号（設計書「客の識別子」） */
  customerId: string;
  /** 客の端末に配る値。D1 にはこの SHA-256 しか残らない */
  token: string;
};

export const registerCustomer = async (deps: Deps, input: CustomerRegisterInput): Promise<RegisteredCustomer> => {
  const token = tokenFromBytes(deps.rng.bytes(TOKEN_BYTES));
  const customerId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const tokenHash = await deps.hasher.sha256Hex(token);
  await insertCustomer(deps.db, {
    id: customerId,
    nickname: input.nickname,
    phone: input.phone,
    genres: JSON.stringify(input.genres),
    budgetMax: input.budgetMax ?? null,
    tokenHash,
  });
  return { customerId, token };
};
