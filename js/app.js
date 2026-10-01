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

const ROUTES = [
  { name: 'week', pattern: /^#week\/(.+)$/ },
  { name: 'record', pattern: /^#record\/(.+)$/ },
  { name: 'edit', pattern: /^#edit\/(.+)$/ },
];

function parseRoute(hash) {
  for (const { name, pattern } of ROUTES) {
    const match = pattern.exec(hash);
    if (match) return { name, habitId: decodeURIComponent(match[1]) };
  }
  return { name: 'home' };
}

async function render() {
  const route = parseRoute(location.hash);

  // 追加は対象の習慣がまだ無いので、照合より先に分ける。
  if (route.name === 'edit' && route.habitId === 'new') {
    await renderEditScreen(screen, header, null);
    return;
  }

  if (route.name !== 'home') {
    const habit = await storage.getHabit(route.habitId);
    if (!habit) {
      // 消した習慣のリンクを踏んだ場合など。履歴を汚さずホームに戻す。
      goHome();
      return;
    }
    if (route.name === 'week') await renderWeek(screen, header, habit);
    else if (route.name === 'record') await renderRecordScreen(screen, header, habit);
    else await renderEditScreen(screen, header, habit);
    return;
  }

  // 打ち間違いなどで知らないハッシュが残っていると、再読み込みのたびに同じ URL を
  // 引きずる。ホームを描くときに落としておく。
  if (location.hash !== '' && location.hash !== '#') {
    history.replaceState(null, '', location.pathname + location.search);
  }

  await renderHome(screen, header);
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
