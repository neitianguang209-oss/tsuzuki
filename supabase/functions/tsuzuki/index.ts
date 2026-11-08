// つづきから Edge Function: YouTube の公開情報(新着フィード・検索・関連動画・チャンネルの動画一覧)を集めて返す。
// 動画そのものは扱わない(再生はアプリの中の YouTube 公式の埋め込みプレーヤーが行う)。
// 入口の鍵: 本人の合言葉(x-tz-key。じぶんノートと共通の jibun_access)か、定期実行用の cron_token(tsuzuki_secret)。
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-tz-key, authorization, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CTX = { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'ja', gl: 'JP' } };
const TAB_PARAMS: Record<string, string> = {
  videos: 'EgZ2aWRlb3PyBgQKAjoA',
  streams: 'EgdzdHJlYW1z8gYECgJ6AA==',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function authorize(req: Request, body: Record<string, unknown>): Promise<'user' | 'cron' | null> {
  const key = req.headers.get('x-tz-key');
  if (key && key.length >= 4) {
    const { data } = await db.from('jibun_access').select('token_hash').eq('token_hash', await sha256(key)).maybeSingle();
    if (data) return 'user';
  }
  const tok = typeof body.token === 'string' ? body.token : '';
  if (tok.length >= 20) {
    const { data } = await db.from('tsuzuki_secret').select('v').eq('k', 'cron_token').maybeSingle();
    if (data?.v && data.v === tok) return 'cron';
  }
  return null;
}

// ------------------------------------------------------------------ YouTube の内部の窓口(公開ページと同じデータ)
async function yti(path: string, payload: Record<string, unknown>, ms = 9000) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/${path}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept-Language': 'ja,en;q=0.8' },
    body: JSON.stringify({ context: CTX, ...payload }),
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`YouTube ${path} HTTP ${r.status}`);
  return await r.json();
}

// deno-lint-ignore no-explicit-any
type Any = any;
const runs = (x: Any): string => (x?.simpleText ?? (x?.runs ?? []).map((r: Any) => r.text).join('') ?? '') as string;
const fixUrl = (u?: string) => (!u ? '' : u.startsWith('//') ? 'https:' + u : u);
const lastThumb = (t: Any) => {
  const a = t?.thumbnails || t?.sources || [];
  return fixUrl(a.length ? a[a.length - 1].url : '');
};
function toSec(s: string) {
  const p = String(s || '').trim().split(':').map(Number);
  if (p.length < 2 || p.some((x) => !Number.isFinite(x))) return 0;
  return p.reduce((a, x) => a * 60 + x, 0);
}

type Hit = {
  id: string;
  title: string;
  ch: string; // チャンネル名
  chId: string;
  avatar: string;
  dur: number; // 秒(わからなければ 0)
  dtxt: string; // 長さの文字
  vtxt: string; // 視聴回数の文字
  ptxt: string; // 「3 日前」など
  live: boolean;
};
type ChHit = { id: string; title: string; avatar: string; handle: string; subs: string };

function fromVideoRenderer(v: Any): Hit | null {
  if (!v?.videoId) return null;
  const owner = v.ownerText?.runs?.[0] || v.longBylineText?.runs?.[0] || v.shortBylineText?.runs?.[0];
  const live = JSON.stringify(v.badges || v.thumbnailOverlays || []).includes('LIVE');
  const dtxt = runs(v.lengthText);
  return {
    id: String(v.videoId),
    title: runs(v.title),
    ch: owner?.text || '',
    chId: owner?.navigationEndpoint?.browseEndpoint?.browseId || '',
    avatar: lastThumb(v.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail || v.channelThumbnail),
    dur: toSec(dtxt),
    dtxt,
    vtxt: runs(v.viewCountText) || runs(v.shortViewCountText),
    ptxt: runs(v.publishedTimeText),
    live: live || (!dtxt && /視聴中|watching/.test(runs(v.viewCountText))),
  };
}

