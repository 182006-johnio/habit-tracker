// エクスポートボタン。ホームのヘッダーに置く。
//
// 押した結果は必ず画面に出す。無言だと、共有シートが出ない環境で押したときに
// 反応が無いように見える。

import { exportBackup } from '../export.js';

const status = document.getElementById('export-status');
let timer = null;

export function backupButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'backup-button';
  button.textContent = '書き出し';
  button.addEventListener('click', run);
  return button;
}

async function run() {
  showStatus('書き出し中…', false);
  try {
    // クリックハンドラから直接呼ぶ。navigator.share() はユーザー操作の直後にしか
    // 実行できず、タイマーや通信を挟んでから呼ぶと WebKit に拒否される。
    const result = await exportBackup();
    showStatus(
      result.cancelled ? 'キャンセルしました' : `${result.filename} を書き出しました`,
      false,
    );
  } catch (error) {
    showStatus(`書き出しに失敗しました: ${error.message}`, true);
  }
}

function showStatus(message, isError) {
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.hidden = false;

  clearTimeout(timer);
  timer = setTimeout(() => { status.hidden = true; }, 4000);
}
