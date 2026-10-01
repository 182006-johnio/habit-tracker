// スキーマ定義・生成・検証。
//
// フィールド名は CLAUDE.md のデータモデル表と同じ snake_case をそのまま使う。
// エクスポートする JSON もこの名前で出るので、仕様書・コード・ファイルで表記を揃えるため。
//
// 検証関数は例外を投げず { ok, errors } を返す。将来インポートを作るとき、
// 読み込んだ JSON のどこがどう不正かを列挙して見せる必要があるため。

import { isValidISO, nowTimestamp } from './dates.js';

export const SCHEMA_VERSION = 2;

// 2 = ○、1 = △、0 = ×
export const RATING = { SKIP: 0, PARTIAL: 1, DONE: 2 };

const RATING_VALUES = Object.values(RATING);

const IF_THEN_MAX = 60;
const TAG_MAX = 20;

export function createDB() {
  return { schemaVersion: SCHEMA_VERSION, habits: [], logs: [] };
}

export function createHabit({ name, started_on, order, ifThen }) {
  return {
    id: crypto.randomUUID(),
    name: trimText(name),
    started_on,
    order,
    ifThen: normalizeIfThen(ifThen),
  };
}

export function createLog({ habit_id, date, rating, action, blockerTags, blockerNote, fix }) {
  return {
    id: crypto.randomUUID(),
    habit_id,
    date,
    recorded_at: nowTimestamp(),
    rating,
    action: optionalText(action),
    blockerTags: normalizeTags(blockerTags),
    blockerNote: optionalText(blockerNote),
    fix: optionalText(fix),
  };
}

export function normalizeIfThen(ifThen) {
  const source = isPlainObject(ifThen) ? ifThen : {};
  return { trigger: optionalText(source.trigger), action: optionalText(source.action) };
}

// NFKC を先に、trim を後にかける。順序が逆だと全角スペース（U+3000）だけの
// 前後余白が落ちない。
export function normalizeTag(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : value;
}

