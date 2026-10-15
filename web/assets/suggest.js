/* =========================================================================
   逐句改写建议（Line-level Rewrite Suggestions）
   ---------------------------------------------------------------------
   ⚠️ 为什么需要这个模块：
      原来的建议是「标点要多样」「句子要长短交错」——**通用套话**，
      用户看完不知道自己该改哪一句。本模块做的是**逐句定位 + 具体改写**：
        「第 12 句：他缓缓地睁开眼睛，感受着新一天的到来。
          → 他睁开眼睛。窗外已经亮了。」

   三类可自动改写的问题（**纯规则可实现，无需大模型**）：
     A. 冗余修饰语 —— 可安全删除（缓缓地/轻轻地/微微地…）
     B. 套话短语   —— 有明确替换（嘴角勾起一抹弧度 → 笑了笑）
     C. 空洞表达   —— 无标准替换，给**方向 + 参考写法**
   另有四类结构问题（只定位、给目标，不硬改）：
     D. 超长句 / E. 连续同长句 / F. 句首重复 / G. 标点单一

   ⚠️ 所有改写都是**建议**。文学表达没有唯一正解，作者有权全部不改。
   ========================================================================= */

const NovelSuggest = (() => {

  const hanChars = t => {
    const out = [];
    for (const ch of String(t)) if (/[\u4e00-\u9fff]/.test(ch)) out.push(ch);
    return out;
  };

  /* ---------- A. 冗余修饰语：删除后语义基本不变 ---------- */
  const REDUNDANT = [
    '缓缓地', '缓缓', '轻轻地', '轻轻', '微微地', '微微', '淡淡地', '淡淡',
    '默默地', '默默', '悄悄地', '悄悄', '深深地', '深深', '静静地', '静静',
    '慢慢地', '慢慢', '不由自主地', '下意识地', '情不自禁地', '不禁',
    '忍不住', '若有所思地', '意味深长地'
  ];

  /* ---------- A2. 凑字词：删掉后句意基本不变（可自动改写） ---------- */
  const FILLER = ['一丝', '一抹', '不由得', '些许', '略微', '颇为', '甚是', '反倒', '终究'];

  /* ---------- B. 套话短语：有约定俗成的替换 ---------- */
  const CLICHE = [
    { from: '嘴角勾起一抹弧度', to: '笑了笑' },
    { from: '嘴角勾起一抹', to: '笑了笑' },
    { from: '嘴角微微上扬', to: '笑了笑' },
    { from: '嘴角扬起', to: '笑了笑' },
    { from: '眼中闪过一丝', to: '看了他一眼' },
    { from: '眼中闪过', to: '眼里' },
    { from: '眼中闪过一丝复杂', to: '看了他一眼' },
    { from: '深吸一口气', to: '' },
    { from: '缓缓开口', to: '说' },
    { from: '淡淡开口', to: '说' },
    { from: '沉默片刻', to: '' },
    { from: '沉默了一会儿', to: '' },
    { from: '空气仿佛凝固', to: '' },
    { from: '时间仿佛静止', to: '' },
    { from: '不知过了多久', to: '' },
    { from: '心中一凛', to: '' },
    { from: '心中一紧', to: '' },
    { from: '若有所思', to: '' },
    { from: '不易察觉地', to: '' },
    { from: '难以言喻的情绪', to: '' },
    { from: '复杂的情绪', to: '' },
    { from: '百感交集', to: '' },
    { from: '五味杂陈', to: '' },
    { from: '心情久久不能平静', to: '' },
    { from: '心中涌起一股', to: '' },
    { from: '难以言喻', to: '' },
    { from: '无法形容', to: '' },
    { from: '说不清道不明', to: '' }
  ];

  /* ---------- C. 空洞表达：无标准替换，只给方向 ---------- */
  const VAGUE = [
    { p: '感受到了', tip: '「感受到」是空转词，直接写感受本身' },
    { p: '感受着', tip: '「感受着」是空转词，直接写感受本身' },
    { p: '仿佛在诉说', tip: '拟人化的空泛描写，换成具体的声音/景象' },
    { p: '仿佛在告诉他', tip: '拟人化的空泛描写，换成具体的声音/景象' },
    { p: '的一切', tip: '「的一切」过于笼统，写具体的一两样' },
    { p: '某种', tip: '「某种」是模糊限定，写清楚是什么' },
    { p: '油然而生', tip: '书面套语，换成具体反应' },
    { p: '涌上心头', tip: '书面套语，换成具体反应' },
    { p: '在心中回荡', tip: '书面套语，换成具体反应' }
  ];

  /* ---------- 句切分（带位置） ---------- */
  function splitSentences(text) {
    const out = [];
    const s = String(text).replace(/\r\n?/g, '\n');
    const re = /[^。！？…；\n]+[。！？…；]?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const t = m[0].trim();
      if (t && hanChars(t).length >= 2) out.push({ text: t, index: m.index });
    }
    return out;
  }

  /* ---------- D. 找长句的断句点 ---------- */
  function findBreak(text) {
    const marks = [];
    for (let i = 0; i < text.length; i++) {
      if ('，,；;'.includes(text[i])) marks.push(i);
    }
    if (!marks.length) return null;
    const mid = text.length / 2;
    const best = marks.reduce((a, b) => Math.abs(b - mid) < Math.abs(a - mid) ? b : a);
    return {
      pos: best,
      head: text.slice(0, best) + '。',
      tail: text.slice(best + 1)
    };
  }

  /* ---------- E. 连续同长句 ---------- */
  function findUniformRuns(sents) {
    const runs = [];
    let i = 0;
    while (i < sents.length) {
      const base = hanChars(sents[i].text).length;
      let j = i + 1;
      while (j < sents.length) {
        const len = hanChars(sents[j].text).length;
        if (Math.abs(len - base) <= Math.max(4, base * 0.25)) j++;
        else break;
      }
      if (j - i >= 3) runs.push({ from: i + 1, to: j, lens: sents.slice(i, j).map(x => hanChars(x.text).length) });
      i = j > i + 1 ? j : i + 1;
    }
    return runs;
  }

  /* ---------- F. 句首重复 ---------- */
  function findStarterRepeats(sents) {
    const runs = [];
    let i = 0;
    while (i < sents.length) {
      const head = hanChars(sents[i].text).slice(0, 1);
      if (!head || !'他她它'.includes(head)) { i++; continue; }
      let j = i + 1;
      while (j < sents.length && hanChars(sents[j].text)[0] === head) j++;
      if (j - i >= 3) runs.push({ from: i + 1, to: j, word: head });
      i = j > i + 1 ? j : i + 1;
    }
    return runs;
  }

  /* ---------------- 主分析 ---------------- */
  function analyze(text) {
    const sents = splitSentences(text);
    const items = [];

    sents.forEach((s, i) => {
      const raw = s.text;
      const len = hanChars(raw).length;
      const issues = [];
      let revised = raw;

      /* A. 冗余修饰语：按**长度降序**匹配，命中后从工作串中移除，
         避免「静静地」与「静静」这类包含关系被重复上报。 */
      let work = raw;
      for (const w of [...REDUNDANT].sort((a, b) => b.length - a.length)) {
        if (work.includes(w)) {
          issues.push({
            kind: 'redundant', from: w, to: '',
            reason: `冗余修饰语「${w}」删掉后句意不变`
          });
          work = work.split(w).join('');
        }
      }

      /* A2. 凑字词（可直接删） */
      for (const w of FILLER) {
        if (work.includes(w)) {
          issues.push({
            kind: 'filler', from: w, to: '',
            reason: `凑字词「${w}」删掉后句意基本不变`
          });
          work = work.split(w).join('');
        }
      }

      /* B. 套话短语 */
      for (const c of CLICHE) {
        if (raw.includes(c.from)) {
          issues.push({
            kind: 'cliche', from: c.from, to: c.to,
            reason: c.to ? `套话「${c.from}」建议换成「${c.to}」` : `套话「${c.from}」可直接删除`
          });
          break;   // 每句只报一个最主要的套话，避免刷屏
        }
      }

      /* C. 空洞表达 */
      for (const v of VAGUE) {
        if (raw.includes(v.p)) {
          issues.push({ kind: 'vague', from: v.p, to: null, reason: v.tip });
          break;
        }
      }

      /* D. 超长句 */
      let longBreak = null;
      if (len > 34) {
        longBreak = findBreak(raw);
        issues.push({
          kind: 'long', from: null, to: null,
          reason: `本句 ${len} 字，偏长` + (longBreak ? '，建议在中间的「，」处断成两句' : '，且句中没有逗号，建议加停顿')
        });
      }

      /* 生成改写结果：按顺序应用可自动替换的项 */
      let changed = false;
      for (const iss of issues) {
        if (iss.from && iss.to !== null && revised.includes(iss.from)) {
          revised = revised.replace(iss.from, iss.to);
          changed = true;
        }
      }
      if (longBreak) {
        revised = longBreak.head + longBreak.tail;
        changed = true;
      }
      // 清理因删除产生的孤立标点（如「他，转身」→「他转身」）
      revised = revised
        .replace(/^([他她它我你]{1,2})，/, '$1')
        .replace(/，{2,}/g, '，')
        .replace(/。{2,}/g, '。')
        .replace(/^[，。、]+/, '')
        .replace(/[，、]+(?=[。！？…])/g, '')
        .replace(/[，、]$/, '')
        .trim();

      if (issues.length) {
        items.push({
          no: i + 1, original: raw, len,
          revised: changed && revised !== raw ? revised : null,
          issues,
          // 严重度：高=套话/空洞（内容级）；中=冗余/超长
          severity: issues.some(x => x.kind === 'cliche' || x.kind === 'vague') ? 'high' : 'mid'
        });
      }
    });

    const runs = findUniformRuns(sents);
    const starters = findStarterRepeats(sents);

    /* 排序：严重度优先，其次按句序 */
    items.sort((a, b) => {
      const s = { high: 0, mid: 1 }[a.severity] - { high: 0, mid: 1 }[b.severity];
      return s !== 0 ? s : a.no - b.no;
    });

    return {
      items: items.slice(0, 20),
      totalIssues: items.length,
      runs,
      starters,
      sentenceCount: sents.length
    };
  }

  return { analyze, splitSentences, REDUNDANT, FILLER, CLICHE, VAGUE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelSuggest;
