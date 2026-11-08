// サーバーとのやりとり。合言葉は じぶんノート・就活アプリと共通(同じ github.io なので保存場所も共通)
export const SB_URL = 'https://gzayrjlhruhvklsidraw.supabase.co';
export const SB_KEY = 'sb_publishable_-sNQxpwsU7JxhPF9S2vn5A_-CCTqQZL';
const KEY_NAME = 'jibun-note:key';

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 保存できない環境 */ }
}

// 合言葉入りリンク(#k=…)で開いたら保存して、URL から消す
export function takeKeyFromUrl() {
  const m = location.hash.match(/[#&]k=([^&]+)/);
  if (!m) return;
  lsSet(KEY_NAME, decodeURIComponent(m[1]));
  const rest = location.hash.replace(/[#&]k=[^&]+/, '').replace(/^#&/, '#');
  history.replaceState(null, '', location.pathname + location.search + (rest === '#' ? '' : rest));
}
export const getKey = () => lsGet(KEY_NAME) || '';
export const setKey = (k) => lsSet(KEY_NAME, k || null);

export class ApiError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function post(url, body, headers = {}, ms = 25000) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined,
    });
  } catch (e) {
    throw new ApiError(navigator.onLine === false ? 'オフラインです' : 'つながりませんでした', 0);
  }
  let data = null;
  try { data = await r.json(); } catch { /* 空 */ }
  if (!r.ok) {
    const msg = data?.error || data?.message || `エラー ${r.status}`;
    throw new ApiError(/bad key/.test(msg) ? '合言葉がちがいます' : msg, r.status);
  }
  return data;
}

// 自分のデータ(登録・履歴・あとで見る)は データベースの関数 tsuzuki_api
export function rpc(action, args = {}) {
  return post(`${SB_URL}/rest/v1/rpc/tsuzuki_api`, { p_key: getKey(), p_action: action, p_args: args });
}

// YouTube の公開情報(検索・関連動画・チャンネル・新着の取り込み)は Edge Function tsuzuki
export function fn(action, args = {}, ms) {
  return post(`${SB_URL}/functions/v1/tsuzuki`, { action, ...args }, { 'x-tz-key': getKey() }, ms);
}
