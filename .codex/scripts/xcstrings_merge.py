#!/usr/bin/env python3
"""
xcstrings 合并脚本

将多个 *.xcstrings 合并成一个文件（默认输出到 Resource/Localizable.xcstrings）。

推荐用途：配合 xcstrings_split.py，把多个小文件合并回单一 Localizable 表，
从而避免改动大量 Swift 的 `String(localized:)` 调用。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


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


def _merge_strings(
    merged_strings: dict,
    incoming_strings: dict,
    *,
    on_duplicate: str,
    source_name: str,
) -> None:
    for key, value in incoming_strings.items():
        if key not in merged_strings:
            merged_strings[key] = value
            continue

        if on_duplicate == "keep-first":
            continue
        if on_duplicate == "keep-last":
            merged_strings[key] = value
            continue
        if on_duplicate == "verify-equal":
            if merged_strings[key] != value:
                raise ValueError(f"重复 key 且内容不同: {key}（来自 {source_name}）")
            continue

        raise ValueError(f"重复 key: {key}（来自 {source_name}）")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]

    parser = argparse.ArgumentParser(description="Merge multiple .xcstrings into one.")
    parser.add_argument(
        "--in-dir",
        default=str(repo_root / ".codex" / "i18n" / "xcstrings_parts"),
        help="输入目录（默认 .codex/i18n/xcstrings_parts）",
    )
    parser.add_argument(
        "--glob",
        default="*.xcstrings",
        help="匹配模式（默认 '*.xcstrings'）",
    )
    parser.add_argument(
        "--out",
        default=str(repo_root / "Resource" / "Localizable.xcstrings"),
        help="输出路径（默认 Resource/Localizable.xcstrings）",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="输出时执行 compact（减少 diff 噪音）",
    )
    parser.add_argument(
        "--on-duplicate",
        choices=["error", "keep-first", "keep-last", "verify-equal"],
        default="verify-equal",
        help="遇到重复 key 时的策略（默认 verify-equal）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅检查/统计，不写输出文件",
    )

    args = parser.parse_args()

    in_dir = Path(args.in_dir)
    if not in_dir.exists():
        print(f"错误: 输入目录不存在: {in_dir}", file=sys.stderr)
        sys.exit(1)

    sources = sorted(in_dir.glob(args.glob))
    sources = [p for p in sources if p.is_file()]
    if not sources:
        print(f"错误: 未找到任何匹配文件: {in_dir}/{args.glob}", file=sys.stderr)
        sys.exit(1)

    base_data = _load_xcstrings(sources[0])
    merged: dict = {k: v for k, v in base_data.items() if k != "strings"}
    merged_strings: dict = {}

    for source in sources:
        data = _load_xcstrings(source)

        # 简单校验：sourceLanguage/version 不一致时提醒并报错（避免隐式合并错）
        for meta_key in ("sourceLanguage", "version"):
            if meta_key in merged and meta_key in data and merged[meta_key] != data[meta_key]:
                raise ValueError(
                    f"元数据不一致: {meta_key}（{sources[0].name}={merged[meta_key]!r}, {source.name}={data[meta_key]!r}）"
                )

        on_duplicate = "error" if args.on_duplicate == "error" else args.on_duplicate
        _merge_strings(merged_strings, data["strings"], on_duplicate=on_duplicate, source_name=source.name)

    merged["strings"] = merged_strings

    print(f"输入: {len(sources)} 个文件，共合并 {len(merged_strings)} 条")
    print(f"输出: {args.out}")

    if args.dry_run:
        return

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _write_xcstrings(out_path, merged, compact=args.compact)
    print("✅ 合并完成")


if __name__ == "__main__":
    main()
