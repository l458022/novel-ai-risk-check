# -*- coding: utf-8 -*-
"""
从公版中文小说仓库提取正文，切成定长样本，作为「真人基线」语料。

⚠️ 语料许可与边界：
  · 《红楼梦》文本已进入**公有领域**（作者逝世逾 50 年）。
  · 但本仓库的**整理/排版版本**可能含整理者权利 → 语料**只本地用于标定，不入库**。
  · 标定产出的**阈值数字**是事实，不受版权保护，可入仓库。
"""
import os
import re
import sys
import zipfile

ZIP = sys.argv[1] if len(sys.argv) > 1 else 'hongloumeng.zip'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'test/corpus/human'
SEG_CHARS = 2200      # 每段目标字数
MIN_CHARS = 1200      # 低于此长度的段丢弃


def clean_md(text: str) -> str:
    """去掉 markdown 标记与乱码，只留中文正文与中文标点。"""
    import html as _html
    text = _html.unescape(text)                          # &nbsp; &amp; 等实体
    text = re.sub(r'```[\s\S]*?```', ' ', text)          # 代码块
    text = re.sub(r'!?\[([^\]]*)\]\([^)]*\)', r'\1', text)  # 链接/图片
    text = re.sub(r'^#{1,6}\s*.*$', ' ', text, flags=re.M)  # 标题行
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.M)    # 列表符
    text = re.sub(r'[*_`>]', '', text)                      # 强调/引用符
    # 只保留：汉字 / CJK标点 / 全角字符 / 通用标点(— … “ ”) / 换行
    text = re.sub(r'[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2000-\u206f\n]', '', text)
    text = re.sub(r'[ \t\u00a0]+', '', text)                # 行内空白
    return text


def han_len(s: str) -> int:
    return len(re.findall(r'[\u4e00-\u9fff]', s))


def main():
    os.makedirs(OUT, exist_ok=True)
    z = zipfile.ZipFile(ZIP)
    chs = sorted(n for n in z.namelist() if re.search(r'/ch/\d+\.md$', n))
    print(f'章节文件 {len(chs)} 个')

    # 汇总全部正文
    buf = []
    for n in chs:
        raw = z.read(n).decode('utf-8', errors='ignore')
        buf.append(clean_md(raw))
    full = '\n'.join(buf)

    # 按段落聚合切分
    paras = [p.strip() for p in full.split('\n') if han_len(p.strip()) >= 4]
    segs, cur, cur_n = [], [], 0
    for p in paras:
        cur.append(p)
        cur_n += han_len(p)
        if cur_n >= SEG_CHARS:
            segs.append('\n'.join(cur))
            cur, cur_n = [], 0
    if cur_n >= MIN_CHARS:
        segs.append('\n'.join(cur))

    segs = [s for s in segs if han_len(s) >= MIN_CHARS]
    print(f'切成样本 {len(segs)} 个')

    for i, s in enumerate(segs):
        p = os.path.join(OUT, f'hongloumeng_{i:03d}.txt')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(s)

    total = sum(han_len(s) for s in segs)
    print(f'写入 {OUT}：{len(segs)} 个样本，共 {total} 汉字，'
          f'平均 {total // max(1, len(segs))} 字/样本')


if __name__ == '__main__':
    main()
