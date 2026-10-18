/* GitHub Pages 版：密码保管库 + 仓库读写。
   GitHub 令牌在浏览器里用管理密码加密（PBKDF2 60 万次 → AES-256-GCM），
   仓库里只保存加密结果 data/vault.json。和科研日志同一套方案。 */
const GH = (() => {
  const ITERATIONS = 600000;
  const TOKEN_PATTERN = /^github_pat_[A-Za-z0-9_]{20,}$/;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (t) => Uint8Array.from(atob(t.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const aad = (repo) => enc.encode("exchange-rates/vault/v1/" + repo.toLowerCase());
  const utf8ToB64 = (text) => toB64(enc.encode(text));
  const b64ToUtf8 = (b64) => dec.decode(fromB64(b64));

  const validToken = (t) => typeof t === "string" && TOKEN_PATTERN.test(t.trim());
  function passwordProblem(pw) {
    if (typeof pw !== "string" || pw.length < 8) return "密码至少需要 8 位。";
    if (pw.length > 200) return "密码太长了。";
    if (/^\d+$/.test(pw)) return "不要只用数字，加几个字母吧。";
    if (new Set(pw).size < 5) return "密码里重复的字符太多了。";
    if (["password", "12345678", "qwertyui", "iloveyou", "abcdefgh"].some((w) => pw.toLowerCase().includes(w))) return "这个密码太常见了，换一个吧。";
    return "";
  }
  async function deriveKey(pw, salt, iterations, usage) {
    const material = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  async function seal(token, pw, repo) {
    const problem = passwordProblem(pw);
    if (problem) throw Error(problem);
    if (!validToken(token)) throw Error("令牌格式不对：请使用 github_pat_ 开头的细粒度令牌。");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pw, salt, ITERATIONS, "encrypt");
    const plain = enc.encode(JSON.stringify({ token: token.trim(), repo }));
    try {
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(repo), tagLength: 128 }, key, plain);
      return { version: 1, repo, algorithm: "AES-256-GCM", kdf: "PBKDF2-SHA256", iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(new Uint8Array(ct)), updatedAt: new Date().toISOString() };
    } finally { plain.fill(0); }
  }
  const validVault = (v) => !!v && v.version === 1 && v.algorithm === "AES-256-GCM" && v.kdf === "PBKDF2-SHA256" && Number.isInteger(v.iterations) && v.iterations >= ITERATIONS && v.iterations <= 3000000 && typeof v.salt === "string" && typeof v.iv === "string" && typeof v.ciphertext === "string" && v.ciphertext.length < 10000;
  async function open(vault, pw, repo) {
    if (!validVault(vault)) throw Error("授权文件已损坏，请重新设置。");
    let bytes;
    try {
      const key = await deriveKey(pw, fromB64(vault.salt), vault.iterations, "decrypt");
      bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(vault.iv), additionalData: aad(repo), tagLength: 128 }, key, fromB64(vault.ciphertext)));
      const payload = JSON.parse(dec.decode(bytes));
      if (!validToken(payload.token)) throw Error();
      return payload.token;
    } catch { throw Error("密码不正确。"); }
    finally { bytes && bytes.fill(0); }
  }

  const MESSAGES = {
    401: "GitHub 令牌已失效或被撤销，请在网站设置里更换令牌。",
    403: "GitHub 拒绝了请求：请确认令牌对这个仓库有 Contents 读写权限，或稍后再试。",
    404: "找不到仓库或文件，请确认令牌授权了这个仓库。",
    409: "另一台设备刚保存过，需要重新合并。",
    422: "GitHub 没有接受这次保存，可能另一台设备刚保存过。",
  };
  class Err extends Error { constructor(m, status) { super(m); this.status = status; } }

  class Client {
    #token = "";
    constructor(repo, branch = "main", fetcher = globalThis.fetch, apiBase = "https://api.github.com") {
      this.repo = repo; this.branch = branch; this.apiBase = apiBase; this.fetch = fetcher.bind(globalThis);
    }
    get unlocked() { return !!this.#token; }
    setToken(t) { this.#token = t || ""; }
    async api(path, { method = "GET", body, auth = true } = {}) {
      const headers = { Accept: "application/vnd.github+json" };
      if (auth && this.#token) { headers.Authorization = "Bearer " + this.#token; headers["X-GitHub-Api-Version"] = "2022-11-28"; }
      if (body) headers["Content-Type"] = "application/json";
      let res;
      try {
        res = await this.fetch(this.apiBase + path, { method, headers, cache: "no-store", signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch (e) {
        throw new Err(e && e.name === "TimeoutError" ? "连接 GitHub 超时，草稿仍保存在本机。" : "无法连接 GitHub，草稿仍保存在本机。", 0);
      }
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Err(MESSAGES[res.status] || "GitHub 请求失败（" + res.status + "）。", res.status);
      return data;
    }
    contentsPath(path) { return "/repos/" + this.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/"); }
    async checkAccess() {
      const info = await this.api("/repos/" + this.repo);
      if (!info || !info.permissions || !info.permissions.push) throw new Err("这个令牌没有写入权限，请确认 Contents 选了 Read and write。", 403);
      return info;
    }
    /* 返回 { data, sha }；文件不存在返回 null */
    async readJSON(path, { auth = true } = {}) {
      try {
        const f = await this.api(this.contentsPath(path) + "?ref=" + encodeURIComponent(this.branch), { auth });
        if (!f || Array.isArray(f) || f.type !== "file") return null;
        return { data: JSON.parse(b64ToUtf8(f.content || "")), sha: f.sha };
      } catch (e) { if (e.status === 404) return null; throw e; }
    }
    /* 带 sha 写入：别的设备先保存了会得到 409/422 */
    async writeJSON(path, data, sha, message) {
      const res = await this.api(this.contentsPath(path), {
        method: "PUT",
        body: { message, branch: this.branch, content: utf8ToB64(JSON.stringify(data, null, 2) + "\n"), ...(sha ? { sha } : {}) },
      });
      return { sha: res.content.sha, commit: res.commit.sha };
    }
  }
  return { Client, Err, seal, open, validToken, validVault, passwordProblem };
})();
if (typeof module !== "undefined") module.exports = GH;
