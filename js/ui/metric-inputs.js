// 記録項目の入力欄。記録画面に埋め込む。
//
// 出すのは使用中の項目だけ。使用終了の項目は入力欄に出さないが、その日のログに
// 値が入っていれば read() の結果にそのまま残す。過去の日を開いて保存し直しただけで、
// 見えていない値が消えるのを防ぐ。
//
// 未入力（空欄）と 0 は別物。空欄の項目は values にキーを持たせない。

import { METRIC_KIND } from '../schema.js';

const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

export function createMetricInputs(metrics, values = {}) {
  const active = metrics.filter((metric) => metric.active);
  const activeIds = new Set(active.map((metric) => metric.id));

  // 入力欄に出ていない項目の値。触らずに持ち回る。
  const untouched = Object.fromEntries(
    Object.entries(values).filter(([id]) => !activeIds.has(id)),
  );

  const inputs = active.map((metric) => ({ metric, input: buildInput(metric, values[metric.id]) }));

  return {
    // 使用中の項目が無ければ null。呼び出し側はまとまりごと出さない。
    element: active.length === 0 ? null : buildBlock(inputs),

    // { ok: true, values } か { ok: false, message }。
    read() {
      const result = { ...untouched };
      for (const { metric, input } of inputs) {
        const parsed = parse(metric, input.value);
        if (parsed === INVALID) {
          return { ok: false, message: `「${metric.label}」には 0 以上の数値を入れてください。` };
        }
        if (parsed !== null) result[metric.id] = parsed;
      }
      return { ok: true, values: result };
    },
  };
}

const INVALID = Symbol('invalid');

// 空欄は null（未入力）。読めない入力は INVALID。
function parse(metric, raw) {
  if (metric.kind === METRIC_KIND.TIME) {
    // 時刻ピッカーの値は 'HH:MM'。秒が付く環境に備えて先頭 5 文字だけ使う。
    return raw === '' ? null : raw.slice(0, 5);
  }

  // 全角数字や全角の小数点で打っても受け取る。
  const text = raw.normalize('NFKC').trim();
  if (text === '') return null;
  return PLAIN_NUMBER.test(text) ? Number(text) : INVALID;
}

function buildBlock(inputs) {
  const block = element('section', 'block');
  block.append(element('h2', 'block-title', '今日の記録'));

  const list = element('div', 'metric-inputs');
  for (const { metric, input } of inputs) {
    const row = element('label', 'metric-input-row');
    row.append(element('span', 'metric-input-name', metric.label));

    const field = element('span', 'metric-input-field');
    field.append(input);
    if (metric.kind === METRIC_KIND.NUMBER && metric.unit !== '') {
      field.append(element('span', 'metric-input-unit', metric.unit));
    }
    row.append(field);
    list.append(row);
  }
  block.append(list);
  return block;
}

function buildInput(metric, value) {
  const input = element('input', 'text-input metric-input');
  input.autocomplete = 'off';

  if (metric.kind === METRIC_KIND.TIME) {
    input.type = 'time';
    input.value = typeof value === 'string' ? value : '';
  } else {
    // type="number" は iOS で小数点の出ないテンキーになることがあり、読めない入力を
    // 空文字として返すので未入力と区別できない。text + inputmode にして自分で読む。
    input.type = 'text';
    input.inputMode = 'decimal';
    input.placeholder = '未入力';
    input.value = typeof value === 'number' ? String(value) : '';
  }
  return input;
}

// 項目名はユーザーが打った文字なので、中身は必ず textContent で入れる。
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}