// 2025年からの新しい形(関連動画・チャンネルの動画一覧)
function fromLockup(l: Any): Hit | null {
  if (!l?.contentId || l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const md = l.metadata?.lockupMetadataViewModel || {};
  const rows: string[][] = (md.metadata?.contentMetadataViewModel?.metadataRows || []).map((r: Any) =>
    (r.metadataParts || []).map((p: Any) => p?.text?.content || '').filter(Boolean),
  );
  const flat = rows.flat();
  const isViews = (s: string) => /回視聴|視聴|views?$|^[\d.,]+\s*(万|億)?\s*(回)?$/.test(s) && !/前$/.test(s);
  const isWhen = (s: string) => /前$|ago$|配信|公開/.test(s);
  const vtxt = flat.find(isViews) || '';
  const ptxt = flat.find(isWhen) || '';
  const chName = flat.find((s) => s !== vtxt && s !== ptxt && !/^\d/.test(s)) || '';
  let dtxt = '';
  let live = false;
  for (const o of l.contentImage?.thumbnailViewModel?.overlays || []) {
    for (const b of o.thumbnailBottomOverlayViewModel?.badges || o.thumbnailOverlayBadgeViewModel?.thumbnailBadges || []) {
      const t = b.thumbnailBadgeViewModel?.text || '';
      if (/^\d+(:\d+){1,2}$/.test(t)) dtxt = t;
      else if (/ライブ|LIVE/i.test(t)) live = true;
    }
  }
  const s = JSON.stringify(md);
  const chId = (s.match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || '';
  const av = md.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources ||
    md.image?.avatarStackViewModel?.avatars?.[0]?.avatarViewModel?.image?.sources || [];
  return {
    id: String(l.contentId),
    title: md.title?.content || '',
    ch: chName,
    chId,
    avatar: fixUrl(av[0]?.url),
    dur: toSec(dtxt),
    dtxt,
    vtxt: vtxt && /^[\d.,]+\s*(万|億)?$/.test(vtxt) ? vtxt + ' 回視聴' : vtxt,
    ptxt,
    live,
  };
}

function fromChannelRenderer(c: Any): ChHit | null {
  if (!c?.channelId) return null;
  const a = runs(c.subscriberCountText);
  const b = runs(c.videoCountText);
  const handle = [a, b].find((x) => x.startsWith('@')) || '';
  const subs = [a, b].find((x) => /登録者|subscriber/.test(x)) || '';
  return { id: c.channelId, title: runs(c.title), avatar: lastThumb(c.thumbnail), handle, subs };
}

// 返事の中を歩いて、動画・チャンネル・続きの合図を上から順に拾う
function harvest(root: Any) {
  const videos: Hit[] = [];
  const channels: ChHit[] = [];
  let cont = '';
  const seen = new Set<string>();
  const walk = (n: Any, depth: number) => {
    if (!n || typeof n !== 'object' || depth > 40) return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, depth + 1);
      return;
    }
    if (n.videoRenderer || n.lockupViewModel || n.gridVideoRenderer || n.compactVideoRenderer) {
      const h = n.lockupViewModel ? fromLockup(n.lockupViewModel) : fromVideoRenderer(n.videoRenderer || n.gridVideoRenderer || n.compactVideoRenderer);
      if (h && !seen.has(h.id)) {
        seen.add(h.id);
        videos.push(h);
      }
      return;
    }
    if (n.channelRenderer) {
      const c = fromChannelRenderer(n.channelRenderer);
      if (c && !channels.some((x) => x.id === c.id)) channels.push(c);
      return;
    }
    if (n.reelShelfRenderer || n.shortsLockupViewModel || n.reelItemRenderer) return; // ショートの棚は飛ばす
    if (n.continuationItemRenderer) {
      const t = n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (t) cont = t;
      return;
    }
    for (const k in n) {
      if (k === 'frameworkUpdates' || k === 'responseContext' || k === 'topbar') continue;
      walk(n[k], depth + 1);
    }
  };
  walk(root, 0);
  return { videos, channels, cont };
}

// ------------------------------------------------------------------ 検索
async function search(q: string, cont?: string) {
  const d = cont ? await yti('search', { continuation: cont }) : await yti('search', { query: q });
  const h = harvest(cont ? d.onResponseReceivedCommands : d.contents);
  return { videos: h.videos, channels: h.channels, cont: h.cont };
}

