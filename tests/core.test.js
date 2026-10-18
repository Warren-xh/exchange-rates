const test = require("node:test");
const assert = require("node:assert/strict");
const FX = require("../src/core.js");

const base = FX.normalizeConfig({
  title: "汇率台",
  entries: [
    { id: "a", kind: "live", code: "EUR", label: "欧元", note: "" },
    { id: "b", kind: "live", code: "USD", label: "美元", note: "" },
    { id: "c", kind: "custom", code: "GBP", label: "银行卖出", mode: "spread", spread: 0.5 },
  ],
});

test("rate math: per unit and custom spread/fixed", () => {
  const rates = { EUR: 0.1330055, USD: 0.1494589, GBP: 0.1121363 };
  assert.ok(Math.abs(FX.cnyPerUnit(rates, "EUR") - 7.51848) < 1e-4);
  const spread = FX.entryCny(base.entries[2], rates);
  assert.ok(Math.abs(spread - (1 / 0.1121363) * 1.005) < 1e-9);
  assert.equal(FX.entryCny({ kind: "custom", mode: "fixed", fixed: 7.62, code: "EUR" }, rates), 7.62);
  assert.equal(FX.cnyPerUnit(rates, "XXX"), null);
  assert.equal(FX.cnyPerUnit(rates, "CNY"), 1);
});

test("target status", () => {
  const e = { target: 7.5, targetDir: "below" };
  assert.equal(FX.targetStatus(e, 7.4).state, "hit");
  assert.equal(FX.targetStatus(e, 7.55).state, "near");
  assert.equal(FX.targetStatus(e, 8).state, "watch");
  assert.equal(FX.targetStatus({ target: null }, 8), null);
});

test("formatting and parsing", () => {
  assert.equal(FX.fmtAmount(1234.5678, "USD"), "1,234.57");
  assert.equal(FX.fmtAmount(23615.78, "JPY"), "23,616");
  assert.equal(FX.fmtAmount(0.0018408, "BTC"), "0.001841");
  assert.equal(FX.fmtRate(7.518482), "7.5185");
  assert.equal(FX.fmtRate(0.0423444), "0.0423");
  assert.equal(FX.fmtRate(0.000005), "0.00000500");
  assert.equal(FX.parseAmount("1,000.5"), 1000.5);
  assert.equal(FX.parseAmount("1 000"), 1000);
  assert.equal(FX.parseAmount(""), null);
  assert.ok(Number.isNaN(FX.parseAmount("abc")));
});

test("diff lists adds, removes, edits, order", () => {
  const after = FX.clone(base);
  after.entries[0].note = "去巴黎用";
  after.entries.splice(1, 1);
  after.entries.push(FX.normalizeEntry({ id: "d", code: "JPY" }));
  after.title = "我的汇率";
  const d = FX.diff(base, after).map((x) => x.text);
  assert.ok(d.some((t) => t.includes("网站标题")));
  assert.ok(d.some((t) => t.includes("新增 日元")));
  assert.ok(d.some((t) => t.includes("删除 美元")));
  assert.ok(d.some((t) => t.includes("备注")));
  assert.deepEqual(FX.diff(base, FX.clone(base)), []);
});

test("merge: independent edits combine without conflict", () => {
  const local = FX.clone(base);
  local.entries[0].note = "本机备注";
  local.entries.push(FX.normalizeEntry({ id: "L", code: "HKD" }));
  const remote = FX.clone(base);
  remote.entries[1].label = "美金";
  remote.title = "云端标题";
  remote.entries.push(FX.normalizeEntry({ id: "R", code: "JPY" }));
  const { merged, conflicts } = FX.merge3(base, local, remote);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.title, "云端标题");
  assert.equal(merged.entries.find((e) => e.id === "a").note, "本机备注");
  assert.equal(merged.entries.find((e) => e.id === "b").label, "美金");
  assert.deepEqual(merged.entries.map((e) => e.id).sort(), ["L", "R", "a", "b", "c"]);
});

test("merge: same field conflict, resolve both ways", () => {
  const local = FX.clone(base); local.entries[0].label = "本机";
  const remote = FX.clone(base); remote.entries[0].label = "云端";
  const { merged, conflicts } = FX.merge3(base, local, remote);
  assert.equal(conflicts.length, 1);
  assert.equal(FX.resolve(merged, conflicts, ["local"]).entries[0].label, "本机");
  assert.equal(FX.resolve(merged, conflicts, ["remote"]).entries[0].label, "云端");
});

test("merge: delete vs untouched deletes; delete vs edit conflicts", () => {
  const local = FX.clone(base); local.entries.splice(1, 1);
  const r1 = FX.merge3(base, local, FX.clone(base));
  assert.equal(r1.conflicts.length, 0);
  assert.ok(!r1.merged.entries.some((e) => e.id === "b"));
  const remote = FX.clone(base); remote.entries[1].note = "云端改了";
  const r2 = FX.merge3(base, local, remote);
  assert.equal(r2.conflicts.length, 1);
  assert.ok(!FX.resolve(r2.merged, r2.conflicts, ["local"]).entries.some((e) => e.id === "b"));
  assert.ok(FX.resolve(r2.merged, r2.conflicts, ["remote"]).entries.some((e) => e.id === "b"));
});

test("merge: local reorder wins, remote additions kept", () => {
  const local = FX.clone(base); local.entries.reverse();
  const remote = FX.clone(base); remote.entries.push(FX.normalizeEntry({ id: "R", code: "JPY" }));
  const { merged } = FX.merge3(base, local, remote);
  assert.deepEqual(merged.entries.map((e) => e.id), ["c", "b", "a", "R"]);
});

test("history helpers", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const hist = [
    { t: "2026-10-17T12:10:00Z", rates: { EUR: 0.13 } },
    { t: "2026-10-18T11:00:00Z", rates: { EUR: 0.133 } },
    { t: "2026-10-10T11:00:00Z", rates: { EUR: 0.12 } },
  ];
  assert.equal(FX.snapshotNear(hist, now, 24).t, "2026-10-17T12:10:00Z");
  assert.equal(FX.seriesFor(hist, "EUR", now).length, 2);
  assert.equal(FX.freshness("2026-10-18T11:30:00Z", now), "fresh");
  assert.equal(FX.freshness("2026-10-18T06:00:00Z", now), "stale");
});

test("password lock round trip", async () => {
  const lock = await FX.makeLock("correct horse");
  assert.equal(await FX.checkLock(lock, "correct horse"), true);
  assert.equal(await FX.checkLock(lock, "wrong"), false);
});

test("normalize rejects junk and fixes duplicate ids", () => {
  const c = FX.normalizeConfig({ entries: [{ id: "x", code: "usd" }, { id: "x", code: "eur" }, { code: "" }, null], defaultAmount: -5 });
  assert.equal(c.entries.length, 2);
  assert.notEqual(c.entries[0].id, c.entries[1].id);
  assert.equal(c.entries[0].code, "USD");
  assert.equal(c.defaultAmount, 1000);
});
