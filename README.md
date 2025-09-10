# SyncBookNotes
我想做个Apple books高亮笔记、注释的导出app，或者做成命令行：）需要保存到notion中的。最好是同步。

因为我发现obsidian 中的Apple Books笔记同步功能很糟糕：）

难点：接下来要解决的问题是，获取到Apple 图书app的数据。

参考：https://github.com/atfzl/obsidian-apple-books-plugin?tab=readme-ov-file


我现在想做： @README.md 
然后目前的计划是@TODO.md 

book note的数据解析可以参考 @obsidian-apple-books-plugin/ 项目中的@main.ts 来实现。

我们要做的事情分以下几个步骤：
1、实现解析Apple book note数据
2、导出笔记为json、markdown文件。
3、集成notion app，同步数据到notion。

## Apple Books URL Scheme
Apple Books支持以下URL scheme用于深度链接：

- 打开指定书籍：`ibooks://assetid/{bookAssetId}`
- 打开指定书籍的高亮笔记位置：`ibooks://assetid/{bookAssetId}#{epubCFI}`

其中：
- `{bookAssetId}` 是书籍的唯一标识符
- `{epubCFI}` 是EPUB Canonical Fragment Identifier，用于精确定位书籍中的位置，比如：`ibooks://assetid/6DD1DDFBA85918A22B61BD5884B3856F#epubcfi(/6/12[Chapter_0002.xhtml]!/4,/6/1:0,/12/1:0)`

