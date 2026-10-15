/* =========================================================================
   叙事一致性检测（Narrative Consistency）
   ---------------------------------------------------------------------
   对标：
     · 番茄小说公告违规词「前后文脱节」「情节错乱」
     · 一线反馈「前后文脱节、情节错乱」「记错人名」

   三项检查：
     1. 视角一致性（第一/第三人称混用、段落级漂移）
     2. 时间线（时间词出现顺序是否矛盾）
     3. 重复描写模板（跨段重复的四字短语）
   ⚠️ 三项都是**弱信号**，只提示"值得回看"，绝不定性。
   ========================================================================= */

const NovelConsistency = (() => {

  const hanChars = t => {
    const out = [];
    for (const ch of String(t)) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
    return out;
  };

  const P1 = ['我们', '咱们', '我'];
  const P3 = ['他们', '她们', '它们', '他', '她', '它'];

  /* 时间词：按「时间跨度」归一到小时数，用于检查顺序矛盾 */
  const TIME_WORDS = [
    { w: '片刻', h: 0.25 }, { w: '一会儿', h: 0.25 }, { w: '须臾', h: 0.1 },
    { w: '半晌', h: 0.5 }, { w: '半个时辰', h: 1 }, { w: '一个时辰', h: 2 },
    { w: '一炷香', h: 0.5 }, { w: '翌日', h: 24 }, { w: '次日', h: 24 },
    { w: '第二天', h: 24 }, { w: '隔天', h: 24 }, { w: '三天后', h: 72 },
    { w: '数日后', h: 96 }, { w: '半个月后', h: 360 }, { w: '一个月后', h: 720 },
    { w: '半年后', h: 4320 }, { w: '一年后', h: 8760 }, { w: '多年以后', h: 26280 }
  ];

  function countList(s, list) {
    let n = 0; const hits = [];
    for (const w of list) {
      const c = s.split(w).length - 1;
      if (c > 0) { n += c; hits.push({ w, c }); }
    }
    return { n, hits };
  }

  /* 去掉引号内内容（对话里的「我」不算叙述视角） */
  function stripQuotes(text) {
    let s = String(text);
    for (const [o, c] of [['「', '」'], ['『', '』'], ['“', '”'], ['"', '"']]) {
      let out = '', i = 0;
      while (i < s.length) {
        const a = s.indexOf(o, i);
        if (a < 0) { out += s.slice(i); break; }
        out += s.slice(i, a);
        const b = s.indexOf(c, a + 1);
        if (b < 0) { out += s.slice(a); break; }
        i = b + 1;
      }
      s = out;
    }
    return s;
  }

  function analyze(text) {
    const s = String(text).replace(/\r\n?/g, '\n');
    const hanCount = hanChars(s).length || 1;
    const narration = stripQuotes(s);       // 叙述部分（去对话）
    const signals = [];

    /* --- 1. 视角一致性 --- */
    const p1 = countList(narration, P1);
    const p3 = countList(narration, P3);
    const p1n = p1.n, p3n = p3.n;
    const total = p1n + p3n || 1;
    const p1Ratio = p1n / total;

    // 段落级视角漂移：把叙述按段统计，看是否出现「两种人称都占显著比例」的段落
    const paras = narration.split(/\n+/).map(p => p.trim()).filter(p => hanChars(p).length >= 15);
    let mixedParas = 0;
    for (const p of paras) {
      const a = countList(p, P1).n, b = countList(p, P3).n;
      if (a >= 2 && b >= 2) mixedParas++;
    }
    const mixedRatio = paras.length ? mixedParas / paras.length : 0;

    let povAi = 0;
    if (paras.length >= 4) {
      if (p1Ratio > 0.15 && p1Ratio < 0.85 && mixedRatio > 0.35) povAi = 70;
      else if (mixedRatio > 0.5) povAi = 55;
      else if (p1Ratio > 0.10 && p1Ratio < 0.90 && mixedRatio > 0.2) povAi = 30;
    }
    signals.push({
      key: 'pov', label: '叙述视角一致性', weight: 0.35,
      aiScore: povAi,
      value: `第一人称 ${(p1Ratio * 100).toFixed(0)}% / 第三人称 ${((1 - p1Ratio) * 100).toFixed(0)}%（已排除对话）`,
      evidence: [
        `叙述部分第一人称词 ${p1n} 次，第三人称词 ${p3n} 次`,
        `同一段内两种人称同时显著出现的段落 = ${mixedParas} / ${paras.length}（${(mixedRatio * 100).toFixed(0)}%）`
      ],
      note: '长篇创作中最常见的 AI 痕迹之一是**视角漂移**（同段内人称来回切换）。⚠️ 但「第一人称叙述 + 引用他人心理」等合法写法也会命中，本项只提示回看。'
    });

    /* --- 2. 时间线 --- */
    const found = [];
    let cursor = 0;
    while (cursor < s.length) {
      let best = null;
      for (const t of TIME_WORDS) {
        const idx = s.indexOf(t.w, cursor);
        if (idx >= 0 && (!best || idx < best.idx)) best = { idx, t };
      }
      if (!best) break;
      found.push({ pos: best.idx, ...best.t });
      cursor = best.idx + best.t.w.length;
    }
    // 检查是否出现「大步长 → 小步长」的倒退（如「三年后」之后又「片刻后」）
    let backJumps = 0;
    const seq = [];
    for (let i = 1; i < found.length; i++) {
      if (found[i].h < found[i - 1].h * 0.25 && found[i - 1].h >= 24) {
        backJumps++;
        if (seq.length < 3) seq.push(`${found[i - 1].w} → ${found[i].w}`);
      }
    }
    const timeAi = Math.min(100, backJumps * 30);
    signals.push({
      key: 'timeline', label: '时间线顺序', weight: 0.30,
      aiScore: timeAi,
      value: found.length ? `检出 ${found.length} 个时间词，疑似倒退 ${backJumps} 处` : '未检出明确时间词',
      evidence: found.length
        ? [
            `时间词序列：${found.slice(0, 10).map(f => f.w).join(' → ')}`,
            backJumps ? `疑似倒退：${seq.join('；')}` : '未发现明显倒退'
          ]
        : ['文中没有可识别的时间推进词'],
      note: '对应番茄公告的「情节错乱」。⚠️ 倒叙、插叙、回忆都是合法手法，时间倒退**绝大多数情况是正常的**，本项仅供参考。'
    });

    /* --- 3. 重复描写模板 --- */
    const pList = s.split(/\n+/).map(p => p.trim()).filter(p => hanChars(p).length > 0);
    const seen = new Map(), count = new Map();
    pList.forEach((p, pi) => {
      const ph = hanChars(p);
      for (let i = 0; i + 4 <= ph.length; i++) {
        const g = ph.slice(i, i + 4).join('');
        count.set(g, (count.get(g) || 0) + 1);
        if (!seen.has(g)) seen.set(g, new Set());
        seen.get(g).add(pi);
      }
    });
    const repeated = [...seen.entries()]
      .filter(([g, ps]) => ps.size >= 2)
      .map(([g, ps]) => ({ g, paras: ps.size, total: count.get(g) }))
      .sort((a, b) => b.paras - a.paras);
    const repeatRate = repeated.reduce((a, r) => a + r.total * 4, 0) / hanCount;
    const repAi = Math.min(100, Math.round(repeatRate / 0.08 * 100));

    signals.push({
      key: 'repeat', label: '重复描写模板', weight: 0.35,
      aiScore: repAi,
      value: `${repeated.length} 个四字短语跨段重复（占全文 ${(repeatRate * 100).toFixed(2)}%）`,
      evidence: repeated.length
        ? repeated.slice(0, 6).map(r => `「${r.g}」出现 ${r.total} 次，跨 ${r.paras} 段`)
        : ['未发现跨段重复的四字短语'],
      note: '对应一线反馈的「反复使用一些固定的描述方式」。⚠️ 网文本身套路化程度高（「嘴角勾起」类），真人重复率天然不低——**本项不参与主判定**，仅作提示。'
    });

    const totalWeight = signals.reduce((a, b) => a + b.weight, 0) || 1;
    const score = Math.round(signals.reduce((a, b) => a + b.aiScore * b.weight, 0) / totalWeight);

    return {
      signals, score,
      level: score >= 55 ? 'high' : score >= 30 ? 'mid' : 'low',
      p1Ratio, mixedRatio, backJumps, repeatRate, hanCount
    };
  }

  return { analyze, stripQuotes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelConsistency;
