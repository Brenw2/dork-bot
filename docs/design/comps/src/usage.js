// Card 25 / fix 12: Usage screen comps. Loaded after comps.js; reuses its parts (iphone, desktop, av, mix, I, ...).
// ALL per-bot, Codex, OpenRouter and daily numbers below are SAMPLE values for layout. Only the Claude windows
// (29% / 9%, resets 7:00 PM today / Sat 12:00 PM) come from `hermes usage --json`.
/* global frames, iphone, desktop, ROSTER, sidebar, drow, dChatHd, chatNav, status, row, listNav */
(() => {
  const start = frames.length;
  const WARN = '#F2A65A', OK = '#4CC38A';
  const TRACK = '#2A2D33';
  const SEL = mix(ACCENT, 0.3); // segmented selected fill (app-level accent)

  // ---------- sample "systems" bot (no sprite/color in repo yet): recolored coder sprite ----------
  const shiftHex = (hex, a) => { const [r, g, b] = rgb(hex); const f = (v) => Math.round(a >= 0 ? v + (255 - v) * a : v * (1 + a)).toString(16).padStart(2, '0'); return `#${f(r)}${f(g)}${f(b)}`; };
  { const from = BOTS.coder.color, to = '#B98B6E', svg = {};
    for (const [k, v] of Object.entries(BOTS.coder.svg)) {
      svg[k] = v.replace(new RegExp(from, 'gi'), to).replace(new RegExp(shiftHex(from, 0.28), 'gi'), shiftHex(to, 0.28)).replace(new RegExp(shiftHex(from, -0.25), 'gi'), shiftHex(to, -0.25)).replace(new RegExp(shiftHex(from, -0.4), 'gi'), shiftHex(to, -0.4));
    }
    BOTS.systems = { color: to, svg }; }

  // ---------- number formatting (this is the spec; REVIEW.md Fix 12 repeats it) ----------
  function fmtTok(n) {
    if (n < 1000) return String(Math.round(n));
    const tiers = [[1e9, 'B', 100], [1e6, 'M', 100], [1e3, 'K', 10]];
    for (const [d, s, lim] of tiers) {
      if (n >= d) {
        const v = n / d; const r = +v.toFixed(v < lim ? 1 : 0);
        if (r >= 1000 && s !== 'B') return fmtTok(r * d);
        return `${r}${s}`;
      }
    }
    return String(n);
  }
  const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtCost = (c) => (c === 0 ? '$0.00' : c < 0.005 ? '<$0.01' : '$' + c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const level = (shown) => (shown >= 91 ? 'bad' : shown >= 70 ? 'warn' : 'ok'); // on the ROUNDED integer
  const LV = { ok: { c: OK, w: '' }, warn: { c: WARN, w: 'Running low' }, bad: { c: BAD, w: 'Almost out' } };

  // ---------- sample data ----------
  const BU = [
    { bot: 'chief', in: 4812000, out: 912400, cache: 21600000, calls: 1284, tools: 2310, cost: 18.42, top: 'claude-opus-5-5 · Anthropic' },
    { bot: 'mobile', in: 3391000, out: 780200, cache: 14100000, calls: 903, tools: 1822, cost: 12.3, top: 'claude-sonnet-5-5 · Anthropic' },
    { bot: 'design', in: 2104000, out: 405300, cache: 9300000, calls: 612, tools: 1104, cost: 7.96, top: 'claude-opus-5-5 · Anthropic' },
    { bot: 'assistant', in: 1216000, out: 210000, cache: 0, calls: 482, tools: 640, cost: 0, top: 'gemma4:31b · Dork' },
    { bot: 'schedules', in: 640000, out: 98700, cache: 2900000, calls: 231, tools: 402, cost: 3.41, top: 'claude-sonnet-5-5 · Anthropic' },
    { bot: 'homelab', in: 310400, out: 52100, cache: 0, calls: 96, tools: 188, cost: 0, top: 'gemma4:31b · Dork' },
    { bot: 'systems', in: 0, out: 0, cache: 0, calls: 0, tools: 0, cost: 0, top: '' },
  ];
  const TOT = BU.reduce((a, b) => ({ tok: a.tok + b.in + b.out, cost: a.cost + b.cost, calls: a.calls + b.calls }), { tok: 0, cost: 0, calls: 0 });
  const LOCAL_TOK = BU.filter((b) => /gemma/.test(b.top)).reduce((a, b) => a + b.in + b.out, 0);
  const CHIEF_MODELS = [
    { m: 'claude-opus-5-5 · Anthropic', in: 3540000, out: 690400, calls: 980, cost: 15.37 },
    { m: 'claude-sonnet-5-5 · Anthropic', in: 1100000, out: 200000, calls: 270, cost: 3.05 },
    { m: 'gemma4:31b · Dork', in: 172000, out: 22000, calls: 34, cost: 0 },
  ];
  const W30 = [3, 5, 6, 2, 0, 1, 7, 8, 6, 9, 5, 1, 0, 6, 9, 11, 8, 7, 2, 1, 5, 10, 12, 9, 8, 3, 0, 7, 11, 6];
  const chiefTok = 4812000 + 912400;
  const DAYS = (() => { const s = W30.reduce((a, b) => a + b, 0); const d = W30.map((w) => Math.round((w / s) * chiefTok)); d[d.length - 1] += chiefTok - d.reduce((a, b) => a + b, 0); return d; })();
  const dateOf = (i, n = 30) => { const dt = new Date(2026, 10, 17 - (n - 1 - i)); return dt; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dl = (dt) => `${MON[dt.getMonth()]} ${dt.getDate()}`;

  // ---------- parts ----------
  const chipIco = `<span style="display:flex">${I.chip}</span>`;
  function ring(p, c, trackC = TRACK) {
    const C2 = 2 * Math.PI * 7.5, f = Math.max(0, Math.min(1, p / 100));
    return `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="none" stroke="${trackC}" stroke-width="3"/><circle cx="10" cy="10" r="7.5" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(f * C2).toFixed(2)} ${C2.toFixed(2)}" transform="rotate(-90 10 10)"/></svg>`;
  }
  function gauge(p, o = {}) {
    const lv = level(Math.round(p)); const c = LV[lv].c;
    const bg = lv === 'ok' ? (o.sel ? 'var(--raised)' : 'var(--card)') : mix(c, lv === 'warn' ? 0.14 : 0.18);
    return `<div class="u-gauge ${o.d ? 'd' : ''}" style="background:${bg};color:${lv === 'ok' ? TEXT : c}">${ring(p, c)}<span>${Math.round(p)}%</span></div>`;
  }
  const meter = (p) => { const r = Math.round(p), lv = level(r); return `<div class="u-bar"><i style="width:${r > 0 ? Math.max(8, 0) && `max(8px,${Math.min(r, 100)}%)` : '0'};background:${LV[lv].c}"></i></div>`; };
  function win(label, p, reset) {
    const r = Math.round(p), lv = level(r); const word = r >= 100 ? 'Limit reached' : LV[lv].w;
    return `<div class="u-row"><div class="u-w1"><span class="u-wl">${label}</span><span class="u-wp" style="color:${lv === 'ok' ? TEXT : LV[lv].c}">${r}%</span></div>${meter(p)}<div class="u-w2"><span>${reset}</span>${word ? `<b style="color:${LV[lv].c}">${word}</b>` : ''}</div></div>`;
  }
  const head = (name, detail) => `<div class="u-head"><div class="u-disc">${chipIco}</div><div><div class="n">${name}</div><div class="d">${detail}</div></div></div>`;
  const CLAUDE = (d) => `<div class="${d ? 'u-dgrp' : 'u-grp'}">${head('Claude', 'Anthropic subscription')}${win('Current session', 29, 'Resets in 1h 59m · 7:00 PM')}${win('Current week', 9, 'Resets in 3d 18h · Sat 12:00 PM')}</div>`;
  const CODEX = (d) => `<div class="${d ? 'u-dgrp' : 'u-grp'}">${head('Codex', 'OpenAI subscription')}${win('5-hour', 78, 'Resets in 2h 14m · 7:15 PM')}${win('Weekly', 93, 'Resets in 2d 15h · Fri 9:00 AM')}</div>`;
  const ORCREDIT = (d) => `<div class="${d ? 'u-dgrp' : 'u-grp'}">${head('OpenRouter', 'Credits')}<div class="u-row"><div class="u-cred"><span class="u-wl">Credits</span><span class="u-wp">$12.40</span></div><div class="u-w2" style="margin-top:2px"><span>Balance from OpenRouter</span></div></div></div>`;
  const COPILOT = (d) => `<div class="${d ? 'u-dgrp' : 'u-grp'}">${head('GitHub Copilot', 'Subscription')}<div class="u-row"><div class="u-none">No usage data from Hermes</div></div></div>`;
  const OLLAMA = (d, per = '30 days') => `<div class="${d ? 'u-dgrp' : 'u-grp'}">${head('Dork (Ollama)', 'Local model · no limits')}<div class="u-row"><div class="u-cred"><span class="u-wl">Tokens · ${per}</span><span class="u-wp">${fmtTok(LOCAL_TOK)}</span></div></div></div>`;
  const updated = (t = 'Updated 1 min ago') => `<div class="u-upd">${t}</div>`;
  const seg = (on = 1, c = SEL, d) => `<div class="u-seg ${d ? 'u-dseg' : ''}" style="--sel:${c}">${['7 days', '30 days', '90 days'].map((t, i) => `<div class="${i === on ? 'on' : ''}">${t}</div>`).join('')}</div>`;
  const botRow = (b) => {
    const idle = b.in + b.out + b.calls === 0;
    return `<div class="u-brow ${idle ? 'idle' : ''}">${av(b.bot, 40, idle ? 'sleeping' : undefined)}<div class="m"><div class="l1"><div class="nm">${b.bot}</div><div class="cost">${idle ? '—' : fmtCost(b.cost)}</div><span class="chev">›</span></div>${idle ? '<div class="l2">No activity in 30 days</div>' : `<div class="l2">${fmtTok(b.in)} in · ${fmtTok(b.out)} out · ${fmtInt(b.calls)} calls</div><div class="l2">${b.top}</div>`}</div></div>`;
  };
  const totals = (d) => `<div class="${d ? 'u-dtot' : 'u-tot'}"><div><div class="v">${fmtTok(TOT.tok)}</div><div class="l">Tokens</div></div><div><div class="v">${fmtInt(TOT.calls)}</div><div class="l">API calls</div></div><div><div class="v">${fmtCost(TOT.cost)}</div><div class="l">Est. cost</div></div></div>`;
  const uNav = () => `<div class="nav"><div class="back" ${color(ACCENT)}>${I.back}<span>Bots</span></div><div class="grow"></div></div>`;
  const uTitle = (t) => `<div class="largetitle">Usage</div>${updated(t)}`;

  // ---------- 25-usage--iphone (top) ----------
  iphone('25-usage--iphone', `${uNav()}${uTitle()}<div class="u-body"><div class="u-sec" style="padding-top:10px">Subscriptions</div>${CLAUDE()}${CODEX()}${ORCREDIT()}</div>`,
    ann(16, 118, 'Updated line 13/18 dim · pull down to refresh') + ann(200, 232, 'bar 8 tall r4 · % 17 semibold · state word 13 semibold') + ann(200, 330, 'under 70 #4CC38A') + ann(200, 536, '70-90 #F2A65A · over 90 #F06A6A'));

  // ---------- 25-usage-scrolled--iphone (same screen, scrolled to Bots) ----------
  iphone('25-usage-scrolled--iphone', `<div class="nav hair" style="justify-content:center;font:600 17px var(--font)"><div class="back" style="position:absolute;left:0;color:${ACCENT}">${I.back}<span>Bots</span></div>Usage</div><div class="u-body"><div class="u-sec" style="padding-top:12px">Subscriptions</div>${COPILOT()}${OLLAMA()}<div class="u-sec">Bots</div>${seg(1)}${totals()}<div class="u-grp" style="margin-top:12px">${BU.map(botRow).join('')}</div></div>`,
    ann(16, 214, 'no data: one dim line, never a bar') + ann(16, 296, 'local: tokens only (follows the 7/30/90 control)') + ann(200, 384, '7 / 30 / 90 · selected = mix(#8B7CF6,.30)') + ann(200, 640, 'row: avatar 40 · name · est. cost · › · 2 detail lines'));

  // ---------- 25-usage-states--iphone ----------
  const skel = `<div class="u-grp">${`<div class="u-head"><span class="sk" style="width:32px;height:32px;border-radius:16px"></span><div><span class="sk" style="width:90px;height:14px"></span><span class="sk" style="width:140px;height:11px;margin-top:6px"></span></div></div>`}${[0].map(() => `<div class="u-row"><div class="u-w1"><span class="sk" style="width:120px;height:14px"></span><span class="sk" style="width:34px;height:14px"></span></div><div class="u-bar" style="margin:10px 0 8px"></div><span class="sk" style="width:180px;height:11px"></span></div>`).join('')}</div>`;
  iphone('25-usage-states--iphone', `<div class="nav hair" style="justify-content:center;font:600 17px var(--font)">Usage states</div><div class="u-body">
    <div class="u-lbl">Loading, first open: skeleton card, Updated line says “Updating…”</div><div class="u-upd" style="padding-bottom:8px"><span class="spin"></span>Updating…</div>${skel}
    <div class="u-lbl" style="padding-top:2px">Refresh failed, data kept: banner above the cards, old numbers stay</div><div class="u-banner"><span style="color:${BAD};width:18px;height:18px;display:flex;flex:none">${I.warn}</span><div class="grow">Couldn’t update. Showing data from 9:38 AM.</div><div class="sbtn" style="background:${mix(BAD, 0.25)};color:${TEXT}">Retry</div></div>
    <div class="u-lbl" style="padding-top:2px">One provider can’t be read: only its card changes</div><div class="u-grp">${head('Codex', 'OpenAI subscription')}<div class="u-row" style="display:flex;align-items:center;gap:8px"><div class="u-none" style="flex:1">Couldn’t read Codex usage</div><div class="sbtn" style="background:var(--raised);color:${TEXT}">Retry</div></div></div>
    <div class="u-lbl" style="padding-top:2px">Nothing cached and Hermes unreachable</div><div class="u-center"><span style="width:36px;height:36px;color:${DIM};display:flex">${I.warn}</span><div class="t">Can’t reach b-lab</div><div class="s">Usage comes from Hermes. Check the connection and try again.</div><div class="btn pill" style="height:50px;width:100%;margin-top:14px;background:${ACCENT};color:#fff;font-size:17px">Try again</div></div>
    <div class="u-lbl" style="padding-top:12px">Bots, a quiet period</div><div class="u-grp"><div class="u-row"><div class="u-none">No bot activity in the last 7 days</div></div></div></div>`,
    '');

  // ---------- bot detail ----------
  const niceMax = (v) => { const e = 10 ** Math.floor(Math.log10(v)); const m = v / e; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e; };
  function chart(bot, w, h, selIdx, n = 30, gap = 2) {
    const c = C(bot), data = DAYS, max = niceMax(Math.max(...data));
    const bars = data.map((v, i) => `<i style="height:${v ? Math.max(2, (v / max) * h) : 0}px;background:${selIdx == null || i === selIdx ? c : mix(c, 0.45)}"></i>`).join('');
    const colW = (w - gap * (n - 1)) / n; const cx = selIdx == null ? 0 : selIdx * (colW + gap) + colW / 2;
    const dt = selIdx == null ? null : dateOf(selIdx);
    const call = selIdx == null ? '' : `<div class="u-call" style="left:${Math.max(0, Math.min(w - 196, cx - 98))}px;top:-36px"><b>${WD[dt.getDay()]}, ${dl(dt)}</b> · ${fmtTok(data[selIdx])} tokens</div>`;
    return { html: `<div class="u-plot" style="height:${h}px;margin-top:30px;width:${w}px"><div class="gl" style="top:0"><span>${fmtTok(max)}</span></div><div class="gl" style="top:${h / 2}px"><span>${fmtTok(max / 2)}</span></div><div class="gl" style="top:${h}px"></div><div class="u-bars" style="gap:${gap}px">${bars}</div>${call}</div><div class="u-xl" style="width:${w}px"><span>${dl(dateOf(0))}</span><span>${dl(dateOf(15))}</span><span>Today</span></div>` };
  }
  const MODELS = (c) => `<div class="u-grp">${CHIEF_MODELS.map((m) => { const t = m.in + m.out; const sh = t / chiefTok; return `<div class="u-mrow"><div class="l1"><div class="nm">${m.m.split(' · ')[0]}</div><div class="pr">${fmtCost(m.cost)}</div></div><div class="sub">${m.m.split(' · ')[1]}</div><div class="u-share"><i style="width:${(sh * 100).toFixed(1)}%;background:${c}"></i></div><div class="sub">${fmtTok(m.in)} in · ${fmtTok(m.out)} out · ${fmtInt(m.calls)} calls · ${Math.round(sh * 100)}%</div></div>`; }).join('')}</div>`;
  const cb = BU[0];
  const tiles6 = [[fmtTok(cb.in), 'Input'], [fmtTok(cb.out), 'Output'], [fmtTok(cb.cache), 'Cache'], [fmtInt(cb.calls), 'API calls'], [fmtInt(cb.tools), 'Tool calls'], [fmtCost(cb.cost), 'Est. cost']];
  const botNav = (bot) => `<div class="chatnav"><div class="back" ${color(C(bot))}>${I.back}<span>Usage</span></div><div class="grow" style="flex:1;display:flex;justify-content:center;min-width:0"><div class="ttl">${av(bot, 32)}<div style="min-width:0"><div class="t1">${bot}</div><div class="t2">Last 30 days</div></div></div></div><div style="width:68px"></div></div>`;
  const c1 = C('chief');
  iphone('25-usage-bot-detail--iphone', `${botNav('chief')}<div class="u-body">${seg(1, mix(c1, 0.3))}<div class="u-tiles">${tiles6.map(([v, l]) => `<div class="u-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div><div class="u-sec" style="padding-top:16px">Tokens per day</div><div class="u-chart">${chart('chief', 297, 132, 22).html}</div><div class="u-sec">By model</div>${MODELS(c1)}<div class="u-foot">Tokens are input plus output. Cache is counted on its own. Costs are Hermes estimates.</div></div>`,
    ann(16, 128, 'segmented control carries over from Usage · bot color') + ann(16, 252, '6 tiles: 3 across, 68 tall, value 20 semibold') + ann(200, 380, 'tap or drag = day callout') + ann(16, 640, 'share bar 4 tall · bot color'));
  desktop('25-usage-bot-detail--desktop', `<div class="dwin">${uSide({ gauge: 29 })}<div class="main"><div class="dhd"><div class="back" style="padding-left:14px;color:${c1};font-size:15px">${I.back}<span>Usage</span></div><div class="ttl" style="margin-left:8px">${av('chief', 32)}<div style="min-width:0"><div class="t1">chief</div><div class="t2">Last 30 days</div></div></div><div style="flex:1"></div><div style="width:240px">${seg(1, mix(c1, 0.3), true).replace('margin:0 0 10px', '')}</div></div><div style="flex:1;padding:16px 24px;overflow:hidden"><div style="max-width:760px;margin:0 auto"><div class="u-dtiles">${tiles6.map(([v, l]) => `<div class="u-tile"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('')}</div><div class="u-dsec">Tokens per day</div><div class="u-chart" style="margin:0;padding:16px 16px 10px 20px">${chart('chief', 664, 168, 22, 30, 3).html}</div><div class="u-dsec">By model</div><div class="u-dgrp">${CHIEF_MODELS.map((m) => { const t = m.in + m.out; const sh = t / chiefTok; return `<div class="u-mrow" style="padding:10px 14px"><div class="l1"><div class="nm" style="font-size:15px">${m.m.split(' · ')[0]} <span class="sub">${m.m.split(' · ')[1]}</span></div><div class="sub">${fmtTok(m.in)} in · ${fmtTok(m.out)} out · ${fmtInt(m.calls)} calls · ${Math.round(sh * 100)}%</div><div class="pr" style="font-size:15px;width:64px;text-align:right">${fmtCost(m.cost)}</div></div><div class="u-share" style="margin:6px 0 0"><i style="width:${(sh * 100).toFixed(1)}%;background:${c1}"></i></div></div>`; }).join('')}</div></div></div></div></div>`,
    ann(400, 4, 'detail replaces the Usage pane; sidebar stays · “‹ Usage” returns') + ann(1000, 300, 'bars 3 gap, hover = same callout'));

  // ---------- desktop main ----------
  function uSide(o) {
    const rows = ROSTER.map((r) => drow(r)).join('');
    return `<div class="side"><div class="sidehd"><div class="t">Dork Bot</div>${gauge(o.gauge, { d: true, sel: o.sel })}<div class="dib" ${color(DIM)}>${I.more}</div><div class="dib" ${color(TEXT)}>${I.compose}</div></div><div style="display:flex;flex-direction:column;gap:2px">${rows}</div></div>`;
  }
  const dBotRow = (b, hov) => { const idle = b.in + b.out + b.calls === 0; return `<div class="u-dbrow ${idle ? 'idle' : ''} ${hov ? 'hov' : ''}">${av(b.bot, 36, idle ? 'sleeping' : undefined)}<div class="m"><div class="nm">${b.bot}</div><div class="l2">${idle ? 'No activity in 30 days' : `${fmtTok(b.in)} in · ${fmtTok(b.out)} out · ${fmtInt(b.calls)} calls · ${b.top.split(' · ')[0]}`}</div></div><div class="cost">${idle ? '—' : fmtCost(b.cost)}</div><span class="chev">›</span></div>`; };
  desktop('25-usage--desktop', `<div class="dwin">${uSide({ gauge: 29, sel: true })}<div class="main"><div class="dhd"><div class="ttl" style="margin-left:8px"><div style="min-width:0"><div class="t1">Usage</div><div class="t2">Updated 1 min ago</div></div></div><div style="flex:1"></div><div class="dib" ${color(DIM)} title="Refresh">${I.retry}</div></div><div class="u-dcols"><div><div class="u-dsec f">Subscriptions</div>${CLAUDE(true)}${CODEX(true)}${ORCREDIT(true)}${COPILOT(true)}${OLLAMA(true)}</div><div><div class="u-dsec f">Bots</div>${seg(1, SEL, true)}${totals(true)}<div class="u-dgrp" style="margin-top:0">${BU.map((b, i) => dBotRow(b, i === 1)).join('')}</div></div></div></div></div>`,
    ann(330, 62, 'two columns, 24 gutter · each scrolls on its own · no pull to refresh: use ↻ (32) or Ctrl+R') + ann(1000, 4, 'header gauge shows selected while Usage is open'));

  // ---------- header gauge ----------
  const gnav = (p) => `<div class="u-gnav">${`<div class="u-ghit">${gauge(p)}</div>`}<div class="grow" style="flex:1"></div><div class="ibtn" ${color(ACCENT)}>${I.more}</div><div class="ibtn" ${color(ACCENT)}>${I.compose}</div></div><div class="largetitle">Dork Bot</div>`;
  const gblock = (label, p, r) => `<div class="u-lbl" style="padding-top:8px">${label}</div>${gnav(p)}${row(r)}`;
  iphone('25-header-gauge--iphone', `<div style="flex:1;overflow:hidden">${gblock('Normal · under 70% · 29% (Claude, Current session)', 29, ROSTER[0])}${gblock('Warning · 70-90% · 78% (Codex, 5-hour)', 78, ROSTER[1])}${gblock('Red · over 90% · 94% (Claude, Current week)', 94, ROSTER[2])}<div class="u-foot" style="padding:12px 16px 0">Shows the highest used window across every provider. Tap opens Usage. Hidden until the first successful load, and when no provider reports a percent.</div></div>`,
    ann(8, 124, 'pill 32 tall in a 44×44 hit · left of the nav row · ring 20, stroke 3'));
  const gcol = (label, p) => `<div style="width:400px;border:.5px solid var(--border);border-radius:12px;overflow:hidden;background:#0D0E10"><div class="u-lbl" style="padding:10px 18px 0">${label}</div><div class="sidehd" style="padding:0 10px 0 18px"><div class="t" style="font:700 17px var(--font);flex:1">Dork Bot</div>${gauge(p, { d: true })}<div class="dib" ${color(DIM)}>${I.more}</div><div class="dib" ${color(TEXT)}>${I.compose}</div></div>${[ROSTER[0], ROSTER[1]].map((r) => `<div style="margin:2px 0">${drow(r)}</div>`).join('')}</div>`;
  desktop('25-header-gauge--desktop', `<div style="display:flex;gap:24px;padding:48px 40px 0">${gcol('Normal · 29%', 29)}${gcol('Warning · 78%', 78)}${gcol('Red · 94%', 94)}</div><div style="padding:32px 40px;font:400 14px/22px var(--font);color:${DIM};max-width:900px">Sidebar header: title, gauge pill (32 tall, ring 20, 13 semibold %), ⋯, New bot. Click opens Usage in the main pane; the pill takes the #22252A selected fill while Usage is open. Tooltip: “Claude · Current session · 29% used”. Same thresholds and colors as iPhone.</div>`);

  // lock text uses this card's date
  for (let i = start; i < frames.length; i++) frames[i] = frames[i].replace('LOCKED 2026-11-12', 'LOCKED 2026-11-17');
  document.body.insertAdjacentHTML('beforeend', frames.slice(start).join('\n'));
})();
