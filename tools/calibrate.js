/* =========================================================================
   标定脚本：对比「真人基线」与「AI 样本」在各特征上的分布
   ---------------------------------------------------------------------
   目的：找出**真正有分离度**的特征，并据此定阈值。
   ⚠️ 真人基线是公版古典小说（清代白话）→ 存在**时代偏差**，
      结论必须标注「阈值基于古典语料，待现代语料校准」。
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const NS = require(path.join(__dirname, '..', 'web', 'assets', 'novel_stylometry.js'));

const ROOT = path.join(__dirname, '..');
const HUMAN_DIR = path.join(ROOT, 'test', 'corpus', 'human');
const AI_SRC = path.join(ROOT, 'test', 'corpus', 'ai', '_source.md');

/* ⚠️ 等长切片：TTR / 标点种类数等特征**随文本变长而系统性变化**，
   两组文本长度不等时对比完全失真（实测：真人 2446 字 vs AI 702 字，
   导致 AI 的 TTR 反而"高于"人类 —— 纯长度效应）。
   → 所有样本统一切成等长块，块内不足 75% 丢弃。 */
function chunk(text, size = 600) {
  const out = [];
  const sents = NS.splitSentences(text);
  let cur = [], n = 0;
  for (const s of sents) {
    cur.push(s);
    n += NS.hanChars(s).length;
    if (n >= size) { out.push(cur.join('\n')); cur = []; n = 0; }
  }
  if (n >= size * 0.75) out.push(cur.join('\n'));
  return out;
}

function readHuman() {
  return fs.readdirSync(HUMAN_DIR)
    .filter(f => f.endsWith('.txt'))
    .flatMap(f => chunk(fs.readFileSync(path.join(HUMAN_DIR, f), 'utf8')));
}

function readAI() {
  const raw = fs.readFileSync(AI_SRC, 'utf8');
  return raw.split(/^===SEG===$/m)
    .map(s => s.trim())
    .filter(s => NS.hanChars(s).length > 300)
    .flatMap(s => chunk(s));
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}
const med = a => percentile(a, 0.5);
const fmt = (x, d = 3) => Number(x).toFixed(d);

/* 提取每个样本的原始特征值 */
function feats(text) {
  const lr = NS.lexicalRichness(text);
  const bu = NS.burstiness(text);
  const pu = NS.punctuationProfile(text);
  const pa = NS.paragraphProfile(text);
  const rp = NS.repetitionProfile(text);
  return {
    hanCount: NS.hanChars(text).length,
    ttr: lr.usable ? lr.ttr : null,
    msttr: lr.usable ? lr.msttr : null,
    bigram: lr.usable ? lr.bigramUniqueRate : null,
    top10: lr.usable ? lr.top10Share : null,
    cv: bu.usable ? bu.cv : null,
    delta: bu.usable ? bu.meanDelta : null,
    sentMean: bu.usable ? bu.mean : null,
    punctTypes: pu.typeCount,
    punctEnt: pu.punctEntropy,
    singleQuote: pu.singleQuotePer1k,
    dash: pu.dashPer1k,
    ellipsis: pu.ellipsisPer1k,
    dunhao: pu.dunhaoPer1k,
    comma: pu.commaPer1k,
    paraCv: pa.usable ? pa.paraLenCv : null,
    oneSent: pa.usable ? pa.oneSentenceRatio : null,
    repeat: rp.usable ? rp.repeatRate : null
  };
}

