#!/usr/bin/env bash
# v2 の鍵と Cloudflare の資源を用意する（本人が自分の端末で実行する。Claude Code の `!` 経由では実行しない——
# 入力した鍵が会話に残るため）。
#
# 使い方:
#   scripts/v2-keys.sh check            いまの状態を見る（値は1文字も出さない。名前と有無だけ）
#   scripts/v2-keys.sh cloudflare       D1 と R2 のバケットを作る（在れば何もしない）
#   scripts/v2-keys.sh put <名前>       鍵を1つ入れる（入力は画面に出ない）。手元の web/.dev.vars と Cloudflare の両方へ
#   scripts/v2-keys.sh all              入っていない鍵を順に聞く
#   scripts/v2-keys.sh vapid            Web プッシュの鍵の組を作って入れる（秘密の側だけ秘密にする）
#   scripts/v2-keys.sh push             手元の web/.dev.vars の中身を Cloudflare の Worker の秘密へまとめて送る
#
# 名前は設計書（docs/specs/v2/design.md の「秘密情報と個人データの扱い」）のとおり。
# Worker・D1・R2 の名前は設計書に決めが無いので、ここの既定が最初の決め（AI判断・2026-09-21）。
# 変えるときは環境変数で上書きし、web/wrangler.jsonc と同じ名前にする。
set -euo pipefail

WORKER="${V2_WORKER:-ai-hack-v2}"
D1_NAME="${V2_D1:-ai-hack-v2}"
R2_BUCKET="${V2_R2:-ai-hack-v2-permits}"

# 秘密にするもの（Worker の秘密 ＝ wrangler secret）
SECRET_NAMES=(ORCAROUTER_API_KEY GOOGLE_MAPS_API_KEY STRIPE_SECRET_KEY TURNSTILE_SECRET_KEY VAPID_PRIVATE_KEY ADMIN_CONTACT_EMAIL)
# 鍵の形の目安（打ち間違いに気づくための緩い確かめ。合わなくても止めず、確かめを求めるだけ）
declare -A HINT=(
  [ORCAROUTER_API_KEY]="OrcaRouter の管理画面の API キー"
  [GOOGLE_MAPS_API_KEY]="Google Cloud の API キー（AIza で始まる39字）"
  [STRIPE_SECRET_KEY]="Stripe のテスト用のシークレットキー（sk_test_ で始まる）"
  [TURNSTILE_SECRET_KEY]="Cloudflare Turnstile のシークレットキー（0x で始まる）"
  [VAPID_PRIVATE_KEY]="Web プッシュの秘密の鍵（vapid で作るのが楽）"
  [ADMIN_CONTACT_EMAIL]="運営の連絡先のメールアドレス（最終日の機能で使う。後でよい）"
)
declare -A SHAPE=(
  [GOOGLE_MAPS_API_KEY]='^AIza[0-9A-Za-z_-]{35}$'
  [STRIPE_SECRET_KEY]='^(sk|rk)_test_[0-9A-Za-z]+$'
  [TURNSTILE_SECRET_KEY]='^(0x|1x|2x|3x)[0-9A-Za-z_-]+$'
  [ADMIN_CONTACT_EMAIL]='^[^@[:space:]]+@[^@[:space:]]+$'
)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_VARS="$ROOT/web/.dev.vars"

# 非対話のシェルでは node が PATH に居ないことがあるので nvm を読む
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
wr() { pnpm dlx wrangler@4 "$@"; }

die() { echo "✖ $*" >&2; exit 1; }
known() { local n; for n in "${SECRET_NAMES[@]}"; do [ "$n" = "$1" ] && return 0; done; return 1; }

has_local() { [ -f "$DEV_VARS" ] && grep -q "^$1=" "$DEV_VARS"; }

# web/.dev.vars の1行を置き換える（値は引数でなく標準入力で受ける＝ps に出さない）
write_local() {
  local name="$1" value; value="$(cat)"
  mkdir -p "$(dirname "$DEV_VARS")"
  touch "$DEV_VARS"; chmod 600 "$DEV_VARS"
  git -C "$ROOT" check-ignore -q "$DEV_VARS" || die "web/.dev.vars が git の対象外になっていません（.gitignore を確かめる）。書き込みを止めました"
  local tmp; tmp="$(mktemp "$DEV_VARS.XXXXXX")"; chmod 600 "$tmp"
  grep -v "^$name=" "$DEV_VARS" >"$tmp" || true
  printf '%s="%s"\n' "$name" "$value" >>"$tmp"
  mv "$tmp" "$DEV_VARS"
}

put_remote() {
  local name="$1"
  if cat | wr secret put "$name" --name "$WORKER" >/dev/null 2>"$ROOT/.dev/v2-keys.err"; then
    echo "  ✔ Cloudflare（Worker: $WORKER）へ入れました"
  else
    echo "  ⚠ Cloudflare へは入りませんでした（Worker がまだ無い・未ログイン など）。手元には入っています。"
    echo "    最初のデプロイのあとで  scripts/v2-keys.sh push  を実行してください。理由: $ROOT/.dev/v2-keys.err"
  fi
}

