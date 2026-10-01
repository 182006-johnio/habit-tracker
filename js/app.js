// アプリの起動と画面の切り替え。
//
// DOM を触るのはこのファイルと js/ui/ 配下だけ。dates / schema / storage / stats /
// weeks / export の 6 モジュールは DOM を知らない。
//
// 画面は location.hash で分ける。ホーム画面から起動した PWA にはブラウザの戻るボタンが
// 無いが、ハッシュで履歴が積まれれば iOS の戻るスワイプが効く。
//
// ヘッダーの中身は画面ごとに違う（日付と見出し、戻ると習慣名、週送り）。枠だけ用意し、
// 組み立ては各画面に任せる。

import { isValidISO, todayISO } from './dates.js';
import * as storage from './storage.js';
import { renderEditScreen } from './ui/edit-screen.js';
import { renderHome } from './ui/home.js';
import { renderRecordScreen } from './ui/record-screen.js';
import { renderWeek } from './ui/week.js';

const boot = document.getElementById('boot-status');
const app = document.getElementById('app');
const screen = document.getElementById('screen');
const header = document.getElementById('app-header');

async function start() {
  boot.dataset.started = '1'; // index.html の「起動できたか」の見張りに知らせる

  try {
    await storage.init();
  } catch (error) {
    // 保存データが壊れていた場合、データ層は上書きせずに例外を投げる。
    // ここで握り潰すと画面が真っ白になり、原因が分からないまま「壊れた」ように見える。
    boot.className = 'error';
    boot.textContent = `データを読み込めませんでした。\n\n${error.message}`;
    return;
  }

  boot.hidden = true;
  app.hidden = false;
  window.addEventListener('hashchange', render);
  await render();
}

const WEEK = /^#week\/([^/]+)$/;
// 日付を省略すると今日。週まとめの表から過去の日を開くときに付く。
const RECORD = /^#record\/([^/]+)(?:\/([^/]+))?$/;
const EDIT = /^#edit\/([^/]+)$/;

async function render() {
  const hash = location.hash;

  // 画面を切り替えたら先頭から見せる。ハッシュだけの移動ではブラウザが
  // スクロール位置を引き継ぐので、下まで読んだあと別の画面に移ると途中から始まる。
  window.scrollTo(0, 0);

  const edit = EDIT.exec(hash);
  if (edit) {
    const id = decodeURIComponent(edit[1]);
    // 追加は対象の習慣がまだ無いので、照合より先に分ける。
    if (id === 'new') {
      await renderEditScreen(screen, header, null);
      return;
    }
    await withHabit(id, (habit) => renderEditScreen(screen, header, habit));
    return;
  }

  const record = RECORD.exec(hash);
  if (record) {
    const date = record[2] === undefined ? todayISO() : decodeURIComponent(record[2]);
    if (!isValidISO(date)) {
      goHome();
      return;
    }
    await withHabit(decodeURIComponent(record[1]), (habit) => renderRecordScreen(screen, header, habit, date));
    return;
  }

  const week = WEEK.exec(hash);
  if (week) {
    await withHabit(decodeURIComponent(week[1]), (habit) => renderWeek(screen, header, habit));
    return;
  }

  // 打ち間違いなどで知らないハッシュが残っていると、再読み込みのたびに同じ URL を
  // 引きずる。ホームを描くときに落としておく。
  if (location.hash !== '' && location.hash !== '#') {
    history.replaceState(null, '', location.pathname + location.search);
  }

  await renderHome(screen, header);
}

// 消した習慣のリンクを踏んだ場合など。履歴を汚さずホームに戻す。
async function withHabit(id, draw) {
  const habit = await storage.getHabit(id);
  if (!habit) {
    goHome();
    return;
  }
  await draw(habit);
}

function goHome() {
  history.replaceState(null, '', location.pathname + location.search);
  render();
}

// オフラインでも起動できるようにする。登録に失敗してもアプリは動くので、
// 画面には出さずコンソールに残すだけにする。
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('Service Worker を登録できませんでした:', error);
  });
}

start();
registerServiceWorker();
