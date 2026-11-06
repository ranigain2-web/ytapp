#!/usr/bin/env python3
# patch-server-phase4.py — phase-4 server endpoints (channel tabs, playlist,
# comments replies + continuation)
import re

p = "server/index.mjs"
s = open(p).read()

# ---- 1) extend getComments: per-thread replies_token + page continuation ----
old = """      const c = await pool.withRetry(async yt => await yt.getComments(id, sort === 'new' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'), { label: `comments ${id}` });
      const items = (c.contents || []).map(t => t.comment || t).filter(Boolean);
      return {
        comments: items.map(cm => ({
          author: String(cm.author?.name || cm.author?.text || 'User'),
          author_id: cm.author?.id || '',
          author_thumb: cm.author?.best_thumbnail?.url || '',
          text: typeof cm.content === 'string' ? cm.content : String(cm.content?.text || ''),
          likes: cm.like_count || 0,
          time: String(cm.published_time?.text || cm.published_time || ''),
          replies: (cm.reply_count || 0),
          creator_heart: !!cm.creator_heart,
        })).filter(c2 => c2.text),
        count: c.comment_count || null,
      };"""
new = """      const c = await pool.withRetry(async yt => await yt.getComments(id, sort === 'new' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'), { label: `comments ${id}` });
      const threads = (c.contents || []);
      // per-thread replies token: the continuation item inside comment_replies_data
      const repliesToken = (t) => {
        try {
          const crd = t?.comment_replies_data;
          const ci = crd?.sub_threads?.firstOfType?.(ContinuationItem);
          const ep = ci?.button?.endpoint || ci?.endpoint;
          return String(ep?.payload?.token || ep?.payload?.continuation || '') || '';
        } catch { return ''; }
      };
      const items = threads.map(t => ({ thread: t, cm: t.comment || t })).filter(x => x.cm);
      // page continuation token (more comments) — last ContinuationItem in the list
      let continuation = null;
      try {
        const cont = threads.firstOfType?.(ContinuationItem);
        continuation = String(cont?.endpoint?.payload?.token || cont?.endpoint?.payload?.continuation || '') || null;
      } catch { /* page has no continuation */ }
      return {
        comments: items.map(({ thread, cm }) => ({
          author: String(cm.author?.name || cm.author?.text || 'User'),
          author_id: cm.author?.id || '',
          author_thumb: cm.author?.best_thumbnail?.url || '',
          text: typeof cm.content === 'string' ? cm.content : String(cm.content?.text || ''),
          likes: cm.like_count || 0,
          time: String(cm.published_time?.text || cm.published_time || ''),
          replies: (cm.reply_count || thread?.has_replies ? cm.reply_count || 1 : 0),
          creator_heart: !!cm.creator_heart,
          pinned: thread?.rendering_priority === 'RENDERING_PRIORITY_PINNED_COMMENT',
          replies_token: (thread?.has_replies && !thread?.is_prepopulated) ? repliesToken(thread) : '',
        })).filter(c2 => c2.text),
        count: c.comment_count || null,
        continuation,
      };"""
assert old in s, "getComments block not found"
s = s.replace(old, new, 1)

