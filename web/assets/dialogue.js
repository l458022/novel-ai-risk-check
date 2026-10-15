/* =========================================================================
   对话分析（Dialogue Analysis）
   ---------------------------------------------------------------------
   对标：起点侧一线反馈「完全由 AI 代写的小说，一点活人味儿都没有」，
         人物对话呆板、缺少个性化。

   设计依据：
     · 网文以对话驱动情节，真人作品的对话通常占相当比例，且长短交错；
     · AI 生成的对话常表现为：占比偏低、长度均匀、句式雷同。
   ⚠️ 对话占比的"正常范围"因题材差异极大（言情对话多、硬科幻对话少），
      故本模块**只报数据 + 给保守提示**，不单独定结论。
   ========================================================================= */

const NovelDialogue = (() => {

  const hanChars = t => {
    const out = [];
    for (const ch of String(t)) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
    return out;
  };

  // 中文对话引号配对（按优先级：直角引号 → 弯引号 → 英文直引号）
  const PAIRS = [
    ['「', '」'], ['『', '』'], ['“', '”'], ['"', '"']
  ];

  /* 提取所有引号内的对话文本（非贪婪，跨行也允许） */
  function extractQuotes(text) {
    const s = String(text).replace(/\r\n?/g, '\n');
    const found = [];
    for (const [open, close] of PAIRS) {
      let i = 0;
      while (i < s.length) {
        const a = s.indexOf(open, i);
        if (a < 0) break;
        const b = s.indexOf(close, a + 1);
        if (b < 0) break;
        found.push({ start: a, end: b, text: s.slice(a + 1, b) });
        i = b + 1;
      }
    }
    // 去重（不同引号体系可能嵌套误配，按位置排序后过滤重叠）
    found.sort((x, y) => x.start - y.start);
    const out = [];
    let lastEnd = -1;
    for (const q of found) {
      if (q.start >= lastEnd) { out.push(q); lastEnd = q.end; }
    }
    return out;
  }

  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
  }

  function analyze(text) {
    const s = String(text);
    const hanCount = hanChars(s).length || 1;
    const quotes = extractQuotes(s);
    const paras = s.split(/\n+/).filter(p => p.trim().length > 0);

    const signals = [];

    if (quotes.length === 0) {
      signals.push({
        key: 'dialogue', label: '对话', weight: 0.5,
        aiScore: hanCount >= 600 ? 55 : 25,
        value: '全篇无对话',
        evidence: ['未检测到任何引号对话'],
        note: '网文极少出现「整章零对话」。⚠️ 但若是纯景物/心理描写段落，属正常。请结合题材判断。'
      });
      return { signals, score: hanCount >= 600 ? 55 : 25, quoteCount: 0, hanCount };
    }

    const quoteChars = quotes.reduce((a, q) => a + hanChars(q.text).length, 0);
    const quoteRatio = quoteChars / hanCount;

    // 对话长度分布
    const lens = quotes.map(q => hanChars(q.text).length).filter(n => n > 0);
    const cv = lens.length >= 3 ? std(lens) / (mean(lens) || 1) : 0;

    // 含对话的段落占比
    const parasWithQuote = paras.filter(p => PAIRS.some(([o]) => p.includes(o))).length;
    const paraQuoteRatio = paras.length ? parasWithQuote / paras.length : 0;

    // 每千字对话轮次
    const turnsPer1k = quotes.length / hanCount * 1000;

    /* --- 信号 1：对话占比 --- */
    // 真人网文对话占比通常 15%–45%；过低可疑
    let ratioAi = 0;
    if (quoteRatio < 0.05) ratioAi = 90;
    else if (quoteRatio < 0.10) ratioAi = 65;
    else if (quoteRatio < 0.15) ratioAi = 35;
    else ratioAi = 0;
    signals.push({
      key: 'dialogue', label: '对话占比', weight: 0.45,
      aiScore: ratioAi,
      value: `对话 ${quoteChars} 字 / 全文 ${hanCount} 字 = ${(quoteRatio * 100).toFixed(1)}%`,
      evidence: [
        `对话段落占比 = ${(paraQuoteRatio * 100).toFixed(1)}%（${parasWithQuote}/${paras.length} 段）`,
        `对话轮次 = ${quotes.length}，每千字 ${turnsPer1k.toFixed(1)} 轮`,
        `平均每句对话 = ${mean(lens).toFixed(1)} 字`
      ],
      note: '网文以对话驱动情节，真人作品对话占比通常 15%–45%。占比过低提示「叙述过重、人物不说话」，可能缺乏"活人味"。⚠️ 题材差异大（硬科幻/悬疑对话天然少），仅作提示。'
    });

    /* --- 信号 2：对话长度均匀度 --- */
    // AI 对话长度高度一致；真人对话长短交错（"嗯。" vs 大段独白）
    let cvAi = 0;
    if (lens.length >= 5) {
      if (cv < 0.45) cvAi = 80;
      else if (cv < 0.60) cvAi = 50;
      else if (cv < 0.75) cvAi = 25;
      else cvAi = 0;
    }
    signals.push({
      key: 'dialogue_cv', label: '对话长度波动', weight: 0.35,
      aiScore: cvAi,
      value: `对话长度 CV = ${cv.toFixed(3)}（平均 ${mean(lens).toFixed(1)} 字，共 ${lens.length} 句）`,
      evidence: [
        `最长对话 = ${Math.max(...lens)} 字，最短 = ${Math.min(...lens)} 字`,
        `对话长度标准差 = ${std(lens).toFixed(2)}`
      ],
      note: '真人对话长短交错（一个字「嗯」到整段独白）；AI 对话长度容易趋于一致。⚠️ 对话少于 5 句时本项不可靠。'
    });

    const totalWeight = signals.reduce((a, b) => a + b.weight, 0) || 1;
    const score = Math.round(signals.reduce((a, b) => a + b.aiScore * b.weight, 0) / totalWeight);

    return {
      signals, score,
      level: score >= 55 ? 'high' : score >= 30 ? 'mid' : 'low',
      quoteCount: quotes.length,
      quoteRatio,
      dialogueChars: quoteChars,
      hanCount
    };
  }

  return { analyze, extractQuotes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelDialogue;
