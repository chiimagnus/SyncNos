#!/usr/bin/env python3
"""
将 Resource/Localizable.xcstrings 全量拆分为多个 *.xcstrings（按模块 table），并更新 Swift 调用点补齐 table/tableName。

设计目标：
- 基于“实际 Swift 源码引用位置”给每个 key 归属 table（WeRead/Dedao/Notion/...）
- key 在多个模块引用时归入 Common
- 未在 Swift 中找到引用的 key 归入 Legacy
- 生成 Resource/<Table>.xcstrings，并将 Resource/Localizable.xcstrings 置空（保留文件本身）
- 批量把常见 SwiftUI/Foundation 调用点改成显式 table：
  - NSLocalizedString("k", comment: "c") -> NSLocalizedString("k", tableName:"T", bundle:.main, value:"", comment:"c")
  - String(localized: "k" ...) -> String(localized: "k", table: "T", ...)
  - Text("k") / Button("k") / Label("k", ...) / .help("k") / .navigationTitle("k") 等 -> String(localized:..., table:...)

用法：
    # 预览（不改文件）
    python3 .codex/skills/syncnos-i18n/scripts/split_xcstrings_tables.py

    # 真正执行
    python3 .codex/skills/syncnos-i18n/scripts/split_xcstrings_tables.py --apply
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class Match:
    kind: str
    key_literal: str
    key_value: str


TABLE_PRIORITY = [
    "WeRead",
    "Dedao",
    "GoodLinks",
    "AppleBooks",
    "Chats",
    "OCR",
    "Notion",
    "Account",
    "Settings",
]


def _find_repo_root(start: Path) -> Path:
    for parent in [start] + list(start.parents):
        if (parent / "SyncNos.xcodeproj").exists() and (parent / "SyncNos").exists():
            return parent
    return start


def table_for_path(path: Path) -> str:
    s = str(path)
    if "/WeRead/" in s:
        return "WeRead"
    if "/Dedao/" in s:
        return "Dedao"
    if "/GoodLinks/" in s:
        return "GoodLinks"
    if "/AppleBooks/" in s:
        return "AppleBooks"
    if "/Chats/" in s:
        return "Chats"
    if "/OCR/" in s:
        return "OCR"
    if "/Notion/" in s:
        return "Notion"
    if "/Account/" in s or "/IAP" in s:
        return "Account"
    if "/Views/Settings/" in s or "/Settings/" in s:
        return "Settings"
    return "Common"


def unescape_swift_string_literal(s: str) -> str:
    """
    仅用于把源码中的字符串字面量内容解码为真实 key（用于与 xcstrings key 匹配）。
    覆盖常见转义：\\n \\t \\\\ \\\" \\r，以及 Swift 的 \\u{...}。
    """
    def replace_unicode(match: re.Match[str]) -> str:
        hex_value = match.group(1)
        try:
            return chr(int(hex_value, 16))
        except Exception:
            return match.group(0)

    s = re.sub(r"\\u\{([0-9a-fA-F]+)\}", replace_unicode, s)
    s = s.replace(r"\\", "\\")
    s = s.replace(r"\"", "\"")
    s = s.replace(r"\n", "\n")
    s = s.replace(r"\t", "\t")
    s = s.replace(r"\r", "\r")
    return s


def iter_swift_files(syncnos_dir: Path) -> Iterable[Path]:
    yield from sorted(syncnos_dir.rglob("*.swift"))


def find_key_matches_in_swift(text: str) -> list[Match]:
    matches: list[Match] = []

    # NSLocalizedString("key", comment: "...")
    for m in re.finditer(
        r'NSLocalizedString\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,\s*comment\s*:\s*"(?P<c>(?:[^"\\]|\\.)*)"\s*\)',
        text,
        re.MULTILINE,
    ):
        lit = m.group("k")
        matches.append(Match(kind="NSLocalizedString", key_literal=lit, key_value=unescape_swift_string_literal(lit)))

    # String(localized: "key" ... ) - 仅抓第一个参数是字符串字面量的情况
    for m in re.finditer(
        r'String\s*\(\s*localized\s*:\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>[^)]*)\)',
        text,
        re.MULTILINE,
    ):
        lit = m.group("k")
        matches.append(Match(kind="StringLocalized", key_literal=lit, key_value=unescape_swift_string_literal(lit)))

    # SwiftUI 常见：Text/Button/Label("key" ...)
    for kind, pattern in [
        ("Text", r'Text\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)'),
        ("Button", r'Button\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>,[^)]*)?\)'),
        ("Label", r'Label\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>,[^)]*)?\)'),
    ]:
        for m in re.finditer(pattern, text, re.MULTILINE):
            lit = m.group("k")
            matches.append(Match(kind=kind, key_literal=lit, key_value=unescape_swift_string_literal(lit)))

    # 常见 modifier：.help("key") / .navigationTitle("key") / .alert("key"...)
    for kind, pattern in [
        ("help", r'\.help\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)'),
        ("navigationTitle", r'\.navigationTitle\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)'),
        ("alert", r'\.alert\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,'),
        ("confirmationDialog", r'\.confirmationDialog\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,'),
    ]:
        for m in re.finditer(pattern, text, re.MULTILINE):
            lit = m.group("k")
            matches.append(Match(kind=kind, key_literal=lit, key_value=unescape_swift_string_literal(lit)))

    return matches


def choose_table(tables: set[str]) -> str:
    if not tables:
        return "Legacy"
    if len(tables) == 1:
        return next(iter(tables))
    for candidate in TABLE_PRIORITY:
        if tables == {candidate, "Common"}:
            return candidate
    return "Common"


def split_xcstrings(localizable: dict, key_to_table: dict[str, str]) -> dict[str, dict]:
    by_table: dict[str, dict] = defaultdict(dict)
    strings = localizable.get("strings", {})
    for key, value in strings.items():
        table = key_to_table.get(key, "Legacy")
        by_table[table][key] = value

    base_payload = {k: v for k, v in localizable.items() if k != "strings"}
    base_payload.setdefault("sourceLanguage", "en")
    base_payload.setdefault("version", "1.1")

    return {table: {**base_payload, "strings": table_strings} for table, table_strings in by_table.items()}


def dumps_json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, separators=(",", " : ")) + "\n"


def update_swift_sources(
    file_path: Path,
    text: str,
    key_to_table: dict[str, str],
) -> tuple[str, int]:
    edits = 0

    def table_for_key_literal(lit: str) -> str | None:
        key = unescape_swift_string_literal(lit)
        return key_to_table.get(key)

    # NSLocalizedString("k", comment:"c") -> 带 tableName/bundle/value
    def repl_nslocalizedstring(m: re.Match[str]) -> str:
        nonlocal edits
        key_lit = m.group("k")
        comment_lit = m.group("c")
        table = table_for_key_literal(key_lit)
        if not table:
            return m.group(0)
        replacement = (
            f'NSLocalizedString("{key_lit}", tableName: "{table}", bundle: .main, value: "", comment: "{comment_lit}")'
        )
        edits += 1
        return replacement

    text = re.sub(
        r'NSLocalizedString\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,\s*comment\s*:\s*"(?P<c>(?:[^"\\]|\\.)*)"\s*\)',
        repl_nslocalizedstring,
        text,
        flags=re.MULTILINE,
    )

    # String(localized: "k", comment: "...") / String(localized: "k")
    def repl_string_localized(m: re.Match[str]) -> str:
        nonlocal edits
        key_lit = m.group("k")
        rest = m.group("rest") or ""
        if "table:" in rest:
            return m.group(0)
        table = table_for_key_literal(key_lit)
        if not table:
            return m.group(0)
        if "comment:" in rest:
            new_rest = re.sub(r"\bcomment\s*:", f'table: "{table}", comment:', rest, count=1)
            edits += 1
            return f'String(localized: "{key_lit}"{new_rest})'
        edits += 1
        return f'String(localized: "{key_lit}", table: "{table}"{rest})'

    text = re.sub(
        r'String\s*\(\s*localized\s*:\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>[^)]*)\)',
        repl_string_localized,
        text,
        flags=re.MULTILINE,
    )

    # Text("k") -> Text(String(localized: "k", table: "T"))
    def repl_text(m: re.Match[str]) -> str:
        nonlocal edits
        key_lit = m.group("k")
        table = table_for_key_literal(key_lit)
        if not table:
            return m.group(0)
        edits += 1
        return f'Text(String(localized: "{key_lit}", table: "{table}"))'

    text = re.sub(
        r'Text\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)',
        repl_text,
        text,
        flags=re.MULTILINE,
    )

    # Button("k", ...) -> Button(String(localized:"k", table:"T"), ...)
    def repl_button(m: re.Match[str]) -> str:
        nonlocal edits
        key_lit = m.group("k")
        rest = m.group("rest") or ""
        table = table_for_key_literal(key_lit)
        if not table:
            return m.group(0)
        edits += 1
        return f'Button(String(localized: "{key_lit}", table: "{table}"){rest})'

    text = re.sub(
        r'Button\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>,[^)]*)?\)',
        repl_button,
        text,
        flags=re.MULTILINE,
    )

    # Label("k", ...) -> Label(String(localized:"k", table:"T"), ...)
    def repl_label(m: re.Match[str]) -> str:
        nonlocal edits
        key_lit = m.group("k")
        rest = m.group("rest") or ""
        table = table_for_key_literal(key_lit)
        if not table:
            return m.group(0)
        edits += 1
        return f'Label(String(localized: "{key_lit}", table: "{table}"){rest})'

    text = re.sub(
        r'Label\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*(?P<rest>,[^)]*)?\)',
        repl_label,
        text,
        flags=re.MULTILINE,
    )

    # .help("k") / .navigationTitle("k") -> String(localized:..., table:...)
    def repl_modifier(kind: str, pattern: str) -> None:
        nonlocal text, edits

        def repl(m: re.Match[str]) -> str:
            nonlocal edits
            key_lit = m.group("k")
            table = table_for_key_literal(key_lit)
            if not table:
                return m.group(0)
            edits += 1
            return f'.{kind}(String(localized: "{key_lit}", table: "{table}"))'

        text = re.sub(pattern, repl, text, flags=re.MULTILINE)

    repl_modifier("help", r'\.help\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)')
    repl_modifier("navigationTitle", r'\.navigationTitle\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*\)')

    # .alert("k", ...) / .confirmationDialog("k", ...)：只替换首参
    def repl_first_arg(kind: str, pattern: str) -> None:
        nonlocal text, edits

        def repl(m: re.Match[str]) -> str:
            nonlocal edits
            key_lit = m.group("k")
            table = table_for_key_literal(key_lit)
            if not table:
                return m.group(0)
            edits += 1
            return f'.{kind}(String(localized: "{key_lit}", table: "{table}"),'

        text = re.sub(pattern, repl, text, flags=re.MULTILINE)

    repl_first_arg("alert", r'\.alert\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,')
    repl_first_arg("confirmationDialog", r'\.confirmationDialog\(\s*"(?P<k>(?:[^"\\]|\\.)*)"\s*,')

    return text, edits


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="写入 xcstrings 与 Swift 文件")
    args = parser.parse_args()

    repo_root = _find_repo_root(Path(__file__).resolve())
    resource_dir = repo_root / "Resource"
    syncnos_dir = repo_root / "SyncNos"
    localizable_path = resource_dir / "Localizable.xcstrings"

    localizable = json.loads(localizable_path.read_text(encoding="utf-8"))
    all_keys: set[str] = set(localizable.get("strings", {}).keys())

    used_tables: dict[str, set[str]] = defaultdict(set)
    for swift_file in iter_swift_files(syncnos_dir):
        file_table = table_for_path(swift_file)
        text = swift_file.read_text(encoding="utf-8")
        for match in find_key_matches_in_swift(text):
            if match.key_value in all_keys:
                used_tables[match.key_value].add(file_table)

    key_to_table: dict[str, str] = {}
    for key in all_keys:
        table = choose_table(used_tables.get(key, set()))
        key_to_table[key] = table

    split = split_xcstrings(localizable, key_to_table)
    tables = sorted(split.keys(), key=lambda t: (t not in TABLE_PRIORITY, t))
    print("Tables:", ", ".join(tables))
    for t in tables:
        print(f"- {t}: {len(split[t]['strings'])} keys")

    # Swift 替换预估
    estimated_edits = 0
    for swift_file in iter_swift_files(syncnos_dir):
        original = swift_file.read_text(encoding="utf-8")
        updated, edits = update_swift_sources(swift_file, original, key_to_table)
        if edits and original != updated:
            estimated_edits += edits
    print(f"Estimated Swift edits: {estimated_edits}")

    if not args.apply:
        print("Dry-run only (use --apply to write changes).")
        return 0

    # 写入拆分后的 xcstrings（覆盖/新建）
    for table, payload in split.items():
        out_path = resource_dir / f"{table}.xcstrings"
        out_path.write_text(dumps_json(payload), encoding="utf-8")

    # 置空 Localizable.xcstrings（保留文件）
    empty_localizable = {k: v for k, v in localizable.items() if k != "strings"}
    empty_localizable.setdefault("sourceLanguage", "en")
    empty_localizable.setdefault("version", "1.1")
    empty_localizable["strings"] = {}
    localizable_path.write_text(dumps_json(empty_localizable), encoding="utf-8")

    # 更新 Swift 源码
    total_edits = 0
    for swift_file in iter_swift_files(syncnos_dir):
        original = swift_file.read_text(encoding="utf-8")
        updated, edits = update_swift_sources(swift_file, original, key_to_table)
        if edits and original != updated:
            swift_file.write_text(updated, encoding="utf-8")
            total_edits += edits

    print(f"Applied Swift edits: {total_edits}")

    # JSON 校验
    for xc in sorted(resource_dir.glob("*.xcstrings")):
        try:
            json.loads(xc.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"❌ JSON invalid: {xc} - {exc}", file=sys.stderr)
            return 1
    print("✅ All xcstrings JSON valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
