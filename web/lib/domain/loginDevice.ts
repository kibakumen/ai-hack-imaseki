// ログインの数えと端末の印に共通の、小さな決まり（2026-09-25 のレビュー・安全-10 の続き）。
// 連打の抑止（http/rateLimits）と、端末の印を書く手続き（usecases/login）と、それを置く repo が
// 同じ形でメールアドレスと印を扱うための、ただ1つの置き場。

/**
 * 数えの鍵に使うメールアドレス。前後の空白を落として小文字へ揃える——大文字の別名で数を分けられると、
 * 抑止そのものが無いのと同じになる。accounts の email は大小を区別しない一意（`COLLATE NOCASE UNIQUE`・
 * migrations/0001）なので、大小だけが違う2つのアカウントは作れず、揃えても別のアカウントの数に混ざることはない
 * （2026-09-25 の監査の直しで、「大小を区別する」と逆に書いていた注を直した・設計-12）。
 */
export const normalizeLoginEmail = (email: string): string => email.trim().toLowerCase();

/** 端末の印の形（16バイトの base64url＝22字）。形の違う値は印として扱わない（表に変な鍵を作らない）。 */
const LOGIN_DEVICE_SHAPE = /^[A-Za-z0-9_-]{22}$/;

export const isLoginDeviceValue = (value: string | null | undefined): value is string => typeof value === "string" && LOGIN_DEVICE_SHAPE.test(value);
