#!/usr/bin/env python3
"""
Localizable.xcstrings 格式压缩脚本

将 xcstrings 文件中的语言条目从多行格式压缩为更紧凑的单行格式，
提高可读性并减小文件体积。

使用方法:
    python3 .cursor/rules/compact_xcstrings.py
    # 或
    ./.cursor/rules/compact_xcstrings.py

压缩前:
    "nl": {
      "stringUnit": {
        "state": "translated",
        "value": "..."
      }
    }

压缩后:
    "nl": { "stringUnit" : { "state" : "translated", "value" : "..." } }
"""

import json
import re
import sys
from pathlib import Path


def compact_xcstrings(file_path: str) -> bool:
    """
    压缩 xcstrings 文件，将 stringUnit 条目压缩为单行。
    
    参数:
        file_path: xcstrings 文件路径
        
    返回:
        成功返回 True，失败返回 False
    """
    try:
        # 读取并解析 JSON
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 处理前验证 JSON 格式
        data = json.loads(content)
        
        # 第一步：使用标准 2 空格缩进导出
        output = json.dumps(data, ensure_ascii=False, indent=2)
        
        # 第二步：将 stringUnit 块压缩为单行
        # 匹配模式: "stringUnit" : {\n..."state" : "...",\n..."value" : "..."\n...}
        string_unit_pattern = r'"stringUnit"\s*:\s*\{\s*\n\s*"state"\s*:\s*"([^"]+)",\s*\n\s*"value"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\n\s*\}'
        
        def string_unit_replacer(match):
            state = match.group(1)
            value = match.group(2)
            return f'"stringUnit" : {{ "state" : "{state}", "value" : "{value}" }}'
        
        output = re.sub(string_unit_pattern, string_unit_replacer, output)
        
        # 第三步：将语言条目压缩为单行
        # 匹配模式: "langCode": {\n..."stringUnit" : { ... }\n...}
        lang_pattern = r'"([a-z]{2}(?:-[A-Za-z]+)?)": \{\s*\n\s*("stringUnit" : \{ "state" : "[^"]+", "value" : "[^"\\]*(?:\\.[^"\\]*)*" \})\s*\n\s*\}'
        
        def lang_replacer(match):
            lang = match.group(1)
            string_unit = match.group(2)
            return f'"{lang}": {{ {string_unit} }}'
        
        output = re.sub(lang_pattern, lang_replacer, output)
        
        # 写回文件
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(output)
        
        # 处理后验证 JSON 格式
        with open(file_path, 'r', encoding='utf-8') as f:
            json.load(f)
        
        return True
        
    except json.JSONDecodeError as e:
        print(f"错误: JSON 格式无效 - {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        return False


def main():
    # 脚本位置的相对路径（.cursor/rules -> 项目根目录）
    script_dir = Path(__file__).parent.parent.parent
    default_path = script_dir / "Resource" / "Localizable.xcstrings"
    
    # 支持命令行参数指定自定义路径
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        file_path = str(default_path)
    
    if not Path(file_path).exists():
        print(f"错误: 文件不存在: {file_path}", file=sys.stderr)
        sys.exit(1)
    
    print(f"正在压缩: {file_path}")
    
    if compact_xcstrings(file_path):
        print("✅ 完成 - xcstrings 文件压缩成功")
        print("   - stringUnit 块已压缩为单行")
        print("   - 语言条目已压缩为单行")
        print("   - JSON 格式验证通过")
    else:
        print("❌ xcstrings 文件压缩失败", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

