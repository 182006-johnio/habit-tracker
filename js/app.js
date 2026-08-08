// アプリの起動と画面の切り替え。
//
// DOM を触るのはこのファイルと js/ui/ 配下だけ。dates / schema / storage / stats /
// weeks / export の 6 モジュールは DOM を知らない。
//
// 画面は location.hash で分ける。ホーム画面から起動した PWA にはブラウザの戻るボタンが
// 無いが、ハッシュで履歴が積まれれば iOS の戻るスワイプが効く。

import * as storage from './storage.js';
import { renderHome } from './ui/home.js';
import { renderWeek } from './ui/week.js';

const boot = document.getElementById('boot-status');
const app = document.getElementById('app');
const screen = document.getElementById('screen');
const title = document.getElementById('screen-title');
const nav = document.getElementById('header-nav');

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

// #week/<habit_id> だけを別画面にする。それ以外はホーム。
function parseRoute(hash) {
  const match = /^#week\/(.+)$/.exec(hash);
  return match ? { name: 'week', habitId: decodeURIComponent(match[1]) } : { name: 'home' };
}

async function render() {
  const route = parseRoute(location.hash);
  screen.replaceChildren();
  nav.replaceChildren();

  if (route.name === 'week') {
    const habit = await storage.getHabit(route.habitId);
    if (!habit) {
      // 消した習慣のリンクを踏んだ場合など。履歴を汚さずホームに戻す。
      goHome();
      return;
    }
    title.textContent = habit.name;
    nav.append(backLink());
    await renderWeek(screen, habit);
    return;
  }

  // 打ち間違いなどで知らないハッシュが残っていると、再読み込みのたびに同じ URL を
  // 引きずる。ホームを描くときに落としておく。
  if (location.hash !== '' && location.hash !== '#') {
    history.replaceState(null, '', location.pathname + location.search);
  }

  title.textContent = '習慣';
  await renderHome(screen);
}

function goHome() {
  history.replaceState(null, '', location.pathname + location.search);
  render();
}

function backLink() {
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = '← 一覧';
  return link;
}

start();
