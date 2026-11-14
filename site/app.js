/* Goatpedia — static single-page site. Data: library.json (built from entries/*.yaml).
   Routes:  #/                       browse + search   (#/?q=…&cat=…)
            #/e/<id>[/<tab>[/<n>]]   article, tab, log index
            #/sourcetypes  #/cves    indexes                                        */
(() => {
  const REPO = 'https://github.com/wvdlinde-cribl/goatpedia';
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app');
  let LIB = null, CATS = {}, ENTRIES = [];

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (id) => ENTRIES.find((e) => e.id === id);
  const cveIds = (e) => (e.cves ? e.cves.map((c) => c.id) : e.cveIds || []);
  const cvssColor = (v) => (v >= 9 ? '#c92a2a' : v >= 7 ? '#e8590c' : v >= 4 ? '#f08c00' : '#2f9e44');
  const sevColor = (s) => ({ critical: '#c92a2a', high: '#e8590c', medium: '#f08c00', low: '#2f9e44' }[s] || '#868e96');
  const editUrl = (id) => `${REPO}/edit/main/entries/${id}.yaml`;
  const newUrl = `${REPO}/new/main/entries?filename=new-device.yaml`;

  const { parseLog, SEP } = window.SecpediaParse;
  const parsed = (l) => { try { return parseLog(l).map((f) => ({ ...f, key: (l.key || []).includes(f.name), noise: (l.noise || []).includes(f.name) })); } catch { return []; } };
  const logHtml = (l) => {
    const p = parsed(l);
    if (!p.length) return esc(l.sample);
    return p.map((f) => `<span class="lf ${f.key ? 'k' : f.noise ? 'n' : ''}" data-i="${f.i}" title="${f.i}: ${esc(f.name)}">${esc(f.text) || '<i>∅</i>'}</span>`)
      .join(`<span class="lc">${esc(SEP[l.format] || ' ')}</span>`);
  };
  const mitreUrl = (t) => `https://attack.mitre.org/techniques/${t.replace('.', '/')}/`;

  function mark(text, q) {
    let s = esc(text);
    for (const t of String(q || '').split(/\s+/).filter((x) => x.length > 1))
      s = s.replace(new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'), '<mark>$1</mark>');
    return s;
  }

  // Weighted search: every token must hit somewhere
  function search(q) {
    const toks = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const sortName = (a, b) => (a.e.status === b.e.status ? a.e.name.localeCompare(b.e.name) : a.e.status === 'full' ? -1 : 1);
    if (!toks.length) return ENTRIES.map((e) => ({ e, score: 0 })).sort(sortName);
    const W = { name: 10, sourcetype: 8, cve: 8, vendor: 6, category: 5, tag: 3, text: 1 };
    const out = [];
    for (const e of ENTRIES) {
      const hay = {
        name: [e.name, e.short, ...(e.aka || [])].join(' ').toLowerCase(),
        vendor: e.vendor.toLowerCase(),
        sourcetype: e.sourcetypes.map((s) => s.st).join(' ').toLowerCase(),
        category: ((CATS[e.category]?.label || '') + ' ' + e.category).toLowerCase(),
        tag: (e.tags || []).join(' ').toLowerCase(),
        cve: cveIds(e).join(' ').toLowerCase(),
        // index.json carries the how-it-works and detection words pre-joined as e.text.
        text: [e.summary, e.text != null ? e.text : [...(e.howItWorks || []).map((h) => h.title + ' ' + h.body), ...(e.detections || []).map((d) => d.title + ' ' + d.signals.join(' '))].join(' ')].join(' ').toLowerCase(),
      };
      let score = 0, all = true;
      for (const t of toks) {
        let hit = false;
        for (const k in hay) if (hay[k].includes(t)) { score += W[k]; hit = true; }
        if (!hit) { all = false; break; }
      }
      if (all) out.push({ e, score: score + (e.status === 'full' ? 2 : 0) });
    }
    return out.sort((a, b) => b.score - a.score || sortName(a, b));
  }

  // Network placement diagram (SVG)
  function diagram(e) {
    const t = { bg: '#f8fafc', box: '#fff', stroke: '#cbd5e1', text: '#14212b', muted: '#64748b', accent: '#0ea5a4', line: '#cbd5e1' };
    const slots = { edge: [205, 175], internal: [515, 175], cloud: [640, 92], remote: [80, 300], dmz: [385, 118], endpoint: [380, 300] };
    const box = (x, y, w, h, label, sub) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${t.box}" stroke="${t.stroke}"/>
      <text x="${x + w / 2}" y="${y + h / 2 - (sub ? 4 : -4)}" text-anchor="middle" font-size="13" font-weight="600" fill="${t.text}">${label}</text>
      ${sub ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="10.5" fill="${t.muted}">${sub}</text>` : ''}`;
    const line = (a, b, dash, col = t.line, w = 2) => `<path d="M${a[0]},${a[1]} L${b[0]},${b[1]}" stroke="${col}" stroke-width="${w}" ${dash ? 'stroke-dasharray="5 5"' : ''} fill="none"/>`;
    let s = `<svg viewBox="0 0 760 360" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Network placement of ${esc(e.name)}" style="width:100%;height:auto;display:block;font-family:inherit"><rect width="760" height="360" rx="12" fill="${t.bg}"/>`;
    s += line([110, 175], [330, 175]) + line([205, 175], [300, 85]) + line([430, 175], [580, 175]) + line([380, 195], [380, 270]) + line([90, 150], [580, 60], true) + line([80, 200], [80, 280], true);
    s += `<ellipse cx="70" cy="175" rx="52" ry="34" fill="${t.box}" stroke="${t.stroke}"/><text x="70" y="180" text-anchor="middle" font-size="13" font-weight="600" fill="${t.text}">Internet</text>`;
    s += box(300, 40, 170, 56, 'DMZ', 'web · mail · VPN portal') + box(330, 155, 100, 40, 'Core') + box(300, 270, 160, 60, 'Campus', 'users · endpoints')
      + box(580, 145, 160, 60, 'Data center', 'servers · databases') + box(580, 30, 160, 56, 'Cloud VPC', 'AWS · Azure · GCP') + box(580, 270, 160, 60, 'Log pipeline', '→ SIEM · data lake');
    s += `<text x="80" y="342" text-anchor="middle" font-size="10.5" fill="${t.muted}">Remote users</text>`;
    const items = e.placement.items;
    items.forEach((it) => { s += line(slots[it.slot], [580, 300], true, t.accent, 1.2).replace('<path', '<path opacity=".55"'); });
    items.forEach((it, i) => {
      const [x, y] = slots[it.slot];
      s += `<rect x="${x - 44}" y="${y - 14}" width="88" height="28" rx="14" fill="${t.accent}"/><text x="${x + 6}" y="${y + 4.5}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${esc(e.short)}</text>
        <circle cx="${x - 33}" cy="${y}" r="9" fill="#fff"/><text x="${x - 33}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${t.accent}">${i + 1}</text>`;
    });
    return s + '</svg>';
  }

  // ---------- routing ----------
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [p, qs] = h.split('?');
    return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || '') };
  }
  function route() {
    const { parts, params } = parseHash();
    const r = parts[0] || '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (r === 'e' ? 'x' : r)));
    $('#mini').hidden = r === '';
    const page = Math.max(1, parseInt(params.get('p'), 10) || 1);
    if (r === 'e' && byId(parts[1])) return openArticle(parts[1], parts[2] || 'overview', +(parts[3] || 0));
    if (r === 'sourcetypes') return sourcetypes(page);
    if (r === 'cves') return cves(page);
    home(params.get('q') || '', params.get('cat'), page);
  }

  // ---------- paging ----------
  // Only one page is drawn at a time: 24 cards on Browse, 100 rows on the index tables.
  const PAGE = 24, ROWS = 100;
  const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));
  function pager(total, size, page) {
    const n = pageCount(total, size);
    if (n <= 1) return '';
    const want = new Set([1, n, page - 2, page - 1, page, page + 1, page + 2].filter((x) => x >= 1 && x <= n));
    const nums = [...want].sort((a, b) => a - b);
    let out = '', prev = 0;
    for (const x of nums) {
      if (x - prev > 1) out += '<span class="gap">…</span>';
      out += `<button type="button" data-p="${x}" class="${x === page ? 'on' : ''}"${x === page ? ' aria-current="page"' : ''}>${x}</button>`;
      prev = x;
    }
    return `<nav class="pager" aria-label="Pages"><button type="button" data-p="${page - 1}"${page <= 1 ? ' disabled' : ''}>‹ Previous</button>${out}<button type="button" data-p="${page + 1}"${page >= n ? ' disabled' : ''}>Next ›</button></nav>`;
  }
  const wirePager = (root, go) => root.querySelectorAll('.pager [data-p]').forEach((b) => (b.onclick = () => go(+b.dataset.p)));
  const range = (total, size, page) => `${(page - 1) * size + 1}–${Math.min(total, page * size)}`;
  const setPageParam = (p, page) => { if (page > 1) p.set('p', page); else p.delete('p'); };

  // ---------- article loading ----------
  // Browse needs only index.json; a full article is fetched when it is opened and kept.
  const FULL = new Map();
  function openArticle(id, tab, logi) {
    if (FULL.has(id)) return article(FULL.get(id), tab, logi);
    app.innerHTML = '<div class="page"><p>Loading article…</p></div>';
    fetch(`e/${encodeURIComponent(id)}.json?v=__BUILD__`).then((r) => { if (!r.ok) throw new Error(`The article responded ${r.status}`); return r.json(); })
      .then((e) => { FULL.set(id, e); if (parseHash().parts[1] === id) route(); })
      .catch((x) => { app.innerHTML = `<div class="page"><h1>Could not load this article</h1><p>${esc(x.message)}</p><p><a href="#/">Back to the library</a></p></div>`; });
  }

  // ---------- home ----------
  function home(q, cat, page = 1) {
    const icon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
    app.innerHTML = `<div class="hero"><h1>What's generating that log?</h1>
      <p>Search ${ENTRIES.length} security devices by name, vendor, sourcetype, CVE or behaviour.</p>
      <div class="big">${icon}<input id="q" value="${esc(q)}" placeholder="Try “pan:threat”, “CVE-2024-3400”, “waf”, “globalprotect”…" aria-label="Search"></div>
      <div class="chips">${Object.entries(CATS).map(([k, c]) => `<span class="chip ${cat === k ? 'on' : ''}" data-c="${k}">${c.icon} ${esc(c.label)}</span>`).join('')}</div></div>
      <div class="content"><div class="count" id="count"></div><div class="grid" id="grid"></div><div id="pages"></div></div>`;
    const input = $('#q');
    // A new search or category starts again at page 1; the page number lives in the URL.
    const sync = (toPage = 1) => {
      page = toPage;
      const p = new URLSearchParams(); if (input.value) p.set('q', input.value); if (cat) p.set('cat', cat); setPageParam(p, page);
      history.replaceState(null, '', '#/' + (p.toString() ? '?' + p : ''));
      results(input.value, cat, page, sync);
    };
    input.oninput = () => sync(1);
    app.querySelectorAll('.chip').forEach((c) => (c.onclick = () => { cat = cat === c.dataset.c ? null : c.dataset.c; app.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x.dataset.c === cat)); sync(1); }));
    input.focus(); input.setSelectionRange(q.length, q.length);
    results(q, cat, page, sync);
  }
  function results(q, cat, page, go) {
    const r = search(q).filter((x) => !cat || x.e.category === cat);
    page = Math.min(page, pageCount(r.length, PAGE));
    const shown = r.slice((page - 1) * PAGE, page * PAGE);
    $('#count').textContent = `${r.length} device${r.length === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}${cat ? ` in ${CATS[cat].label}` : ''}${r.length > PAGE ? ` · showing ${range(r.length, PAGE, page)}` : ''}`;
    $('#pages').innerHTML = pager(r.length, PAGE, page);
    wirePager($('#pages'), (to) => { go(to); $('#count').scrollIntoView({ block: 'start' }); });
    $('#grid').innerHTML = shown.length ? shown.map(({ e }) => {
      const c = CATS[e.category], cv = cveIds(e);
      return `<a class="card" href="#/e/${e.id}"><div class="cat" style="color:${c.color}">${c.icon} ${esc(c.label)}</div>
        <h3>${mark(e.name, q)}</h3><div class="v">${mark(e.vendor, q)}</div><p>${mark(e.summary, q)}</p>
        <div>${e.sourcetypes.slice(0, 3).map((s) => `<span class="st">${mark(s.st, q)}</span>`).join('')}</div>
        <div class="badges">${cv.length ? `<span class="b" style="background:#fee2e2;color:#b91c1c">${cv.length} CVE${cv.length > 1 ? 's' : ''}</span>` : ''}${e.status === 'full' ? '<span class="b" style="background:#dcfce7;color:#166534">full article</span>' : '<span class="b" style="background:#fef3c7;color:#92400e">stub</span>'}</div></a>`;
    }).join('') : `<div class="empty">Nothing matches. <button type="button" class="linkish" id="req-empty">Request this device</button>, or <a href="${newUrl}" target="_blank" rel="noopener">add it yourself</a>.</div>`;
    const re = $('#req-empty'); if (re) re.onclick = () => openRequest(q);
  }

  // ---------- article ----------
  const TABS = [['overview', 'Overview'], ['network', 'Network & traffic'], ['logs', 'Logs'], ['cves', 'Vulnerabilities', 'cves'], ['detect', 'Detect', 'detections'], ['optimize', 'Optimize']];
  function article(e, tab, logi) {
    const c = CATS[e.category], full = e.status === 'full';
    if (!full) tab = 'overview';
    const kev = (e.cves || []).filter((x) => x.kev).length;
    const traffic = (e.logs || [])[0];
    document.title = `${e.name} — Goatpedia`;
    app.innerHTML = `<div class="ahead"><div class="in">
      <div class="crumb"><a href="#/">Goatpedia</a> › <a href="#/?cat=${e.category}">${esc(c.label)}</a> › <span>${esc(e.vendor)}</span>
        <a class="edit" href="${editUrl(e.id)}" target="_blank" rel="noopener">✎ Edit on GitHub</a></div>
      <div class="title"><div class="ico" style="background:${c.color}22">${c.icon}</div><div><h1>${esc(e.name)}</h1>
        <div class="v">${esc(e.vendor)} · ${esc(c.label)}${e.aka ? ' · aka ' + e.aka.map(esc).join(', ') : ''}</div></div></div>
      <div class="lede">${esc(e.summary)}</div>
      ${full ? `<div class="glance"><div><small>Sourcetypes</small><b>${e.sourcetypes.length}</b> · <span class="st">${esc(e.sourcetypes[0].st)}</span></div>
        <div><small>Log format</small><b>${esc(traffic.format.toUpperCase())}</b></div>
        <div><small>Main volume</small><b>${esc(traffic.type)} ${esc(traffic.share || '')}</b></div>
        <div><small>Known CVEs</small><b style="color:#b91c1c">${e.cves.length}${kev ? ` · ${kev} KEV` : ''}</b></div>
        <div><small>Optimizations</small><b style="color:#16a34a">${e.optimizations.length} techniques</b></div></div>` : ''}
    </div></div>
    ${full ? `<div class="tabwrap"><div class="tabs">${TABS.map(([k, l, n]) => `<a href="#/e/${e.id}/${k}" class="${tab === k ? 'on' : ''}">${l}${n && e[n].length ? `<span class="n">${e[n].length}</span>` : ''}</a>`).join('')}</div></div>` : ''}
    <div class="body">${full ? (TAB[tab] || TAB.overview)(e, logi) : stub(e)}</div>`;
    if (full && tab === 'logs') wireLogs(e, logi);
    app.querySelectorAll('.copy').forEach((b) => (b.onclick = () => { navigator.clipboard.writeText(b.closest('.box').querySelector('pre').textContent); b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy KQL'), 1200); }));
  }
  const stub = (e) => `<div class="box"><h2>Sourcetypes</h2>${e.sourcetypes.map((s) => `<span class="st">${esc(s.st)}</span>`).join('')}</div>
    ${cveIds(e).length ? `<div class="box"><h2>Known CVEs</h2>${cveIds(e).map((x) => `<a class="sig" href="https://nvd.nist.gov/vuln/detail/${x}" target="_blank" rel="noopener">${x}</a>`).join('')}</div>` : ''}
    <div class="stub"><b>This device only has a summary so far.</b><br>Help complete it: how it works, network placement, sample logs, CVEs, detections and optimizations.<br>
    <a class="btn" href="${editUrl(e.id)}" target="_blank" rel="noopener">✎ Complete this article</a></div>`;

  const TAB = {
    overview: (e) => `<div class="two">${e.howItWorks.map((h) => `<div class="box"><h4>${esc(h.title)}</h4><p>${esc(h.body)}</p></div>`).join('')}</div>
      <div class="box"><h2>Sourcetypes</h2><table class="ftable">${e.sourcetypes.map((s) => `<tr><td style="width:220px"><span class="st">${esc(s.st)}</span></td><td>${esc(s.desc || '')}</td></tr>`).join('')}</table></div>
      <div class="box"><h2>Key facts</h2><div class="kv">${Object.entries(e.facts).map(([k, v]) => `<b>${esc(k)}</b><span>${esc(v)}</span>`).join('')}</div></div>
      ${(e.related || []).length ? `<div class="box"><h2>Related</h2>${e.related.map((r) => `<a class="st" href="#/e/${r}">${esc(byId(r).name)}</a>`).join('')}</div>` : ''}
      ${(e.references || []).length ? `<div class="box"><h2>References</h2><ul class="refs">${e.references.map((r) => `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></li>`).join('')}</ul></div>` : ''}`,
    network: (e) => `<div class="box"><h2>Where it sits in the network</h2>${diagram(e)}</div>
      <div class="two">${e.placement.items.map((p, i) => `<div class="box"><h4><span class="num">${i + 1}</span>${esc(p.title)}</h4><p>${esc(p.desc)}</p></div>`).join('')}</div>
      <div class="box"><h2>What traffic it handles</h2><div style="margin-bottom:12px">${e.traffic.handles.map((h) => `<span class="sig">${esc(h)}</span>`).join('')}</div>
      <h4 style="margin-bottom:8px">Packet flow</h4><div class="flow">${e.traffic.flow.map((f, i) => `<div><b>${i + 1}. ${esc(f.step)}</b>${esc(f.desc)}</div>`).join('')}</div></div>`,
    logs: (e, logi) => {
      const l = e.logs[logi] || e.logs[0];
      return `<div class="logsw">${e.logs.map((x, i) => `<a href="#/e/${e.id}/logs/${i}" class="${x === l ? 'on' : ''}">${esc(x.type)} <span style="opacity:.6;font-weight:400">${esc(x.share || '')}</span></a>`).join('')}</div>
      <div class="box"><h2>${esc(l.type)} log <span class="st">${esc(l.sourcetype)}</span></h2><p>${esc(l.desc)}${l.avg ? ` · avg ${esc(l.avg)}/event` : ''}</p>
        <div class="two" style="margin-top:12px"><div><div class="raw" id="raw">${logHtml(l)}</div>
        <p style="font-size:12.5px;color:var(--muted);margin-top:8px">Click a value to find it in the field list. <span style="color:#0b7f7e">Teal</span> = key field, grey = droppable noise.</p><div id="save"></div></div>
        <div class="scroll"><table class="ftable mono" id="ft">${parsed(l).map((f) => `<tr data-i="${f.i}" class="${f.noise ? 'n' : ''}"><td>${f.i}</td><td style="color:${f.key ? '#0b7f7e' : 'inherit'};font-weight:${f.key ? 700 : 400}">${esc(f.name)}</td><td>${esc(f.value) || '<span style="color:#cbd5e1">∅ empty</span>'}</td></tr>`).join('')}</table></div></div></div>`;
    },
    cves: (e) => `<div class="box"><h2>Known vulnerabilities <span style="font-weight:400;color:var(--muted);font-size:13px">— the device itself and the traffic it protects</span></h2>
      ${e.cves.map((v) => `<div class="cve"><div><div class="score" style="background:${cvssColor(v.cvss)}">${v.cvss.toFixed(1)}<small>CVSS</small></div>${v.kev ? '<div style="text-align:center;margin-top:6px"><span class="b" style="background:#fee2e2;color:#b91c1c;font-size:11px">CISA KEV</span></div>' : ''}</div>
        <div><h4><a href="https://nvd.nist.gov/vuln/detail/${v.id}" target="_blank" rel="noopener">${v.id}</a> — ${esc(v.title)}</h4>
        <div class="kv"><b>Scope</b><span>${v.scope === 'device' ? 'The device itself' : 'Traffic type it protects'}</span><b>Affected</b><span>${esc(v.affected)}</span>
        ${v.fixed ? `<b>Fixed in</b><span>${esc(v.fixed)}</span>` : ''}<b>How to identify</b><span>${esc(v.detect)}</span><b>Avoid / mitigate</b><span>${esc(v.avoid)}</span></div></div></div>`).join('')}</div>`,
    detect: (e) => e.detections.map((d) => `<div class="box"><button class="copy">Copy KQL</button><h4><span class="b" style="background:${sevColor(d.severity)};color:#fff">${d.severity}</span> ${esc(d.title)}</h4>
      <p>${esc(d.why)}</p><div>${d.signals.map((s) => `<span class="sig">${esc(s)}</span>`).join('')}</div>
      ${(d.mitre || []).length ? `<div class="mitre">MITRE ATT&amp;CK: ${d.mitre.map((t) => `<a href="${mitreUrl(t)}" target="_blank" rel="noopener">${t}</a>`).join(' · ')}</div>` : ''}<pre class="kql">${esc(d.kql)}</pre></div>`).join(''),
    optimize: (e) => `<div class="box"><h2>Reduce volume without losing signal</h2>${e.optimizations.map((o) => `<div class="opt"><div class="pct">${esc(o.saving)}<small>typical saving</small></div>
      <div><h4>${esc(o.title)} <span class="st">${esc(o.fn)}</span></h4><p>${esc(o.how)}</p>${o.expr ? `<code class="st" style="display:inline-block">${esc(o.expr)}</code>` : ''}</div></div>`).join('')}</div>`,
  };
  function wireLogs(e, logi) {
    const l = e.logs[logi] || e.logs[0], p = parsed(l);
    const drop = p.filter((f) => f.noise || !f.value).reduce((a, f) => a + f.value.length + 1, 0);
    const pct = Math.min(100, Math.round((drop / l.sample.length) * 100));
    $('#save').innerHTML = `<div class="save"><span>Noise + empty fields in this event:</span><div class="bar"><i style="width:${pct}%"></i></div><b style="color:#16a34a">${pct}%</b></div>`;
    $('#raw').onclick = (ev) => {
      const f = ev.target.closest('.lf'); if (!f) return;
      app.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
      f.classList.add('sel');
      const r = $(`#ft tr[data-i="${f.dataset.i}"]`); r.classList.add('sel'); r.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
  }

  // ---------- indexes ----------
  // Draw one page of an index table; the pager moves through the URL (#/<name>?p=N).
  function indexPage(name, page, total, render) {
    page = Math.min(page, pageCount(total, ROWS));
    app.innerHTML = render(page, pager(total, ROWS, page), total > ROWS ? ` · showing ${range(total, ROWS, page)}` : '');
    wirePager(app, (to) => { const p = new URLSearchParams(); setPageParam(p, to); location.hash = `#/${name}` + (p.toString() ? '?' + p : ''); });
  }
  function sourcetypes(page = 1) {
    document.title = 'Sourcetypes — Goatpedia';
    const rows = ENTRIES.flatMap((e) => e.sourcetypes.map((s) => ({ s, e }))).sort((a, b) => a.s.st.localeCompare(b.s.st));
    indexPage('sourcetypes', page, rows.length, (pg, nav, showing) => `<div class="page"><h1>Sourcetype index</h1><div class="sub">${rows.length} sourcetypes across ${ENTRIES.length} devices${showing}</div>
      <div class="box"><table class="ftable"><tr><th>Sourcetype</th><th>Device</th><th>Category</th><th>Description</th></tr>
      ${rows.slice((pg - 1) * ROWS, pg * ROWS).map(({ s, e }) => `<tr><td><span class="st">${esc(s.st)}</span></td><td><a href="#/e/${e.id}">${esc(e.name)}</a></td><td>${esc(CATS[e.category].label)}</td><td>${esc(s.desc || '')}</td></tr>`).join('')}</table></div>${nav}</div>`);
  }
  function cves(page = 1) {
    document.title = 'CVEs — Goatpedia';
    const rows = ENTRIES.flatMap((e) => (e.cves || cveIds(e).map((id) => ({ id }))).map((v) => ({ v, e })))
      .sort((a, b) => (b.v.cvss ?? -1) - (a.v.cvss ?? -1) || b.v.id.localeCompare(a.v.id));
    indexPage('cves', page, rows.length, (pg, nav, showing) => `<div class="page"><h1>CVE index</h1><div class="sub">${rows.length} CVEs · ${rows.filter((r) => r.v.kev).length} in CISA KEV${showing}</div>
      <div class="box"><table class="ftable"><tr><th>CVE</th><th>CVSS</th><th>Device</th><th>Scope</th><th>Title</th></tr>
      ${rows.slice((pg - 1) * ROWS, pg * ROWS).map(({ v, e }) => `<tr><td><a href="https://nvd.nist.gov/vuln/detail/${v.id}" target="_blank" rel="noopener">${v.id}</a>${v.kev ? ' <span class="b" style="background:#fee2e2;color:#b91c1c;font-size:10.5px">KEV</span>' : ''}</td>
        <td>${v.cvss != null ? `<b style="color:${cvssColor(v.cvss)}">${v.cvss.toFixed(1)}</b>` : '—'}</td><td><a href="#/e/${e.id}${v.cvss != null ? '/cves' : ''}">${esc(e.name)}</a></td>
        <td>${esc(v.scope || '—')}</td><td>${esc(v.title || 'Details not yet written')}</td></tr>`).join('')}</table></div>${nav}</div>`);
  }

  // ---------- request a device ----------
  // The popup fills the GitHub issue form .github/ISSUE_TEMPLATE/device-request.yml through
  // query parameters (one per field id). The requester signs in on GitHub to submit, so
  // GitHub knows who asked and keeps robots out; no email is collected. Admins work the
  // queue with `npm run requests` and the process-device-requests skill (README).
  const REQUEST_FIELDS = [
    ['device', 'Device or sourcetype', 'input', 'e.g. Palo Alto Networks NGFW, or pan:traffic', true],
    ['vendor', 'Vendor', 'input', 'e.g. Palo Alto Networks'],
    ['category', 'Category', 'select'],
    ['sourcetypes', 'Sourcetypes', 'textarea', 'One per line, if you know them'],
    ['format', 'Log format and transport', 'input', 'e.g. CSV over syslog, JSON via HTTPS API, CEF'],
    ['links', 'Vendor documentation', 'textarea', 'Links to the log or field reference, one per line'],
    ['sample', 'Sample event', 'textarea', 'Synthetic or fully redacted only'],
    ['notes', 'Anything else', 'textarea', 'Versions, use case, detections or savings you care about'],
  ];
  const requestUrl = (v) => {
    const p = new URLSearchParams({ template: 'device-request.yml', title: `[Device request] ${v.device}` });
    for (const [id] of REQUEST_FIELDS) if (v[id]) p.set(id, v[id]);
    return `${REPO}/issues/new?${p}`;
  };
  function openRequest(prefill = '') {
    $('#req-modal')?.remove();
    const field = ([id, label, kind, ph, req]) => {
      const attrs = `id="rq-${id}" name="${id}"${ph ? ` placeholder="${esc(ph)}"` : ''}${req ? ' required' : ''}`;
      const ctl = kind === 'textarea' ? `<textarea ${attrs} rows="${id === 'sample' ? 3 : 2}"></textarea>`
        : kind === 'select' ? `<select ${attrs}><option value="">Not sure</option>${Object.values(CATS).map((c) => `<option>${esc(c.label)}</option>`).join('')}</select>`
          : `<input ${attrs} autocomplete="off">`;
      return `<label class="rq-f${id === 'device' ? ' wide' : ''}"><span>${esc(label)}${req ? ' <b>*</b>' : ''}</span>${ctl}</label>`;
    };
    document.body.insertAdjacentHTML('beforeend', `<div class="req-modal" id="req-modal" role="dialog" aria-modal="true" aria-labelledby="rq-h">
      <form class="req-card" id="rq-form" novalidate>
        <button type="button" class="rq-x" aria-label="Close">×</button>
        <h2 id="rq-h">Request a device</h2>
        <p class="rq-sub">Missing a device or sourcetype? Tell us what you know; only the first field is required.</p>
        <div class="rq-grid">${REQUEST_FIELDS.map(field).join('')}</div>
        <div class="rq-dup" id="rq-dup" hidden></div>
        <div class="rq-priv" id="rq-priv" hidden role="alert"></div>
        <label class="rq-ok"><input type="checkbox" id="rq-public"> This request contains no customer data, credentials or internal details. The repository is public.</label>
        <p class="rq-note"><b>Submit opens GitHub</b> with this request filled in. Sign in there and click <i>Create</i>; your GitHub name shows on the request, which also keeps robots out. Use documentation IPs (192.0.2.x, 198.51.100.x, 203.0.113.x) and example.com names in samples.</p>
        <div class="rq-actions"><button type="button" class="rq-cancel">Cancel</button><button type="submit" class="rq-go">Continue on GitHub ↗</button></div>
      </form></div>`);
    const modal = $('#req-modal'), form = $('#rq-form'), device = $('#rq-device'), dup = $('#rq-dup');
    const close = () => { modal.remove(); removeEventListener('keydown', onKey); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    modal.onclick = (ev) => { if (ev.target === modal) close(); };
    modal.querySelector('.rq-x').onclick = close;
    modal.querySelector('.rq-cancel').onclick = close;
    // Already in the library? Shown while typing, so nobody requests what exists.
    const check = () => {
      const terms = [device.value, ...$('#rq-sourcetypes').value.split(/[\n,]+/)].map((s) => s.trim()).filter((s) => s.length > 2);
      const hits = new Map();
      for (const t of terms) for (const { e } of search(t).slice(0, 3)) hits.set(e.id, e);
      dup.hidden = !hits.size;
      dup.innerHTML = hits.size ? `Already in Goatpedia? ${[...hits.values()].slice(0, 4).map((e) => `<a href="#/e/${e.id}">${esc(e.name)}</a>`).join(' · ')}` : '';
      dup.querySelectorAll('a').forEach((a) => (a.onclick = close));
    };
    // Privacy: every field is scanned as it changes (site/privacy.js). Findings name the field
    // and a masked value, and Submit stays off until they are gone and the box is ticked.
    const go = modal.querySelector('.rq-go'), priv = $('#rq-priv'), ok = $('#rq-public');
    const findings = () => REQUEST_FIELDS.flatMap(([id, label]) => window.GoatpediaPrivacy.scan($(`#rq-${id}`).value).map((f) => ({ ...f, id, field: label })));
    const guard = () => {
      const f = findings();
      REQUEST_FIELDS.forEach(([id]) => $(`#rq-${id}`).classList.toggle('bad', f.some((x) => x.id === id)));
      priv.hidden = !f.length;
      priv.innerHTML = f.length ? `<b>Remove before you submit</b> (the repository is public):<ul>${f.slice(0, 8).map((x) => `<li>${esc(x.field)}: ${esc(x.label)} <code>${esc(window.GoatpediaPrivacy.mask(x.match))}</code></li>`).join('')}</ul>${f.length > 8 ? `<p>…and ${f.length - 8} more.</p>` : ''}` : '';
      go.disabled = !!f.length || !ok.checked;
      return f;
    };
    REQUEST_FIELDS.forEach(([id]) => $(`#rq-${id}`).addEventListener('input', guard));
    ok.onchange = guard;
    device.oninput = check; $('#rq-sourcetypes').oninput = check;
    device.value = prefill; check(); guard();
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const v = Object.fromEntries(REQUEST_FIELDS.map(([id]) => [id, $(`#rq-${id}`).value.trim()]));
      if (!v.device) { device.classList.add('bad'); device.focus(); return; }
      if (guard().length || !ok.checked) return;
      window.open(requestUrl(v), '_blank', 'noopener');
      close();
    };
    device.focus();
  }

  // ---------- boot ----------
  $('#contrib').href = newUrl; $('#repo').href = REPO;
  $('#request').onclick = () => openRequest();
  $('#mq').onkeydown = (ev) => { if (ev.key === 'Enter') location.hash = '#/?q=' + encodeURIComponent(ev.target.value); };
  addEventListener('keydown', (ev) => { if (ev.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { ev.preventDefault(); ($('#q') || $('#mq')).focus(); } });
  addEventListener('hashchange', () => { route(); scrollTo(0, 0); });
  fetch('index.json?v=__BUILD__', { cache: 'no-store' }).then((r) => r.json()).then((lib) => { LIB = lib; CATS = lib.categories; ENTRIES = lib.entries; route(); })
    .catch((x) => { app.innerHTML = `<div class="page"><h1>Could not load the library</h1><p>${esc(x.message)}</p></div>`; });
})();
