# 界面设计方向

## Hallmark 记录

- 版本：Hallmark v2.0.0
- 深度：redesign full
- 范围：app screen
- 页面：/、/network、/setup、/stories/[id]
- Genre：modern-minimal
- Theme：Cobalt，dealt 3/3
- 签名物件：信号账本，评分与来源健康沿同一张纸面展开

## 保留

- 所有既有事实和示例内容。
- 14 个链接、5 个表单字段、7 个处理器。
- 设置页的 API、凭据库、每日任务和首次运行流程。
- 来源健康、示例数据标记、关系图和故事详情。
- 原有路由和 API 接线。

## 系统

### 颜色

采用 Cobalt 的 OKLCH token：

- paper：冷白纸面
- paper-2 / paper-3：浅一层的分区
- ink / ink-2 / muted：蓝灰阅读层级
- accent：单一钴蓝信号
- graphite：深色代码和系统值

所有颜色集中在 app/tokens.css；页面组件不再使用散落的十六进制色值。

### 字体

- 标题：Familjen Grotesk 500/600
- 正文：IBM Plex Sans 400/500
- 数值与时间：JetBrains Mono 400/500

中文字体回退到 PingFang SC 和 Microsoft YaHei。

### 布局

首页是信号账本加右侧关系/来源栏，不再使用三张同构卡片。

信息网络是左侧画布、右侧事件列表；设置页是一张表单纸面和一块状态栏；详情页是正文加窄侧栏。所有页面共享顶部栏、容器宽度和间距尺度。

控件采用 app 密度：40px 高，移动端 44px 命中区。主操作只有一个钴蓝键帽。

## 状态

- 空状态：明确说明未生成数据，并给出设置入口。
- 错误状态：API、来源和运行错误显示在对应字段或状态栏，不生成占位摘要。
- 加载状态：设置页保存和运行按钮有禁用/处理中状态，运行状态自动刷新。
- 示例状态：页面顶部明确标记开发用示例数据。

## 验证

    before: 100 FAIL, 7 REFLEX
    after:  0 FAIL, 0 REFLEX, 0 WARN
    kept:   14/14 links, 5/5 fields, 7/7 handlers, 12/12 headings, 7/7 figures
    build:  pass
    lint:   pass

前后对比：

    web/.hallmark/compare.html

## 值得保留的东西

账本的行距、数值的等宽字体、来源状态的纸面色阶和关系图的低饱和蓝灰，是这次界面最值得保留的部分。后续增加蜘蛛动画时，不应把页面重新变成霓虹仪表盘；蜘蛛应活动在图谱和账本之间的空白处，保持 Cobalt 的克制。
