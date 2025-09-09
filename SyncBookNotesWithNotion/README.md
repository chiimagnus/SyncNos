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