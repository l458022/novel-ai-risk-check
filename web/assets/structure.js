/* =========================================================================
   结构与「水文」检测（Structure / Padding Analysis）
   ---------------------------------------------------------------------
   对标：
     · 番茄小说公告违规词「空洞水文」「结构失常」
     · 起点侧一线反馈「大量无用的环境描写，细节堆砌」「废话变多」

   方法：用**词表密度**近似「情节推进」与「环境描写」的配比。
     推进词（动作 / 转折）密度低 + 环境词密度高 → 疑似注水。
   ⚠️ 词表法是粗粒度近似，题材差异大（抒情向 vs 强剧情向），
      结论只作提示，不单独定性。
   ========================================================================= */

const NovelStructure = (() => {

  const hanChars = t => {
    const out = [];
    for (const ch of String(t)) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
    return out;
  };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const std = a => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
  };

  /* 情节推进词：动作 + 转折（双字以上，避免单字误匹配） */
  const ACTION = [
    '转身', '点头', '摇头', '皱眉', '抬头', '低头', '伸手', '开口', '回头', '迈步',
    '起身', '坐下', '站起', '推开', '拉起', '抓住', '放下', '拿起', '走出', '走进',
    '看向', '望向', '盯着', '瞪着', '抓住', '握紧', '松开', '拔出', '收起', '递给'
  ];
  const ADVANCE = [
    '突然', '忽然', '于是', '接着', '随即', '立刻', '马上', '瞬间', '刹那', '猛然',
    '骤然', '陡然', '就在这时', '不料', '没想到', '岂料', '紧接', '下一刻', '话音刚落',
    '正在这时', '就在这时', '转眼间'
  ];
  /* 环境 / 心理描写词（注水的常见载体） */
  const SCENERY = [
    '阳光', '月光', '星光', '天空', '空气', '夜色', '黄昏', '清晨', '微风', '清风',
    '山风', '云雾', '云层', '远方', '远处', '天边', '树林', '树叶', '花瓣', '湖面',
    '波光', '光影', '气息', '味道', '温度', '寂静', '宁静', '朦胧', '静谧', '柔和'
  ];
  const EMOTION = [
    '心中', '心里', '内心', '心情', '情绪', '感慨', '惆怅', '思绪', '回忆', '思绪万千',
    '百感交集', '心潮', '涌起', '涌上', '难以言喻', '说不清', '五味杂陈'
  ];

  function countWords(s, list) {
    let n = 0;
    const hits = [];
    for (const w of list) {
      const c = s.split(w).length - 1;
      if (c > 0) { n += c; hits.push({ w, c }); }
    }
    hits.sort((a, b) => b.c - a.c);
    return { n, hits };
  }

  function analyze(text) {
    const s = String(text).replace(/\r\n?/g, '\n');
    const hanCount = hanChars(s).length || 1;
    const paras = s.split(/\n+/).map(p => p.trim()).filter(p => hanChars(p).length > 0);
    const signals = [];

    /* --- 1. 段落形态 --- */
    const lens = paras.map(p => hanChars(p).length);
    const paraCv = lens.length >= 3 ? std(lens) / (mean(lens) || 1) : 0;
    const oneSentence = paras.filter(p => {
      const sent = p.split(/[。！？…；]+/).filter(x => hanChars(x).length > 0);
      return sent.length <= 1;
    }).length;
    const oneRatio = paras.length ? oneSentence / paras.length : 0;

    // AI 段落长度高度均匀；真人因对话/描写切换起伏大
    let paraAi = 0;
    if (paras.length >= 5) {
      if (paraCv < 0.40) paraAi = 80;
      else if (paraCv < 0.55) paraAi = 50;
      else if (paraCv < 0.70) paraAi = 25;
    }
    signals.push({
      key: 'para_shape', label: '段落长度分布', weight: 0.30,
      aiScore: paraAi,
      value: `${paras.length} 段 · 段长 CV ${paraCv.toFixed(3)} · 平均 ${mean(lens).toFixed(0)} 字`,
      evidence: [
        `最长段 = ${Math.max(...lens)} 字，最短段 = ${Math.min(...lens)} 字`,
        `单句成段比例 = ${(oneRatio * 100).toFixed(1)}%（${oneSentence}/${paras.length}）`,
        `段落长度标准差 = ${std(lens).toFixed(1)}`
      ],
      note: 'AI 生成的段落长度高度均匀；真人会因对话/描写切换剧烈起伏，且网文常用「单句成段」制造节奏。⚠️ 古典文本常「每句一行」，本项对这类排版会失真。'
    });

    /* --- 2. 情节推进 vs 环境描写 --- */
    const act = countWords(s, ACTION);
    const adv = countWords(s, ADVANCE);
    const sce = countWords(s, SCENERY);
    const emo = countWords(s, EMOTION);
    const advanceDensity = (act.n + adv.n) / hanCount * 1000;   // 每千字
    const sceneryDensity = (sce.n + emo.n) / hanCount * 1000;

    // 描写多、推进少 → 注水嫌疑
    let waterAi = 0;
    if (hanCount >= 300) {
      const ratio = sceneryDensity / (advanceDensity + 0.1);
      if (advanceDensity < 4 && sceneryDensity > 8) waterAi = 75;
      else if (ratio > 2.0 && sceneryDensity > 6) waterAi = 60;
      else if (ratio > 1.2) waterAi = 35;
      else waterAi = 0;
    }
    signals.push({
      key: 'padding', label: '情节推进 / 描写配比', weight: 0.40,
      aiScore: waterAi,
      value: `推进词 ${advanceDensity.toFixed(1)}‰ · 描写词 ${sceneryDensity.toFixed(1)}‰`,
      evidence: [
        `动作词 ${act.n} 处（${act.hits.slice(0, 4).map(h => h.w).join('、') || '无'}）`,
        `转折词 ${adv.n} 处（${adv.hits.slice(0, 4).map(h => h.w).join('、') || '无'}）`,
        `景物词 ${sce.n} 处（${sce.hits.slice(0, 4).map(h => h.w).join('、') || '无'}）`,
        `心理词 ${emo.n} 处（${emo.hits.slice(0, 4).map(h => h.w).join('、') || '无'}）`
      ],
      note: '对应番茄公告的「空洞水文」与一线反馈的「大量无用环境描写、细节堆砌」。⚠️ 抒情向、氛围向作品天然描写多，**不是** AI 特征；本项只提示"推进偏少"，请结合题材判断。'
    });

    /* --- 3. 章末钩子 --- */
    let hookAi = 0, hookNote = '本章结尾信息不足，无法判断';
    if (paras.length >= 2) {
      const last = paras[paras.length - 1];
      const lastLen = hanChars(last).length;
      const hasQ = /[？?]/.test(last);
      const hasEllipsis = /(……|\.{3,}|…)/.test(last);
      const hasSuspense = /(突然|竟然|没想到|不料|岂料|就在这时|是谁|为什么|难道)/.test(last);
      const strong = [hasQ, hasEllipsis, hasSuspense].filter(Boolean).length;
      hookAi = strong >= 2 ? 0 : strong === 1 ? 20 : 45;
      hookNote = strong === 0
        ? '结尾既无疑问、无省略号、也无悬念词，收得比较平。'
        : `结尾含 ${strong} 项悬念特征（${[hasQ && '疑问句', hasEllipsis && '省略号', hasSuspense && '悬念词'].filter(Boolean).join('、')}）。`;
    }
    signals.push({
      key: 'hook', label: '章末钩子', weight: 0.30,
      aiScore: hookAi,
      value: hookNote,
      evidence: paras.length ? [`末段：${paras[paras.length - 1].slice(0, 50)}…`] : ['无段落'],
      note: '网文章节结尾通常留有钩子（悬念、疑问、转折）。⚠️ 这是**很弱**的信号——平稳收尾在文学上完全可以是有意为之，切勿据此改稿。'
    });

    const totalWeight = signals.reduce((a, b) => a + b.weight, 0) || 1;
    const score = Math.round(signals.reduce((a, b) => a + b.aiScore * b.weight, 0) / totalWeight);

    return {
      signals, score,
      level: score >= 55 ? 'high' : score >= 30 ? 'mid' : 'low',
      paraCount: paras.length, paraCv,
      advanceDensity, sceneryDensity, hanCount
    };
  }

  return { analyze };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelStructure;
