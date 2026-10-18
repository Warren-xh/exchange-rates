(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS_DRAFT = "fxdesk:draft:v1", LS_LOCAL = "fxdesk:local:v1", LS_VIEW = "fxdesk:view:v1", LS_ATT = "fxdesk:attempts:v1", LS_HIST = "fxdesk:hist:v1";
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 存储不可用时忽略 */ } },
  };
  const TAB = "t" + Math.random().toString(36).slice(2, 10);
  const IDLE_MS = 15 * 60e3;
  const STANDALONE_CODES = ["EUR", "USD", "GBP", "HKD", "JPY", "KRW", "AUD", "CAD", "SGD", "CHF", "THB", "MOP", "TWD", "BTC"];
  const REPO = window.FX_REPO || "";
  const CONFIG_PATH = "data/config.json", VAULT_PATH = "data/vault.json";
  const shared = () => S.mode === "cloud" || S.mode === "pages"; /* 有云端版本、需要发布的模式 */

  const S = {
    mode: "loading",
    db: null, user: null, downloads: null, canEdit: false,
    rates: null, history: [], rateError: "",
    published: null, publishedLoaded: false,
    editing: false, unlocked: false,
    draft: null, baseline: null, undo: [], redo: [], fieldBefore: null,
    cny: null, per100: null, lastActivity: Date.now(), busy: false,
    gh: null, vault: undefined, daily: false,
  };

  /* ---------- 当前显示的配置 ---------- */
  function publishedContent() {
    if (S.mode === "standalone") return FX.content(store.get(LS_LOCAL) || standaloneDefault());
    return S.published ? FX.content(S.published.doc) : FX.emptyConfig();
  }
  function view() { return S.editing && S.draft ? S.draft : publishedContent(); }
  let standaloneMemo = null;
  function standaloneDefault() {
    if (standaloneMemo) return standaloneMemo;
    const c = FX.emptyConfig();
    c.entries = STANDALONE_CODES.map((code) => FX.liveEntry(code));
    standaloneMemo = c;
    store.set(LS_LOCAL, c);
    return c;
  }
  function per100On() {
    if (S.per100 !== null) return S.per100;
    return !!view().per100;
  }
  function perFor(code) { return per100On() && !FX.CRYPTO.has(code) ? 100 : 1; }

  /* ---------- 渲染 ---------- */
  function render() {
    const c = view();
    $("siteTitle").textContent = c.title;
    $("siteSub").textContent = c.subtitle;
    if (S.cny === null && (S.mode === "standalone" || S.publishedLoaded)) S.cny = c.defaultAmount;
    $("unit1").setAttribute("aria-pressed", String(!per100On()));
    $("unit100").setAttribute("aria-pressed", String(per100On()));
    renderList();
    renderSitePanel();
    renderDock();
    renderBanner();
    renderStatus();
    updateNumbers();
    $("manageBtn").hidden = !(S.mode === "standalone" || S.mode === "pages" || (S.mode === "cloud" && S.canEdit));
    $("srcNote").textContent = S.mode === "pages" || S.mode === "standalone"
      ? "汇率每分钟从 Coinbase 公开汇率刷新，备用 ExchangeRate-API；涨跌和走势参考欧洲央行每日参考价（Frankfurter）。仅供参考，实际兑换以银行或平台报价为准。"
      : "汇率来源：Coinbase 公开汇率，备用 ExchangeRate-API。仅供参考，实际兑换以银行或平台报价为准。";
    $("chgNote").textContent = S.daily
      ? "涨跌按中国市场习惯：红色表示外币对人民币上涨，绿色表示下跌，对比上一个欧洲央行参考价（工作日更新）。"
      : "涨跌按中国市场习惯：红色表示外币对人民币上涨，绿色表示下跌，对比约 24 小时前。";
    $("manageBtn").textContent = S.editing ? "完成编辑" : S.unlocked ? "继续编辑" : "管理";
  }

  function renderList() {
    const c = view();
    const list = $("list");
    if (!c.entries.length) {
      const waiting = S.mode === "cloud" && !S.publishedLoaded;
      list.innerHTML = `<li class="empty">${waiting ? "<span>正在读取货币清单…</span>" : `<strong>还没有货币</strong><span>${S.editing ? "用下面的按钮添加第一个货币或自定义汇率。" : "点右上角「管理」，解锁后添加第一个货币。"}</span>`}</li>`;
    } else {
      list.innerHTML = c.entries.map((e, i) => rowHtml(e, i, c.entries.length)).join("");
    }
    if (S.editing) {
      list.insertAdjacentHTML("beforeend", `<li class="row" style="grid-template-columns:1fr"><div class="adds"><button class="btn" type="button" data-act="add-live">＋ 添加货币</button><button class="btn" type="button" data-act="add-custom">＋ 添加自定义汇率</button></div><p class="hint">自定义汇率可以记下银行牌价、汇款平台的实际报价，或在实时汇率上加点。每一行都能设目标价，达到时会标出「已达目标」。</p></li>`);
    }
  }

  function tagText(e) {
    if (e.kind === "custom") {
      if (e.mode === "fixed") return "自定义 · 固定汇率";
      const s = e.spread || 0;
      return "自定义 · 实时" + (s >= 0 ? " +" : " ") + s + "%";
    }
    return FX.NAMES[e.code] && FX.NAMES[e.code] !== e.label ? FX.NAMES[e.code] : "实时汇率";
  }

  function rowHtml(e, i, n) {
    const id = esc(e.id);
    let html = `<li class="row" data-id="${id}">
      <div class="cur"><span class="code">${esc(e.code)}</span><span class="names"><span class="label" data-t="label">${esc(e.label)}</span><span class="tag" data-t="tag">${esc(tagText(e))}</span></span></div>
      <label class="amt"><input data-amt="${id}" inputmode="decimal" autocomplete="off" aria-label="${esc(e.label)}金额"></label>
      <div class="meta"><span class="rate" data-t="rate"></span><span data-t="chg"></span><span data-t="spark"></span><span data-t="pill"></span></div>
      <p class="note" data-t="note"${e.note ? "" : " hidden"}>${esc(e.note)}</p>`;
    if (S.editing) {
      const opt = (v, cur, label) => `<option value="${v}"${cur === v ? " selected" : ""}>${label}</option>`;
      html += `<div class="edit">
        <label class="field"><span>名称</span><input data-f="label" maxlength="40" value="${esc(e.label)}"></label>
        ${e.kind === "custom" ? `<label class="field"><span>货币代码</span><input data-f="code" maxlength="8" value="${esc(e.code)}"></label>
        <label class="field"><span>计价方式</span><select data-f="mode">${opt("spread", e.mode, "实时汇率加点")}${opt("fixed", e.mode, "固定汇率")}</select></label>
        ${e.mode === "fixed" ? `<label class="field"><span>1 ${esc(e.code)} = ? 人民币</span><input data-f="fixed" inputmode="decimal" value="${e.fixed ?? ""}"></label>` : `<label class="field"><span>加点 %（正数表示更贵）</span><input data-f="spread" inputmode="decimal" value="${e.spread ?? 0}"></label>`}` : ""}
        <label class="field"><span>目标价：1 ${esc(e.code)} = ? 人民币</span><span class="inline"><select data-f="targetDir" aria-label="目标方向">${opt("below", e.targetDir, "低于")}${opt("above", e.targetDir, "高于")}</select><input data-f="target" inputmode="decimal" placeholder="不设" value="${e.target ?? ""}" aria-label="目标价"></span></label>
        <label class="field wide"><span>备注</span><input data-f="note" maxlength="200" placeholder="例如：暑假去东京用" value="${esc(e.note)}"></label>
        <div class="row-tools">
          <button class="btn sm" type="button" data-act="up" ${i === 0 ? "disabled" : ""}>上移</button>
          <button class="btn sm" type="button" data-act="down" ${i === n - 1 ? "disabled" : ""}>下移</button>
          <button class="btn sm danger" type="button" data-act="remove">删除</button>
        </div>
      </div>`;
    }
    return html + "</li>";
  }

  function sparkSvg(points, days = 7) {
    if (points.length < 2) return "";
    const w = 84, h = 22, pad = 2;
    const t0 = points[0].t, t1 = points[points.length - 1].t;
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
    if (hi === lo) { hi += lo * 1e-6 || 1; lo -= lo * 1e-6 || 1; }
    const x = (t) => pad + ((t - t0) / (t1 - t0 || 1)) * (w - pad * 2);
    const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);
    const line = points.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join("");
    const last = points[points.length - 1];
    const area = line + `L${x(last.t).toFixed(1)} ${h}L${x(t0).toFixed(1)} ${h}Z`;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="近 ${days} 天走势"><title>近 ${days} 天走势</title><path class="a" d="${area}"/><path class="l" d="${line}"/><circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2"/></svg>`;
  }

  function updateNumbers() {
    const c = view();
    const rates = S.rates && S.rates.rates;
    const now = Date.now();
    const active = document.activeElement;
    const cnyIn = $("cnyInput");
    if (active !== cnyIn) cnyIn.value = S.cny === null ? "" : FX.fmtAmount(S.cny, "CNY");
    cnyIn.removeAttribute("aria-invalid");
    /* 每日数据（欧洲央行）取至少 12 小时前的最近一条；逐小时数据取约 24 小时前 */
    const past = S.daily
      ? S.history.filter((h) => Date.parse(h.t) <= now - 12 * 3600e3).sort((a, b) => Date.parse(b.t) - Date.parse(a.t))[0] || null
      : FX.snapshotNear(S.history, now, 24);
    const chgTitle = S.daily && past ? "与 " + past.t.slice(0, 10) + " 欧洲央行参考价相比" : "与约 24 小时前相比";
    const sparkDays = S.daily ? 30 : 7;
    for (const e of c.entries) {
      const li = document.querySelector(`li[data-id="${CSS.escape(e.id)}"]`);
      if (!li) continue;
      const val = FX.entryCny(e, rates);
      const input = li.querySelector("input[data-amt]");
      if (input !== active) input.value = val && S.cny !== null ? FX.fmtAmount(S.cny / val, e.code) : "";
      input.placeholder = val ? "0" : "—";
      input.disabled = !val;
      li.querySelector('[data-t="label"]').textContent = e.label;
      li.querySelector('[data-t="tag"]').textContent = tagText(e);
      const note = li.querySelector('[data-t="note"]');
      note.textContent = e.note; note.hidden = !e.note;
      const rateEl = li.querySelector('[data-t="rate"]');
      if (val) {
        const per = perFor(e.code);
        rateEl.textContent = `${per} ${e.code} = ${FX.fmtRate(val * per)} 元`;
        rateEl.className = "rate";
      } else {
        rateEl.textContent = S.rates ? (e.kind === "custom" && e.mode === "fixed" ? "请填写固定汇率" : `暂无 ${e.code} 汇率，下次更新时获取`) : "等待汇率";
        rateEl.className = "pending";
      }
      const fixed = e.kind === "custom" && e.mode === "fixed";
      const liveNow = FX.cnyPerUnit(rates, e.code);
      const then = past ? FX.cnyPerUnit(past.rates, e.code) : null;
      const chgEl = li.querySelector('[data-t="chg"]');
      if (!fixed && liveNow && then) {
        const ch = (liveNow / then - 1) * 100;
        const cls = Math.abs(ch) < 0.005 ? "flat" : ch > 0 ? "up" : "down";
        chgEl.innerHTML = `<span class="chg ${cls}" title="${esc(chgTitle)}">${ch > 0 ? "+" : ""}${ch.toFixed(2)}%</span>`;
      } else chgEl.innerHTML = "";
      let series = fixed ? [] : FX.seriesFor(S.history, e.code, now, sparkDays);
      if (S.daily && series.length && liveNow) series = [...series, { t: now, v: liveNow }];
      li.querySelector('[data-t="spark"]').innerHTML = fixed ? "" : sparkSvg(series, sparkDays);
      const st = FX.targetStatus(e, val);
      const tgt = st ? ` · 目标 ${e.targetDir === "below" ? "≤" : "≥"} ${FX.fmtRate(e.target)}` : "";
      li.querySelector('[data-t="pill"]').innerHTML = st ? `<span class="pill ${st.state}" title="目标${e.targetDir === "below" ? "低于" : "高于"} ${esc(FX.fmtRate(e.target))} 元">${esc(st.text)}${esc(tgt)}</span>` : "";
    }
  }

  function renderStatus() {
    const el = $("status"), text = $("statusText");
    const r = S.rates;
    const now = Date.now();
    if (S.mode === "loading") { el.dataset.state = "none"; text.textContent = "正在连接…"; return; }
    if (S.mode === "offline") { el.dataset.state = "stale"; text.textContent = "需要登录 claude.ai 才能读取汇率"; return; }
    if (!r || !r.fetchedAt) {
      el.dataset.state = S.rateError ? "stale" : "none";
      text.textContent = S.rateError || "等待第一次汇率更新";
      return;
    }
    const f = FX.freshness(r.fetchedAt, now);
    el.dataset.state = f;
    const label = S.mode === "standalone" || S.mode === "pages" ? (S.rateError ? "接口暂时不可用" : "实时 · 每分钟刷新") : { fresh: "汇率正常", late: "更新延迟", stale: "汇率可能已过期", none: "" }[f];
    const when = new Date(r.fetchedAt);
    const hhmm = when.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    text.innerHTML = `<b>${esc(label)}</b> · 更新于 ${esc(FX.fmtAgo(r.fetchedAt, now))}（${esc(hhmm)}）· ${esc(r.source || "")}`;
    text.title = r.fetchedAt;
  }

  function renderSitePanel() {
    const p = $("sitePanel");
    p.hidden = !S.editing;
    if (!S.editing) return;
    const c = S.draft;
    const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    set("fTitle", c.title); set("fSub", c.subtitle); set("fAmount", String(c.defaultAmount)); set("fPer100", c.per100 ? "1" : "0");
    $("pwBtn").hidden = !shared();
    $("pwBtn").textContent = S.mode === "pages" ? "修改密码 / 更换令牌" : "修改管理密码";
    $("modeHint").textContent = S.mode === "cloud"
      ? "发布后，所有打开这个页面的设备都会自动换成新版本。汇率由后台自动写入，页面打开着也会自己刷新。"
      : S.mode === "pages"
        ? "发布会在 GitHub 仓库里保存一次提交（data/config.json），其他设备打开页面就能看到，误改也能从提交历史找回。"
        : "单机模式：修改只保存在这台设备的浏览器里，汇率直接从接口每分钟刷新一次。";
  }

  function renderDock() {
    $("dock").hidden = !S.editing;
    if (!S.editing) return;
    const n = FX.diff(S.baseline.doc, S.draft).length;
    const remoteMoved = shared() && S.published && S.published.revision && S.published.revision !== S.baseline.revision;
    $("dockState").innerHTML = n ? `<b>${n} 处修改</b> 未发布 · 草稿已保存在本机${remoteMoved ? " · 云端有新版本，发布时自动合并" : ""}` : `没有未发布的修改${remoteMoved ? " · 云端有新版本" : ""}`;
    $("undoBtn").disabled = !S.undo.length;
    $("redoBtn").disabled = !S.redo.length;
    $("publishBtn").disabled = !n || S.busy;
    $("publishBtn").textContent = shared() ? "发布修改" : "保存修改";
    $("syncBtn").hidden = !shared();
    $("lockBtn").textContent = shared() ? "锁定" : "退出编辑";
  }

  function renderBanner() {
    const b = $("draftBanner");
    const saved = store.get(LS_DRAFT);
    const can = S.mode === "standalone" || S.mode === "pages" || S.canEdit;
    if (S.editing || !saved || !saved.draft || !can) { b.hidden = true; return; }
    const n = FX.diff(saved.baseline?.doc || FX.emptyConfig(), saved.draft).length;
    b.hidden = !n;
    $("draftBannerText").textContent = `这台设备上有 ${n} 处未发布的修改。`;
  }

  /* ---------- 金额输入 ---------- */
  $("cnyInput").addEventListener("input", (ev) => {
    const v = FX.parseAmount(ev.target.value);
    if (Number.isNaN(v)) { ev.target.setAttribute("aria-invalid", "true"); return; }
    ev.target.removeAttribute("aria-invalid");
    S.cny = v === null ? 0 : v;
    updateNumbers();
  });
  $("cnyInput").addEventListener("blur", () => updateNumbers());
  $("list").addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.amt) {
      const e = view().entries.find((x) => x.id === t.dataset.amt);
      const val = e && FX.entryCny(e, S.rates && S.rates.rates);
      const v = FX.parseAmount(t.value);
      if (Number.isNaN(v) || !val) { t.setAttribute("aria-invalid", "true"); return; }
      t.removeAttribute("aria-invalid");
      S.cny = (v === null ? 0 : v) * val;
      updateNumbers();
      return;
    }
    if (t.dataset.f && S.editing) editField(t, false);
  });
  $("list").addEventListener("focusout", (ev) => { if (ev.target.dataset.amt) updateNumbers(); });

  /* ---------- 编辑 ---------- */
  const NUM_FIELDS = new Set(["fixed", "spread", "target"]);
  function editField(t, structural) {
    const li = t.closest("li[data-id]");
    const e = S.draft.entries.find((x) => x.id === li.dataset.id);
    if (!e) return;
    const f = t.dataset.f;
    let v = t.value;
    if (NUM_FIELDS.has(f)) { v = FX.num(v); if (f === "spread" && v === null) v = 0; }
    if (f === "code") v = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || e.code;
    e[f] = v;
    saveDraft();
    if (structural) { pushUndoFrom(S.fieldBefore); S.fieldBefore = null; render(); }
    else { updateNumbers(); renderDock(); }
  }
  $("list").addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t.dataset.f || !S.editing) return;
    if (t.tagName === "SELECT") editField(t, true);
    else { editField(t, false); pushUndoFrom(S.fieldBefore); S.fieldBefore = JSON.stringify(S.draft); renderDock(); }
  });
  document.addEventListener("focusin", (ev) => {
    const t = ev.target;
    if (S.editing && (t.dataset?.f || t.closest?.("#sitePanel"))) S.fieldBefore = JSON.stringify(S.draft);
  });
  function pushUndoFrom(before) {
    if (!before || before === JSON.stringify(S.draft)) return;
    S.undo.push(before); if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    renderDock();
  }
  function commit(mutate) {
    const before = JSON.stringify(S.draft);
    mutate(S.draft);
    S.draft = FX.content(S.draft);
    if (JSON.stringify(S.draft) === before) return;
    S.undo.push(before); if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
    saveDraft();
    render();
  }
  function saveDraft() {
    store.set(LS_DRAFT, { draft: S.draft, baseline: S.baseline, savedAt: new Date().toISOString() });
  }

  $("list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b || !S.editing) return;
    const act = b.dataset.act;
    if (act === "add-live") return openAddLive();
    if (act === "add-custom") return openAddCustom();
    const id = b.closest("li[data-id]")?.dataset.id;
    commit((d) => {
      const i = d.entries.findIndex((x) => x.id === id);
      if (i < 0) return;
      if (act === "remove") d.entries.splice(i, 1);
      if (act === "up" && i > 0) [d.entries[i - 1], d.entries[i]] = [d.entries[i], d.entries[i - 1]];
      if (act === "down" && i < d.entries.length - 1) [d.entries[i + 1], d.entries[i]] = [d.entries[i], d.entries[i + 1]];
    });
    if (act === "remove") toast("已删除，可撤销");
  });

  function sitePanelInput(ev) {
    if (!S.editing) return;
    const t = ev.target;
    const d = S.draft;
    if (t.id === "fTitle") d.title = t.value;
    if (t.id === "fSub") d.subtitle = t.value;
    if (t.id === "fAmount") { const v = FX.parseAmount(t.value); if (v > 0) d.defaultAmount = v; }
    if (t.id === "fPer100") d.per100 = t.value === "1";
    $("siteTitle").textContent = d.title || "人民币汇率台";
    $("siteSub").textContent = d.subtitle;
    saveDraft();
    if (t.id === "fPer100") { S.per100 = null; render(); }
    renderDock();
  }
  $("sitePanel").addEventListener("input", sitePanelInput);
  $("sitePanel").addEventListener("change", (ev) => {
    if (["fTitle", "fSub", "fAmount", "fPer100"].includes(ev.target.id)) {
      S.draft = FX.content(S.draft); saveDraft();
      pushUndoFrom(S.fieldBefore); S.fieldBefore = JSON.stringify(S.draft);
    }
  });

  function undoRedo(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(S.draft));
    S.draft = JSON.parse(from.pop());
    saveDraft();
    render();
  }
  $("undoBtn").addEventListener("click", () => undoRedo(S.undo, S.redo));
  $("redoBtn").addEventListener("click", () => undoRedo(S.redo, S.undo));
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("overlay").hidden) { closeModal(); return; }
    if (!S.editing || !(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== "z") return;
    if (ev.target.matches?.("input, textarea")) return;
    ev.preventDefault();
    undoRedo(ev.shiftKey ? S.redo : S.undo, ev.shiftKey ? S.undo : S.redo);
  });

  /* ---------- 解锁与锁定 ---------- */
  $("manageBtn").addEventListener("click", () => {
    if (S.editing) { S.editing = false; render(); toast(FX.diff(S.baseline.doc, S.draft).length ? "草稿已保存在本机，还没有发布" : "已退出编辑"); return; }
    if (S.unlocked || S.mode === "standalone") { S.unlocked = true; enterEdit(); return; }
    openUnlock();
  });
  $("draftBannerBtn").addEventListener("click", () => $("manageBtn").click());
  $("lockBtn").addEventListener("click", () => lock(shared() ? "已锁定，草稿保留在本机" : "已退出编辑"));

  function enterEdit() {
    const saved = store.get(LS_DRAFT);
    const pub = publishedContent();
    const rev = shared() ? (S.published?.revision || "") : "local";
    if (saved && saved.draft && saved.baseline) {
      S.draft = FX.content(saved.draft);
      S.baseline = { doc: FX.content(saved.baseline.doc), revision: saved.baseline.revision || "" };
    } else {
      S.draft = FX.clone(pub);
      S.baseline = { doc: FX.clone(pub), revision: rev };
    }
    S.editing = true; S.undo = []; S.redo = [];
    render();
  }

  function lock(msg) {
    S.unlocked = false; S.editing = false;
    if (S.gh) S.gh.setToken("");
    if (S.draft) saveDraft();
    closeModal();
    render();
    if (msg) toast(msg);
  }
  ["pointerdown", "keydown", "input"].forEach((t) => document.addEventListener(t, () => { S.lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (shared() && S.unlocked && Date.now() - S.lastActivity > IDLE_MS) lock("闲置 15 分钟，已自动锁定。草稿保留在本机");
    renderStatus();
  }, 30e3);

  async function openUnlock() {
    if (S.mode === "pages") return openUnlockPages();
    let lockDoc = null;
    try { const snap = await S.db.doc("secure/lock").get(); lockDoc = snap.exists ? snap.data() : null; }
    catch (e) { toast(dbMessage(e)); return; }
    if (!lockDoc) {
      openModal(`<h2 id="modalTitle">设置管理密码</h2>
        <p class="hint">第一次使用，先设一个管理密码。以后在任何设备上打开这个页面，输入密码就能修改并发布。</p>
        <form id="pwForm" class="grid" style="display:grid;gap:10px">
          <label class="field"><span>新密码（至少 6 位）</span><input id="pw1" type="password" autocomplete="new-password" required minlength="6"></label>
          <label class="field"><span>再输一次</span><input id="pw2" type="password" autocomplete="new-password" required></label>
          <p class="err" id="pwErr"></p>
          <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">设定并开始编辑</button></div>
        </form>`);
      $("pwForm").addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const a = $("pw1").value, b = $("pw2").value;
        if (a.length < 6) return ($("pwErr").textContent = "密码至少 6 位。");
        if (a !== b) return ($("pwErr").textContent = "两次输入的密码不一样。");
        try {
          await S.db.doc("secure/lock").set(await FX.makeLock(a));
          S.unlocked = true; closeModal(); enterEdit(); toast("管理密码已设定");
        } catch (e) { $("pwErr").textContent = dbMessage(e); }
      });
      return;
    }
    openModal(`<h2 id="modalTitle">输入管理密码</h2>
      <form id="pwForm" style="display:grid;gap:10px">
        <label class="field"><span>管理密码</span><input id="pw1" type="password" autocomplete="current-password" required></label>
        <p class="err" id="pwErr"></p>
        <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit" id="pwGo">解锁</button></div>
      </form>`);
    $("pwForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const att = store.get(LS_ATT) || { n: 0, until: 0 };
      if (att.until > Date.now()) return ($("pwErr").textContent = `尝试次数太多，请 ${Math.ceil((att.until - Date.now()) / 1000)} 秒后再试。`);
      $("pwGo").disabled = true; $("pwErr").textContent = "正在验证…";
      const ok = await FX.checkLock(lockDoc, $("pw1").value).catch(() => false);
      $("pwGo").disabled = false;
      if (!ok) {
        att.n += 1; if (att.n >= 5) { att.until = Date.now() + 60e3; att.n = 0; }
        store.set(LS_ATT, att);
        $("pwErr").textContent = att.until > Date.now() ? "密码不正确。连续 5 次错误，请 1 分钟后再试。" : "密码不正确。";
        $("pw1").select();
        return;
      }
      store.del(LS_ATT);
      S.unlocked = true; closeModal(); enterEdit();
    });
  }

  /* ---------- GitHub Pages：令牌保管库 ---------- */
  async function loadVault(force) {
    if (S.vault !== undefined && !force) return S.vault;
    let v = null;
    try { v = (await S.gh.readJSON(VAULT_PATH, { auth: false }))?.data || null; }
    catch {
      try { const r = await fetch("./" + VAULT_PATH + "?t=" + Date.now(), { cache: "no-store" }); v = r.ok ? await r.json() : null; } catch { v = null; }
    }
    S.vault = v;
    return v;
  }

  const TOKEN_STEPS = `<ol class="hint" style="margin:0;padding-left:20px;display:grid;gap:4px">
      <li>打开 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 新建细粒度令牌</a>（需要已登录 GitHub）。</li>
      <li>Token name 随便填，比如「汇率台」；Expiration 选最长 1 年。</li>
      <li>Repository access 选 <b>Only select repositories</b>，只勾 <b>${esc(REPO.split("/")[1] || "")}</b>。</li>
      <li>Permissions → Repository permissions → <b>Contents</b> 选 <b>Read and write</b>，其他不用动。</li>
      <li>点 Generate token，复制 github_pat_ 开头的那串，粘贴到下面。</li>
    </ol>`;

  async function openUnlockPages() {
    let vault;
    try { vault = await loadVault(true); } catch { vault = null; }
    if (!vault) return openSetupPages();
    openModal(`<h2 id="modalTitle">输入管理密码</h2>
      <form id="pwForm" style="display:grid;gap:10px">
        <label class="field"><span>管理密码</span><input id="pw1" type="password" autocomplete="current-password" required></label>
        <p class="err" id="pwErr"></p>
        <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit" id="pwGo">解锁</button></div>
      </form>`);
    $("pwForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const att = store.get(LS_ATT) || { n: 0, until: 0 };
      if (att.until > Date.now()) return ($("pwErr").textContent = `尝试次数太多，请 ${Math.ceil((att.until - Date.now()) / 1000)} 秒后再试。`);
      $("pwGo").disabled = true; $("pwErr").textContent = "正在验证…";
      try {
        const token = await GH.open(vault, $("pw1").value, REPO);
        S.gh.setToken(token);
        store.del(LS_ATT);
        S.unlocked = true; closeModal();
        await refreshPublished(true).catch(() => {});
        enterEdit();
      } catch (e) {
        $("pwGo").disabled = false;
        att.n += 1; if (att.n >= 5) { att.until = Date.now() + 60e3; att.n = 0; }
        store.set(LS_ATT, att);
        $("pwErr").textContent = att.until > Date.now() ? "密码不正确。连续 5 次错误，请 1 分钟后再试。" : e.message || "密码不正确。";
        $("pw1").select();
      }
    });
  }

  function openSetupPages(replacing) {
    openModal(`<h2 id="modalTitle">${replacing ? "修改密码 / 更换令牌" : "第一次设置"}</h2>
      <p class="hint">${replacing ? "可以只改密码（令牌留空），也可以换一个新令牌。" : "网站是静态页面，保存修改需要一个只能改这个仓库的 GitHub 令牌。令牌会用你设的密码在浏览器里加密后存进仓库，以后任何设备输入密码就能发布。只需要做一次。"}</p>
      ${replacing ? "" : TOKEN_STEPS}
      <form id="suForm" style="display:grid;gap:10px">
        ${replacing ? `<label class="field"><span>当前密码</span><input id="suOld" type="password" autocomplete="current-password" required></label>` : ""}
        <label class="field"><span>${replacing ? "新令牌（不换就留空）" : "GitHub 令牌"}</span><input id="suTok" type="password" autocomplete="off" placeholder="github_pat_…" ${replacing ? "" : "required"}></label>
        <label class="field"><span>${replacing ? "新密码（至少 8 位）" : "设一个管理密码（至少 8 位）"}</span><input id="suPw1" type="password" autocomplete="new-password" required></label>
        <label class="field"><span>再输一次</span><input id="suPw2" type="password" autocomplete="new-password" required></label>
        ${replacing ? TOKEN_STEPS.replace("<ol", '<details><summary class="hint">怎么生成新令牌</summary><ol').replace("</ol>", "</ol></details>") : ""}
        <p class="err" id="suErr"></p>
        <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit" id="suGo">${replacing ? "保存" : "完成设置并开始编辑"}</button></div>
      </form>`);
    $("suForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = $("suErr"), go = $("suGo");
      const pw = $("suPw1").value;
      if (pw !== $("suPw2").value) return (err.textContent = "两次输入的密码不一样。");
      const problem = GH.passwordProblem(pw);
      if (problem) return (err.textContent = problem);
      go.disabled = true; err.textContent = "正在检查令牌…";
      try {
        let token = $("suTok").value.trim();
        if (replacing && !token) token = await GH.open(await loadVault(true), $("suOld").value, REPO);
        else if (replacing) await GH.open(await loadVault(true), $("suOld").value, REPO); /* 换令牌也要先验证旧密码 */
        if (!GH.validToken(token)) throw Error("令牌格式不对：请使用 github_pat_ 开头的细粒度令牌。");
        S.gh.setToken(token);
        await S.gh.checkAccess();
        err.textContent = "正在加密并保存…";
        const sealed = await GH.seal(token, pw, REPO);
        const existing = await S.gh.readJSON(VAULT_PATH);
        await S.gh.writeJSON(VAULT_PATH, sealed, existing && existing.sha, replacing ? "更新编辑密码" : "设置编辑密码");
        S.vault = sealed;
        S.unlocked = true; closeModal();
        toast(replacing ? "已保存，其他设备下次解锁时使用新密码" : "设置完成");
        if (!replacing) { await refreshPublished(true).catch(() => {}); enterEdit(); }
      } catch (e) {
        if (!S.unlocked) S.gh.setToken("");
        go.disabled = false;
        err.textContent = e.message || "保存失败，请重试。";
      }
    });
  }

  $("pwBtn").addEventListener("click", () => {
    if (S.mode === "pages") return openSetupPages(true);
    openModal(`<h2 id="modalTitle">修改管理密码</h2>
      <form id="cpForm" style="display:grid;gap:10px">
        <label class="field"><span>当前密码</span><input id="cp0" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>新密码（至少 6 位）</span><input id="cp1" type="password" autocomplete="new-password" required minlength="6"></label>
        <label class="field"><span>再输一次新密码</span><input id="cp2" type="password" autocomplete="new-password" required></label>
        <p class="err" id="cpErr"></p>
        <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">保存新密码</button></div>
      </form>`);
    $("cpForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = $("cpErr");
      if ($("cp1").value.length < 6) return (err.textContent = "新密码至少 6 位。");
      if ($("cp1").value !== $("cp2").value) return (err.textContent = "两次输入的新密码不一样。");
      try {
        const snap = await S.db.doc("secure/lock").get();
        if (!(await FX.checkLock(snap.exists ? snap.data() : null, $("cp0").value))) return (err.textContent = "当前密码不正确。");
        await S.db.doc("secure/lock").set(await FX.makeLock($("cp1").value));
        closeModal(); toast("管理密码已更新，其他设备下次解锁时使用新密码");
      } catch (e) { err.textContent = dbMessage(e); }
    });
  });

  /* ---------- 添加 ---------- */
  function openAddLive() {
    openModal(`<h2 id="modalTitle">添加货币</h2>
      <label class="field"><span>搜索中文名或代码</span><input id="q" placeholder="例如：泰铢、THB" autocomplete="off"></label>
      <div class="picker" id="pick"></div>
      <div class="acts"><button class="btn" type="button" data-close>关闭</button></div>`);
    const draw = () => {
      const q = $("q").value.trim().toLowerCase();
      const have = new Set(S.draft.entries.filter((e) => e.kind === "live").map((e) => e.code));
      const hits = FX.CATALOG.filter(([c, n]) => !q || c.toLowerCase().includes(q) || n.toLowerCase().includes(q));
      let html = hits.map(([c, n]) => `<button type="button" data-code="${c}" ${have.has(c) ? "disabled" : ""}><span class="code">${c}</span><span>${esc(n)}${have.has(c) ? "（已添加）" : ""}</span></button>`).join("");
      const raw = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (raw.length >= 3 && raw.length <= 6 && !FX.NAMES[raw]) html += `<button type="button" data-code="${raw}"><span class="code">${raw}</span><span>使用代码 ${raw}（来源支持时会显示汇率）</span></button>`;
      $("pick").innerHTML = html || `<p class="hint">没有找到。可以直接输入 3 位货币代码。</p>`;
    };
    $("q").addEventListener("input", draw);
    $("pick").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-code]");
      if (!b) return;
      const entry = FX.liveEntry(b.dataset.code);
      commit((d) => d.entries.push(entry));
      closeModal(); flashRow(entry.id); toast(`已添加 ${entry.label}`);
    });
    draw();
  }

  function openAddCustom() {
    const opts = FX.CATALOG.map(([c, n]) => `<option value="${c}">${c} ${esc(n)}</option>`).join("");
    openModal(`<h2 id="modalTitle">添加自定义汇率</h2>
      <p class="hint">记下你实际能拿到的价格，比如银行现汇卖出价、汇款平台报价，或者在实时汇率上加点。</p>
      <form id="cuForm" style="display:grid;gap:10px">
        <label class="field"><span>名称</span><input id="cuName" maxlength="40" required placeholder="例如：招行现汇卖出"></label>
        <label class="field"><span>货币</span><select id="cuCode">${opts}</select></label>
        <label class="field"><span>计价方式</span><select id="cuMode"><option value="spread">实时汇率加点</option><option value="fixed">固定汇率</option></select></label>
        <label class="field" id="cuSpreadF"><span>加点 %（正数表示比实时汇率贵）</span><input id="cuSpread" inputmode="decimal" value="0.5"></label>
        <label class="field" id="cuFixedF" hidden><span id="cuFixedL">1 外币 = ? 人民币</span><input id="cuFixed" inputmode="decimal" placeholder="例如 7.62"></label>
        <label class="field"><span>备注</span><input id="cuNote" maxlength="200"></label>
        <p class="err" id="cuErr"></p>
        <div class="acts"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">添加</button></div>
      </form>`);
    const sync = () => {
      const fixed = $("cuMode").value === "fixed";
      $("cuSpreadF").hidden = fixed; $("cuFixedF").hidden = !fixed;
      const code = $("cuCode").value;
      $("cuFixedL").textContent = `1 ${code} = ? 人民币`;
      const live = FX.cnyPerUnit(S.rates && S.rates.rates, code);
      $("cuFixed").placeholder = live ? "当前实时约 " + FX.fmtRate(live) : "例如 7.62";
    };
    $("cuMode").addEventListener("change", sync);
    $("cuCode").addEventListener("change", sync);
    sync();
    $("cuForm").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const mode = $("cuMode").value;
      const fixed = FX.num($("cuFixed").value), spread = FX.num($("cuSpread").value);
      if (mode === "fixed" && !(fixed > 0)) return ($("cuErr").textContent = "请填写大于 0 的固定汇率。");
      if (mode === "spread" && spread === null) return ($("cuErr").textContent = "请填写加点百分比，可以是 0 或负数。");
      const entry = FX.normalizeEntry({ kind: "custom", code: $("cuCode").value, label: $("cuName").value.trim() || $("cuCode").value, mode, fixed, spread: spread ?? 0, note: $("cuNote").value.trim() });
      commit((d) => d.entries.push(entry));
      closeModal(); flashRow(entry.id); toast(`已添加 ${entry.label}`);
    });
  }

  function flashRow(id) {
    const li = document.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.add("flash");
    li.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => li.classList.remove("flash"), 1300);
  }

  /* ---------- 发布与合并 ---------- */
  async function readCloud() {
    if (S.mode === "pages") {
      const f = await S.gh.readJSON(CONFIG_PATH, { auth: S.gh.unlocked });
      return f ? { doc: FX.content(f.data), revision: f.sha } : { doc: FX.emptyConfig(), revision: "" };
    }
    const snap = await S.db.doc("config/site").get();
    if (!snap.exists) return { doc: FX.emptyConfig(), revision: "" };
    const d = snap.data();
    return { doc: FX.content(d), revision: d.revision || "" };
  }

  /* 把云端新版本合进草稿；有冲突时让用户选择。返回 false 表示用户取消 */
  function mergeInto(latest) {
    return new Promise((resolve) => {
      const { merged, conflicts } = FX.merge3(S.baseline.doc, S.draft, latest.doc);
      const finish = (doc) => {
        const before = JSON.stringify(S.draft);
        S.draft = doc; S.baseline = { doc: FX.clone(latest.doc), revision: latest.revision };
        if (before !== JSON.stringify(doc)) { S.undo.push(before); S.redo = []; }
        saveDraft(); render(); resolve(true);
      };
      if (!conflicts.length) return finish(merged);
      const show = (v, f) => (typeof v === "boolean" ? (v ? "保留这一项" : "删除这一项") : esc(f === "per100" ? (v ? "开" : "关") : v === null || v === undefined || v === "" ? "（空）" : v));
      openModal(`<h2 id="modalTitle">有 ${conflicts.length} 处修改冲突</h2>
        <p class="hint">另一台设备也改了同样的内容。逐项选择要保留的版本，其余修改已经自动合并。</p>
        <div style="display:grid;gap:8px">${conflicts.map((c, i) => `<div class="conflict"><strong style="font-size:14px">${esc(c.label)}</strong><div class="opts">
          <label><input type="radio" name="c${i}" value="local" checked><span>本机：${show(c.local, c.field)}</span></label>
          <label><input type="radio" name="c${i}" value="remote"><span>云端：${show(c.remote, c.field)}</span></label></div></div>`).join("")}</div>
        <div class="acts"><button class="btn" type="button" id="cfCancel">稍后再说</button><button class="btn primary" type="button" id="cfApply">应用选择</button></div>`);
      $("cfCancel").addEventListener("click", () => { closeModal(); resolve(false); });
      $("cfApply").addEventListener("click", () => {
        const choices = conflicts.map((_, i) => document.querySelector(`input[name="c${i}"]:checked`)?.value || "local");
        closeModal();
        finish(FX.resolve(merged, conflicts, choices));
      });
    });
  }

  $("syncBtn").addEventListener("click", async () => {
    try {
      const latest = await readCloud();
      if (latest.revision === S.baseline.revision) return toast("已是最新，云端没有新的修改");
      if (await mergeInto(latest)) toast("已合并云端的新修改，本机草稿保留");
    } catch (e) { toast(dbMessage(e)); }
  });

  $("publishBtn").addEventListener("click", () => startPublish());

  async function startPublish() {
    if (S.busy) return;
    if (S.mode === "standalone") {
      const changes = FX.diff(S.baseline.doc, S.draft);
      if (!changes.length) return toast("没有需要保存的修改");
      return openPreview(changes, async () => {
        store.set(LS_LOCAL, S.draft);
        S.baseline = { doc: FX.clone(S.draft), revision: "local" };
        store.del(LS_DRAFT); S.undo = []; S.redo = [];
        closeModal(); render(); toast("已保存到这台设备");
      });
    }
    try {
      S.busy = true; renderDock();
      const latest = await readCloud();
      if (latest.revision !== S.baseline.revision) {
        S.busy = false;
        const ok = await mergeInto(latest);
        if (!ok) return;
        toast("发布前已合并云端的新修改");
      }
      S.busy = false; renderDock();
      const changes = FX.diff(S.baseline.doc, S.draft);
      if (!changes.length) return toast("合并后没有需要发布的修改");
      openPreview(changes, confirmPublish);
    } catch (e) { S.busy = false; renderDock(); toast(dbMessage(e)); }
  }

  function openPreview(changes, onConfirm) {
    openModal(`<h2 id="modalTitle">发布前检查</h2>
      <p class="hint">${S.mode === "cloud" ? "确认后，所有设备上的这个页面都会换成新版本。" : S.mode === "pages" ? "确认后会在 GitHub 仓库保存一次提交，其他设备打开页面就能看到。" : "确认后保存在这台设备的浏览器里。"}</p>
      <ul class="changes">${changes.map((c) => `<li class="${c.type}">${esc(c.text)}</li>`).join("")}</ul>
      <p class="err" id="pubErr"></p>
      <div class="acts"><button class="btn" type="button" data-close>返回编辑</button><button class="btn primary" type="button" id="pubGo">${shared() ? "确认发布到网站" : "确认保存"}</button></div>`);
    $("pubGo").addEventListener("click", onConfirm);
  }

  async function confirmPublish() {
    const go = $("pubGo"), err = $("pubErr");
    go.disabled = true; err.textContent = "正在发布…";
    S.busy = true;
    if (S.mode === "pages") return confirmPublishPages(go, err);
    const ref = S.db.doc("config/site");
    try {
      try {
        const lease = await ref.acquire({ holder: TAB, ttlMs: 20000 });
        if (lease && lease.acquired === false) { err.textContent = "另一台设备正在发布，请几秒后再试。"; go.disabled = false; S.busy = false; return; }
      } catch { /* 文档还不存在或不支持租约时直接继续 */ }
      const latest = await readCloud();
      if (latest.revision !== S.baseline.revision) {
        closeModal(); S.busy = false;
        toast("刚才云端有了新版本，先合并再发布");
        return startPublish();
      }
      const revision = FX.uid();
      const doc = { ...FX.content(S.draft), revision, updatedAt: new Date().toISOString() };
      await ref.set(doc);
      const check = await ref.get();
      if (!check.exists || check.data().revision !== revision) throw { code: "verify" };
      S.published = { doc, revision };
      S.baseline = { doc: FX.content(doc), revision };
      S.draft = FX.content(doc);
      store.del(LS_DRAFT); S.undo = []; S.redo = [];
      S.busy = false; closeModal(); render();
      toast("已发布，所有设备都能看到新版本");
    } catch (e) {
      S.busy = false; go.disabled = false;
      err.textContent = e && e.code === "verify" ? "已提交，但重新读取时没看到这次的版本。草稿仍在本机，请点「检查云端更新」后再试。" : dbMessage(e);
      renderDock();
    }
  }

  async function confirmPublishPages(go, err) {
    try {
      const changes = FX.diff(S.baseline.doc, S.draft);
      const message = "更新汇率台：" + changes.slice(0, 3).map((c) => c.text).join("；").slice(0, 120) + (changes.length > 3 ? ` 等 ${changes.length} 处` : "");
      const doc = { ...FX.content(S.draft), updatedAt: new Date().toISOString() };
      let res;
      try {
        res = await S.gh.writeJSON(CONFIG_PATH, doc, S.baseline.revision || undefined, message);
      } catch (e) {
        if (e.status === 409 || e.status === 422) {
          closeModal(); S.busy = false;
          toast("刚才另一台设备保存过，先合并再发布");
          return startPublish();
        }
        throw e;
      }
      const check = await S.gh.readJSON(CONFIG_PATH);
      if (!check || check.sha !== res.sha) throw { code: "verify" };
      S.published = { doc, revision: res.sha };
      S.baseline = { doc: FX.content(doc), revision: res.sha };
      S.draft = FX.content(doc);
      store.del(LS_DRAFT); S.undo = []; S.redo = [];
      S.busy = false; closeModal(); render();
      toast("已发布到 GitHub，其他设备刷新页面就能看到");
    } catch (e) {
      S.busy = false; go.disabled = false;
      err.textContent = e && e.code === "verify" ? "已提交，但重新读取时没看到这次的版本。草稿仍在本机，请点「检查云端更新」后再试。" : dbMessage(e);
      renderDock();
    }
  }

  function dbMessage(e) {
    if (e instanceof GH.Err) return e.message;
    const code = e && e.code;
    if (code === "invalid_argument") return "没有修改权限：只有这个页面的拥有者和编辑者能保存。草稿仍在本机。";
    if (code === "quota_exceeded") return "云端存储已满，请删除一些内容后再试。";
    if (code === "resource_exhausted") return "操作太频繁，请稍等几秒再试。";
    if (code === "revoked" || code === "not_granted") return "这个页面的云端访问已不可用，请刷新页面。";
    return "暂时连不上云端，草稿仍保存在本机，请稍后再试。";
  }

  /* ---------- 备份 ---------- */
  $("exportBtn").addEventListener("click", async () => {
    const data = JSON.stringify({ app: "fxdesk", exportedAt: new Date().toISOString(), config: FX.content(view()) }, null, 2);
    const filename = "汇率台备份-" + new Date().toISOString().slice(0, 10) + ".json";
    if (S.downloads) {
      try { await S.downloads.save({ filename, data }); toast("备份已导出"); } catch (e) { if (e && e.code !== "declined") showCopy(data); }
      return;
    }
    if (!window.claude) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return;
    }
    showCopy(data);
  });
  function showCopy(data) {
    openModal(`<h2 id="modalTitle">备份内容</h2><p class="hint">复制下面的内容，保存成 .json 文件即可。</p>
      <label class="field"><span>JSON</span><textarea id="cpText" rows="10" readonly>${esc(data)}</textarea></label>
      <div class="acts"><button class="btn" type="button" data-close>关闭</button><button class="btn primary" type="button" id="cpGo">复制</button></div>`);
    $("cpGo").addEventListener("click", () => {
      navigator.clipboard.writeText(data).then(() => toast("已复制"), () => { $("cpText").select(); toast("请按 Ctrl/⌘+C 复制"); });
    });
  }
  $("importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file || !S.editing) return;
    try {
      const obj = JSON.parse(await file.text());
      const cfg = FX.normalizeConfig(obj.config || obj);
      commit((d) => { Object.assign(d, cfg); });
      toast(`已导入 ${cfg.entries.length} 个货币到草稿，可撤销；发布后才会生效`);
    } catch { toast("这个文件不是有效的备份 JSON。"); }
  });

  /* ---------- 显示方式 ---------- */
  const setPer = (on) => { S.per100 = on; store.set(LS_VIEW, { per100: on }); render(); };
  $("unit1").addEventListener("click", () => setPer(false));
  $("unit100").addEventListener("click", () => setPer(true));

  /* ---------- 弹窗与提示 ---------- */
  let lastFocus = null;
  function openModal(html) {
    lastFocus = document.activeElement;
    $("modal").innerHTML = html;
    $("overlay").hidden = false;
    const first = $("modal").querySelector("input:not([type=radio]), select, textarea, button.primary");
    setTimeout(() => first && first.focus(), 20);
  }
  function closeModal() {
    if ($("overlay").hidden) return;
    $("overlay").hidden = true; $("modal").innerHTML = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("overlay").addEventListener("click", (ev) => {
    if (ev.target === $("overlay") || ev.target.closest("[data-close]")) closeModal();
  });
  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  /* ---------- 纹样 ---------- */
  (function drawGuilloche() {
    const svg = $("guilloche");
    let paths = "";
    for (let k = 0; k < 9; k++) {
      let d = "";
      for (let x = 0; x <= 800; x += 8) {
        const y = 60 + Math.sin(x / 38 + k * 0.7) * (22 + k * 2) * Math.cos(x / 170 - k * 0.3);
        d += (x ? "L" : "M") + x + " " + y.toFixed(1);
      }
      paths += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="0.8"/>`;
    }
    svg.innerHTML = paths;
  })();

  /* ---------- 数据来源 ---------- */
  async function startCloud(db) {
    S.db = db; S.mode = "cloud";
    render();
    db.doc("rates/latest").onSnapshot((snap) => {
      S.rates = snap.exists ? snap.data() : null;
      updateNumbers(); renderStatus();
    }, () => { S.rateError = "汇率连接中断，请刷新页面"; renderStatus(); });
    db.doc("config/site").onSnapshot((snap) => {
      const d = snap.exists ? snap.data() : null;
      const changed = S.publishedLoaded && d && S.published && d.revision !== S.published.revision;
      S.published = d ? { doc: d, revision: d.revision || "" } : null;
      S.publishedLoaded = true;
      if (S.editing) { renderDock(); if (changed) toast("另一台设备刚发布了修改，发布时会自动合并"); }
      else render();
    }, () => { S.publishedLoaded = true; render(); });
    db.collection("history").orderBy("t", "desc").limit(240).onSnapshot((qs) => {
      S.history = qs.docs.map((d) => d.data());
      updateNumbers();
    }, () => { /* 没有历史时只是不显示涨跌 */ });
    const [user, downloads] = await Promise.all([window.claude.use("user"), window.claude.use("downloads")]);
    S.user = user; S.downloads = downloads;
    if (user) {
      const can = await user.can("data.write");
      S.canEdit = can === null ? true : can; /* 平台没给答案时保留入口，由写入结果决定 */
    } else S.canEdit = true;
    render();
  }

  function startStandalone() {
    S.mode = "standalone";
    S.history = store.get(LS_HIST) || [];
    render();
    fetchDirect();
    setInterval(fetchDirect, 60e3);
  }

  async function fetchDirect() {
    const get = async (url) => { const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) }); if (!r.ok) throw Error(r.status); return r.json(); };
    let next = null;
    try {
      const j = await get("https://api.coinbase.com/v2/exchange-rates?currency=CNY");
      const rates = {};
      for (const [k, v] of Object.entries(j.data.rates)) { const n = Number(v); if (n > 0) rates[k] = n; }
      next = { base: "CNY", rates, source: "Coinbase", fetchedAt: new Date().toISOString() };
    } catch {
      try {
        const j = await get("https://open.er-api.com/v6/latest/CNY");
        next = { base: "CNY", rates: j.rates, source: "ExchangeRate-API", fetchedAt: new Date().toISOString() };
      } catch { /* 两个来源都失败 */ }
    }
    if (next) {
      S.rates = next; S.rateError = "";
      if (S.mode === "standalone") {
        const hourKey = next.fetchedAt.slice(0, 13);
        if (!S.history.length || S.history[0].t.slice(0, 13) !== hourKey) {
          const codes = new Set(view().entries.map((e) => e.code));
          const subset = {}; for (const c of codes) if (next.rates[c]) subset[c] = next.rates[c];
          S.history = [{ t: next.fetchedAt, rates: subset }, ...S.history].filter((h) => Date.parse(h.t) > Date.now() - 8 * 86400e3).slice(0, 200);
          store.set(LS_HIST, S.history);
        }
      }
    } else S.rateError = "暂时连不上汇率接口，稍后自动重试";
    updateNumbers(); renderStatus();
  }

  /* ---------- GitHub Pages 模式 ---------- */
  async function refreshPublished(auth) {
    let got = null;
    try {
      const f = await S.gh.readJSON(CONFIG_PATH, { auth: !!auth && S.gh.unlocked });
      if (f) got = { doc: f.data, revision: f.sha };
    } catch {
      try {
        const r = await fetch("./" + CONFIG_PATH + "?t=" + Date.now(), { cache: "no-store" });
        if (r.ok) got = { doc: await r.json(), revision: "" };
      } catch { /* 两种方式都读不到时保留当前内容 */ }
    }
    const changed = got && S.published && got.revision && S.published.revision && got.revision !== S.published.revision;
    if (got) S.published = got;
    S.publishedLoaded = true;
    if (S.editing) { renderDock(); if (changed) toast("另一台设备刚发布了修改，发布时会自动合并"); }
    else render();
  }

  async function fetchDaily() {
    const from = new Date(Date.now() - 32 * 86400e3).toISOString().slice(0, 10);
    try {
      const r = await fetch("https://api.frankfurter.dev/v1/" + from + "..?base=CNY", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw Error(r.status);
      const j = await r.json();
      S.history = Object.entries(j.rates || {}).map(([d, rates]) => ({ t: d + "T15:00:00Z", rates })).sort((a, b) => (a.t < b.t ? 1 : -1));
      S.daily = S.history.length > 0;
      $("chgNote").textContent = "涨跌按中国市场习惯：红色表示外币对人民币上涨，绿色表示下跌，对比上一个欧洲央行参考价（工作日更新）。";
      updateNumbers();
    } catch { /* 拿不到历史时只是不显示涨跌和走势 */ }
  }

  function startPages() {
    S.mode = "pages";
    S.gh = new GH.Client(REPO, "main");
    render();
    refreshPublished(false);
    fetchDirect();
    fetchDaily();
    setInterval(fetchDirect, 60e3);
    setInterval(fetchDaily, 6 * 3600e3);
    setInterval(() => { if (!S.editing && document.visibilityState === "visible") refreshPublished(false); }, 5 * 60e3);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") fetchDirect(); });
  }

  /* ---------- 启动 ---------- */
  const view0 = store.get(LS_VIEW);
  if (view0 && typeof view0.per100 === "boolean") S.per100 = view0.per100;
  render();
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("db").then((db) => {
      if (db) startCloud(db);
      else { S.mode = "offline"; render(); }
    });
  } else if (REPO && /^https?:$/.test(location.protocol)) startPages();
  else startStandalone();
})();
