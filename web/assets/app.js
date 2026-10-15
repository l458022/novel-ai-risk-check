/* =========================================================================
   主逻辑：输入 → 分析 → 汇总 → 渲染
   ========================================================================= */

(function () {
  const $ = id => document.getElementById(id);
  const HC = NovelStylo.hanChars;

  /* ---------------- Tab 切换 ---------------- */
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('view-' + t.dataset.view).classList.add('active');
    });
  });

  PlatformRules.render($('rulesBody'));

  /* ---------------- 输入区 ---------------- */
  const ta = $('inputText');
  const btnAnalyze = $('btnAnalyze');
  const btnClear = $('btnClear');
  const dropZone = $('dropZone');
  const fileInput = $('fileInput');
  const fileMeta = $('fileMeta');

  function updateCount() {
    const n = HC(ta.value).length;
    $('statLine').textContent = n ? `${n} 字 · ${NovelStylo.splitSentences(ta.value).length} 句` : '0 字';
    btnAnalyze.disabled = n < 100;
    if (n && n < 100) $('statLine').textContent += '（至少 100 字）';
  }

  ta.addEventListener('input', updateCount);

  /* 拖入 / 选择文件 */
  dropZone.addEventListener('click', () => fileInput.click());
  ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    if (f) readFile(f);
  });

  function readFile(f) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.docx')) {
      const r = new FileReader();
      r.onload = () => parseDocx(r.result, txt => { ta.value = txt; showMeta(f, txt); updateCount(); });
      r.readAsArrayBuffer(f);
      return;
    }
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      const r = new FileReader();
      r.onload = () => {
        const div = document.createElement('div');
        div.innerHTML = r.result;
        div.querySelectorAll('script,style').forEach(x => x.remove());
        ta.value = div.textContent.replace(/\n{3,}/g, '\n\n').trim();
        showMeta(f, ta.value); updateCount();
      };
      r.readAsText(f, 'utf-8');
      return;
    }
    const r = new FileReader();
    r.onload = () => { ta.value = r.result; showMeta(f, r.result); updateCount(); };
    r.readAsText(f, 'utf-8');
  }

  /* .docx 解析：docx 是 zip，正文在 word/document.xml
     ⚠️ 提取 <w:t> 的正则必须是 <w:t(?:\s[^>]*)?> ——
        用 <w:t[^>]*> 会误匹配 <w:tblPr>，把整段 XML 当正文（实测词数虚报数倍）。 */
  function parseDocx(buf, cb) {
    if (typeof JSZip === 'undefined') { alert('JSZip 未加载，无法解析 .docx。请改用 .txt。'); return; }
    JSZip.loadAsync(buf).then(zip => {
      const doc = zip.file('word/document.xml');
      if (!doc) throw new Error('缺少 word/document.xml，可能不是有效的 .docx');
      return doc.async('string');
    }).then(xml => {
      const unesc = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
      const lines = xml.split(/<\/w:p>/).map(p => {
        const ts = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]);
        return unesc(ts.join(''));
      }).filter(t => t.trim().length > 0);
      if (!lines.length) throw new Error('未提取到文本');
      cb(lines.join('\n'));
    }).catch(e => alert('解析 .docx 失败：' + e.message));
  }

  function showMeta(f, text) {
    fileMeta.classList.remove('hidden');
    $('fmName').textContent = f.name;
    $('fmInfo').textContent = `${(f.size / 1024).toFixed(1)} KB · ${HC(text).length} 字`;
  }

  $('fmClear').addEventListener('click', () => {
    fileMeta.classList.add('hidden'); fileInput.value = '';
  });

  btnClear.addEventListener('click', () => {
    ta.value = ''; fileMeta.classList.add('hidden'); fileInput.value = '';
    $('report').classList.add('hidden'); updateCount();
  });

  /* ---------------- 热点段落 ---------------- */
  function findHotspots(text, topN) {
    const paras = text.split(/\n+/).map(p => p.trim()).filter(p => HC(p).length > 0);
    const blocks = [];
    let cur = [], n = 0, start = 0;
    paras.forEach((p, i) => {
      cur.push(p); n += HC(p).length;
      if (n >= 320) { blocks.push({ text: cur.join('\n'), from: start + 1, to: i + 1 }); cur = []; n = 0; start = i + 1; }
    });
    if (n >= 160) blocks.push({ text: cur.join('\n'), from: start + 1, to: paras.length });

    return blocks.map(b => {
      const r = NovelStylo.analyze(b.text);
      const top = [...r.signals].sort((x, y) => y.aiScore - x.aiScore)[0];
      return {
        ...b,
        index: b.from === b.to ? `第 ${b.from} 段` : `第 ${b.from}–${b.to} 段`,
        score: r.score,
        reason: top ? `${top.label} 偏高` : '综合'
      };
    }).sort((a, b) => b.score - a.score).slice(0, topN);
  }

  /* ---------------- 主分析 ---------------- */
  function analyzeAll(text) {
    const want = {
      dialogue: $('chkDialogue').checked,
      structure: $('chkStructure').checked,
      consistency: $('chkConsistency').checked,
      format: $('chkFormat').checked
    };

    const stylo = NovelStylo.analyze(text, null);

    const modules = [];
    // 文体统计（主体，权重最高）
    modules.push({
      key: 'stylo', name: '文体统计', score: stylo.score, level: stylo.level,
      signals: stylo.signals.map(s => ({ ...s, level: s.aiScore >= 55 ? 'high' : s.aiScore >= 30 ? 'mid' : 'low' }))
    });
    if (want.format) {
      const r = NovelFormat.analyze(text);
      modules.push({ key: 'format', name: '格式合规', score: r.score, level: r.level, signals: r.signals });
    }
    if (want.dialogue) {
      const r = NovelDialogue.analyze(text);
      modules.push({ key: 'dialogue', name: '对话分析', score: r.score, level: r.level, signals: r.signals });
    }
    if (want.structure) {
      const r = NovelStructure.analyze(text);
      modules.push({ key: 'structure', name: '结构 / 水文', score: r.score, level: r.level, signals: r.signals });
    }
    if (want.consistency) {
      const r = NovelConsistency.analyze(text);
      modules.push({ key: 'consistency', name: '叙事一致性', score: r.score, level: r.level, signals: r.signals });
    }

    /* 总分融合：
       · 以「文体统计」为主体（唯一经过语料标定的模块）
       · 其余模块按较低权重补充
       · **提示词残留等硬证据**可突破加权结果（确定性高于统计推断） */
    const W = { stylo: 0.58, format: 0.12, dialogue: 0.10, structure: 0.10, consistency: 0.10 };
    let tw = 0, sum = 0, peak = 0;
    for (const m of modules) {
      const w = W[m.key] || 0.1;
      sum += m.score * w; tw += w;
      peak = Math.max(peak, m.score);
    }
    let overall = sum / (tw || 1);

    const fmt = modules.find(m => m.key === 'format');
    if (fmt) {
      const residue = fmt.signals.find(s => s.key === 'residue');
      if (residue && residue.aiScore >= 60) overall = Math.max(overall, residue.aiScore * 0.9);
    }
    overall = Math.round(Math.max(0, Math.min(100, overall)));

    const level = overall >= 55 ? 'high' : overall >= 30 ? 'mid' : 'low';

    return {
      overall: { score: overall, level },
      modules,
      edits: NovelSuggest.analyze(text),
      hotspots: findHotspots(text, 3),
      hanCount: stylo.hanCount,
      sentenceCount: stylo.sentenceCount,
      paraCount: stylo.paraCount,
      reliable: stylo.reliable,
      verseLikely: stylo.verseLikely
    };
  }

  btnAnalyze.addEventListener('click', () => {
    const text = ta.value;
    if (HC(text).length < 100) { alert('文本太短，请至少输入 100 字。'); return; }
    btnAnalyze.disabled = true;
    btnAnalyze.textContent = '分析中…';
    // 让 UI 先刷新，再跑计算
    setTimeout(() => {
      try {
        const result = analyzeAll(text);
        NovelReport.render(result);
        $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        alert('分析出错：' + err.message);
        console.error(err);
      } finally {
        btnAnalyze.disabled = false;
        btnAnalyze.textContent = '开始体检';
      }
    }, 30);
  });

  updateCount();
})();
