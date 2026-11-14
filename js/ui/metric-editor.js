// 記録項目の編集欄。習慣の編集画面に埋め込む。
//
// ここでの追加・削除・使用終了は画面の中だけの変更で、保存はしない。
// 編集画面が「保存」のときに values() を取り出して、習慣ごと保存する。
//
// 値を持つログがある項目（usedIds）は、削除も種類の変更もできない。過去の値が
// 宙に浮くため。storage 側でも拒否するが、押せるのに弾かれる形にはしない。

import { METRIC_KIND } from '../schema.js';

const KIND_LABELS = [
  [METRIC_KIND.NUMBER, '数値'],
  [METRIC_KIND.TIME, '時刻'],
];

export function createMetricEditor(container, metrics, usedIds) {
  // 画面上の行。id が null の行は、まだ保存していない新しい項目。
  const rows = metrics.map((metric) => ({ ...metric, used: usedIds.has(metric.id) }));

  const activeList = element('div', 'metric-list');
  const addButton = element('button', 'metric-add', '項目を追加');
  addButton.type = 'button';
  const retiredBlock = element('div', 'metric-retired-block');

  addButton.addEventListener('click', () => {
    const row = { id: null, label: '', kind: METRIC_KIND.NUMBER, unit: '', active: true, used: false };
    rows.push(row);
    render();
    activeList.lastElementChild?.querySelector('.metric-label')?.focus();
  });

  container.replaceChildren(activeList, addButton, retiredBlock);
  render();

  // 行の増減や使用終了の切り替えのときだけ描き直す。文字を打つたびに描き直すと
  // 入力中の欄からフォーカスが外れる。
  function render() {
    const active = rows.filter((row) => row.active);
    const retired = rows.filter((row) => !row.active);

    activeList.replaceChildren(...active.map(activeRow));
    if (active.length === 0) {
      activeList.append(element('p', 'metric-empty', 'まだ項目がありません。'));
    }

    retiredBlock.hidden = retired.length === 0;
    retiredBlock.replaceChildren(
      element('p', 'metric-retired-title', '使用終了（過去の記録は残る）'),
      ...retired.map(retiredRow),
    );
  }

  function activeRow(row) {
    const wrap = element('div', 'metric-row');

    const label = element('input', 'text-input inset metric-label');
    label.type = 'text';
    label.maxLength = 20;
    label.autocomplete = 'off';
    label.placeholder = '項目名（例: トリガー回数）';
    label.setAttribute('aria-label', '項目名');
    label.value = row.label;
    label.addEventListener('input', () => { row.label = label.value; });

    const kind = element('select', 'text-input inset metric-kind');
    kind.setAttribute('aria-label', '種類');
    for (const [value, text] of KIND_LABELS) {
      const option = element('option', '', text);
      option.value = value;
      kind.append(option);
    }
    kind.value = row.kind;
    kind.disabled = row.used;

    const unit = element('input', 'text-input inset metric-unit');
    unit.type = 'text';
    unit.maxLength = 8;
    unit.autocomplete = 'off';
    unit.placeholder = '単位（例: 回）';
    unit.setAttribute('aria-label', '単位');
    unit.value = row.unit;
    unit.hidden = row.kind === METRIC_KIND.TIME;
    unit.addEventListener('input', () => { row.unit = unit.value; });

    kind.addEventListener('change', () => {
      row.kind = kind.value;
      // 時刻に単位は無い。欄を隠すだけで、打った文字は数値に戻したとき用に残す。
      unit.hidden = row.kind === METRIC_KIND.TIME;
    });

    const options = element('div', 'metric-options');
    options.append(kind, unit);

    const actions = element('div', 'metric-actions');
    // まだ保存していない項目に「使用終了」は要らない。消せば済む。
    if (row.id !== null) {
      actions.append(actionButton('使用終了', () => {
        row.active = false;
        render();
      }));
    }
    if (!row.used) {
      actions.append(actionButton('削除', () => {
        rows.splice(rows.indexOf(row), 1);
        render();
      }, 'danger'));
    }

    wrap.append(label, options, actions);
    if (row.used) {
      wrap.append(element('p', 'metric-lock', '記録済みのため、種類の変更と削除はできません。'));
    }
    return wrap;
  }

  function retiredRow(row) {
    const wrap = element('div', 'metric-row retired');
    const unit = row.kind === METRIC_KIND.NUMBER && row.unit.trim() !== '' ? `（${row.unit.trim()}）` : '';
    wrap.append(element('span', 'metric-retired-name', `${row.label}${unit}`));

    const actions = element('div', 'metric-actions');
    actions.append(actionButton('戻す', () => {
      row.active = true;
      render();
    }));
    if (!row.used) {
      actions.append(actionButton('削除', () => {
        rows.splice(rows.indexOf(row), 1);
        render();
      }, 'danger'));
    }
    wrap.append(actions);
    return wrap;
  }

  return {
    // 保存できない入力があればメッセージを、無ければ null を返す。
    validate() {
      return rows.some((row) => row.label.trim() === '') ? '項目名を入力してください。' : null;
    },

    // 保存に渡す形。新しい項目は id を付けずに返し、保存側で振ってもらう。
    values() {
      return rows.map((row) => {
        const metric = { label: row.label, kind: row.kind, unit: row.unit, active: row.active };
        return row.id === null ? metric : { id: row.id, ...metric };
      });
    },
  };
}

function actionButton(text, onClick, extra = '') {
  const button = element('button', `metric-action ${extra}`.trim(), text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

// ユーザーが打った文字も通るので、中身は必ず textContent で入れる。
function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}