# ---- 2) shared comments-continuation executor (page more + replies) ----
anchor = "// ----------------------------------------------------------------------------\n// HLS manifest proxy"
addition = """// Statelessly continue a comments flow (page more / thread replies) by its
// continuation token: execute /next and map the returned comment threads.
async function continueComments(token, { label } = {}) {
  if (!token) return { comments: [], replies: [], continuation: null };
  return cache.wrap(`commentsCont:${token}`, 30 * 60 * 1000, async () => {
    return pool.withRetry(async yt => {
      const response = await yt.actions.execute('/next', { continuation: token, parse: true });
      const endpoints = response?.on_response_received_endpoints || [];
      let nodes = [];
      for (const ep of endpoints) {
        const contents = ep?.contents || ep?.reloadContinuationItemsCommand?.contents;
        if (Array.isArray(contents) && contents.length) nodes = contents;
      }
      const mapComment = (t) => {
        const cm = t?.comment || t;
        if (!cm || !cm.author) return null;
        const text = typeof cm.content === 'string' ? cm.content : String(cm.content?.text || '');
        if (!text) return null;
        return {
          author: String(cm.author?.name || 'User'),
          author_id: cm.author?.id || '',
          author_thumb: cm.author?.best_thumbnail?.url || '',
          text,
          likes: cm.like_count || 0,
          time: String(cm.published_time?.text || cm.published_time || ''),
          replies: (cm.reply_count || 0),
          creator_heart: !!cm.creator_heart,
          pinned: t?.rendering_priority === 'RENDERING_PRIORITY_PINNED_COMMENT',
          replies_token: '',
        };
      };
      const comments = [];
      const replies = [];
      let continuation = null;
      for (const node of nodes) {
        if (node?.comment || node?.author) {
          const m = mapComment(node);
          if (m) { comments.push(m); replies.push(m); }
        } else if (node?.endpoint || node?.type === 'ContinuationItem') {
          const tok = node?.endpoint?.payload?.token || node?.endpoint?.payload?.continuation;
          if (tok) continuation = String(tok);
        }
      }
      return { comments, replies, continuation };
    }, { label: label || `commentsCont ${token.slice(0, 12)}` });
  });
}

// ----------------------------------------------------------------------------
// Phase 4: channel tabs (videos | shorts | playlists | about)
// ----------------------------------------------------------------------------
async function getChannelTab(id, tab) {
  return cache.wrap(`channelTab:${id}:${tab}`, 30 * 60 * 1000, async () => {
    return pool.withRetry(async yt => {
      const ch = await yt.getChannel(id);

      if (tab === 'about') {
        const about = await ch.getAbout();
        const text = (x) => String(x?.text ?? x ?? '');
        return {
          tab,
          about: {
            description: text(about?.description),
            total_views: text(about?.total_views),
            joined: text(about?.joined_date),
            country: text(about?.country),
            video_count: text(about?.video_count),
            links: (about?.links || []).map(l => text(l?.title) || text(l?.url)).filter(Boolean).slice(0, 5),
          },
        };
      }

      if (tab === 'playlists') {
        const page = await ch.getPlaylists();
        const playlists = (page?.playlists || []).map(p => {
          const pid = p?.content_id || p?.id || '';
          const title = String(p?.metadata?.title?.text || p?.title?.text || '').trim();
          if (!pid || !title) return null;
          let thumb = '';
          let count = '';
          try { thumb = p?.content_image?.image?.[0]?.url || p?.thumbnails?.[0]?.url || ''; } catch {}
          try {
            const rows = p?.metadata?.metadata?.metadata_rows || [];
            const parts = rows.flatMap(r => (r.metadata_parts || []).map(x => String(x?.text?.text || x?.text || '')));
            count = parts.find(x => /\\d+\\s+videos?/i.test(x)) || '';
          } catch {}
          return { id: pid, title, thumb, count };
        }).filter(Boolean);
        return { tab, playlists };
      }

      if (tab === 'shorts') {
        const page = await ch.getShorts();
        const list = page?.shorts || [];
        const shorts = list.map(sv => {
          const sid = sv?.content_id || sv?.id || '';
          if (!sid) return null;
          const title = String(sv?.metadata?.title?.text || '').trim();
          let views = '';
          try {
            const rows = sv?.metadata?.metadata?.metadata_rows || [];
            const parts = rows.flatMap(r => (r.metadata_parts || []).map(x => String(x?.text?.text || x?.text || '')));
            views = parts.find(x => /view/i.test(x)) || '';
          } catch {}
          return { id: sid, title, views };
        }).filter(Boolean);
        return { tab, shorts };
      }

      // default: videos tab
      const page = await ch.getVideos();
      const videos = (page?.videos || []).map(normalizeVideo).filter(Boolean).slice(0, 36);
      return { tab: 'videos', videos };
    }, { label: `channelTab ${id} ${tab}` });
  });
}

// ----------------------------------------------------------------------------
// Phase 4: playlist contents (queue-style watch page)
// ----------------------------------------------------------------------------
async function getPlaylistInfo(playlistId) {
  return cache.wrap(`playlist:${playlistId}`, 30 * 60 * 1000, async () => {
    return pool.withRetry(async yt => {
      const pl = await yt.getPlaylist(playlistId);
      const author = pl?.info?.author;
      const videos = (pl?.items || []).map(v => {
        const n = normalizeVideo(v);
        if (n && !n.channel && author?.name) n.channel = String(author.name);
        return n;
      }).filter(Boolean);
      return {
        id: playlistId,
        title: String(pl?.info?.title?.toString?.() || ''),
        channel: String(author?.name || ''),
        channel_id: String(author?.id || ''),
        count: String(pl?.info?.total_items?.toString?.() || ''),
        videos,
      };
    }, { label: `playlist ${playlistId}` });
  });
}

"""
assert anchor in s, "HLS anchor not found"
s = s.replace(anchor, addition + anchor, 1)

# ---- 3) import ContinuationItem ----
s = s.replace("import { Innertube } from 'youtubei.js';",
              "import { Innertube, YTNodes } from 'youtubei.js';\nconst { ContinuationItem } = YTNodes;", 1)

# ---- 4) routes ----
old_routes = """app.get('/api/channel/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\\w-]{2,60}$/.test(id)) return res.status(400).json({ error: 'Bad channel id' });
  res.json(await getChannelInfo(id));
}));"""
new_routes = old_routes + """

app.get('/api/channel/:id/tabs', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\\w-]{2,60}$/.test(id)) return res.status(400).json({ error: 'Bad channel id' });
  const tab = String(req.query.tab || 'videos');
  if (!['videos', 'shorts', 'playlists', 'about'].includes(tab)) return res.status(400).json({ error: 'Bad tab' });
  res.json(await getChannelTab(id, tab));
}));

app.get('/api/playlist/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\\w-]{4,60}$/.test(id)) return res.status(400).json({ error: 'Bad playlist id' });
  res.json(await getPlaylistInfo(id));
}));

app.get('/api/video/:id/comments/more', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  const r = await continueComments(token, { label: 'comments more' });
  res.json({ comments: r.comments, continuation: r.continuation });
}));

app.get('/api/video/:id/comments/replies', wrap(async (req, res) => {
  const token = String(req.query.token || '');
  const r = await continueComments(token, { label: 'comments replies' });
  res.json({ replies: r.replies, continuation: r.continuation });
}));"""
assert old_routes in s, "channel route not found"
s = s.replace(old_routes, new_routes, 1)

open(p, "w").write(s)
print("server patched")
