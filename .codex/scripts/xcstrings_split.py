#!/usr/bin/env python3
"""
xcstrings 拆分脚本

目标：把一个很大的 *.xcstrings 拆分为多个小文件，便于管理；
然后可用 xcstrings_merge.py 再合并回单一的 Resource/Localizable.xcstrings，
从而避免改动大量 Swift 的 `String(localized:)` 调用（仍使用默认 Localizable 表）。

默认拆分策略：按 key 的第一个分段（例如 `settings.saved` -> `settings` 组）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path


def _safe_filename_segment(value: str) -> str:
    value = value.strip()
    if not value:
        return "_Misc"
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    return value[:120] if len(value) > 120 else value


def _load_xcstrings(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "strings" not in data or not isinstance(data["strings"], dict):
        raise ValueError("不是有效的 .xcstrings JSON（缺少顶层 strings 字典）")
    return data


def _write_xcstrings(path: Path, data: dict, *, compact: bool) -> None:
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if compact:
        import compact_xcstrings

        text = compact_xcstrings._compact_xcstrings_text(data)
    path.write_text(text, encoding="utf-8")


def _group_key_first_segment(key: str, separator: str) -> str:
    if not separator:
        return "_All"
    if separator in key:
        return key.split(separator, 1)[0]
    return "_Misc"


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]

    parser = argparse.ArgumentParser(description="Split a large .xcstrings into smaller parts.")
    parser.add_argument(
        "input",
        nargs="?",
        default=str(repo_root / "Resource" / "Localizable.xcstrings"),
        help="输入 xcstrings 路径（默认 Resource/Localizable.xcstrings）",
    )
    parser.add_argument(
        "--out-dir",
        default=str(repo_root / ".codex" / "i18n" / "xcstrings_parts"),
        help="输出目录（默认 .codex/i18n/xcstrings_parts）",
    )
    parser.add_argument(
        "--separator",
        default=".",
        help="按 key 的第一个分段拆分，使用的分隔符（默认 '.'）",
    )
    parser.add_argument(
        "--file-prefix",
        default="Localizable.",
        help="输出文件名前缀（默认 'Localizable.'）",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="输出时执行 compact（减少 diff 噪音）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印分组统计，不写文件",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    if not input_path.exists():
        print(f"错误: 输入文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)

    data = _load_xcstrings(input_path)
    strings: dict = data["strings"]

    groups: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for key, payload in strings.items():
        group = _group_key_first_segment(str(key), args.separator)
        groups[group].append((key, payload))

    stats = sorted(((name, len(items)) for name, items in groups.items()), key=lambda x: (-x[1], x[0]))
    total = sum(count for _, count in stats)
    print(f"输入: {input_path}（共 {total} 条）")
    print("分组统计（按条数降序）:")
    for name, count in stats[:50]:
        print(f"  - {name}: {count}")
    if len(stats) > 50:
        print(f"  ... 还有 {len(stats) - 50} 个分组未展示")

    if args.dry_run:
        return

    out_dir.mkdir(parents=True, exist_ok=True)

    # 生成每个分组的独立文件（保留原始顶层字段，仅替换 strings）
    top_level = {k: v for k, v in data.items() if k != "strings"}
    manifest: dict[str, dict] = {"input": str(input_path), "separator": args.separator, "groups": {}}

    for group_name, items in sorted(groups.items(), key=lambda x: x[0].lower()):
        safe_group = _safe_filename_segment(group_name)
        out_path = out_dir / f"{args.file_prefix}{safe_group}.xcstrings"

        group_data = dict(top_level)
        group_data["strings"] = {k: v for k, v in items}

        _write_xcstrings(out_path, group_data, compact=args.compact)
        manifest["groups"][out_path.name] = {"count": len(items), "group": group_name}

    (out_dir / "xcstrings_parts.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"✅ 已输出到: {out_dir}")


if __name__ == "__main__":
    main()
