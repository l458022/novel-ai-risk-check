/* 冒烟测试：验证中文引擎能跑通，并检查「真人 vs AI」方向是否正确 */
const path = require('path');
const NS = require(path.join(__dirname, '..', 'web', 'assets', 'novel_stylometry.js'));

const HUMAN = `　　林昭把剑收回鞘中，转身望向山下的雾海。
　　「你当真要走？」
　　他没有回头，只淡淡说了三个字：「不必送。」
　　山风卷起衣角。雾在脚下翻涌，像一层活着的海。
　　这一别，或许是永诀。
　　他忽然想起很多年前的那个雪夜——师父递给他这把剑时，说的也是同样的话。
　　走。
　　一个字，轻飘飘的，却压得人喘不过气。
　　林昭笑了。他笑得很轻，像怕惊动了什么。
　　「好。」
　　于是他走了。头也不回。身后的雾合拢过来，把那道背影吞了个干净。`;

const AI = `　　清晨的阳光透过窗户洒进房间，空气中弥漫着淡淡的花香。李明缓缓睁开眼睛，感受着新一天的到来。他轻轻起身，走到窗前，望着远处的城市轮廓，心中涌起一股难以言喻的情绪。
　　这座城市承载着他太多的回忆。每一条街道，每一个角落，都仿佛诉说着过去的故事。他不禁陷入了沉思，回忆起那些曾经的点点滴滴，心中充满了感慨。
　　时间仿佛在这一刻静止了。他深吸一口气，转身走向门口，准备迎接新的挑战。未来的路还很长，但他相信，只要坚持下去，就一定能够实现自己的梦想。
　　阳光依旧温暖，微风依旧轻柔。他迈开脚步，走向那个充满希望的明天，心中充满了无限的憧憬与期待。`;

function show(name, text) {
  const r = NS.analyze(text);
  console.log(`\n===== ${name} =====`);
  console.log(`汉字数 ${r.hanCount} · 句数 ${r.sentenceCount} · 段数 ${r.paraCount}`);
  console.log(`总分 ${r.score} (${r.level}) · 强票 ${r.strongVotes} · 峰值 ${r.peak}`);
  for (const s of r.signals) {
    console.log(`  [${String(s.aiScore).padStart(3)}] ${s.label}  w=${s.weight}  | ${s.value}`);
  }
}

show('真人风格样本', HUMAN);
show('AI 风格样本', AI);

// 断言：方向必须正确（AI 分 > 真人分）
const h = NS.analyze(HUMAN).score;
const a = NS.analyze(AI).score;
console.log(`\n方向检查：AI(${a}) > 真人(${h}) ? ${a > h ? '✅ 通过' : '❌ 失败'}`);
process.exit(a > h ? 0 : 1);
