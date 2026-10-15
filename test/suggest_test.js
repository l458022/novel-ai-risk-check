/* 逐句改写建议：验证能给出**具体**的「原文 → 改后」对照 */
const fs = require('fs');
const path = require('path');
const SUG = require(path.join(__dirname, '..', 'web', 'assets', 'suggest.js'));

const ai = fs.readFileSync(path.join(__dirname, 'corpus', 'ai', '_source.md'), 'utf8')
  .split(/^===SEG===$/m).slice(0, 3).join('\n');

const r = SUG.analyze(ai);
console.log(`共 ${r.sentenceCount} 句，命中 ${r.totalIssues} 处问题\n`);

for (const it of r.items.slice(0, 8)) {
  console.log(`【第 ${it.no} 句 · ${it.severity === 'high' ? '高' : '中'}】`);
  console.log(`  原文：${it.original}`);
  if (it.revised) console.log(`  改后：${it.revised}`);
  for (const iss of it.issues) console.log(`   · ${iss.reason}`);
  console.log('');
}

console.log('--- 连续同长句 ---');
for (const run of r.runs.slice(0, 3)) console.log(`  第 ${run.from}–${run.to} 句，长度 ${run.lens.join(' / ')}`);
console.log('--- 句首重复 ---');
for (const s of r.starters.slice(0, 3)) console.log(`  第 ${s.from}–${s.to} 句连续以「${s.word}」开头`);

// 断言：必须给出至少 1 条带具体改写的建议
const withRevised = r.items.filter(i => i.revised).length;
console.log(`\n带具体改写的建议：${withRevised} 条`);
process.exit(withRevised >= 1 ? 0 : 1);