// 空と重複は落とす。文字列でない値はそのまま残して検証側に判断を渡す。
// 黙って捨てると、不正な入力が検証をすり抜ける。
export function normalizeTags(values) {
  if (!Array.isArray(values)) return values === undefined || values === null ? [] : values;

  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (typeof tag !== 'string') {
      tags.push(tag);
      continue;
    }
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

// 文字列なら前後の空白を落とす。それ以外は加工せず、判断を検証側に渡す。
function trimText(value) {
  return typeof value === 'string' ? value.trim() : value;
}

// action / blockerNote / fix / ifThen は任意項目。未指定は空文字にする。
function optionalText(value) {
  return value === undefined || value === null ? '' : trimText(value);
}

export function validateHabit(habit, path = 'habit') {
  if (!isPlainObject(habit)) {
    return result([`${path}: オブジェクトではありません`]);
  }
  const errors = [];
  if (!isNonEmptyString(habit.id)) errors.push(`${path}.id: 空でない文字列が必要です`);
  if (!isNonEmptyString(habit.name)) errors.push(`${path}.name: 空でない文字列が必要です`);
  if (!isValidISO(habit.started_on)) {
    errors.push(`${path}.started_on: 'YYYY-MM-DD' 形式の実在する日付が必要です`);
  }
  if (!Number.isFinite(habit.order)) errors.push(`${path}.order: 数値が必要です`);

  if (!isPlainObject(habit.ifThen)) {
    errors.push(`${path}.ifThen: オブジェクトが必要です`);
  } else {
    for (const field of ['trigger', 'action']) {
      const value = habit.ifThen[field];
      if (typeof value !== 'string') {
        errors.push(`${path}.ifThen.${field}: 文字列が必要です（空文字は可）`);
      } else if (value.length > IF_THEN_MAX) {
        errors.push(`${path}.ifThen.${field}: ${IF_THEN_MAX} 文字以内にしてください`);
      }
    }
  }
  return result(errors);
}

// date が started_on より前かどうか、未来かどうかは検査しない。
// 判定ロジック側が started_on 以前を対象外と定めているので二重に防ぐ必要がなく、
// 開始日を後から直したときに既存のログが不正扱いになるのも避けたいため。
export function validateLog(log, path = 'log') {
  if (!isPlainObject(log)) {
    return result([`${path}: オブジェクトではありません`]);
  }
  const errors = [];
  if (!isNonEmptyString(log.id)) errors.push(`${path}.id: 空でない文字列が必要です`);
  if (!isNonEmptyString(log.habit_id)) errors.push(`${path}.habit_id: 空でない文字列が必要です`);
  if (!isValidISO(log.date)) {
    errors.push(`${path}.date: 'YYYY-MM-DD' 形式の実在する日付が必要です`);
  }
  if (!isNonEmptyString(log.recorded_at) || Number.isNaN(Date.parse(log.recorded_at))) {
    errors.push(`${path}.recorded_at: 日時として読める文字列が必要です`);
  }
  if (!RATING_VALUES.includes(log.rating)) {
    errors.push(`${path}.rating: ${RATING_VALUES.join(' / ')} のいずれかが必要です`);
  }
  for (const field of ['action', 'blockerNote', 'fix']) {
    if (typeof log[field] !== 'string') {
      errors.push(`${path}.${field}: 文字列が必要です（空文字は可）`);
    }
  }

  if (!Array.isArray(log.blockerTags)) {
    errors.push(`${path}.blockerTags: 配列が必要です`);
  } else {
    const seen = new Set();
    log.blockerTags.forEach((tag, index) => {
      const at = `${path}.blockerTags[${index}]`;
      if (typeof tag !== 'string' || tag === '') {
        errors.push(`${at}: 空でない文字列が必要です`);
        return;
      }
      // 字数超過は切り詰めずエラーにする。黙って削ると書いた本人が気付けない。
      if (tag.length > TAG_MAX) errors.push(`${at}: ${TAG_MAX} 文字以内にしてください`);
      if (seen.has(tag)) errors.push(`${at}: タグが重複しています: ${tag}`);
      seen.add(tag);
    });
  }

  return result(errors);
}

// 保存データを現行スキーマに引き上げる。副作用のない変換で、
// 読み書きは storage.js が受け持つ。
export function migrateDB(db) {
  if (!isPlainObject(db)) return db;

  const habits = Array.isArray(db.habits) ? db.habits.map(migrateHabit) : db.habits;
  const logs = Array.isArray(db.logs) ? db.logs.map(migrateLog) : db.logs;
  return { ...db, schemaVersion: SCHEMA_VERSION, habits, logs };
}

function migrateHabit(habit) {
  if (!isPlainObject(habit)) return habit;
  // archived は廃止。休止中だった習慣も削除せず、通常の習慣として残す。
  const { archived, ...rest } = habit;
  return { ...rest, ifThen: normalizeIfThen(habit.ifThen) };
}

function migrateLog(log) {
  if (!isPlainObject(log)) return log;
  // 旧 blocker の自由記述は blockerNote へ移す。自動でタグには変換しない。
  const { blocker, ...rest } = log;
  return {
    ...rest,
    blockerTags: normalizeTags(log.blockerTags),
    blockerNote: typeof log.blockerNote === 'string' ? log.blockerNote : optionalText(blocker),
  };
}

export function validateDB(db) {
  if (!isPlainObject(db)) {
    return result(['db: オブジェクトではありません']);
  }
  const shape = [];
  if (db.schemaVersion !== SCHEMA_VERSION) {
    shape.push(`db.schemaVersion: ${SCHEMA_VERSION} が必要です（実際: ${String(db.schemaVersion)}）`);
  }
  if (!Array.isArray(db.habits)) shape.push('db.habits: 配列が必要です');
  if (!Array.isArray(db.logs)) shape.push('db.logs: 配列が必要です');
  if (shape.length > 0) return result(shape);

  const errors = [];
  const habitIds = new Set();
  db.habits.forEach((habit, index) => {
    const path = `db.habits[${index}]`;
    errors.push(...validateHabit(habit, path).errors);
    if (!isPlainObject(habit) || !isNonEmptyString(habit.id)) return;
    if (habitIds.has(habit.id)) errors.push(`${path}.id: id が重複しています: ${habit.id}`);
    habitIds.add(habit.id);
  });

  const logIds = new Set();
  const logKeys = new Set();
  db.logs.forEach((log, index) => {
    const path = `db.logs[${index}]`;
    errors.push(...validateLog(log, path).errors);
    if (!isPlainObject(log)) return;
    if (isNonEmptyString(log.id)) {
      if (logIds.has(log.id)) errors.push(`${path}.id: id が重複しています: ${log.id}`);
      logIds.add(log.id);
    }
    if (isNonEmptyString(log.habit_id) && !habitIds.has(log.habit_id)) {
      errors.push(`${path}.habit_id: 存在しない習慣を参照しています: ${log.habit_id}`);
    }
    // (habit_id, date) は一意。1 つの習慣につき 1 日 1 件。
    const key = JSON.stringify([log.habit_id, log.date]);
    if (logKeys.has(key)) {
      errors.push(`${path}: (habit_id, date) が重複しています: ${log.habit_id} / ${log.date}`);
    }
    logKeys.add(key);
  });

  return result(errors);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}
