import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { html, noteRoute, setThemeBlack, goBack, leaveWatch, nav } from './util.js';
import { takeKeyFromUrl } from './api.js';
import { useStore, load, getState, setState, refreshFeed } from './store.js';
import { PlayerShell, setMode, getPs, close as closePlayer, STANDALONE } from './player.js';
import { TopBar, BottomNav, Home, Subs, Channels, AddChannel, ChannelPage, Search, Watch, Me, Settings, HistoryPage, LaterPage, KeyGate, Sheet, ShortsPage } from './views.js';

window.TZ_VERSION = '1.6.0';
takeKeyFromUrl();

function dec(x) {
  try {
    return decodeURIComponent(x);
  } catch (_) {
    return x; // 壊れた % があっても画面が真っ白にならないように
  }
}
function parse(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  const seg = h.split('/').filter(Boolean).map(dec);
  const [a, b] = seg;
  if (!a) return { name: 'home', tab: 'home' };
  if (a === 'w' && b) return { name: 'watch', id: b };
  if (a === 'shorts') return { name: 'shorts', tab: 'shorts', id: b || '' };
  if (a === 'settings') return { name: 'settings', tab: 'me', title: '設定' };
  if (a === 'subs') return { name: 'subs', tab: 'subs', chId: b || '' };
  if (a === 'channels') return { name: 'channels', tab: 'subs', title: '登録チャンネル' };
  if (a === 'add') return { name: 'add', tab: 'subs', title: 'チャンネルを追加' };
  if (a === 'c' && b) return { name: 'channel', tab: 'subs', id: b };
  if (a === 's') return { name: 'search', q: seg.slice(1).join('/') };
  if (a === 'me') return { name: 'me', tab: 'me' };
  if (a === 'history') return { name: 'history', tab: 'me', title: '履歴' };
  if (a === 'later') return { name: 'later', tab: 'me', title: 'あとで見る' };
  return { name: 'home', tab: 'home' };
}

