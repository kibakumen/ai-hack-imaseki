// 実物の差し替え口を1つに束ねる場所（設計書「ファイル構成の計画」の図の Deps）。
// 手続き `lib/usecases` と入口 `lib/http` は `lib/ports.ts` の型しか知らないので、
// 「どの実物を使うか」を決めるのはここだけ。外のサービスを替えるときも、触るのは
// `lib/adapters/` の1ファイルとこの組み立てだけで済む（設計書「撤退しやすさ」）。

import type { Deps } from "../ports";
import { createClock } from "./clock";
import { readBindings, readEnv, type RawEnv } from "./env";
import { createFileStore } from "./files";
import { createGeocoder } from "./geocoding";
import { createLogger } from "./logger";
import { createOrcaRouterSelector } from "./orcarouter";
import { createCardRegistrar } from "./stripe";
import { createHumanCheck } from "./turnstile";
import { createHasher, createRng } from "./webcrypto";
import { createPushSender } from "./webpush";

/**
 * Worker の束縛から実物の Deps を組む。
 *
 * ⚠️ 束縛が無いときは黙って倒さずに投げる（fail-loud）——D1 が無いまま走らせると、
 * 全部の入口が「中で落ちた」だけの応答になり、原因が公開先の設定だと分からなくなる。
 */
export const createDeps = (env: RawEnv): Deps => {
  const { config, secrets } = readEnv(env);
  const { db, permits } = readBindings(env);
  if (!db) throw new Error("D1 の束縛 DB が見つかりません（web/wrangler.jsonc の d1_databases）");
  if (!permits) throw new Error("R2 の束縛 PERMITS が見つかりません（web/wrangler.jsonc の r2_buckets）");

  return {
    db,
    files: createFileStore(permits),
    ai: createOrcaRouterSelector({ apiKey: secrets.orcarouterApiKey, model: config.orcarouterModel }),
    geocoder: createGeocoder({ apiKey: secrets.googleMapsApiKey }),
    push: createPushSender({ publicKey: config.vapidPublicKey, privateKey: secrets.vapidPrivateKey, contactEmail: config.contactEmail }),
    card: createCardRegistrar({ secretKey: secrets.stripeSecretKey }),
    human: createHumanCheck({ secretKey: secrets.turnstileSecretKey }),
    logger: createLogger(),
    clock: createClock(),
    rng: createRng(),
    hasher: createHasher(),
    config,
  };
};
