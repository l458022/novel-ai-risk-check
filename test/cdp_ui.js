/* =========================================================================
   CDP 真机测试：在真实 Chrome 里跑完整交互
   ---------------------------------------------------------------------
   ⚠️ 两个已踩过的坑（务必保留处理）：
     1. alert() 会**永久阻塞主线程** → 必须监听 Page.javascriptDialogOpening 自动关闭；
     2. 测试脚本必须**自带静态服务器**，否则 navigate 落到 chrome-error://，
        报错却是「元素为 null」这类误导信息。
   ========================================================================= */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

/* Chrome 路径：优先环境变量，其次常见安装位置；找不到就报错退出 */
function findChrome() {
  if (process.env.WB_CHROME) return process.env.WB_CHROME;
  const cands = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const hit = cands.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!hit) {
    console.error('❌ 未找到 Chrome。请设置环境变量 WB_CHROME 指向浏览器可执行文件。');
    process.exit(1);
  }
  return hit;
}

const CHROME = findChrome();
const CDP_PORT = 9333;
const HTTP_PORT = 8801;
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'novelai-'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n} ${e || ''}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 静态服务器 ---------------- */
function startServer() {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const p = path.join(ROOT, rel);
    fs.readFile(p, (e, d) => {
      if (e) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain; charset=utf-8' });
      res.end(d);
    });
  });
  return new Promise(r => srv.listen(HTTP_PORT, '127.0.0.1', () => r(srv)));
}

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function waitFor(fn, tries = 60, gap = 300) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) {}
    await sleep(gap);
  }
  return null;
}

/* ---------------- CDP 连接 ---------------- */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else listeners.forEach(h => h(m));
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', e => rej(new Error('WS 连接失败')));
  });
  return {
    ready,
    send(method, params) {
      return new Promise(res => {
        const i = ++id;
        pending.set(i, res);
        ws.send(JSON.stringify({ id: i, method, params: params || {} }));
      });
    },
    on(fn) { listeners.push(fn); },
    close() { try { ws.close(); } catch (e) {} }
  };
}

