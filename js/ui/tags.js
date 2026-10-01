// 邪魔したタグの入力。候補のチップと自由入力を 1 つの部品にまとめる。
//
// 候補は専用の保存領域を持たず、全ログから集計した使用回数の多い順に出す。
// タップで付け外しし、候補に無い言葉はその場で足せる。
//
// 正規化（NFKC と前後の空白）は schema.js のものをそのまま使う。保存時にも同じ
// 処理が走るので、画面に出ているチップと保存される値がずれない。

import { normalizeTag } from '../schema.js';

const TAG_MAX = 20;

// 候補を出す上限。全部出すと、続けるほどチップの列が画面を覆う。
const SUGGESTION_LIMIT = 12;

// tags   いま付いているタグ（既存のログの値）
// usage  stats.tagUsage() の戻り値（使用回数の降順）
//
// 戻り値の values() で、選んでいるタグを配列で取り出す。
export function createTagInput({ tags = [], usage = [] } = {}) {
  const selected = dedupe(tags);
  const counts = new Map(usage.map(({ tag, count }) => [tag, count]));
  const suggestions = usage.slice(0, SUGGESTION_LIMIT).map((item) => item.tag);

  const element = document.createElement('div');
  element.className = 'tag-input';

  const row = document.createElement('div');
  row.className = 'tag-row';

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'text-input';
  field.placeholder = 'タグを入力';
  field.autocomplete = 'off';
  // 打っている途中で止める。NFKC で伸びる文字（㍿ → 株式会社 など）もあるので、
  // これだけに頼らず add() 側でも長さを見る。
  field.maxLength = TAG_MAX;

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'tag-add';
  addButton.textContent = '追加';

  row.append(field, addButton);

  const label = document.createElement('p');
  label.className = 'sub-label';

  const list = document.createElement('div');
  list.className = 'tag-list';

  const error = document.createElement('p');
  error.className = 'error tag-error';
  error.hidden = true;

  element.append(row, label, list, error);

  function draw() {
    // 候補に無いタグ（その場で足したもの）を先に出す。押した結果が入力欄の
    // すぐ下に現れるようにするため。
    const extra = selected.filter((tag) => !suggestions.includes(tag));
    const order = [...extra, ...suggestions];

    label.textContent = 'よく使うタグ';
    label.hidden = order.length === 0;
    list.replaceChildren(...order.map(chip));
  }

  function chip(tag) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-chip';

    const on = selected.includes(tag);
    button.classList.toggle('selected', on);
    button.setAttribute('aria-pressed', String(on));

    const name = document.createElement('span');
    name.textContent = tag;
    button.append(name);

    // 使った回数。その場で足したタグはまだ 0 なので出さない。
    const count = counts.get(tag) ?? 0;
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'tag-count';
      badge.textContent = String(count);
      button.append(badge);
    }

    button.addEventListener('click', () => toggle(tag));
    return button;
  }

  function toggle(tag) {
    const index = selected.indexOf(tag);
    if (index === -1) selected.push(tag);
    else selected.splice(index, 1);
    hideError();
    draw();
  }

  function add() {
    const tag = normalizeTag(field.value);
    if (tag === '') {
      field.value = '';
      return;
    }
    if (tag.length > TAG_MAX) {
      showError(`タグは ${TAG_MAX} 文字までです。`);
      return;
    }
    if (!selected.includes(tag)) selected.push(tag);
    field.value = '';
    hideError();
    draw();
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function hideError() {
    error.textContent = '';
    error.hidden = true;
  }

  addButton.addEventListener('click', add);
  // Enter でも足せるようにする。フォームの中ではないので送信は起きない。
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    add();
  });

  draw();
  return { element, values: () => [...selected] };
}

// 既存のログの値を画面用にそろえる。空と重複を落とす。
function dedupe(tags) {
  const out = [];
  for (const value of Array.isArray(tags) ? tags : []) {
    const tag = normalizeTag(value);
    if (typeof tag !== 'string' || tag === '' || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
}
