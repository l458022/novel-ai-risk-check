/* =========================================================================
   中文小说文体计量检测（Novel Stylometry）
   ---------------------------------------------------------------------
   本模块是「查重降AI项目 / stylometry.js」的**中文小说改写版**。

   ⚠️ 为什么不能直接复用英文版：
     · 英文版 FUNCTION_WORDS 是 the/of/and…，中文需「的/了/在/是…」
     · 英文版 words() 用英文字母正则切词，中文无空格
     · 英文版 countSyllables() 按音节，中文按字
     · 英文版 punct 统计 ; — ( )，中文小说要看 —— …… 、《》 『』
   → **复用架构与判据设计纪律，特征函数全部重写。**

   设计依据：
     1. GPTZero 原始统计层：burstiness（句长波动）。人类长短句交替，
        AI 节奏均匀 —— 该结论在中文上同样成立（句长按**字数**计）。
     2. 一线网文作者/编辑公开谈到的可观测痕迹（《中国新闻周刊》《新京报》）：
        「标点过于规范，频繁使用破折号、顿号甚至单引号」「反复使用固定描述」
        「大量无用环境描写」「剧情起伏小」。→ 转成 punct / repetition 特征。
     3. 中文无空格 → 用**字符 n-gram 多样性**替代词级 TTR
        （bigram 唯一率），无需词典即可反映"用词是否模板化"。

   ⚠️ 产出的是**可解释的启发式风险信号**，不是平台官方判定，也不能预测
      "能否过审"。阈值集中在 THRESHOLDS，**待语料标定**（见 test/calibrate.js）。
   ========================================================================= */

