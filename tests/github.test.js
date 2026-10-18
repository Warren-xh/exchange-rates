const test = require("node:test");
const assert = require("node:assert/strict");
const GH = require("../src/github.js");

const REPO = "Warren-xh/exchange-rates";
const TOKEN = "github_pat_" + "A".repeat(30);

test("vault: seal and open round trip; wrong password and other repo fail", async () => {
  const vault = await GH.seal(TOKEN, "汇率台-2026", REPO);
  assert.ok(GH.validVault(vault));
  assert.ok(!JSON.stringify(vault).includes(TOKEN));
  assert.equal(await GH.open(vault, "汇率台-2026", REPO), TOKEN);
  await assert.rejects(GH.open(vault, "wrong-password", REPO), /密码不正确/);
  await assert.rejects(GH.open(vault, "汇率台-2026", "Warren-xh/research-log"), /密码不正确/);
});

test("vault: rejects weak passwords and bad tokens", async () => {
  assert.match(GH.passwordProblem("1234567"), /8 位/);
  assert.match(GH.passwordProblem("12345678"), /数字/);
  assert.equal(GH.passwordProblem("rates-2026!"), "");
  await assert.rejects(GH.seal("ghp_classic", "rates-2026!", REPO), /令牌格式/);
});

test("client: write sends sha and base64 content; 409 surfaces status", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "PUT" && JSON.parse(init.body).sha === "old") return new Response(JSON.stringify({ message: "conflict" }), { status: 409 });
    return new Response(JSON.stringify({ content: { sha: "new" }, commit: { sha: "c1" } }), { status: 200 });
  };
  const c = new GH.Client(REPO, "main", fetcher);
  c.setToken(TOKEN);
  const res = await c.writeJSON("data/config.json", { title: "人民币汇率台" }, "abc", "msg");
  assert.equal(res.sha, "new");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.sha, "abc");
  assert.match(Buffer.from(body.content, "base64").toString("utf8"), /人民币汇率台/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + TOKEN);
  await assert.rejects(c.writeJSON("data/config.json", {}, "old", "msg"), (e) => e.status === 409);
});