async function evalJS(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error('页面 JS 异常: ' + JSON.stringify(r.result.exceptionDetails.text || ''));
  return r.result && r.result.result ? r.result.result.value : undefined;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const srv = await startServer();
  console.log(`静态服务器 :${HTTP_PORT} 就绪`);

  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1280,1600',
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${TMP}`,
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp = null;
  try {
    const ver = await waitFor(async () => await getJSON('/json/version'), 50, 300);
    if (!ver) throw new Error('Chrome 未在 CDP 端口就绪');
    console.log('Chrome 已就绪:', ver.Browser);

    const list = await getJSON('/json/list');
    const page = list.find(t => t.type === 'page');
    if (!page) throw new Error('未找到 page target');

    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;

    /* 关键：alert() 会阻塞主线程 → 自动关闭所有对话框 */
    cdp.on(m => {
      if (m.method === 'Page.javascriptDialogOpening') {
        console.log('  [自动关闭弹窗]', m.params && m.params.message);
        cdp.send('Page.handleJavaScriptDialog', { accept: true });
      }
    });
    /* 收集控制台错误 */
    const consoleErrors = [];
    cdp.on(m => {
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push((m.params.args || []).map(a => a.value || a.description || '').join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push('EXCEPTION: ' + JSON.stringify(m.params.exceptionDetails.text));
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const URL = `http://127.0.0.1:${HTTP_PORT}/web/index.html`;
    await cdp.send('Page.navigate', { url: URL });
    await waitFor(async () => await evalJS(cdp, 'document.readyState === "complete" && !!window.NovelStylo'), 60, 300);

    console.log('\n=== 1. 页面加载 ===');
    ok('页面标题正确', (await evalJS(cdp, 'document.title')).includes('小说'));
    /* ⚠️ 模块用顶层 `const` 定义 → 不会成为 window 属性，
       必须用 typeof 判断（window.NovelStylo 恒为 undefined）。 */
    ok('五个模块已加载', await evalJS(cdp, 'typeof NovelStylo!=="undefined"&&typeof NovelFormat!=="undefined"&&typeof NovelDialogue!=="undefined"&&typeof NovelStructure!=="undefined"&&typeof NovelConsistency!=="undefined"'));

    /* ---------------- 用例 A：AI 文本 ---------------- */
    const aiText = fs.readFileSync(path.join(ROOT, 'test', 'corpus', 'ai', '_source.md'), 'utf8')
      .split(/^===SEG===$/m).slice(0, 3).join('\n');

    await evalJS(cdp, `(() => {
      const ta = document.getElementById('inputText');
      ta.value = ${JSON.stringify(aiText)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const disabled = await evalJS(cdp, 'document.getElementById("btnAnalyze").disabled');
    ok('AI 文本够长，按钮已启用', disabled === false);

    await evalJS(cdp, 'document.getElementById("btnAnalyze").click()');
    const got = await waitFor(async () => !(await evalJS(cdp, 'document.getElementById("report").classList.contains("hidden")')), 40, 250);
    ok('分析完成，报告已显示', got === true);

    const aiRes = await evalJS(cdp, `(() => ({
      score: +document.getElementById('scoreNum').textContent,
      label: document.getElementById('scoreLabel').textContent,
      cards: document.querySelectorAll('.sig-card').length,
      sugs: document.querySelectorAll('.sug').length,
      hots: document.querySelectorAll('.hot').length
    }))()`);
    console.log('   AI 文本结果:', JSON.stringify(aiRes));
    ok('AI 文本得分 > 30', aiRes.score > 30, `score=${aiRes.score}`);
    ok('信号卡片已渲染', aiRes.cards >= 8, `cards=${aiRes.cards}`);
    ok('修改建议已渲染', aiRes.sugs >= 1, `sugs=${aiRes.sugs}`);
    ok('热点段落已渲染', aiRes.hots >= 1, `hots=${aiRes.hots}`);

    /* 逐句改写建议：必须是「原文 → 改后」的具体对照，不能只有笼统建议 */
    const editRes = await evalJS(cdp, `(() => ({
      items: document.querySelectorAll('.edit-item').length,
      withNew: document.querySelectorAll('.edit-new').length,
      reasons: document.querySelectorAll('.edit-reasons li').length,
      sample: (document.querySelector('.edit-item') || {}).textContent
        ? document.querySelector('.edit-item').textContent.replace(/\\s+/g, ' ').trim().slice(0, 150) : ''
    }))()`);
    console.log('   逐句建议样例:', editRes.sample);
    ok('逐句改写建议已渲染', editRes.items >= 1, `items=${editRes.items}`);
    ok('含具体「改后」文本', editRes.withNew >= 1, `withNew=${editRes.withNew}`);
    ok('每条建议带原因', editRes.reasons >= 1, `reasons=${editRes.reasons}`);

    // 单独截「逐句改写建议」区，便于人工核对视觉效果
    await evalJS(cdp, 'document.getElementById("lineEdits").scrollIntoView({block:"start"})');
    await sleep(400);
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(ROOT, 'test', 'cdp_edits.png'), Buffer.from(r.result.data, 'base64')));
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(ROOT, 'test', 'cdp_ai.png'), Buffer.from(r.result.data, 'base64')));

    /* ---------------- 用例 B：真人文本 ---------------- */
    const humanText = fs.readFileSync(path.join(ROOT, 'test', 'corpus', 'human', 'hongloumeng_000.txt'), 'utf8').slice(0, 1600);
    await evalJS(cdp, `(() => {
      const ta = document.getElementById('inputText');
      ta.value = ${JSON.stringify(humanText)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btnAnalyze').click();
      return true;
    })()`);
    await sleep(600);
    const huRes = await evalJS(cdp, `(() => ({
      score: +document.getElementById('scoreNum').textContent,
      label: document.getElementById('scoreLabel').textContent
    }))()`);
    console.log('   真人文本结果:', JSON.stringify(huRes));
    ok('真人文本得分 < AI 文本得分', huRes.score < aiRes.score, `human=${huRes.score} ai=${aiRes.score}`);

    /* ---------------- 用例 C：提示词残留 ---------------- */
    const residueText = '好的，以下是一篇玄幻小说的开头。\n' + aiText + '\n作为AI，我无法继续创作暴力情节。希望对你有帮助。';
    await evalJS(cdp, `(() => {
      const ta = document.getElementById('inputText');
      ta.value = ${JSON.stringify(residueText)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btnAnalyze').click();
      return true;
    })()`);
    await sleep(600);
    const resRes = await evalJS(cdp, `(() => {
      const cards = [...document.querySelectorAll('.sig-card')];
      const c = cards.find(x => x.querySelector('.sig-name').textContent.includes('提示词残留'));
      return c ? +c.querySelector('.sig-score').textContent : -1;
    })()`);
    console.log('   提示词残留信号分:', resRes);
    ok('提示词残留被检出', resRes >= 60, `score=${resRes}`);
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then(r =>
      fs.writeFileSync(path.join(ROOT, 'test', 'cdp_residue.png'), Buffer.from(r.result.data, 'base64')));

    /* ---------------- 用例 D：平台规则页 ---------------- */
    await evalJS(cdp, 'document.querySelector(\'[data-view="rules"]\').click()');
    await sleep(200);
    const ruleHtml = await evalJS(cdp, 'document.getElementById("rulesBody").innerHTML.length');
    ok('平台规则页已渲染', ruleHtml > 1000, `len=${ruleHtml}`);
    ok('规则页含三个平台', await evalJS(cdp, `(() => {
      const t = document.getElementById('rulesBody').textContent;
      return t.includes('起点') && t.includes('番茄') && t.includes('晋江');
    })()`));

    console.log('\n=== 控制台错误 ===');
    if (consoleErrors.length) { console.log('  ' + consoleErrors.join('\n  ')); }
    ok('无控制台错误', consoleErrors.length === 0, `${consoleErrors.length} 条`);

  } catch (e) {
    console.error('测试异常:', e.message);
    fail++;
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill(); } catch (e) {}
    try { srv.close(); } catch (e) {}
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
