/* 模块集成测试：验证 5 个模块都能跑通，且确定性判据正确 */
const fs = require('fs');
const path = require('path');

const NS = require(path.join(__dirname, '..', 'web', 'assets', 'novel_stylometry.js'));
const FMT = require(path.join(__dirname, '..', 'web', 'assets', 'format.js'));
const DLG = require(path.join(__dirname, '..', 'web', 'assets', 'dialogue.js'));
const STC = require(path.join(__dirname, '..', 'web', 'assets', 'structure.js'));
const CON = require(path.join(__dirname, '..', 'web', 'assets', 'consistency.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

const human = fs.readFileSync(path.join(__dirname, 'corpus', 'human', 'hongloumeng_000.txt'), 'utf8');
const aiSrc = fs.readFileSync(path.join(__dirname, 'corpus', 'ai', '_source.md'), 'utf8');
const ai = aiSrc.split(/^===SEG===$/m)[0].trim();

console.log('\n=== 1. 五个模块在真实语料上跑通 ===');
for (const [name, mod, text] of [
  ['文体统计', NS, human], ['格式合规', FMT, human],
  ['对话分析', DLG, human], ['结构水文', STC, human], ['叙事一致性', CON, human]
]) {
  try {
    const r = mod.analyze(text);
    ok(`${name} 不抛异常`, r && typeof r.score === 'number', `score=${r && r.score}`);
    ok(`${name} 有 signals`, Array.isArray(r.signals) && r.signals.length > 0);
  } catch (e) { ok(`${name} 不抛异常`, false, e.message); }
}
for (const [name, mod] of [['文体统计', NS], ['格式合规', FMT], ['对话分析', DLG], ['结构水文', STC], ['叙事一致性', CON]]) {
  try {
    const r = mod.analyze(ai);
    ok(`${name} 处理 AI 样本不抛异常`, typeof r.score === 'number', `score=${r.score}`);
  } catch (e) { ok(`${name} 处理 AI 样本不抛异常`, false, e.message); }
}

console.log('\n=== 2. 格式合规：确定性判据（提示词残留） ===');
const residueText = '好的，以下是一篇玄幻小说。\n' + human +
  '\n作为AI，我无法继续创作暴力情节。希望对你有帮助。';
const rf = FMT.analyze(residueText);
const residueSig = rf.signals.find(s => s.key === 'residue');
ok('检出提示词残留', residueSig.aiScore >= 60, `score=${residueSig.aiScore}`);
ok('残留证据非空', residueSig.evidence.length > 0 && !/未命中|未发现/.test(residueSig.value), residueSig.value);
const rfClean = FMT.analyze(human);
const residueClean = rfClean.signals.find(s => s.key === 'residue');
ok('干净文本不误报残留', residueClean.aiScore === 0, `score=${residueClean.aiScore}`);

console.log('\n=== 3. 格式合规：Markdown 残留 ===');
const mdText = '## 第一章\n\n他**猛地**抬头，看见了她。\n\n- 第一件事\n- 第二件事\n';
const rm = FMT.analyze(mdText);
const mdSig = rm.signals.find(s => s.key === 'markdown');
ok('检出 Markdown 残留', mdSig.aiScore > 0, `score=${mdSig.aiScore}`);

console.log('\n=== 4. 对话分析：有/无对话 ===');
const noDlg = human.split('\n').filter(l => !/[“”「」]/.test(l)).join('\n');
const dNo = DLG.analyze(noDlg);
ok('无对话文本 dialogue 信号 > 0', dNo.signals[0].aiScore > 0, `score=${dNo.signals[0].aiScore}`);
const dYes = DLG.analyze(human);
ok('有对话文本能提取到引号', dYes.quoteCount > 0, `quotes=${dYes.quoteCount}`);

console.log('\n=== 5. 叙事一致性：视角统计 ===');
const con = CON.analyze(human);
ok('返回人称比例', typeof con.p1Ratio === 'number', `p1Ratio=${con.p1Ratio.toFixed(3)}`);
ok('stripQuotes 能去掉引号内容',
  CON.stripQuotes('他说：“我很好。”') === '他说：',
  `got="${CON.stripQuotes('他说：“我很好。”')}"`);

console.log('\n=== 6. 韵文检测（防误报） ===');
const poem = '昨夜不期经雨活，今朝犹喜带霜开。冷吟秋色诗千首，醉酹寒香酒一杯。' +
             '泉溉泥封勤护惜，好知井径绝尘埃。隔年花事了，昨夜雨声来。' +
             '种菊东篱下，悠然见南山。问君何能尔，心远地自偏。' +
             '采菊东篱下，悠然见南山。山气日夕佳，飞鸟相与还。';
const poemR = NS.analyze(poem);
ok('韵文被识别', poemR.verseLikely === true, `verseLikely=${poemR.verseLikely}`);
ok('韵文分数被压制', poemR.score < 55, `score=${poemR.score}`);

console.log('\n=== 7. 总分对比 ===');
console.log(`  真人样本（红楼梦首块 600 字）文体分 = ${NS.analyze(human).score}`);
console.log(`  AI 样本（首段）文体分 = ${NS.analyze(ai).score}`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