cmd_put() {
  local name="${1:-}"; known "$name" || die "名前が違います。使える名前: ${SECRET_NAMES[*]}"
  echo "▶ $name — ${HINT[$name]}"
  local value=""; read -r -s -p "  値を貼り付けて Enter（画面には出ません）: " value; echo
  [ -n "$value" ] || die "空です。何もしませんでした"
  if [ -n "${SHAPE[$name]:-}" ] && ! [[ "$value" =~ ${SHAPE[$name]} ]]; then
    read -r -p "  ⚠ 形が目安と違います（${HINT[$name]}）。このまま入れますか？ [y/N] " yn
    [[ "$yn" =~ ^[yY]$ ]] || die "やめました"
  fi
  mkdir -p "$ROOT/.dev"
  printf '%s' "$value" | write_local "$name"
  echo "  ✔ 手元（web/.dev.vars）へ入れました"
  printf '%s' "$value" | put_remote "$name"
  unset value
}

cmd_all() {
  local n
  for n in "${SECRET_NAMES[@]}"; do
    [ "$n" = VAPID_PRIVATE_KEY ] && continue   # vapid で作る
    if has_local "$n"; then echo "— $n は手元に入っています（入れ直すなら put $n）"; else cmd_put "$n"; fi
  done
  has_local VAPID_PRIVATE_KEY || echo "— VAPID_PRIVATE_KEY はまだです:  scripts/v2-keys.sh vapid"
}

cmd_vapid() {
  has_local VAPID_PRIVATE_KEY && { read -r -p "VAPID の鍵は手元に在ります。作り直すと、通知を許可済みの端末へ届かなくなります。作り直しますか？ [y/N] " yn; [[ "$yn" =~ ^[yY]$ ]] || exit 0; }
  mkdir -p "$ROOT/.dev"
  local json pub priv
  json="$(pnpm dlx web-push@3 generate-vapid-keys --json 2>/dev/null)" || die "web-push を動かせませんでした"
  pub="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).publicKey))')"
  priv="$(printf '%s' "$json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).privateKey))')"
  printf '%s' "$priv" | write_local VAPID_PRIVATE_KEY
  printf '%s' "$priv" | put_remote VAPID_PRIVATE_KEY
  unset priv json
  echo "  ✔ 秘密の側を入れました。公開してよい側（ブラウザへ渡す値）はこれです:"
  echo "    VAPID_PUBLIC_KEY=$pub"
  echo "    → 実装の骨組みのタスクで web/wrangler.jsonc の vars に書く値です（秘密ではありません）"
}

cmd_push() {
  [ -f "$DEV_VARS" ] || die "web/.dev.vars がありません"
  # .dev.vars を JSON にして標準入力で渡す（ファイルを作らない）
  node -e '
    const fs=require("fs"); const out={};
    for (const line of fs.readFileSync(process.argv[1],"utf8").split("\n")) {
      const m=line.match(/^([A-Z0-9_]+)="?(.*?)"?$/); if (m) out[m[1]]=m[2];
    }
    process.stdout.write(JSON.stringify(out));
  ' "$DEV_VARS" | wr secret bulk --name "$WORKER"
}

cmd_cloudflare() {
  wr whoami >/dev/null 2>&1 || die "Cloudflare に未ログインです:  pnpm dlx wrangler@4 login"
  if wr d1 list --json 2>/dev/null | grep -q "\"name\": *\"$D1_NAME\""; then
    echo "— D1 $D1_NAME は在ります"
  else
    echo "▶ D1 を作ります: $D1_NAME"; wr d1 create "$D1_NAME"
  fi
  echo "  database_id を見る:  pnpm dlx wrangler@4 d1 list   （web/wrangler.jsonc の d1_databases に書く値。秘密ではありません）"
  if wr r2 bucket list 2>/dev/null | grep -q "$R2_BUCKET"; then
    echo "— R2 のバケット $R2_BUCKET は在ります"
  else
    echo "▶ R2 のバケットを作ります: $R2_BUCKET"
    wr r2 bucket create "$R2_BUCKET" || echo "  ⚠ 作れませんでした。R2 をまだ有効にしていなければ、管理画面の R2 で有効にしてから（支払い方法の登録が要ります）もう一度。"
  fi
}

cmd_check() {
  echo "Worker: $WORKER ／ D1: $D1_NAME ／ R2: $R2_BUCKET"
  echo "[手元 web/.dev.vars]"
  local n; for n in "${SECRET_NAMES[@]}"; do has_local "$n" && echo "  ✔ $n" || echo "  ・ $n（未）"; done
  [ -f "$DEV_VARS" ] && { git -C "$ROOT" check-ignore -q "$DEV_VARS" && echo "  ✔ git の対象外" || echo "  ✖ git の対象外になっていない"; }
  echo "[Cloudflare]"
  if wr whoami >/dev/null 2>&1; then
    echo "  ✔ ログイン済み"
    wr secret list --name "$WORKER" 2>/dev/null | grep -o '"name": *"[A-Z0-9_]*"' | sed 's/.*"\([A-Z0-9_]*\)"$/  ✔ 秘密 \1/' || true
    wr secret list --name "$WORKER" >/dev/null 2>&1 || echo "  ・ Worker $WORKER はまだありません（最初のデプロイのあとで push）"
  else
    echo "  ・ 未ログイン:  pnpm dlx wrangler@4 login"
  fi
}

case "${1:-}" in
  check) cmd_check ;;
  cloudflare) cmd_cloudflare ;;
  put) shift; cmd_put "$@" ;;
  all) cmd_all ;;
  vapid) cmd_vapid ;;
  push) cmd_push ;;
  *) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
