# GoodLinks Detail 手动下载 + 插队到自动下载队列（实施计划）
有一个问题，那就是我们不应该在进入一个detialview时触发自动下载，应该做成一个下载的按钮，用户点击之后才会开始下载，这个下载的就会插队到自动下载队列的最前面。

另外还有一个问题，那就是切换到另一个goodlinks item之后，刚才前一个item正在下载文章的进程就会被打断了：[ERROR] GoodLinksDetailViewModel.swift:334 - [GoodLinksDetail] loadContent error: The operation couldn’t be completed. (Swift.CancellationError error 1.)

请你一一查看所有相关和可能相关的代码，然后再开始解决这2个问题。