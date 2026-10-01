// 達成度を付ける／取り消す。ホームのカードと記録画面で同じ扱いにする。
//
// 書き写すと片方だけ直す事故が起きる。とくに「二度押しで取り消し、テキストが
// 入っていれば確認」は、間違えると記録を黙って消す側に倒れる。

import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';

// 戻り値は更新後のログ（取り消した場合は null）。
// 変更しなかった場合は渡された log をそのまま返す。
//
// fields を渡すと、その内容でテキストを上書きする（記録画面で入力中の値を
// 引き継ぐため）。渡さなければ既存のログの内容を保つ。
export async function setRating({ habit, date, rating, log, fields = null }) {
  if (log !== null && log.rating === rating) {
    const texts = fields ?? log;
    const hasText = ['action', 'blockerNote', 'fix'].some((key) => (texts[key] ?? '').trim() !== '')
      || (log.blockerTags?.length ?? 0) > 0;

    if (hasText && !(await askConfirm('記入したテキストも一緒に消えます。この日の記録を消しますか？'))) {
      return log;
    }
    await storage.deleteLog(habit.id, date);
    return null;
  }

  // 表示中のテキストとタグは引き継ぐ。達成度だけ差し替える形にする。
  return storage.putLog({
    habit_id: habit.id,
    date,
    rating,
    action: fields?.action ?? log?.action ?? '',
    blockerNote: fields?.blockerNote ?? log?.blockerNote ?? '',
    fix: fields?.fix ?? log?.fix ?? '',
    blockerTags: log?.blockerTags ?? [],
  });
}