function collect(texts) {
  const keys = null;
  const rows = texts.map(feats);
  const out = {};
  for (const k of Object.keys(rows[0])) {
    out[k] = rows.map(r => r[k]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  }
  return out;
}

function line(name, h, a, better) {
  const hp = `${fmt(percentile(h, .1))} / ${fmt(med(h))} / ${fmt(percentile(h, .9))}`;
  const ap = `${fmt(percentile(a, .1))} / ${fmt(med(a))} / ${fmt(percentile(a, .9))}`;
  // 分离度：两组中位数差 / 合并标准差（简易 Cohen's d 近似）
  const all = [...h, ...a];
  const m = all.reduce((x, y) => x + y, 0) / all.length;
  const sd = Math.sqrt(all.reduce((s, x) => s + (x - m) ** 2, 0) / all.length) || 1e-9;
  const d = Math.abs(med(h) - med(a)) / sd;
  const tag = d >= 0.8 ? '★★★' : d >= 0.5 ? '★★ ' : d >= 0.2 ? '★  ' : '   ';
  console.log(`${name.padEnd(14)} 人类 ${hp.padEnd(22)} | AI ${ap.padEnd(22)} | d=${fmt(d, 2)} ${tag} ${better}`);
}

const H = readHuman();
const A = readAI();
console.log(`\n真人样本 ${H.length} 个（红楼梦·清代白话）· AI 样本 ${A.length} 个（现代 AI）`);
console.log(`真人平均 ${Math.round(H.reduce((s, t) => s + NS.hanChars(t).length, 0) / H.length)} 字 · ` +
            `AI 平均 ${Math.round(A.reduce((s, t) => s + NS.hanChars(t).length, 0) / A.length)} 字\n`);

const hf = collect(H), af = collect(A);
console.log('特征           ' + ' '.repeat(14) + '人类(P10/中位/P90)'.padEnd(24) + ' | AI(P10/中位/P90)'.padEnd(24) + ' | 分离度');
console.log('-'.repeat(110));
line('字级TTR', hf.ttr, af.ttr, 'AI低→可疑');
line('MSTTR(300)', hf.msttr, af.msttr, 'AI高→可疑');
line('bigram唯一率', hf.bigram, af.bigram, 'AI低→可疑');
line('高频10字占比', hf.top10, af.top10, 'AI高→可疑');
line('句长CV', hf.cv, af.cv, 'AI低→可疑');
line('相邻句长差', hf.delta, af.delta, 'AI低→可疑');
line('平均句长', hf.sentMean, af.sentMean, '参考');
line('标点种类数', hf.punctTypes, af.punctTypes, 'AI低→可疑');
line('标点分布熵', hf.punctEnt, af.punctEnt, 'AI低→可疑');
line('单引号‰', hf.singleQuote, af.singleQuote, 'AI高→可疑');
line('破折号‰', hf.dash, af.dash, '方向待定');
line('省略号‰', hf.ellipsis, af.ellipsis, '方向待定');
line('顿号‰', hf.dunhao, af.dunhao, '方向待定');
line('逗号‰', hf.comma, af.comma, '参考');
line('段长CV', hf.paraCv, af.paraCv, 'AI低→可疑');
line('单句成段比', hf.oneSent, af.oneSent, 'AI低→可疑');
line('四字重复率', hf.repeat, af.repeat, 'AI高→可疑');

/* 整体分数 */
console.log('\n--- 综合分数 ---');
const hs = H.map(t => NS.analyze(t).score);
const as = A.map(t => NS.analyze(t).score);
console.log(`真人 ${hs.length} 篇：P10=${percentile(hs, .1)} 中位=${med(hs)} P90=${percentile(hs, .9)} 最高=${Math.max(...hs)}`);
console.log(`AI   ${as.length} 篇：P10=${percentile(as, .1)} 中位=${med(as)} P90=${percentile(as, .9)} 最低=${Math.min(...as)}`);
const overlap = hs.filter(x => x >= percentile(as, .1)).length;
console.log(`真人中 >= AI P10(${percentile(as, .1)}) 的篇数：${overlap} / ${hs.length}（越小越好）`);

/* 诊断：真人得分最高的几块，看误报来自哪里 */
console.log('\n--- 真人得分最高的 5 块（诊断误报来源）---');
H.map(t => ({ t, r: NS.analyze(t) }))
  .sort((a, b) => b.r.score - a.r.score)
  .slice(0, 5)
  .forEach(({ t, r }) => {
    console.log(`  ${r.score} 分 | ${r.signals.map(s => `${s.key}=${s.aiScore}`).join(' ')}`);
    console.log(`      ${NS.hanChars(t).length} 字 | ${t.replace(/\n/g, '').slice(0, 36)}…`);
  });

console.log('\n--- AI 得分最低的 3 块（诊断漏报来源）---');
A.map(t => ({ t, r: NS.analyze(t) }))
  .sort((a, b) => a.r.score - b.r.score)
  .slice(0, 3)
  .forEach(({ t, r }) => {
    console.log(`  ${r.score} 分 | ${r.signals.map(s => `${s.key}=${s.aiScore}`).join(' ')}`);
    console.log(`      ${NS.hanChars(t).length} 字 | ${t.replace(/\n/g, '').slice(0, 36)}…`);
  });
