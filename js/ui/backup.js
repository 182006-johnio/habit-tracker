// バックアップ。書き出しと読み込みを、ホーム画面の一覧の下に置く。
//
// 週まとめ画面の末尾という案もあったが、あの画面は習慣が 1 件も無いと開けない。
// 読み込みがいちばん要るのは端末を変えた直後やデータが消えた直後、つまり習慣が
// 0 件のときなので、そこに辿り着けないと用をなさない。

import { exportBackup } from '../export.js';
import * as storage from '../storage.js';
import { askConfirm } from './confirm.js';

const fileInput = document.getElementById('backup-file');

let statusEl = null;
let pending = null;
let onChanged = null;
let timer = null;
let wired = false;

export function backupSection(onChange) {
  onChanged = onChange;
  wireOnce();

  const section = document.createElement('section');
  section.className = 'backup';

  const heading = document.createElement('h2');
  heading.textContent = 'バックアップ';

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = '記録は端末の中だけにあります。消えると戻せないので、ときどき書き出してください。';

  const buttons = document.createElement('div');
  buttons.className = 'backup-buttons';
  buttons.append(
    actionButton('書き出し', runExport),
    actionButton('読み込み', () => fileInput.click()),
  );

  statusEl = document.createElement('p');
  statusEl.className = 'backup-status';
  statusEl.hidden = true;

  section.append(heading, note, buttons, statusEl);

  // 読み込みの結果は、一覧を描き直したあとの区画に出す。
  if (pending) {
    show(pending.text, pending.isError);
    pending = null;
  }
  return section;
}

function actionButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'backup-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function runExport() {
  show('書き出し中…', false);
  try {
    // クリックハンドラから直接呼ぶ。navigator.share() はユーザー操作の直後にしか
    // 実行できず、タイマーや通信を挟んでから呼ぶと WebKit に拒否される。
    const result = await exportBackup();
    show(
      result.cancelled ? 'キャンセルしました' : `${result.filename} を書き出しました`,
      false,
    );
  } catch (error) {
    show(`書き出しに失敗しました: ${error.message}`, true);
  }
}

async function onFilePicked(event) {
  const file = event.target.files?.[0];
  // 同じファイルを続けて選び直せるようにする。
  event.target.value = '';
  if (!file) return;

  let incoming;
  try {
    incoming = await storage.parseBackup(await file.text());
  } catch (error) {
    show(error.message, true);
    return;
  }

  const current = await storage.getCounts();
  const accepted = await askConfirm(
    `今の習慣 ${current.habits} 件・記録 ${current.logs} 件を、`
    + `ファイルの ${incoming.habits} 件・${incoming.logs} 件に置き換えます。元に戻せません。`,
    '置き換える',
  );
  if (!accepted) return;

  try {
    await storage.replaceAll(incoming.db);
  } catch (error) {
    show(error.message, true);
    return;
  }

  pending = {
    text: `読み込みました（習慣 ${incoming.habits} 件・記録 ${incoming.logs} 件）`,
    isError: false,
  };
  await onChanged?.();
}

function show(text, isError) {
  if (statusEl === null) return;
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
  statusEl.hidden = false;

  clearTimeout(timer);
  timer = setTimeout(() => { statusEl.hidden = true; }, 6000);
}

// 区画は描き直されるが、ファイル選択の購読は 1 回だけ張る。
function wireOnce() {
  if (wired) return;
  wired = true;
  fileInput.addEventListener('change', onFilePicked);
}