function useRoute() {
  const [r, setR] = useState(() => parse(location.hash));
  useEffect(() => {
    noteRoute(location.hash || '#/', location.hash.startsWith('#/w/'));
    const on = () => {
      noteRoute(location.hash || '#/', location.hash.startsWith('#/w/'));
      setR(parse(location.hash));
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

// 一番上で下に引っぱると新着を取り込む(YouTube アプリと同じ)
function PullRefresh() {
  const refreshing = useStore((s) => s.refreshing);
  const [pull, setPull] = useState(0);
  useEffect(() => {
    let y0 = null;
    let d = 0;
    const down = (e) => {
      y0 = scrollY <= 0 && !e.target.closest('.shelf-row, .chips, .ch-strip, .ph, .sheet') ? e.touches[0].clientY : null;
      d = 0;
    };
    const move = (e) => {
      if (y0 == null) return;
      d = e.touches[0].clientY - y0;
      if (d > 0 && scrollY <= 0) setPull(Math.min(110, d * 0.5));
      else setPull(0);
    };
    const up = () => {
      if (y0 != null && d * 0.5 >= 64) refreshFeed();
      y0 = null;
      setPull(0);
    };
    addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', move, { passive: true });
    addEventListener('touchend', up);
    addEventListener('touchcancel', up);
    return () => {
      removeEventListener('touchstart', down);
      removeEventListener('touchmove', move);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', up);
    };
  }, []);
  if (!pull && !refreshing) return null;
  const y = refreshing ? 64 : pull;
  return html`<div class="ptr" style=${{ transform: `translate(-50%, ${y}px)`, opacity: refreshing ? 1 : Math.min(1, pull / 64) }}>
    <span class=${refreshing ? 'spinner' : 'ptr-arrow'} style=${refreshing ? null : { transform: `rotate(${pull * 3}deg)` }}></span>
  </div>`;
}

// 一覧のスクロール位置を、画面ごとに覚えておく(動画から戻ったとき、同じところから)
const scrollPos = {};
try { history.scrollRestoration = 'manual'; } catch (_) { /* 何もしない */ }
const LIST_ROUTES = ['home', 'subs', 'channels', 'channel', 'search', 'me', 'history', 'later'];
// 画面を移る瞬間(まだ前の画面のまま)に、前の画面の位置を覚える
addEventListener('hashchange', (e) => {
  try {
    const old = new URL(e.oldURL).hash || '#/';
    if (LIST_ROUTES.includes(document.body.dataset.route)) scrollPos[old] = scrollY;
  } catch (_) { /* 何もしない */ }
});
// 下へスクロールすると上のバーが隠れ、上へ戻すと出てくる(YouTube アプリと同じ)
let lastY = 0;
let restoring = false; // 一覧の位置を戻している最中(上のバーを隠さない)
addEventListener('scroll', () => {
  const y = scrollY;
  if (restoring) {
    lastY = y;
    return;
  }
  const r = document.body.dataset.route;
  if (r === 'watch' || r === 'shorts' || r === 'search') return;
  if (y > lastY + 6 && y > 120) document.body.classList.add('hide-top');
  else if (y < lastY - 6 || y < 60) document.body.classList.remove('hide-top');
  lastY = y;
}, { passive: true });

// ホーム画面のアイコンで開いているとき: 画面の左端から右へなぞると「戻る」(ブラウザの戻る動きの代わり)
function EdgeBack() {
  useEffect(() => {
    if (!STANDALONE) return;
    let s = null;
    const main = () => document.querySelector('.main');
    const down = (e) => {
      const t = e.touches[0];
      if (t.clientX > 18 || e.target.closest('.ph, .sheet-bg, .panel, .shorts, .tabs, input')) return;
      if (document.querySelector('.panel, .sheet-bg')) return; // 説明・キュー・メニューを開いている間はしない
      // 横に流せる列(棚・チップ)を動かしている途中なら、そちらを優先する
      for (let el = e.target; el && el !== document.body; el = el.parentElement) {
        if (el.scrollLeft > 0 && el.scrollWidth > el.clientWidth) return;
      }
      const r = document.body.dataset.route;
      if (r === 'gate' || r === 'shorts' || (r === 'home' && nav.stack.length <= 1)) return;
      s = { x: t.clientX, y: t.clientY, t: performance.now(), on: false, dx: 0 };
    };
    const move = (e) => {
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (!s.on) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > dx) { s = null; return; }
        if (dx > 12) s.on = true;
      }
      if (s.on) {
        s.dx = Math.max(0, dx);
        const m = main();
        if (m) { m.style.transition = 'none'; m.style.transform = `translateX(${s.dx}px)`; }
        document.body.classList.add('edgeback');
      }
    };
    const up = () => {
      if (!s) return;
      const go = s.on && (s.dx > 90 || (s.dx > 40 && s.dx / Math.max(1, performance.now() - s.t) > 0.5));
      const m = main();
      if (m) { m.style.transition = 'transform 0.2s ease-out'; m.style.transform = ''; }
      document.body.classList.remove('edgeback');
      s = null;
      if (go) (document.body.dataset.route === 'watch' ? leaveWatch() : goBack());
    };
    addEventListener('touchstart', down, { passive: true });
    addEventListener('touchmove', move, { passive: true });
    addEventListener('touchend', up);
    addEventListener('touchcancel', up);
    return () => {
      removeEventListener('touchstart', down);
      removeEventListener('touchmove', move);
      removeEventListener('touchend', up);
      removeEventListener('touchcancel', up);
    };
  }, []);
  return null;
}

function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return html`<div class="toast" key=${t.id}>${t.msg}</div>`;
}

function App() {
  const route = useRoute();
  const needKey = useStore((s) => s.needKey);
  const booted = useStore((s) => s.booted);
  const routeTitle = useStore((s) => s.routeTitle);
  const offline = useStore((s) => s.offline);

  // 再生画面を離れたら、プレーヤーは小さい窓になる。ショートは画面を離れたら止める
  useEffect(() => {
    const ps = getPs();
    if (ps.id && ps.mode === 'short' && route.name !== 'shorts') closePlayer();
    else if (route.name !== 'watch' && ps.id && ps.mode === 'full') setMode('mini');
    document.body.dataset.route = needKey ? 'gate' : route.name;
    document.body.classList.remove('hide-top');
    // 一覧に戻ったら、前に見ていた位置へ(描き終わるのを少し待つ)。記録が無ければ上から
    let tm = 0;
    let tEnd = 0;
    if (LIST_ROUTES.includes(route.name)) {
      const y = scrollPos[location.hash || '#/'] || 0;
      restoring = true;
      lastY = y;
      if (y > 0) {
        let n = 0;
        const go = () => {
          lastY = y;
          scrollTo(0, y);
          if (Math.abs(scrollY - y) > 4 && ++n < 12) tm = setTimeout(go, 50);
        };
        tm = setTimeout(go, 0);
      } else scrollTo(0, 0);
      tEnd = setTimeout(() => { restoring = false; }, 700);
    } else if (route.name !== 'watch' && route.name !== 'shorts') scrollTo(0, 0);
    setThemeBlack(!needKey && (route.name === 'watch' || route.name === 'shorts' || getPs().fs));
    return () => {
      clearTimeout(tm);
      clearTimeout(tEnd);
      restoring = false;
    };
  }, [route, needKey]);
  // 合言葉の画面に入るときは、流していた動画を止める(プレーヤーの箱は外さない)
  useEffect(() => {
    if (needKey && getPs().id) closePlayer();
  }, [needKey]);

  let page;
  switch (needKey ? 'gate' : route.name) {
    case 'gate': page = html`<${KeyGate} />`; break;
    case 'watch': page = html`<${Watch} id=${route.id} />`; break;
    case 'subs': page = html`<${Subs} chId=${route.chId} />`; break;
    case 'channels': page = html`<${Channels} />`; break;
    case 'add': page = html`<${AddChannel} />`; break;
    case 'channel': page = html`<${ChannelPage} key=${route.id} id=${route.id} />`; break;
    case 'search': page = html`<${Search} key=${route.q || ''} q=${route.q} />`; break;
    case 'me': page = html`<${Me} />`; break;
    case 'settings': page = html`<${Settings} />`; break;
    case 'shorts': page = html`<${ShortsPage} key=${'shorts'} id=${route.id} />`; break;
    case 'history': page = html`<${HistoryPage} />`; break;
    case 'later': page = html`<${LaterPage} />`; break;
    default: page = html`<${Home} />`;
  }
  const title = route.name === 'channel' ? routeTitle || 'チャンネル' : route.title;
  return html`<div class="app">
    ${!needKey && html`<${TopBar} route=${{ ...route, title }} />`}
    ${offline && !needKey && html`<div class="offline">オフラインです。前回の内容を表示しています</div>`}
    ${!needKey && (route.name === 'home' || route.name === 'subs') && html`<${PullRefresh} />`}
    <main class="main">${!needKey && !booted && !getState().channels.length ? html`<div class="loading"><span class="spinner"></span></div>` : page}</main>
    <${PlayerShell} />
    ${!needKey && html`<${BottomNav} route=${route} />`}
    <${Sheet} />
    <${Toast} />
    <${EdgeBack} />
  </div>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);

load();
// しばらく閉じていたら、開き直したときに読み込み直す
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) {
    // 読み込み直している間に動画を開くと、ほかの端末で見た位置より古い位置から流してしまうので、その間だけ待ってもらう
    setState({ resyncing: true });
    load({ quiet: true, after: true }).finally(() => setState({ resyncing: false }));
  }
});

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
