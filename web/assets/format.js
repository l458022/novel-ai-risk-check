/* =========================================================================
   格式合规检测（Format Compliance）
   ---------------------------------------------------------------------
   对标：
     · 番茄小说公告违规词「格式混乱」「排版错乱」
     · 起点侧一线反馈「提示词残留」（如正文里混入「好的，以下是一篇…」）

   ⚠️ 本模块的判据**确定性最高**——不像统计特征需要标定，
      「正文里出现『作为 AI 我无法…』」是**可直接确认**的事实。
   ========================================================================= */

const NovelFormat = (() => {

  const hanChars = t => {
    const out = [];
    for (const ch of String(t)) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
    return out;
  };

  /* 提示词残留：分三档，只收**高置信度**的模板串，避免误伤正常行文 */
  const RESIDUE = [
    // 元话语（几乎只可能来自 AI 对话，不可能是小说正文）
    { p: '作为ai', s: 'high', t: '元话语' },
    { p: '作为一个ai', s: 'high', t: '元话语' },
    { p: '作为人工智能', s: 'high', t: '元话语' },
    { p: '我是一个ai', s: 'high', t: '元话语' },
    { p: '我是一个人工智能', s: 'high', t: '元话语' },
    { p: '我无法提供', s: 'high', t: '元话语' },
    { p: '我不能提供', s: 'high', t: '元话语' },
    { p: '我无法回答', s: 'high', t: '元话语' },
    { p: '很抱歉，我', s: 'high', t: '元话语' },
    // 助手腔开头
    { p: '好的，以下', s: 'high', t: '助手腔开头' },
    { p: '当然可以，以下', s: 'high', t: '助手腔开头' },
    { p: '以下是一篇', s: 'high', t: '助手腔开头' },
    { p: '以下是关于', s: 'high', t: '助手腔开头' },
    { p: '下面是这篇', s: 'high', t: '助手腔开头' },
    // 助手腔结尾
    { p: '希望对你有帮助', s: 'high', t: '助手腔结尾' },
    { p: '希望这个回答', s: 'high', t: '助手腔结尾' },
    { p: '以上就是', s: 'medium', t: '助手腔结尾' },
    { p: '需要我继续', s: 'high', t: '助手腔结尾' },
    { p: '需要我帮你', s: 'high', t: '助手腔结尾' },
    { p: '如果你需要', s: 'medium', t: '助手腔结尾' },
    // 说明性旁白
    { p: '需要注意的是', s: 'medium', t: '说明性旁白' },
    { p: '值得一提的是', s: 'medium', t: '说明性旁白' },
    { p: '总而言之', s: 'low', t: '说明性旁白' },
    { p: '综上所述', s: 'medium', t: '说明性旁白' }
  ];

  const W = { high: 3, medium: 2, low: 1 };

  /* Markdown 残留：小说正文里出现这些几乎一定是复制粘贴带入 */
  const MD_PATTERNS = [
    { re: /\*\*[^*\n]{1,40}\*\*/g, name: '加粗 ** **' },
    { re: /^#{1,6}\s+\S/gm, name: '标题 ## ' },
    { re: /^\s*[-*+]\s+\S/gm, name: '列表 - ' },
    { re: /\[[^\]\n]{1,30}\]\([^)\n]{1,80}\)/g, name: '链接 [](  )' },
    { re: /^>\s+\S/gm, name: '引用 >' }
  ];

  /* 全半角混用：中文语境里出现英文标点 */
  function halfWidthMixing(text) {
    const s = String(text);
    const han = hanChars(s).length || 1;
    // 中文句子里夹英文标点（排除引号内的英文专名场景：只统计标点）
    const comma = (s.match(/,(?=[\u4e00-\u9fff])/g) || []).length;
    const period = (s.match(/\.(?=[\u4e00-\u9fff])/g) || []).length;
    const excl = (s.match(/!(?=[\u4e00-\u9fff])/g) || []).length;
    const ques = (s.match(/\?(?=[\u4e00-\u9fff])/g) || []).length;
    const semi = (s.match(/;(?=[\u4e00-\u9fff])/g) || []).length;
    const total = comma + period + excl + ques + semi;
    return { total, per1k: total / han * 1000, comma, period, excl, ques, semi };
  }

  /* 引号混用：同时出现中文引号与英文引号 */
  function quoteMixing(text) {
    const s = String(text);
    const cnDouble = (s.match(/[“”]/g) || []).length;
    const cnCorner = (s.match(/[「」『』]/g) || []).length;
    const enDouble = (s.match(/"/g) || []).length;
    const enSingle = (s.match(/'/g) || []).length;
    const kinds = [cnDouble > 0, cnCorner > 0, enDouble > 0, enSingle > 0].filter(Boolean).length;
    return { cnDouble, cnCorner, enDouble, enSingle, kinds };
  }

  /* 空行异常：连续 3 个以上空行 / 行首大量空格（粘贴自网页的常见痕迹） */
  function blankAnomaly(text) {
    const s = String(text).replace(/\r\n?/g, '\n');
    const multiBlank = (s.match(/\n{3,}/g) || []).length;
    const nbspLike = (s.match(/[\u00a0\u3000]{2,}/g) || []).length;
    const tabIndent = (s.match(/\n\t+/g) || []).length;
    return { multiBlank, nbspLike, tabIndent };
  }

  /* ---------------- 主分析 ---------------- */
  function analyze(text) {
    const s = String(text);
    const hanCount = hanChars(s).length;
    const signals = [];

    /* --- 1. 提示词残留 --- */
    const low = s.toLowerCase();
    const hits = [];
    let weighted = 0;
    for (const r of RESIDUE) {
      const c = low.split(r.p).length - 1;
      if (c > 0) {
        hits.push({ phrase: r.p, count: c, type: r.t, severity: r.s });
        weighted += c * (W[r.s] || 1);
      }
    }
    const residueScore = Math.round(Math.min(100, weighted * 22));
    signals.push({
      key: 'residue', label: '提示词残留', weight: 0.34,
      aiScore: residueScore,
      value: hits.length ? `命中 ${hits.length} 类（加权 ${weighted} 点）` : '未命中',
      evidence: hits.length
        ? hits.sort((a, b) => b.count - a.count).slice(0, 8).map(h => `${h.type}：「${h.phrase}」× ${h.count}`)
        : ['未发现助手腔 / 元话语残留'],
      note: '正文里出现「作为 AI 我无法…」「好的，以下是一篇…」这类**元话语**，是 AI 直接生成的**确定性证据**（人类不会这样写小说）。⚠️ 本项为高置信度判据，一旦命中应优先处理。'
    });

    /* --- 2. Markdown 残留 --- */
    const mdHits = [];
    for (const m of MD_PATTERNS) {
      const found = s.match(new RegExp(m.re.source, m.re.flags));
      if (found && found.length) mdHits.push({ name: m.name, count: found.length, sample: found[0].slice(0, 30) });
    }
    const mdScore = Math.round(Math.min(100, mdHits.reduce((a, b) => a + b.count, 0) * 18));
    signals.push({
      key: 'markdown', label: 'Markdown 残留', weight: 0.20,
      aiScore: mdScore,
      value: mdHits.length ? `${mdHits.reduce((a, b) => a + b.count, 0)} 处` : '未发现',
      evidence: mdHits.length
        ? mdHits.map(h => `${h.name} × ${h.count}（如 ${h.sample}）`)
        : ['未发现 Markdown 语法残留'],
      note: '小说正文里出现 `**加粗**`、`## 标题`、`- 列表` 等，通常是**从 AI 对话窗口直接复制**带入的。'
    });

    /* --- 3. 全半角混用 --- */
    const hw = halfWidthMixing(s);
    const hwScore = Math.round(Math.min(100, hw.per1k / 3 * 100));
    signals.push({
      key: 'halfwidth', label: '全半角混用', weight: 0.16,
      aiScore: hwScore,
      value: `中文句中夹英文标点 ${hw.total} 处（${hw.per1k.toFixed(2)}‰）`,
      evidence: [
        `英文逗号 , = ${hw.comma}，句点 . = ${hw.period}`,
        `英文叹号 ! = ${hw.excl}，问号 ? = ${hw.ques}，分号 ; = ${hw.semi}`
      ],
      note: '中文语境里使用英文标点（如「他说,好的」），常见于**中英混排的 AI 输出**或跨平台复制。少量属正常（英文专名前后），密度高才可疑。'
    });

    /* --- 4. 引号混用 --- */
    const qm = quoteMixing(s);
    const qmScore = qm.kinds >= 3 ? 70 : qm.kinds === 2 && qm.enDouble > 0 ? 45 : 0;
    signals.push({
      key: 'quotemix', label: '引号混用', weight: 0.14,
      aiScore: qmScore,
      value: `共 ${qm.kinds} 种引号（中文双引号 ${qm.cnDouble} / 直角引号 ${qm.cnCorner} / 英文双引号 ${qm.enDouble}）`,
      evidence: [
        `中文双引号 “” = ${qm.cnDouble}`,
        `直角引号 「」『』 = ${qm.cnCorner}`,
        `英文双引号 " = ${qm.enDouble}，英文单引号 ' = ${qm.enSingle}`
      ],
      note: '同一篇里混用多套引号体系，通常意味着**多来源拼接**（人写一段、AI 生成一段、网页复制一段）。'
    });

    /* --- 5. 空行异常 --- */
    const ba = blankAnomaly(s);
    const baScore = Math.round(Math.min(100, (ba.multiBlank * 10 + ba.nbspLike * 25 + ba.tabIndent * 15)));
    signals.push({
      key: 'blank', label: '排版异常', weight: 0.16,
      aiScore: baScore,
      value: `连续空行 ${ba.multiBlank} 处 · 连续全角空格 ${ba.nbspLike} 处 · 制表符缩进 ${ba.tabIndent} 处`,
      evidence: [
        `连续 3 行以上空行 = ${ba.multiBlank}`,
        `连续全角空格（　　　）= ${ba.nbspLike}`,
        `行首制表符缩进 = ${ba.tabIndent}`
      ],
      note: '对应番茄公告的「排版错乱」。网页复制、多编辑器拼接、AI 直接输出都会留下这类痕迹。'
    });

    const totalWeight = signals.reduce((a, b) => a + b.weight, 0) || 1;
    const score = Math.round(signals.reduce((a, b) => a + b.aiScore * b.weight, 0) / totalWeight);

    return { signals, score, level: score >= 55 ? 'high' : score >= 30 ? 'mid' : 'low', hanCount };
  }

  return { analyze, RESIDUE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelFormat;
