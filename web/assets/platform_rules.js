/* =========================================================================
   平台规则数据（用于「平台规则」页展示）
   来源：各平台公开公告 + 行业公约 + 一线采访（详见 docs/01-平台规则对照.md）
   ========================================================================= */

const PlatformRules = (() => {

  const PLATFORMS = [
    {
      name: '起点中文网',
      tag: '付费订阅 · 本项目优先对标',
      focus: '反对「利用 AI 或其他自动化手段替代真人完成核心内容产出」，重叙事逻辑与原创性',
      action: '暂停推荐 → 撤下榜单 → 屏蔽作品 → 下架作品',
      history: '2025-04-21 发布公告；2025-08-18 集中处理一批「AI 创作痕迹过重」作品（撤榜 + 取消官方推荐流量，未下架）。据受处理作者，平台「通过 AI 检测全文，判断整本小说的 AI 率」。',
      rules: [
        { type: '非真人自动化文字创作', desc: 'AI 或自动化手段替代真人完成核心内容产出', detect: '综合 AI 痕迹分 · 提示词残留 · 模板化叙事' },
        { type: '标点异常', desc: '标点过于规范，频繁使用破折号、顿号甚至单引号', detect: '标点形态（分布熵 / 种类数）' },
        { type: '固定描述反复', desc: '反复使用固定描述方式，加入与剧情无关的比喻', detect: '重复描写模板' },
        { type: '剧情起伏小', desc: '「一点活人味儿都没有」，情绪平淡', detect: '句式波动 · 对话占比与波动' },
        { type: '前后文脱节', desc: '情节错乱、人名/视角矛盾', detect: '叙事一致性' }
      ]
    },
    {
      name: '番茄小说',
      tag: '免费阅读 · 其次对标',
      focus: '打击「低质 / 量产 / 水文」，因采用算法自动签约，受 AI 冲击最直接',
      action: '拒签 → 下架 → 账号处罚（持续高频量产者永久封禁）+ 低等级号限流',
      history: '月度发布低质治理公告：2026-07 拒签低质书籍 16 万本、处置 53,948 本、处置账号 5,621 个；2026-08 处置低质网文 6.1 万本。',
      rules: [
        { type: 'AI 粗制滥造', desc: 'AI 批量生成、缺乏打磨', detect: '综合 AI 痕迹分' },
        { type: '空洞水文', desc: '内容空洞、注水凑字数', detect: '情节推进 / 描写配比' },
        { type: '结构失常', desc: '章节结构混乱、节奏失控', detect: '段落长度分布' },
        { type: '行文机械', desc: '句式呆板、节奏均匀', detect: '句式波动' },
        { type: '格式混乱 / 排版错乱', desc: '标点、缩进、空行异常', detect: '格式合规（全半角 / Markdown / 空行）' },
        { type: '前后文脱节 / 情节错乱', desc: '上下文不连贯', detect: '叙事一致性' }
      ]
    },
    {
      name: '晋江文学城',
      tag: '付费订阅 · 参考',
      focus: '唯一给出**细分标准**的平台：按「辅助深度」划线，而非按「是否用 AI」',
      action: '判定违规（具体处置未完全公开）',
      history: '2025-02 发布《关于 AI 辅助写作使用、判定的试行公告》；已引入 AI 检测助手，据报道 AI 含量 < 20% 不计入统计（未获官方确认）。',
      rules: [
        { type: '文字型辅助（校对级）', desc: '校对错别字、病句', detect: '✅ 平台允许 —— 本工具不做判断' },
        { type: '创意型辅助（要素级、粗纲级）', desc: '提供极简略、不涉具体情节的要素/粗纲', detect: '⚠️ 受限 —— 本工具无法检测「是否用了大纲」' },
        { type: '写情节 / 描写场景 / 塑造人物', desc: '超出上述范围', detect: '❌ 平台视为影响原创性的违规' }
      ]
    }
  ];

  function render(el) {
    const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    el.innerHTML = PLATFORMS.map(p => `
      <div class="rule-block">
        <h4>${esc(p.name)} <span class="rule-tag">${esc(p.tag)}</span></h4>
        <p><b>打击重点：</b>${esc(p.focus)}</p>
        <p><b>处置梯度：</b>${esc(p.action)}</p>
        <p class="muted">${esc(p.history)}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">
          <thead>
            <tr style="text-align:left;color:var(--muted)">
              <th style="padding:4px 8px;border-bottom:1px solid var(--border)">官方违规类型</th>
              <th style="padding:4px 8px;border-bottom:1px solid var(--border)">说明</th>
              <th style="padding:4px 8px;border-bottom:1px solid var(--border)">对应检测项</th>
            </tr>
          </thead>
          <tbody>
            ${p.rules.map(r => `
              <tr>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border);white-space:nowrap">${esc(r.type)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border)">${esc(r.desc)}</td>
                <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--accent)">${esc(r.detect)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('') + `
      <p class="warn-text" style="margin-top:18px">
        ⚠️ 以上全部来自各平台**公开公告与媒体报道**。平台**从未公布量化阈值**，
        本工具给出的判据是「公开文献 + 行业经验」的启发式推断，<b>不是任何平台的官方标准</b>，
        也不能预测能否通过审核。
      </p>`;
  }

  return { render, PLATFORMS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PlatformRules;