const NovelStylo = (() => {

  /* =====================================================================
     阈值配置（待标定）
     ---------------------------------------------------------------------
     初值来自「经验估计」，标注 PENDING 的项必须在语料到位后重标。
     标定方法：公版古典小说（真人基线） vs 自建 AI 样本，
     取「真人 10 分位」作为起算点，留 10% 安全余量。
     ===================================================================== */
  const THRESHOLDS = {
    /* 标定记录（2026-10-13）
       -----------------------------------------------------------------
       语料：真人 = 红楼梦 745 块（600 字/块，清代白话）
             AI   = 自建 AI 小说 11 段（现代）
       ⚠️ 时代偏差：真人基线是清代白话，与**当代网文**存在差距 →
          阈值偏保守，且 para / repetition 两项因语料格式差异未能有效标定。
       阈值取「真人 P10 附近作起算点」——宁可漏报，不可误报。
    */
    // 用字：实测 AI 的 **MSTTR 偏高**（0.582 vs 真人 0.525, d=0.98）→ 方向「高可疑」
    // 用 MSTTR（分段平均）而非原始 TTR，消除文本长度影响
    lexical: { ttrStart: 0.53, ttrSpan: 0.10, bigramStart: 0.86, bigramSpan: 0.06 },
    // 句长波动：真人 CV 0.548 / AI 0.392（d=1.38）；相邻差 12.2 / 9.0（d=0.83）
    burstiness: { cvStart: 0.56, cvSpan: 0.20, deltaStart: 11.0, deltaSpan: 5.0 },
    // 标点：真人熵 2.29 / AI 1.30（d=2.75）；种类 8 / 4（d=2.02）——**最强信号**
    punct: { typeStart: 7, typeSpan: 3, entropyStart: 1.90, entropySpan: 0.90 },
    // 段落：语料格式受限（古典文本每句一行），阈值未有效标定，仅作辅助
    para: { cvStart: 0.55, cvSpan: 0.35 },
    // 模板重复：实测方向与预期**相反**（真人 0.063 > AI 0.033）→ 不参与打分
    repetition: { repeatStart: 0.030, repeatSpan: 0.070 },
    cliche: { saturate: 9 }
  };

  /* =====================================================================
     基础工具
     ===================================================================== */

  // 汉字（含扩展区）—— 用于按"字"计数，排除标点与空白
  const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  function isHan(ch) { return HAN.test(ch); }

  function hanChars(text) {
    const out = [];
    for (const ch of String(text)) if (isHan(ch)) out.push(ch);
    return out;
  }

  // 句：按中文句末标点切分；换行也视为断句（小说常一句一段）
  function splitSentences(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .split(/(?<=[。！？…；!?])|\n+/)
      .map(s => s.trim())
      .filter(s => hanChars(s).length > 0);
  }

  // 段：按换行切分
  function splitParas(text) {
    return String(text)
      .replace(/\r\n?/g, '\n')
      .split(/\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
  function std(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // 香农熵（bit）：标点分布的"丰富度"
  function entropy(counts) {
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    let h = 0;
    for (const c of counts) {
      if (c > 0) { const p = c / total; h -= p * Math.log2(p); }
    }
    return h;
  }

  /* =====================================================================
     特征 1：用字丰富度
     ---------------------------------------------------------------------
     中文无空格，无法直接算词级 TTR → 改用两层：
       a) 字级 TTR = 字种 / 字次（长文本自然下降，故阈值需按长度看）
       b) bigram 唯一率 = 唯一相邻二字组合 / 总组合
          —— 这是"用词是否模板化"的代理指标，**无需词典**。
     ===================================================================== */
  function lexicalRichness(text) {
    const hc = hanChars(text);
    const n = hc.length;
    if (n < 80) return { usable: false, hanCount: n };

    const typeSet = new Set(hc);
    const ttr = typeSet.size / n;

    // bigram（滑动窗口，相邻二字）
    const bi = new Map();
    for (let i = 0; i < n - 1; i++) {
      const k = hc[i] + hc[i + 1];
      bi.set(k, (bi.get(k) || 0) + 1);
    }
    const biTotal = n - 1;
    const bigramUniqueRate = biTotal > 0 ? bi.size / biTotal : 0;

    // 高频字集中度：出现最多的 10 个字占全文比例
    const freq = new Map();
    for (const c of hc) freq.set(c, (freq.get(c) || 0) + 1);
    const top = [...freq.values()].sort((a, b) => b - a).slice(0, 10);
    const top10Share = top.reduce((a, b) => a + b, 0) / n;

    /* MSTTR（平均分段类符/形符比）—— **消除文本长度的影响**。
       普通 TTR 随文本变长必然下降，导致 600 字块与 2400 字章节不可比。
       实测：同一篇 AI 文本在 600 字块上 TTR = 0.456，在 2440 字上仅 0.289
       → 用固定 600 字标定的阈值在长文本上会**恒判 0 分**（实测踩到）。 */
    const SEG = 300;
    let msttr = null;
    if (n >= SEG * 2) {
      const segs = [];
      for (let i = 0; i + SEG <= n; i += SEG) {
        segs.push(new Set(hc.slice(i, i + SEG)).size / SEG);
      }
      msttr = segs.reduce((a, b) => a + b, 0) / segs.length;
    }

    return {
      usable: true, hanCount: n, uniqueTypes: typeSet.size,
      ttr, msttr, bigramUniqueRate, bigramTypes: bi.size, top10Share
    };
  }

  /* =====================================================================
     特征 2：句式波动（Burstiness，按字数）
     ---------------------------------------------------------------------
     人类：长短句交替（对话短、描写长）→ 句长 CV 大
     AI  ：节奏均匀 → CV 小
     ===================================================================== */
  function burstiness(text) {
    const sents = splitSentences(text);
    const lens = sents.map(s => hanChars(s).length).filter(n => n > 0);
    if (lens.length < 5) return { usable: false, sentenceCount: lens.length };

    const m = mean(lens);
    const sd = std(lens);
    const cv = m > 0 ? sd / m : 0;

    const deltas = [];
    for (let i = 1; i < lens.length; i++) deltas.push(Math.abs(lens[i] - lens[i - 1]));
    const meanDelta = mean(deltas);

    // 句长随位置的漂移（人类随情节推进自然变化）
    let drift = 0;
    if (lens.length >= 3) {
      const xs = lens.map((_, i) => i);
      const mx = mean(xs), my = mean(lens);
      let num = 0, den = 0;
      for (let i = 0; i < lens.length; i++) {
        num += (xs[i] - mx) * (lens[i] - my);
        den += (xs[i] - mx) ** 2;
      }
      drift = den === 0 ? 0 : num / den;
    }

    /* ⚠️ 韵文检测（标定发现的**主要误报源**）
       -----------------------------------------------------------------
       红楼梦的诗词曲赋（五言/七言）句长高度整齐 → burstiness / lexical
       双双满分，被误判为 AI。这是「**文体伪信号**」：
       韵律文本（诗、词、曲、赋、骈文）的统计特征天然接近 AI。
       判据：最常见的 2 个句长值占比 >= 45% 且 最常见句长 <= 9 字。
    */
    /* 按「，。；」切**小句**再统计——诗以「，」分句，若按整句切
       （"昨夜不期经雨活，今朝犹喜带霜开。"= 14 字）会漏判。 */
    const clauses = String(text)
      .split(/[，。！？；：、…\s]+/)
      .map(s => hanChars(s).length)
      .filter(n => n >= 2);
    let top2Share = 0, commonLen = 0, verseLikely = false;
    if (clauses.length >= 8) {
      const cf = {};
      for (const n of clauses) cf[n] = (cf[n] || 0) + 1;
      const cs = Object.values(cf).sort((a, b) => b - a);
      top2Share = ((cs[0] || 0) + (cs[1] || 0)) / clauses.length;
      commonLen = Number(Object.keys(cf).sort((a, b) => cf[b] - cf[a])[0]);
      verseLikely = top2Share >= 0.5 && commonLen <= 9;
    }

    return {
      usable: true, cv, mean: m, sd, meanDelta, drift,
      sentenceCount: lens.length, lens, verseLikely, top2Share, commonLen
    };
  }

  /* =====================================================================
     特征 3：标点形态
     ---------------------------------------------------------------------
     一线作者原话：「完全由 AI 代写的小说，标点使用过于规范，
     频繁使用破折号、顿号甚至单引号——很多网文作者几乎不会用到单引号。」
     → 统计：标点种类数、标点分布熵、单引号/破折号/顿号密度。
     ===================================================================== */
  const PUNCT_SET = '，。！？；：、“”‘’「」『』（）《》〈〉……—－～·、';

  function punctuationProfile(text) {
    const s = String(text);
    const hanN = hanChars(s).length || 1;

    const per = ch => {
      const c = s.split(ch).length - 1;
      return c / hanN * 1000;   // 每千字
    };

    const dash = (s.match(/——|—|--/g) || []).length;          // 破折号
    const ellipsis = (s.match(/……|\.{3,}|…/g) || []).length;  // 省略号
    const singleQuote = (s.match(/[‘’]/g) || []).length;       // 单引号
    const dunhao = per('、');                                   // 顿号
    const excl = per('！');
    const ques = per('？');
    const comma = per('，');

    // 标点种类与分布熵
    const counts = [];
    for (const ch of PUNCT_SET) {
      const c = s.split(ch).length - 1;
      if (c > 0) counts.push(c);
    }
    const typeCount = counts.length;
    const punctEntropy = entropy(counts);
    const punctTotal = counts.reduce((a, b) => a + b, 0);

    return {
      hanN,
      dashPer1k: dash / hanN * 1000,
      ellipsisPer1k: ellipsis / hanN * 1000,
      singleQuotePer1k: singleQuote / hanN * 1000,
      dunhaoPer1k: dunhao,
      exclPer1k: excl,
      quesPer1k: ques,
      commaPer1k: comma,
      typeCount,
      punctEntropy,
      punctTotal
    };
  }

  /* =====================================================================
     特征 4：段落形态
     ---------------------------------------------------------------------
     AI 生成的段落长度高度均匀；真人会因对话/描写切换而剧烈起伏。
     同时统计「单句成段」比例 —— 网文对话常用，AI 较少。
     ===================================================================== */
  function paragraphProfile(text) {
    const paras = splitParas(text);
    const lens = paras.map(p => hanChars(p).length).filter(n => n > 0);
    if (lens.length < 3) return { usable: false, paraCount: lens.length };

    const cv = std(lens) / (mean(lens) || 1);

    // 单句成段比例
    let oneSentence = 0;
    for (const p of paras) {
      if (splitSentences(p).length <= 1 && hanChars(p).length > 0) oneSentence++;
    }

    return {
      usable: true,
      paraCount: lens.length,
      paraLenCv: cv,
      meanParaLen: mean(lens),
      oneSentenceRatio: oneSentence / paras.length
    };
  }

  /* =====================================================================
     特征 5：模板重复
     ---------------------------------------------------------------------
     「反复使用一些固定的描述方式」→ 用**跨段重复的 4-gram 短语**度量。
     只统计出现在 2 个及以上**不同段落**的 4-gram，避免把正常复现算进去。
     ===================================================================== */
  function repetitionProfile(text) {
    const hc = hanChars(text);
    if (hc.length < 200) return { usable: false, hanCount: hc.length };

    // 记录每个 4-gram 出现的段落集合
    const paras = splitParas(text);
    const seen = new Map();      // gram -> Set(paraIdx)
    const count = new Map();     // gram -> 总出现次数

    paras.forEach((p, pi) => {
      const ph = hanChars(p);
      for (let i = 0; i + 4 <= ph.length; i++) {
        const g = ph[i] + ph[i + 1] + ph[i + 2] + ph[i + 3];
        count.set(g, (count.get(g) || 0) + 1);
        if (!seen.has(g)) seen.set(g, new Set());
        seen.get(g).add(pi);
      }
    });

    let repeatedGramOccur = 0;    // 重复短语占用的字数
    let repeatedGramTypes = 0;
    for (const [g, ps] of seen) {
      if (ps.size >= 2) {
        repeatedGramTypes++;
        repeatedGramOccur += count.get(g) * 4;
      }
    }
    const totalGrams = Math.max(1, hc.length - 3);
    const repeatRate = repeatedGramOccur / hc.length;

    return { usable: true, repeatRate, repeatedGramTypes, totalGrams, hanCount: hc.length };
  }

  /* =====================================================================
     特征 6：套话密度（需传入 KB 的 novel_ai_tells）
     ---------------------------------------------------------------------
     直接匹配「AI 腔 / 网文套路腔」短语。这是唯一"看内容"的信号。
     ===================================================================== */
  function buildMatcher(kb) {
    if (!kb || !Array.isArray(kb.novel_ai_tells)) return null;
    const pats = [];
    for (const p of kb.novel_ai_tells) {
      if (!p.phrase) continue;
      pats.push({
        phrase: p.phrase,
        severity: p.severity || 'medium',
        type: p.type || '套话'
      });
    }
    return pats.length ? pats : null;
  }

  function clicheDensity(text, kb) {
    const pats = buildMatcher(kb);
    if (!pats) return { usable: false };
    const lower = String(text);
    const hanN = hanChars(lower).length || 1;
    const W = { high: 3, medium: 2, low: 1 };

    const hits = [];
    let weighted = 0;
    for (const p of pats) {
      const esc = p.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = lower.match(new RegExp(esc, 'g'));
      if (m && m.length) {
        weighted += m.length * (W[p.severity] || 1);
        hits.push({ phrase: p.phrase, count: m.length, severity: p.severity, type: p.type });
      }
    }
    const density = weighted / hanN * 1000;   // 每千字加权命中
    const sat = THRESHOLDS.cliche.saturate;
    return {
      usable: true,
      weighted,
      hits: hits.sort((a, b) => b.count * W[b.severity] - a.count * W[a.severity]),
      density,
      aiScore: Math.round(clamp01(density / sat) * 100),
      hanCount: hanN
    };
  }

  /* =====================================================================
     综合：折算成「AI 痕迹强度」0-100
     ---------------------------------------------------------------------
     每项返回 { key, label, value, aiScore, weight, evidence, note }
     融合策略沿用原项目：强特征投票 + 分档封顶 + 短文本收缩。
     ===================================================================== */
  function analyze(text, kb) {
    const hanCount = hanChars(text).length;
    const lr = lexicalRichness(text);
    const bu = burstiness(text);
    const pu = punctuationProfile(text);
    const pa = paragraphProfile(text);
    const rp = repetitionProfile(text);
    const cl = clicheDensity(text, kb);

    const signals = [];
    const T = THRESHOLDS;

    /* --- 套话密度 --- */
    if (cl.usable) {
      signals.push({
        key: 'cliche', label: 'AI 腔 / 套路腔密度', weight: 0.14,
        aiScore: cl.aiScore,
        value: `加权命中 ${cl.weighted} 点 / ${cl.hanCount} 字（${cl.hits.length} 类）`,
        evidence: cl.hits.slice(0, 8).map(h => `${h.type}：「${h.phrase}」× ${h.count}`),
        note: '直接匹配网文套路化表达与 AI 腔短语。⚠️ 真人也会用这些词，单靠此项不足以判定；且词库覆盖有限，本项仅作辅助证据。'
      });
    }

    /* --- 用字丰富度 --- */
    if (lr.usable) {
      /* 优先用 MSTTR（与长度无关）；文本 < 600 字时退回普通 TTR（并在 note 提示） */
      const ttrUse = lr.msttr != null ? lr.msttr : lr.ttr;
      const ttrAi = clamp01((ttrUse - T.lexical.ttrStart) / T.lexical.ttrSpan) * 100;
      const biAi = clamp01((lr.bigramUniqueRate - T.lexical.bigramStart) / T.lexical.bigramSpan) * 100;
      // 韵文折扣：诗词曲赋用字考究、TTR 天然偏高，不能当 AI 痕迹
      const verseK = (bu.usable && bu.verseLikely) ? 0.35 : 1;
      const combined = (ttrAi * 0.80 + biAi * 0.20) * verseK;
      signals.push({
        key: 'lexical', label: '用字丰富度', weight: 0.14,
        aiScore: Math.round(combined),
        value: `${lr.msttr != null ? 'MSTTR' : 'TTR'} ${ttrUse.toFixed(3)} · 二字组合唯一率 ${(lr.bigramUniqueRate * 100).toFixed(1)}%`,
        evidence: [
          `字级 TTR = ${lr.ttr.toFixed(3)}${lr.msttr != null ? ` · MSTTR(300 字分段) = ${lr.msttr.toFixed(3)}` : ''}（${lr.uniqueTypes} 字种 / ${lr.hanCount} 字次）`,
          `相邻二字组合唯一率 = ${(lr.bigramUniqueRate * 100).toFixed(1)}%（${lr.bigramTypes} 种组合）`,
          `最高频 10 字占比 = ${(lr.top10Share * 100).toFixed(1)}%`
        ],
        note: '中文无空格，故用「字级 TTR + 二字组合唯一率」近似词汇多样性。⚠️ 标定实测：AI 的 TTR **偏高**（更爱堆书面语新词），方向与英文研究一致；但 TTR 随文本变长自然下降，**只有等长对比才有意义**。'
      });
    }

    /* --- 句式波动 --- */
    if (bu.usable) {
      const cvAi = clamp01((T.burstiness.cvStart - bu.cv) / T.burstiness.cvSpan) * 100;
      const deltaAi = clamp01((T.burstiness.deltaStart - bu.meanDelta) / T.burstiness.deltaSpan) * 100;
      // 韵文折扣：诗词句长天然整齐，不是 AI 痕迹
      const verseK = bu.verseLikely ? 0.35 : 1;
      const combined = (cvAi * 0.62 + deltaAi * 0.38) * verseK;
      signals.push({
        key: 'burstiness', label: '句式波动', weight: 0.28,
        aiScore: Math.round(combined),
        value: `句长 CV ${bu.cv.toFixed(3)} · 平均 ${bu.mean.toFixed(1)} 字 · 相邻差 ${bu.meanDelta.toFixed(1)}`,
        evidence: [
          `句长变异系数 CV = ${bu.cv.toFixed(3)}（SD ${bu.sd.toFixed(2)} / 均值 ${bu.mean.toFixed(2)}）`,
          `相邻句长平均绝对差 = ${bu.meanDelta.toFixed(2)} 字`,
          `句长随位置漂移斜率 = ${bu.drift.toFixed(3)}`,
          `共 ${bu.sentenceCount} 句`
        ],
        note: '核心指标。人类长短句交替（对话短、描写长），AI 节奏均匀 → CV 越低越可疑。按**字数**计算，非音节。'
      });
    }

    /* --- 标点形态 --- */
    {
      const typeAi = clamp01((T.punct.typeStart - pu.typeCount) / T.punct.typeSpan) * 100;
      const entAi = clamp01((T.punct.entropyStart - pu.punctEntropy) / T.punct.entropySpan) * 100;
      const sqAi = clamp01(pu.singleQuotePer1k / 1.5) * 100;
      const verseK = (bu.usable && bu.verseLikely) ? 0.5 : 1;
      const combined = (entAi * 0.50 + typeAi * 0.35 + sqAi * 0.15) * verseK;
      signals.push({
        key: 'punct', label: '标点形态', weight: 0.30,
        aiScore: Math.round(combined),
        value: `标点 ${pu.typeCount} 种 · 分布熵 ${pu.punctEntropy.toFixed(2)} · 单引号 ${pu.singleQuotePer1k.toFixed(2)}‰`,
        evidence: [
          `标点种类数 = ${pu.typeCount}`,
          `标点分布熵 = ${pu.punctEntropy.toFixed(2)} bit`,
          `单引号 = ${pu.singleQuotePer1k.toFixed(2)}‰，破折号 = ${pu.dashPer1k.toFixed(2)}‰，省略号 = ${pu.ellipsisPer1k.toFixed(2)}‰`,
          `顿号 = ${pu.dunhaoPer1k.toFixed(2)}‰，感叹号 = ${pu.exclPer1k.toFixed(2)}‰，问号 = ${pu.quesPer1k.toFixed(2)}‰`
        ],
        note: '**标定后最强信号**（熵 d=2.75 / 种类 d=2.02）：AI 标点高度单一（实测中位 熵 1.30、种类 4），真人标点分布丰富（熵 2.29、种类 8）。⚠️ 真人基线是清代白话，当代网文的标点多样性可能低于古典文本，本项对现代网文可能偏保守。'
      });
    }

    /* --- 段落形态 --- */
    if (pa.usable) {
      const cvAi = clamp01((T.para.cvStart - pa.paraLenCv) / T.para.cvSpan) * 100;
      // 单句成段比例过低也提示（网文对话常单句成段）
      const oneAi = clamp01((0.28 - pa.oneSentenceRatio) / 0.28) * 100;
      const combined = cvAi * 0.75 + oneAi * 0.25;
      signals.push({
        key: 'para', label: '段落形态', weight: 0.10,
        aiScore: Math.round(combined),
        value: `${pa.paraCount} 段 · 段长 CV ${pa.paraLenCv.toFixed(3)} · 单句成段 ${(pa.oneSentenceRatio * 100).toFixed(0)}%`,
        evidence: [
          `段落数 = ${pa.paraCount}`,
          `段长变异系数 = ${pa.paraLenCv.toFixed(3)}`,
          `平均段长 = ${pa.meanParaLen.toFixed(1)} 字`,
          `单句成段比例 = ${(pa.oneSentenceRatio * 100).toFixed(1)}%`
        ],
        note: 'AI 生成的段落长度高度均匀；真人会因对话/描写切换剧烈起伏，且网文常用「单句成段」制造节奏。'
      });
    }

    /* --- 模板重复：⚠️ **不参与打分** ---
       标定实测方向与预期**相反**：真人 0.063 > AI 0.033。
       红楼梦有大量固定人名与套语（「笑道」「宝玉」「黛玉」），
       导致真人重复率反而更高 → 该特征在本语料上**判据不成立**。
       故只作展示信息返回（repetitionInfo），不计入分数，避免反向误导。 */

    /* --- 汇总 --- */
    const totalWeight = signals.reduce((s, x) => s + x.weight, 0) || 1;
    const weighted = signals.reduce((s, x) => s + x.aiScore * x.weight, 0) / totalWeight;
    const peak = signals.length ? Math.max(...signals.map(x => x.aiScore)) : 0;

    // 强证据：用字丰富度 / 句式波动 / 段落形态 / 标点
    /* 强证据名单：只保留**标定有效**的两项。
       · para 因语料格式差异（古典文本每句一行）未有效标定；
       · lexical 判别力中等（d=0.72），且方向依赖文本长度；
       二者仅作展示，不参与投票。 */
    const strongKeys = ['punct', 'burstiness'];
    const strongHigh = signals
      .filter(x => strongKeys.includes(x.key) && x.aiScore >= 60)
      .sort((a, b) => b.aiScore - a.aiScore);
    const strongVotes = strongHigh.length;

    const strongSigs = signals.filter(x => strongKeys.includes(x.key));
    const sw = strongSigs.reduce((s, x) => s + x.weight, 0) || 1;
    const strongAvgAll = strongSigs.reduce((s, x) => s + x.aiScore * x.weight, 0) / sw;
    const hw = strongHigh.reduce((s, x) => s + x.weight, 0) || 1;
    const highAvg = strongHigh.reduce((s, x) => s + x.aiScore * x.weight, 0) / hw;
    const strongAvg = strongHigh.length >= 2
      ? Math.max(strongAvgAll, highAvg * 0.96)
      : strongAvgAll;

    let score;
    if (strongVotes >= 3) {
      score = Math.max(weighted, strongAvg);
    } else if (strongVotes === 2) {
      /* 两个强特征（标点 + 句长波动）**同时**指向 AI → 证据充分。
         标定实测：AI 样本的 strongAvg 约 67，真人极少两项同时低。
         故两项都达标即放行，封顶 78（两项均 >=80 时给 88）。 */
      const bothVeryHigh = strongHigh[0].aiScore >= 80 && strongHigh[1].aiScore >= 80;
      score = Math.min(Math.max(weighted, strongAvg * 0.98), bothVeryHigh ? 88 : 78);
    } else if (strongVotes === 1 && strongHigh[0].aiScore >= 92) {
      score = Math.min(Math.max(weighted, strongAvg), 72);
    } else {
      score = Math.min(weighted, 48);
    }

    // 短文本收缩：<600 字时向中性低分收缩
    if (hanCount < 600) {
      const shrink = 0.65 + clamp01((hanCount - 200) / 400) * 0.35;
      score = score * shrink;
    }
    score = Math.round(Math.max(0, Math.min(100, score)));

    /* 判定档位（按标定数据设，非拍脑袋）：
       真人 745 块：P90=27 · P95≈35 · 最高 54（残留误报为赋体骈文）
       AI  11 段：中位 48 · P90 78
       → 30 分以上约 8% 真人会落入（可接受）；55 分以上基本只有 AI。 */
    const level = score >= 55 ? 'high' : score >= 30 ? 'mid' : 'low';

    return {
      signals,
      score,
      level,
      usable: signals.length > 0,
      reliable: hanCount >= 600,
      hanCount,
      sentenceCount: splitSentences(text).length,
      paraCount: splitParas(text).length,
      peak,
      strongVotes,
      verseLikely: bu.usable ? bu.verseLikely : false,
      repetitionInfo: rp.usable ? rp : null,
      thresholds: THRESHOLDS
    };
  }

  return {
    analyze,
    lexicalRichness, burstiness, punctuationProfile, paragraphProfile,
    repetitionProfile, clicheDensity,
    // 工具导出（供测试与其他模块复用）
    hanChars, splitSentences, splitParas, entropy, mean, std, clamp01,
    THRESHOLDS
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelStylo;
