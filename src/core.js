/* 汇率台核心逻辑：纯函数，无 DOM。浏览器和 Node 测试共用。 */
const FX = (() => {
  const CATALOG = [
    ["USD", "美元"], ["EUR", "欧元"], ["GBP", "英镑"], ["JPY", "日元"], ["HKD", "港币"],
    ["MOP", "澳门元"], ["TWD", "新台币"], ["KRW", "韩元"], ["SGD", "新加坡元"], ["AUD", "澳元"],
    ["NZD", "新西兰元"], ["CAD", "加元"], ["CHF", "瑞士法郎"], ["SEK", "瑞典克朗"], ["NOK", "挪威克朗"],
    ["DKK", "丹麦克朗"], ["ISK", "冰岛克朗"], ["PLN", "波兰兹罗提"], ["CZK", "捷克克朗"], ["HUF", "匈牙利福林"],
    ["RON", "罗马尼亚列伊"], ["BGN", "保加利亚列弗"], ["TRY", "土耳其里拉"], ["RUB", "俄罗斯卢布"], ["UAH", "乌克兰格里夫纳"],
    ["THB", "泰铢"], ["MYR", "马来西亚林吉特"], ["IDR", "印尼盾"], ["PHP", "菲律宾比索"], ["VND", "越南盾"],
    ["KHR", "柬埔寨瑞尔"], ["LAK", "老挝基普"], ["MMK", "缅甸元"], ["INR", "印度卢比"], ["PKR", "巴基斯坦卢比"],
    ["LKR", "斯里兰卡卢比"], ["NPR", "尼泊尔卢比"], ["BDT", "孟加拉塔卡"], ["MVR", "马尔代夫拉菲亚"], ["MNT", "蒙古图格里克"],
    ["KZT", "哈萨克斯坦坚戈"], ["UZS", "乌兹别克斯坦苏姆"], ["AED", "阿联酋迪拉姆"], ["SAR", "沙特里亚尔"], ["QAR", "卡塔尔里亚尔"],
    ["KWD", "科威特第纳尔"], ["BHD", "巴林第纳尔"], ["OMR", "阿曼里亚尔"], ["JOD", "约旦第纳尔"], ["ILS", "以色列新谢克尔"],
    ["EGP", "埃及镑"], ["MAD", "摩洛哥迪拉姆"], ["TND", "突尼斯第纳尔"], ["ZAR", "南非兰特"], ["KES", "肯尼亚先令"],
    ["NGN", "尼日利亚奈拉"], ["TZS", "坦桑尼亚先令"], ["MUR", "毛里求斯卢比"], ["BRL", "巴西雷亚尔"], ["MXN", "墨西哥比索"],
    ["ARS", "阿根廷比索"], ["CLP", "智利比索"], ["COP", "哥伦比亚比索"], ["PEN", "秘鲁索尔"], ["UYU", "乌拉圭比索"],
    ["FJD", "斐济元"], ["XPF", "太平洋法郎"], ["GEL", "格鲁吉亚拉里"], ["AMD", "亚美尼亚德拉姆"], ["AZN", "阿塞拜疆马纳特"],
    ["RSD", "塞尔维亚第纳尔"], ["ALL", "阿尔巴尼亚列克"], ["MKD", "北马其顿第纳尔"], ["BAM", "波黑可兑换马克"], ["XAU", "黄金（盎司）"],
    ["XAG", "白银（盎司）"], ["BTC", "比特币"], ["ETH", "以太坊"], ["USDT", "泰达币 USDT"], ["USDC", "USD Coin"],
    ["SOL", "Solana"], ["BNB", "币安币"], ["XRP", "瑞波币"], ["DOGE", "狗狗币"],
  ];
  const NAMES = Object.fromEntries(CATALOG);
  const CRYPTO = new Set(["BTC", "ETH", "USDT", "USDC", "SOL", "BNB", "XRP", "DOGE"]);
  /* 银行牌价习惯按 100 单位报价的货币 */
  const PER100_DEFAULT = new Set(["JPY", "KRW", "IDR", "VND", "KHR", "LAK", "MMK", "HUF", "CLP", "COP", "UZS", "MNT", "TZS", "NGN", "PKR", "LKR", "NPR", "INR", "RUB", "ISK", "ARS", "KZT"]);
  const SITE_FIELDS = ["title", "subtitle", "defaultAmount", "per100"];
  const ENTRY_FIELDS = ["kind", "code", "label", "note", "mode", "fixed", "spread", "target", "targetDir"];
  const FIELD_LABEL = {
    title: "网站标题", subtitle: "副标题", defaultAmount: "默认金额", per100: "按 100 单位显示汇率",
    kind: "类型", code: "货币代码", label: "名称", note: "备注", mode: "计价方式",
    fixed: "固定汇率", spread: "加点", target: "目标价", targetDir: "目标方向",
  };

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const uid = () => "e" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  function emptyConfig() {
    return { schema: 1, title: "人民币汇率台", subtitle: "以人民币为基准，实时换算", defaultAmount: 1000, per100: false, entries: [] };
  }

  function liveEntry(code, extra = {}) {
    return { id: uid(), kind: "live", code, label: NAMES[code] || code, note: "", target: null, targetDir: "above", ...extra };
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== "object") return null;
    const code = String(e.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (!code) return null;
    const out = {
      id: typeof e.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(e.id) ? e.id : uid(),
      kind: e.kind === "custom" ? "custom" : "live",
      code,
      label: String(e.label ?? NAMES[code] ?? code).slice(0, 40),
      note: String(e.note ?? "").slice(0, 200),
      target: num(e.target),
      targetDir: e.targetDir === "below" ? "below" : "above",
    };
    if (out.kind === "custom") {
      out.mode = e.mode === "fixed" ? "fixed" : "spread";
      out.fixed = num(e.fixed);
      out.spread = num(e.spread) ?? 0;
    }
    return out;
  }

  function num(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s，]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function normalizeConfig(c) {
    const base = emptyConfig();
    if (!c || typeof c !== "object") return base;
    const ids = new Set();
    const entries = [];
    for (const raw of Array.isArray(c.entries) ? c.entries : []) {
      const e = normalizeEntry(raw);
      if (!e) continue;
      while (ids.has(e.id)) e.id = uid();
      ids.add(e.id);
      entries.push(e);
    }
    const amt = num(c.defaultAmount);
    return {
      schema: 1,
      title: String(c.title ?? base.title).slice(0, 40) || base.title,
      subtitle: String(c.subtitle ?? base.subtitle).slice(0, 80),
      defaultAmount: amt !== null && amt > 0 ? amt : base.defaultAmount,
      per100: !!c.per100,
      entries,
    };
  }

  /* 只取需要比较和保存的内容 */
  function content(c) {
    const n = normalizeConfig(c);
    return { schema: 1, title: n.title, subtitle: n.subtitle, defaultAmount: n.defaultAmount, per100: n.per100, entries: n.entries };
  }

  /* ---------- 汇率计算 ---------- */
  /* rates 为「1 人民币 = x 外币」，返回「1 外币 = ? 人民币」 */
  function cnyPerUnit(rates, code) {
    if (code === "CNY") return 1;
    const r = rates && rates[code];
    return typeof r === "number" && r > 0 ? 1 / r : null;
  }

  function entryCny(entry, rates) {
    if (entry.kind === "custom") {
      if (entry.mode === "fixed") return entry.fixed > 0 ? entry.fixed : null;
      const live = cnyPerUnit(rates, entry.code);
      return live === null ? null : live * (1 + (entry.spread || 0) / 100);
    }
    return cnyPerUnit(rates, entry.code);
  }

  function targetStatus(entry, value) {
    if (entry.target === null || entry.target === undefined || !(entry.target > 0) || value === null) return null;
    const hit = entry.targetDir === "below" ? value <= entry.target : value >= entry.target;
    if (hit) return { state: "hit", text: "已达目标" };
    const gap = Math.abs(value - entry.target) / entry.target;
    if (gap <= 0.01) return { state: "near", text: "接近目标 " + (gap * 100).toFixed(2) + "%" };
    return { state: "watch", text: "距目标 " + (gap * 100).toFixed(1) + "%" };
  }

  /* 历史快照：找最接近 hoursAgo 的一条（容差 ±windowHours） */
  function snapshotNear(history, now, hoursAgo, windowHours = 6) {
    const want = now - hoursAgo * 3600e3;
    let best = null, bestGap = Infinity;
    for (const h of history || []) {
      const t = Date.parse(h.t);
      if (!Number.isFinite(t)) continue;
      const gap = Math.abs(t - want);
      if (gap < bestGap) { best = h; bestGap = gap; }
    }
    return best && bestGap <= windowHours * 3600e3 ? best : null;
  }

  function seriesFor(history, code, now, days = 7) {
    const from = now - days * 86400e3;
    return (history || [])
      .map((h) => ({ t: Date.parse(h.t), v: cnyPerUnit(h.rates, code) }))
      .filter((p) => Number.isFinite(p.t) && p.t >= from && p.v !== null)
      .sort((a, b) => a.t - b.t);
  }

  /* ---------- 数字格式 ---------- */
  function decimalsFor(code, value) {
    if (CRYPTO.has(code) && code !== "USDT" && code !== "USDC") {
      const a = Math.abs(value);
      if (a === 0) return 2;
      if (a < 0.001) return 8;
      if (a < 1) return 6;
      return 4;
    }
    if (["JPY", "KRW", "IDR", "VND", "KHR", "LAK", "MMK", "CLP", "COP", "UZS", "MNT", "TZS", "HUF", "ISK"].includes(code)) return Math.abs(value) < 100 ? 2 : 0;
    return 2;
  }

  function fmtAmount(value, code) {
    if (value === null || !Number.isFinite(value)) return "";
    const d = decimalsFor(code, value);
    return value.toLocaleString("en-US", { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
  }

  function fmtRate(value) {
    if (value === null || !Number.isFinite(value)) return "—";
    const a = Math.abs(value);
    let d = 4;
    if (a >= 10000) d = 2;
    else if (a < 0.0001) d = 8;
    else if (a < 0.01) d = 6;
    return value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /* 换算阶梯：值钱的货币看 10 / 100 / 1000；越南盾、印尼盾这类按能买到东西的量级放大 */
  function ladderFor(cnyPerUnit) {
    if (!(cnyPerUnit > 0)) return [];
    if (cnyPerUnit >= 0.05) return [10, 100, 1000];
    const s0 = Math.pow(10, Math.ceil(Math.log10(0.1 / cnyPerUnit)));
    return [s0 * 10, s0 * 100, s0 * 1000];
  }

  /* 人民币金额：1 元以上两位小数；不足 1 元保留 4 位有效数字 */
  function fmtCny(value) {
    if (value === null || !Number.isFinite(value)) return "—";
    const a = Math.abs(value);
    if (a >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (a === 0) return "0";
    const d = Math.min(10, Math.max(2, 3 - Math.floor(Math.log10(a))));
    return value.toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
  }

  function fmtInt(n) { return n.toLocaleString("en-US"); }

  /* 商品价格对比：当地价折人民币后与中国价相比的倍数 */
  function priceRatio(localPrice, cnyPerUnitRate, chinaPrice) {
    if (!(localPrice > 0) || !(cnyPerUnitRate > 0) || !(chinaPrice > 0)) return null;
    return (localPrice * cnyPerUnitRate) / chinaPrice;
  }

  function parseAmount(text) {
    const s = String(text ?? "").replace(/[,\s，]/g, "").replace(/。/g, ".");
    if (s === "" || s === ".") return null;
    if (!/^-?\d*\.?\d*(e[+-]?\d+)?$/i.test(s)) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function fmtAgo(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "未知";
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return "刚刚";
    const m = Math.round(s / 60);
    if (m < 60) return m + " 分钟前";
    const h = Math.round(m / 60);
    if (h < 48) return h + " 小时前";
    return Math.round(h / 24) + " 天前";
  }

  function freshness(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "none";
    const min = (now - t) / 60000;
    if (min <= 80) return "fresh";
    if (min <= 240) return "late";
    return "stale";
  }

  /* ---------- 修改清单 ---------- */
  function entryName(e) {
    return (e.label || e.code) + (e.label && e.label !== e.code ? " " + e.code : "");
  }

  function showVal(field, v) {
    if (v === null || v === undefined || v === "") return "（空）";
    if (field === "per100") return v ? "开" : "关";
    if (field === "kind") return v === "custom" ? "自定义" : "实时";
    if (field === "mode") return v === "fixed" ? "固定汇率" : "实时加点";
    if (field === "targetDir") return v === "below" ? "低于" : "高于";
    if (field === "spread") return v + "%";
    return String(v);
  }

  function diff(before, after) {
    const a = content(before), b = content(after);
    const out = [];
    for (const f of SITE_FIELDS) {
      if (!same(a[f], b[f])) out.push({ type: "site", text: FIELD_LABEL[f] + "：" + showVal(f, a[f]) + " → " + showVal(f, b[f]) });
    }
    const am = new Map(a.entries.map((e) => [e.id, e]));
    const bm = new Map(b.entries.map((e) => [e.id, e]));
    for (const e of b.entries) {
      const old = am.get(e.id);
      if (!old) { out.push({ type: "add", text: "新增 " + entryName(e) + (e.kind === "custom" ? "（自定义）" : "") }); continue; }
      for (const f of ENTRY_FIELDS) {
        if (!same(old[f], e[f])) out.push({ type: "edit", text: entryName(e) + " · " + FIELD_LABEL[f] + "：" + showVal(f, old[f]) + " → " + showVal(f, e[f]) });
      }
    }
    for (const e of a.entries) if (!bm.has(e.id)) out.push({ type: "remove", text: "删除 " + entryName(e) });
    const ao = a.entries.filter((e) => bm.has(e.id)).map((e) => e.id);
    const bo = b.entries.filter((e) => am.has(e.id)).map((e) => e.id);
    if (!same(ao, bo)) out.push({ type: "order", text: "调整了货币顺序" });
    return out;
  }

  /* ---------- 三方合并（字段级） ---------- */
  function merge3(baseIn, localIn, remoteIn) {
    const base = content(baseIn), local = content(localIn), remote = content(remoteIn);
    const merged = { schema: 1 };
    const conflicts = [];
    const pick = (path, label, b, l, r, set) => {
      if (same(l, r)) return set(clone(l));
      if (same(l, b)) return set(clone(r));
      if (same(r, b)) return set(clone(l));
      set(clone(l));
      conflicts.push({ path, label, local: clone(l), remote: clone(r), field: path[path.length - 1] });
    };
    for (const f of SITE_FIELDS) pick([f], FIELD_LABEL[f], base[f], local[f], remote[f], (v) => (merged[f] = v));

    const bm = new Map(base.entries.map((e) => [e.id, e]));
    const lm = new Map(local.entries.map((e) => [e.id, e]));
    const rm = new Map(remote.entries.map((e) => [e.id, e]));
    const result = new Map();
    const ids = new Set([...bm.keys(), ...lm.keys(), ...rm.keys()]);
    for (const id of ids) {
      const b = bm.get(id), l = lm.get(id), r = rm.get(id);
      if (!b) { result.set(id, clone(l || r)); continue; } /* 新增：两边 id 不会重复 */
      if (!l && !r) continue;
      if (!l || !r) {
        const kept = l || r;
        if (same(kept, b)) continue; /* 一边删除，另一边没改 → 删除 */
        if (l) result.set(id, clone(l)); /* 默认保留本机的状态，冲突里可改选云端 */
        conflicts.push({ path: ["entries", id, "__exists"], label: entryName(kept) + " · " + (l ? "云端已删除，本机做了修改" : "本机已删除，云端做了修改"), local: !!l, remote: !!r, field: "__exists", entry: clone(kept) });
        continue;
      }
      const e = { id };
      for (const f of ["id", ...ENTRY_FIELDS, ...Object.keys(l), ...Object.keys(r)]) {
        if (f === "id" || f in e) continue;
        pick(["entries", id, f], entryName(l) + " · " + (FIELD_LABEL[f] || f), b[f], l[f], r[f], (v) => { if (v !== undefined) e[f] = v; });
      }
      result.set(id, e);
    }
    /* 顺序：本机改了顺序则以本机为准，否则跟随云端；再补上另一边新增的 */
    const order = (list) => list.map((e) => e.id);
    const localReordered = !same(order(base.entries).filter((id) => lm.has(id)), order(local.entries).filter((id) => bm.has(id)));
    const primary = localReordered ? order(local.entries) : order(remote.entries);
    const secondary = localReordered ? order(remote.entries) : order(local.entries);
    const seq = [];
    for (const id of [...primary, ...secondary, ...order(base.entries)]) if (result.has(id) && !seq.includes(id)) seq.push(id);
    merged.entries = seq.map((id) => result.get(id));
    return { merged: content(merged), conflicts };
  }

  /* 按用户选择解决冲突：choice[i] = "local" | "remote" */
  function resolve(mergedIn, conflicts, choices) {
    const m = clone(mergedIn);
    conflicts.forEach((c, i) => {
      if (choices[i] !== "remote") return;
      if (c.path.length === 1) { m[c.path[0]] = clone(c.remote); return; }
      const [, id, field] = c.path;
      const idx = m.entries.findIndex((e) => e.id === id);
      if (field === "__exists") {
        if (!c.remote && idx >= 0) m.entries.splice(idx, 1);
        if (c.remote && idx < 0) m.entries.push(clone(c.entry));
        return;
      }
      if (idx >= 0) {
        if (c.remote === undefined) delete m.entries[idx][field];
        else m.entries[idx][field] = clone(c.remote);
      }
    });
    return content(m);
  }

  /* ---------- 密码 ---------- */
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function derive(password, saltB64, iterations) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations }, key, 256);
    return b64(new Uint8Array(bits));
  }
  async function makeLock(password) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const iterations = 210000;
    return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt, hash: await derive(password, salt, iterations), setAt: new Date().toISOString() };
  }
  async function checkLock(lock, password) {
    if (!lock || !lock.salt || !lock.hash || !(lock.iterations >= 100000)) return false;
    const h = await derive(password, lock.salt, lock.iterations);
    if (h.length !== lock.hash.length) return false;
    let d = 0;
    for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ lock.hash.charCodeAt(i);
    return d === 0;
  }

  return {
    CATALOG, NAMES, CRYPTO, PER100_DEFAULT, FIELD_LABEL, clone, same, uid, num,
    emptyConfig, liveEntry, normalizeConfig, normalizeEntry, content,
    cnyPerUnit, entryCny, targetStatus, snapshotNear, seriesFor,
    fmtAmount, fmtRate, parseAmount, fmtAgo, freshness, ladderFor, fmtCny, fmtInt, priceRatio,
    diff, merge3, resolve, makeLock, checkLock, entryName,
  };
})();
if (typeof module !== "undefined") module.exports = FX;
