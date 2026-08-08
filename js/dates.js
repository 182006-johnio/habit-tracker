// 日付ユーティリティ。
//
// 日付の正準表現は 'YYYY-MM-DD' のローカル日付文字列で、Date はこのモジュールの中の
// 計算にだけ使う。この形式は辞書順が日付順と一致するので、比較とソートは文字列のまま行える。

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Date を 'YYYY-MM-DD' にする。
// toISOString() は UTC を返すので使わない。JST の朝 9 時より前に呼ぶと前日の日付になる。
function toISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 'YYYY-MM-DD' をローカル正午の Date にする。
// 0 時ではなく正午を起点にするのは、夏時間のある地域で加減算が 1 日ずれないようにするため。
function fromISO(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setFullYear(year); // 0〜99 年が 1900 年代に丸められるのを防ぐ
  return date;
}

function requireISO(iso) {
  if (!isValidISO(iso)) {
    throw new TypeError(`日付が 'YYYY-MM-DD' 形式の実在する日付ではありません: ${String(iso)}`);
  }
  return iso;
}

// 端末のローカルタイムでの今日。基準時刻は 0 時。
export function todayISO() {
  return toISO(new Date());
}

export function isValidISO(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = fromISO(value);
  // 2026-02-30 のような日付は Date が翌月へ繰り上げるので、往復させて一致を見る。
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function addDays(iso, days) {
  if (!Number.isInteger(days)) {
    throw new TypeError(`日数には整数を渡してください: ${String(days)}`);
  }
  const date = fromISO(requireISO(iso));
  date.setDate(date.getDate() + days);
  return toISO(date);
}

// from から to までの日数。to が過去なら負の数になる。
export function diffDays(from, to) {
  const start = fromISO(requireISO(from));
  const end = fromISO(requireISO(to));
  return Math.round((end - start) / MS_PER_DAY);
}

// recorded_at 用。対象日 (date) と違って判定に使わない値なので、曖昧さのない UTC で持つ。
export function nowTimestamp() {
  return new Date().toISOString();
}