// ------------------------------------------------------------------ 動画の詳しい情報と関連動画
async function video(id: string) {
  const d = await yti('next', { videoId: id });
  const res = d.contents?.twoColumnWatchNextResults || {};
  const prim = (res.results?.results?.contents || []).map((c: Any) => c.videoPrimaryInfoRenderer).find(Boolean) || {};
  const sec = (res.results?.results?.contents || []).map((c: Any) => c.videoSecondaryInfoRenderer).find(Boolean) || {};
  const owner = sec.owner?.videoOwnerRenderer || {};
  const ownerRun = owner.title?.runs?.[0] || {};
  const rel = harvest(res.secondaryResults);
  // コラボ動画は投稿者が「一覧の窓」の形で入っているので、中の最初のチャンネルを使う
  const os = JSON.stringify(owner);
  return {
    id,
    title: runs(prim.title),
    vtxt: runs(prim.viewCount?.videoViewCountRenderer?.viewCount) || runs(prim.viewCount?.videoViewCountRenderer?.shortViewCount),
    ptxt: runs(prim.dateText) || runs(prim.relativeDateText),
    live: !!prim.viewCount?.videoViewCountRenderer?.isLive,
    channel: {
      id: ownerRun.navigationEndpoint?.browseEndpoint?.browseId || (os.match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || '',
      title: ownerRun.text || (os.match(/"listItemViewModel":\{"title":\{"content":"([^"]+)"/) || [])[1] || owner.attributedTitle?.content || '',
      avatar: lastThumb(owner.thumbnail) || (os.match(/"url":"(https:\/\/yt3\.[^"]+)"/) || [])[1] || '',
      subs: runs(owner.subscriberCountText) || ((os.match(/(チャンネル登録者数\s*[\d.,]+\s*(?:万|億)?人)/) || [])[1] || ''),
      collab: owner.attributedTitle?.content || '',
    },
    desc: sec.attributedDescription?.content || runs(sec.description) || '',
    related: rel.videos.filter((v) => v.id !== id).slice(0, 30),
  };
}

// ------------------------------------------------------------------ チャンネル
async function channelPage(id: string, tab = 'videos', cont?: string) {
  if (cont) {
    const d = await yti('browse', { continuation: cont });
    const h = harvest(d.onResponseReceivedActions);
    return { videos: h.videos, cont: h.cont };
  }
  const d = await yti('browse', { browseId: id, params: TAB_PARAMS[tab] || TAB_PARAMS.videos });
  const m = d.metadata?.channelMetadataRenderer || {};
  const hs = JSON.stringify(d.header || {});
  const subs = (hs.match(/"content":"(チャンネル登録者数[^"]*|[^"]*subscribers?)"/) || [])[1] || '';
  const h = harvest(d.contents);
  return {
    meta: {
      id: m.externalId || id,
      title: m.title || '',
      avatar: lastThumb(m.avatar),
      handle: (String(m.vanityChannelUrl || '').match(/\/(@[^/?#]+)/) || [])[1] ? decodeURIComponent((String(m.vanityChannelUrl).match(/\/(@[^/?#]+)/) || [])[1]) : '',
      desc: m.description || '',
      subs,
    },
    videos: h.videos,
    cont: h.cont,
  };
}

// URL・@ハンドル・UC… から チャンネルID を出す
async function resolveChannel(input: string): Promise<string> {
  const s = String(input || '').trim();
  const m = s.match(/(UC[\w-]{22})/);
  if (m) return m[1];
  let url = s;
  if (s.startsWith('@')) url = 'https://www.youtube.com/' + s;
  else if (!/^https?:\/\//.test(s)) url = 'https://www.youtube.com/@' + s.replace(/^@/, '');
  const d = await yti('navigation/resolve_url', { url });
  const b = d.endpoint?.browseEndpoint?.browseId;
  if (b && b.startsWith('UC')) return b;
  // 動画のURLなら、その動画のチャンネル
  const vid = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
  if (vid) {
    const v = await video(vid[1]);
    if (v.channel.id) return v.channel.id;
  }
  throw new Error('チャンネルが見つかりませんでした');
}

// ------------------------------------------------------------------ 新着フィード(RSS)
const ent = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

async function fetchFeed(chId: string) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${chId}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 404) return { gone: true, title: '', items: [] as Any[] };
  if (!r.ok) throw new Error(`RSS HTTP ${r.status}`);
  const x = await r.text();
  const head = x.split('<entry>')[0];
  const title = ent((head.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
  const items = x.split('<entry>').slice(1).map((e) => {
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || '';
    return {
      id,
      channel_id: chId,
      title: ent((e.match(/<title>([^<]*)<\/title>/) || [])[1] || ''),
      published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || null,
      views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0) || null,
      is_short: /\/shorts\//.test(link),
      fetched_at: new Date().toISOString(),
    };
  }).filter((v) => v.id);
  return { gone: false, title, items };
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await f(items[k]);
    }
  }));
  return out;
}

async function refreshChannels(ids: string[]) {
  let added = 0;
  await pool(ids, 8, async (id) => {
    try {
      const f = await fetchFeed(id);
      if (f.gone) {
        await db.from('tsuzuki_channels').update({ last_fetch: new Date().toISOString(), fetch_error: 'フィードが見つかりません(チャンネルが消えた可能性)' }).eq('id', id);
        return;
      }
      if (f.items.length) {
        const { data: had } = await db.from('tsuzuki_videos').select('id').in('id', f.items.map((v) => v.id));
        added += f.items.length - (had?.length || 0);
        const { error } = await db.from('tsuzuki_videos').upsert(f.items, { onConflict: 'id' });
        if (error) throw error;
      }
      const upd: Record<string, unknown> = { last_fetch: new Date().toISOString(), fetch_error: null };
      if (f.title) upd.title = f.title;
      await db.from('tsuzuki_channels').update(upd).eq('id', id);
    } catch (e) {
      await db.from('tsuzuki_channels').update({ last_fetch: new Date().toISOString(), fetch_error: String((e as Error)?.message || e).slice(0, 200) }).eq('id', id);
    }
  });
  return added;
}

// 長さ・ライブかどうかを、チャンネルの「動画」「ライブ」の一覧(長さが載っている)から埋める。
// 動画ごとの情報(player)はサーバーからだと断られるので使わない。1チャンネル1〜2回の問い合わせで30本ぶん埋まる
async function fillMeta(maxChannels: number) {
  const { data: rows } = await db.from('tsuzuki_videos').select('id, channel_id, meta_tries')
    .is('duration', null).eq('is_short', false).lt('meta_tries', 3)
    .order('published', { ascending: false }).limit(400);
  const byCh = new Map<string, Any[]>();
  for (const r of rows || []) {
    if (!byCh.has(r.channel_id)) {
      if (byCh.size >= maxChannels) continue;
      byCh.set(r.channel_id, []);
    }
    byCh.get(r.channel_id)!.push(r);
  }
  let filled = 0;
  await pool([...byCh.entries()], 4, async ([chId, list]) => {
    const want = new Map(list.map((r: Any) => [r.id, r]));
    for (const tab of ['videos', 'streams']) {
      if (!want.size) break;
      try {
        const p = await channelPage(chId, tab);
        for (const h of p.videos) {
          const row = want.get(h.id);
          if (!row) continue;
          const live = tab === 'streams' && (h.live || !h.dur);
          await db.from('tsuzuki_videos').update({ duration: h.dur || 0, is_live: live || h.live }).eq('id', h.id);
          want.delete(h.id);
          filled++;
        }
      } catch (_) { /* 次の回 */ }
    }
    for (const row of want.values()) {
      await db.from('tsuzuki_videos').update({ meta_tries: row.meta_tries + 1 }).eq('id', row.id);
    }
  });
  return filled;
}

async function refresh(n: number, metaN: number, force = false) {
  const staleBefore = new Date(Date.now() - (force ? 0 : 12 * 60e3)).toISOString();
  const { data: chs } = await db.from('tsuzuki_channels').select('id, last_fetch')
    .or(`last_fetch.is.null,last_fetch.lt.${staleBefore}`)
    .order('last_fetch', { ascending: true, nullsFirst: true }).limit(n);
  const ids = (chs || []).map((c: Any) => c.id);
  const added = ids.length ? await refreshChannels(ids) : 0;
  const filled = metaN ? await fillMeta(metaN) : 0;
  const { count } = await db.from('tsuzuki_channels').select('id', { count: 'exact', head: true })
    .or(`last_fetch.is.null,last_fetch.lt.${staleBefore}`);
  return { checked: ids.length, added, filled, stale: count || 0 };
}

async function subscribe(input: Any) {
  const id = await resolveChannel(input.id || input.url || input.handle || '');
  let meta = { id, title: String(input.title || ''), avatar: String(input.avatar || ''), handle: String(input.handle || '') };
  try {
    const p = await channelPage(id);
    meta = { id, title: p.meta.title || meta.title, avatar: p.meta.avatar || meta.avatar, handle: p.meta.handle || meta.handle };
  } catch (_) { /* RSS の題名で埋める */ }
  const { error } = await db.from('tsuzuki_channels').upsert({ id, title: meta.title, avatar: meta.avatar || null, handle: meta.handle || null }, { onConflict: 'id' });
  if (error) throw error;
  await refreshChannels([id]);
  await fillMeta(3);
  return { channel: meta };
}

// まとめて登録(YouTube の登録チャンネル一覧から取り込むとき)
async function importChannels(list: Any[]) {
  const rows = (list || [])
    .map((c) => ({ id: String(c.id || '').match(/UC[\w-]{22}/)?.[0] || '', title: String(c.title || ''), avatar: c.avatar ? String(c.avatar) : null, handle: c.handle ? String(c.handle) : null }))
    .filter((c) => c.id);
  if (!rows.length) return { imported: 0 };
  const { data: had } = await db.from('tsuzuki_channels').select('id').in('id', rows.map((r) => r.id));
  const known = new Set((had || []).map((r: Any) => r.id));
  const fresh = rows.filter((r) => !known.has(r.id));
  if (fresh.length) {
    const { error } = await db.from('tsuzuki_channels').insert(fresh);
    if (error) throw error;
  }
  // アイコンの無い既存行だけ埋める
  for (const r of rows.filter((r) => known.has(r.id) && r.avatar)) {
    await db.from('tsuzuki_channels').update({ avatar: r.avatar }).eq('id', r.id).is('avatar', null);
  }
  return { imported: fresh.length, total: rows.length };
}

// アイコンが無いチャンネルを少しずつ埋める
async function fillAvatars(limit: number) {
  const { data } = await db.from('tsuzuki_channels').select('id').is('avatar', null).limit(limit);
  let n = 0;
  await pool(data || [], 3, async (c: Any) => {
    try {
      const p = await channelPage(c.id);
      if (p.meta.avatar) {
        await db.from('tsuzuki_channels').update({ avatar: p.meta.avatar, handle: p.meta.handle || null, ...(p.meta.title ? { title: p.meta.title } : {}) }).eq('id', c.id);
        n++;
      }
    } catch (_) { /* 次の回 */ }
  });
  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, Any> = {};
  try {
    body = await req.json();
  } catch (_) {
    return json({ error: 'bad json' }, 400);
  }
  const who = await authorize(req, body);
  if (!who) return json({ error: 'bad key' }, 401);
  try {
    switch (body.action) {
      case 'search':
        return json(await search(String(body.q || '').slice(0, 200), body.cont));
      case 'video':
        return json(await video(String(body.id || '')));
      case 'channel':
        return json(await channelPage(String(body.id || ''), String(body.tab || 'videos'), body.cont));
      case 'resolve':
        return json({ id: await resolveChannel(String(body.url || '')) });
      case 'sub':
        return json(await subscribe(body));
      case 'import':
        return json(await importChannels(body.channels));
      case 'refresh': {
        const r = await refresh(Math.min(Number(body.n) || 30, 60), Math.min(Number(body.meta) || 6, 12), !!body.force);
        const av = await fillAvatars(4);
        return json({ ...r, avatars: av });
      }
      case 'cron': {
        const r = await refresh(25, 10);
        const av = await fillAvatars(12);
        // 200日より前の新着は片づける(履歴・あとで見るは題名を自分で持っているので消えない)
        const old = new Date(Date.now() - 200 * 864e5).toISOString();
        await db.from('tsuzuki_videos').delete().lt('published', old);
        return json({ ...r, avatars: av });
      }
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});
