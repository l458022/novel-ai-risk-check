/* =========================================================================
   报告渲染（Report）
   ---------------------------------------------------------------------
   把各模块结果汇总成：总分环 + 信号卡片 + 修改建议 + 热点段落。
   ========================================================================= */

const NovelReport = (() => {

  const LEVEL_TEXT = { low: '低', mid: '中', high: '高' };
  const LEVEL_DESC = {
    low: '未发现明显的 AI 痕迹。',
    mid: '存在部分可疑特征，建议回看标红项。',
    high: '多项特征同时异常，建议重点修改。'
  };

  const esc = t => String(t == null ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* 各信号 → 修改建议（指向「提升质量」，不是「规避检测」） */
  const SUGGESTIONS = {
    punct: {
      title: '标点使用过于单一',
      why: '真人写作会用省略号、破折号、问号、叹号、引号等多种标点制造语气与停顿；标点过于单一往往意味着句子节奏缺少变化。',
      how: [
        '在情绪转折处用省略号（……）或破折号（——）制造停顿',
        '对话密集处用问号、叹号体现人物语气',
        '检查是否通篇只有「，」和「。」——这是最典型的单一化'
      ]
    },
    burstiness: {
      title: '句子长短过于均匀',
      why: '真人写作会自然地在长句与短句之间切换：紧张的对话用短句，铺陈描写用长句。句子长度一致会让节奏变得机械。',
      how: [
        '在关键情节处用短句甚至单词句制造冲击力（如「走。」「不可能。」）',
        '把连续的长句拆开，或把碎句合并，制造起伏',
        '朗读一遍——如果读起来像念稿子，节奏就有问题'
      ]
    },
    lexical: {
      title: '用字偏「书面化 / 均匀」',
      why: '统计显示 AI 文本的用字多样性偏高（爱堆书面语新词），而真人写作会自然重复核心词汇。',
      how: [
        '适当重复人物名、口头禅、习惯用语，让叙述更口语化',
        '把「难以言喻的情绪」这类书面表达换成具体的动作或细节'
      ]
    },
    para_shape: {
      title: '段落长度过于均匀',
      why: 'AI 生成的段落长度往往高度一致；真人会因对话、动作、心理描写的切换而剧烈起伏。',
      how: [
        '对话用单句成段，制造节奏感',
        '长段描写后接一个短段，形成呼吸感'
      ]
    },
    padding: {
      title: '描写多、推进少（有注水嫌疑）',
      why: '对应平台公告的「空洞水文」。如果大量篇幅用在景物与心理描写，而情节推进词很少，读者会觉得「废话变多」。',
      how: [
        '删掉与情节无关的环境描写',
        '让每一段都推动一点情节：人物做了什么、决定了什么、发生了什么变化',
        '把「他感到很悲伤」换成具体的行为'
      ]
    },
    dialogue: {
      title: '对话占比偏低',
      why: '网文以对话驱动情节。对话过少会让作品显得「人物不说话」，缺少活人味。',
      how: [
        '把部分叙述改成对话（信息交代、冲突、情感都可以用对话完成）',
        '注意：题材差异大，硬科幻/悬疑对话天然少，不必强求'
      ]
    },
    dialogue_cv: {
      title: '对话长度过于一致',
      why: '真人对话长短交错——一个字的「嗯」和整段独白会并存；长度一致会让对话显得机械。',
      how: [
        '给不同性格的人物设计不同的说话长度与用词习惯',
        '关键对话用短促的短句，情绪爆发处可以用长段独白'
      ]
    },
    pov: {
      title: '叙述视角可能漂移',
      why: '长篇创作中最常见的 AI 痕迹之一是视角不稳定（同段内人称来回切换）。',
      how: [
        '确定本章是第几人称，通篇保持一致',
        '如果要切换视角，用明确的分段或章节断点'
      ]
    },
    timeline: {
      title: '时间线出现倒退',
      why: '时间词序列出现「大步长 → 小步长」的倒退。',
      how: [
        '⚠️ 倒叙、插叙、回忆都是合法手法，绝大多数情况是正常的',
        '只需确认这不是笔误（如把「三年前」误写成「三年后」）'
      ]
    },
    hook: {
      title: '章节结尾偏平淡',
      why: '网文章节结尾通常留有钩子（悬念、疑问、转折）。',
      how: [
        '⚠️ 这是很弱的信号，平稳收尾在文学上完全可以是有意为之',
        '若确需调整，可在结尾抛出一个未解的问题'
      ]
    },
    residue: {
      title: '检测到提示词残留（高置信度）',
      why: '正文里出现了「作为 AI 我无法…」「好的，以下是一篇…」这类元话语。人类写小说**不会**这样写——这是 AI 直接生成的确定性证据。',
      how: [
        '立即删除这些残留语句',
        '检查是否有整段是直接从 AI 对话窗口复制过来的'
      ]
    },
    markdown: {
      title: '正文含 Markdown 语法残留',
      why: '小说正文里出现 **加粗**、## 标题、- 列表等，通常是从 AI 对话窗口直接复制带入的。',
      how: ['删除所有 Markdown 标记，改为纯文本排版']
    },
    halfwidth: {
      title: '中英文标点混用',
      why: '中文语境里使用英文标点（如「他说,好的」），常见于中英混排的 AI 输出或跨平台复制。',
      how: ['把英文逗号、句点、问号替换为对应的中文标点（，。？）']
    },
    quotemix: {
      title: '混用了多套引号体系',
      why: '同一篇里同时出现 “”、「」、"" 等多种引号，通常意味着多来源拼接。',
      how: ['统一为一种引号体系（网文通常用 “” 或「」）']
    },
    blank: {
      title: '排版异常',
      why: '连续空行、连续全角空格、制表符缩进等，对应平台公告的「排版错乱」。',
      how: ['统一缩进方式（网文通常用两个全角空格　　）', '删除多余空行']
    },
    repeat: {
      title: '存在重复的描写模板',
      why: '同一四字短语在多段中反复出现。',
      how: [
        '⚠️ 网文本身套路化程度高，重复未必是问题',
        '若确实反复使用同一描写，换成更具体的细节'
      ]
    },
    cliche: {
      title: '套路化表达密集',
      why: '命中了较多网文套路腔 / AI 腔短语。',
      how: ['把「嘴角勾起一抹弧度」这类套话换成具体的动作与神态']
    }
  };

  function renderScore(overall) {
    const { score, level } = overall;
    const ring = document.getElementById('scoreRing');
    ring.className = 'score-ring lv-' + level;
    document.getElementById('scoreNum').textContent = score;
    document.getElementById('scoreLabel').textContent = LEVEL_TEXT[level] + '风险';
    document.getElementById('scoreDesc').textContent = LEVEL_DESC[level];
    document.getElementById('scoreTitle').textContent = 'AI 痕迹强度';
  }

  function renderSignalCard(sig) {
    return `
      <div class="sig-card lv-${sig.level || 'low'}">
        <div class="sig-head">
          <span class="sig-name">${esc(sig.label)}</span>
          <span class="sig-score lv-${sig.level || 'low'}">${sig.aiScore}</span>
        </div>
        <div class="sig-value">${esc(sig.value)}</div>
        ${sig.evidence && sig.evidence.length
          ? `<ul class="sig-evidence">${sig.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`
          : ''}
        ${sig.note ? `<div class="sig-note">${esc(sig.note)}</div>` : ''}
      </div>`;
  }

  function renderSignals(modules) {
    const box = document.getElementById('signalCards');
    let html = '';
    for (const m of modules) {
      html += `<div style="grid-column:1/-1;margin:14px 0 2px;font-size:13px;color:var(--muted);
        border-left:3px solid var(--accent);padding-left:8px">${esc(m.name)}
        <span style="margin-left:8px">综合 ${m.score}</span></div>`;
      html += m.signals.map(renderSignalCard).join('');
    }
    box.innerHTML = html;
  }

  function renderSuggestions(modules) {
    const box = document.getElementById('suggestions');
    // 收集所有 aiScore >= 30 的信号，按分数降序
    const items = [];
    for (const m of modules) {
      for (const s of m.signals) {
        if (s.aiScore >= 30 && SUGGESTIONS[s.key]) {
          items.push({ key: s.key, aiScore: s.aiScore, ...SUGGESTIONS[s.key] });
        }
      }
    }
    items.sort((a, b) => b.aiScore - a.aiScore);

    if (!items.length) {
      box.innerHTML = '<p class="muted">未发现需要修改的明显问题。</p>';
      return;
    }
    // 同 key 去重
    const seen = new Set();
    const uniq = items.filter(i => !seen.has(i.key) && seen.add(i.key));

    box.innerHTML = uniq.map(s => `
      <div class="sug">
        <div class="sug-title">${esc(s.title)} <span class="muted">（信号强度 ${s.aiScore}）</span></div>
        <div class="sug-why">${esc(s.why)}</div>
        <div class="sug-how">
          <b>可以这样改：</b>
          <ul>${s.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
        </div>
      </div>`).join('');
  }

  function renderHotspots(hotspots) {
    const box = document.getElementById('hotspots');
    if (!hotspots.length) {
      box.innerHTML = '<p class="muted">未发现明显异常段落。</p>';
      return;
    }
    box.innerHTML = hotspots.map(h => `
      <div class="hot ${h.score >= 55 ? 'high' : ''}">
        <div class="hot-head">第 ${h.index} 段 · 痕迹强度 ${h.score} · ${esc(h.reason)}</div>
        <div class="hot-text">${esc(h.text.slice(0, 160))}${h.text.length > 160 ? '…' : ''}</div>
      </div>`).join('');
  }

  /* 逐句改写建议：给出「原文 → 改后」的具体对照 */
  function renderLineEdits(edits) {
    const box = document.getElementById('lineEdits');
    const cnt = document.getElementById('editCount');
    if (!edits) { box.innerHTML = '<p class="muted">未分析。</p>'; return; }
    cnt.textContent = edits.totalIssues
      ? `共定位 ${edits.totalIssues} 处，按优先级显示前 ${edits.items.length} 条`
      : '未发现可定位的逐句问题';

    const hl = (text, issues) => {
      let h = esc(text);
      for (const iss of issues) {
        if (!iss.from) continue;
        const e = esc(iss.from);
        h = h.split(e).join(`<mark>${e}</mark>`);
      }
      return h;
    };

    let html = edits.items.map(it => `
      <div class="edit-item ${it.severity}">
        <div class="edit-head">第 ${it.no} 句 · ${it.len} 字
          <span class="edit-tag ${it.severity}">${it.severity === 'high' ? '优先处理' : '可优化'}</span></div>
        <div class="edit-orig">${hl(it.original, it.issues)}</div>
        ${it.revised ? `<div class="edit-arrow">↓ 建议改为</div>
          <div class="edit-new">${esc(it.revised)}</div>` : ''}
        <ul class="edit-reasons">${it.issues.map(x => `<li>${esc(x.reason)}</li>`).join('')}</ul>
      </div>`).join('');

    if (edits.runs.length) {
      html += `<div class="edit-struct"><b>连续同长句</b>（句长太接近，读起来会平）
        <ul>${edits.runs.slice(0, 5).map(r =>
          `<li>第 ${r.from}–${r.to} 句，长度 ${r.lens.join(' / ')} 字 —— 把其中一句压到一半，或插一个 5 字以内的短句</li>`
        ).join('')}</ul></div>`;
    }
    if (edits.starters.length) {
      html += `<div class="edit-struct"><b>句首重复</b>
        <ul>${edits.starters.slice(0, 5).map(s =>
          `<li>第 ${s.from}–${s.to} 句连续以「${s.word}」开头 —— 改 1–2 处：换成别的指代，或直接省略主语</li>`
        ).join('')}</ul></div>`;
    }
    if (!html) html = '<p class="muted">未发现可定位的逐句问题。</p>';
    box.innerHTML = html;
  }

  function render(result) {
    document.getElementById('report').classList.remove('hidden');
    renderScore(result.overall);
    renderSignals(result.modules);
    renderLineEdits(result.edits);
    renderSuggestions(result.modules);
    renderHotspots(result.hotspots);

    const meta = document.getElementById('scoreMeta');
    meta.innerHTML = `
      <span>字数 <b>${result.hanCount}</b></span>
      <span>句数 <b>${result.sentenceCount}</b></span>
      <span>段数 <b>${result.paraCount}</b></span>
      <span>${result.reliable ? '样本量充足' : '<b style="color:var(--mid)">样本偏短，结果仅供参考</b>'}</span>
      ${result.verseLikely ? '<span style="color:var(--mid)"><b>疑似诗词/韵文，统计特征不适用</b></span>' : ''}`;
  }

  return { render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NovelReport;
