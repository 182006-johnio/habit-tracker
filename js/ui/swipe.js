// 横スワイプで削除ボタンを出す部品。
//
// HTML 標準のドラッグ&ドロップはタッチで動かないので Pointer Events で拾う。
// CSS の touch-action: pan-y と組み合わせることで、縦スクロールはブラウザが処理し、
// 横方向だけがこちらに渡ってくる。「スクロールしたいのに削除が始まる」を自前の
// 判定なしに防げる。
//
// 左方向のみ。iOS では画面左端からの右スワイプが「戻る」に割り当てられていて、
// 週まとめ画面との行き来で使うため衝突させない。

const REVEAL = 72; // 削除ボタンの幅
const COMMIT = 36; // ここまで動かしたら開いたままにする
const SLOP = 8; // これ未満の移動はタップとみなす

let opened = null;

export function closeOpenSwipe() {
  opened?.close();
}

// locked() が true の間はスワイプを受け付けない（展開中のカードなど）。
export function enableSwipe(surface, { locked = () => false } = {}) {
  let resting = 0;
  let startX = 0;
  let dragging = false;
  let moved = false;

  function setX(x, animate) {
    surface.classList.toggle('swiping', !animate);
    surface.style.transform = `translateX(${x}px)`;
  }

  function settle(open) {
    resting = open ? -REVEAL : 0;
    setX(resting, true);
    if (open) {
      opened?.close?.();
      opened = api;
    } else if (opened === api) {
      opened = null;
    }
  }

  const api = { close: () => settle(false), isOpen: () => resting !== 0 };

  surface.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (locked()) return;
    dragging = true;
    moved = false;
    startX = event.clientX;
  });

  surface.addEventListener('pointermove', (event) => {
    if (!dragging) return;

    const delta = event.clientX - startX;
    if (!moved) {
      if (Math.abs(delta) < SLOP) return;
      moved = true;
      // 指が要素の外へ出ても追随させる。捕捉できない状況でも動作は続けられる。
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // 何もしない
      }
    }
    setX(Math.min(0, Math.max(-REVEAL, resting + delta)), false);
  });

  surface.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) return;
    settle(resting + (event.clientX - startX) <= -COMMIT);
  });

  surface.addEventListener('pointercancel', () => {
    dragging = false;
    settle(resting !== 0);
  });

  // スワイプの直後にタップ扱いでカードが展開しないようにする。
  // 開いている状態で表面を触ったときは、閉じるだけにする。
  surface.addEventListener('click', (event) => {
    const suppress = moved || resting !== 0;
    // 1 回だけ食べて必ず落とす。残したままだと、あとから来た正当なタップまで
    // 無視してしまう（pointerdown を伴わないキーボード操作などで起きる）。
    moved = false;
    if (!suppress) return;

    event.preventDefault();
    event.stopPropagation();
    if (resting !== 0) settle(false);
  }, true);

  return api;
}
