// 「〜したら → 〜する」の組み立て。
//
// 編集画面のプレビューと、記録画面の見出し下の表示で同じものを使う。
// DOM を触らないので、テストから直接呼べる。

export function formatIfThen(ifThen) {
  const trigger = (ifThen?.trigger ?? '').trim();
  const action = (ifThen?.action ?? '').trim();
  // 両方空なら何も出さない。片方だけなら、入っているほうを出す。
  if (trigger === '' && action === '') return null;
  return { trigger, action };
}
