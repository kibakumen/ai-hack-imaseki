// 手元のスクリプトから web/lib の TypeScript をそのまま読むための、最小の読み込み補助。
// Node は .ts の型を自分で外せる（24 系）が、拡張子を省いた相対の import は解決できないので、
// 解決に失敗した相対の指定にだけ .ts を足して読み直す。手元でしか走らない（Worker には載らない）。

export const resolve = async (specifier, context, nextResolve) => {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".")) throw error;
    return nextResolve(`${specifier}.ts`, context);
  }
};
