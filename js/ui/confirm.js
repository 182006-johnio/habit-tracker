// 確認ダイアログ。
//
// dialog の close イベントには依存しない。閉じて returnValue も設定されるのに
// close が発火しない環境があり、その場合 await が解決せず操作が固まる。
// ボタンのクリックで直接決め、Esc（cancel イベント）は取り消し扱いにする。

const dialog = document.getElementById('confirm-dialog');
const messageBox = document.getElementById('confirm-message');
const okButton = document.getElementById('confirm-ok');
const cancelButton = document.getElementById('confirm-cancel');

export function askConfirm(message, okLabel = '消す') {
  return new Promise((resolve) => {
    messageBox.textContent = message;
    okButton.textContent = okLabel;

    const settle = (ok) => {
      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    const onOk = () => settle(true);
    const onCancel = () => settle(false);

    okButton.addEventListener('click', onOk);
    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
  });
}
