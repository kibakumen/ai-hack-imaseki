// 事業者の表記（2026-09-26 本人選択（AI提示））。/privacy と2つの利用規約が同じ正本（lib/domain/texts の OPERATOR_IDENTITY）を出す。
// 公開の歯止め（scripts/deploy-guard.mjs）は、3つのページがこの部品を使っていることと、正本が埋まっていることを確かめる。
import { operatorIdentityText } from "../../lib/domain/texts";

export const OperatorIdentity = () => <span data-testid="operator-identity">{`事業者: ${operatorIdentityText()}`}</span>;
