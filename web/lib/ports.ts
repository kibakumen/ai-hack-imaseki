// 差し替え口の型（設計書「ファイル構成の計画」: lib/ports.ts）。手続き lib/usecases と入口
// lib/http/defineRoute はこの型だけを知って呼ぶ。実物は lib/adapters（この型を満たす）。
// 受け入れ検査の契約は tests/acceptance/v2/_types.ts（この型と同じ形に合わせてある）。

export type Clock = { now(): Date; after(ms: number): Promise<void> };
export type Rng = { bytes(n: number): Uint8Array };
export type Hasher = {
  sha256Hex(input: string): Promise<string>;
  derive(password: string, saltB64: string, iterations: number): Promise<string>;
};
export type Logger = { log(entry: { event: string; id?: string | number; durationMs?: number; errorKind?: string }): void };

export type AiSelectInput = {
  party: number;
  genres: string[];
  budgetMax: number | null;
  stores: Array<{ id: string; genres: string[]; menus: string[]; budgetMin: number; budgetMax: number }>;
};
export type AiSelectResult =
  | { ok: true; text: string; costUsd: number | null; resolvedModel?: string | null; requestId?: string | null; fallbackLevel?: number | null }
  | { ok: false; error: string; costUsd?: number | null };
export type AiSelector = { select(input: AiSelectInput, opts: { signal?: AbortSignal }): Promise<AiSelectResult> };

export type Geocoder = {
  geocode(text: string, opts: { signal?: AbortSignal }): Promise<{ ok: true; lat: number; lng: number } | { ok: false }>;
};
export type PushSender = { send(subscription: unknown, opts: { ttlSeconds: number }): Promise<{ ok: true } | { ok: false; gone: boolean }> };
export type CardRegistrar = {
  createSetupSession(input: { storeId: string; returnUrl: string }): Promise<{ ok: true; url: string; sessionId: string } | { ok: false }>;
  confirmSetup(sessionId: string): Promise<{ ok: true; clientReference: string } | { ok: false }>;
};
export type HumanCheck = { verify(token: string | null, opts: { signal?: AbortSignal }): Promise<{ ok: true; human: boolean } | { ok: false }> };
export type FileStore = {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
};
export type AppConfig = { turnstileSiteKey: string; vapidPublicKey: string; contactEmail: string | null; orcarouterModel: string };

export type Deps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- D1Database（wrangler の getPlatformProxy／実物の Worker 束縛）。型は各アダプタ・repo が持つ
  db: any;
  files: FileStore;
  ai: AiSelector;
  geocoder: Geocoder;
  push: PushSender;
  card: CardRegistrar;
  human: HumanCheck;
  logger: Logger;
  clock: Clock;
  rng: Rng;
  hasher: Hasher;
  config: AppConfig;
};
