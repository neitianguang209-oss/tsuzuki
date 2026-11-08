import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { html, noteRoute } from './util.js';
import { takeKeyFromUrl } from './api.js';
import { useStore, load, getState } from './store.js';
import { PlayerShell, setMode, getPs, close as closePlayer } from './player.js';
import { TopBar, BottomNav, Home, Subs, Channels, AddChannel, ChannelPage, Search, Watch, Me, HistoryPage, LaterPage, KeyGate, Sheet } from './views.js';

window.TZ_VERSION = '1.0.0';
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

  // 再生画面を離れたら、プレーヤーは小さい窓になる
  useEffect(() => {
    if (route.name !== 'watch' && getPs().id) setMode('mini');
    document.body.dataset.route = needKey ? 'gate' : route.name;
  }, [route.name, needKey]);
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
    case 'search': page = html`<${Search} q=${route.q} />`; break;
    case 'me': page = html`<${Me} />`; break;
    case 'history': page = html`<${HistoryPage} />`; break;
    case 'later': page = html`<${LaterPage} />`; break;
    default: page = html`<${Home} />`;
  }
  const title = route.name === 'channel' ? routeTitle || 'チャンネル' : route.title;
  return html`<div class="app">
    ${!needKey && html`<${TopBar} route=${{ ...route, title }} />`}
    ${offline && !needKey && html`<div class="offline">オフラインです。前回の内容を表示しています</div>`}
    <main class="main">${!needKey && !booted && !getState().channels.length ? html`<div class="loading">読み込み中…</div>` : page}</main>
    <${PlayerShell} />
    ${!needKey && html`<${BottomNav} route=${route} />`}
    <${Sheet} />
    <${Toast} />
  </div>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);

load();
// しばらく閉じていたら、開き直したときに読み込み直す
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 10 * 60e3) load({ quiet: true });
});

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
