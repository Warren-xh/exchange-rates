import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const r = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@600;700&display=swap">';
const body = (repo) => [
  r("./src/body.html"),
  repo ? `<script>window.FX_REPO = ${JSON.stringify(repo)};</script>` : "",
  "<script>\n" + r("./src/core.js") + "\n</script>",
  "<script>\n" + r("./src/github.js") + "\n</script>",
  "<script>\n" + r("./src/app.js") + "\n</script>",
].join("\n");
const head = ["<title>人民币汇率台</title>", '<meta name="claude:viewport-fit-sides" content="cover">', fonts, "<style>\n" + r("./src/style.css") + "</style>"].join("\n");
mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
/* claude.ai 网页版：发布时外层会补上文档骨架 */
writeFileSync(new URL("./dist/fxdesk.html", import.meta.url), head + "\n" + body(""));
/* GitHub Pages 版：完整文档，汇率每分钟直接从接口拉取，修改提交到仓库 */
const repo = process.env.FX_REPO || "Warren-xh/exchange-rates";
const full = (b) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="以人民币为基准的实时汇率换算，可自定义货币、银行报价和目标价。">
<meta name="theme-color" content="#f1f4f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0d1620" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='6' y='6' width='52' height='52' rx='8' fill='none' stroke='%23b5312a' stroke-width='5'/%3E%3Ctext x='32' y='45' font-size='34' text-anchor='middle' fill='%23b5312a' font-family='serif' font-weight='700'%3E%C2%A5%3C/text%3E%3C/svg%3E">
${head}
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${b}
</body>
</html>
`;
writeFileSync(new URL("./dist/index.html", import.meta.url), full(body(repo)));
writeFileSync(new URL("./index.html", import.meta.url), full(body(repo)));
console.log("built for", repo);
