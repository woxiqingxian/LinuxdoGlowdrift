# Linuxdo流光漫游 (Glowdrift)

一个用于 `linux.do` 的 Tampermonkey 浏览增强脚本。  

<img src="img/main.jpg" alt="整体页面效果" width="960">

<img src="img/over.jpg" alt="话题预览效果" width="720">

## 功能特性

- 默认人类自动浏览：按 scan/read/pause 节奏滚动与停顿，减少机械感，模拟更自然的浏览过程。
- 漫游超时自动关闭：单标签页内从启动开始累计运行满 1.5 小时后自动关闭，避免忘记停止。
- 漫游时长大字提醒：页面中间实时显示三行累计时长（历史/今天/本次），均为 `XX:XX:XX` 两位格式。
- 主页筛选工具：在首页按等级、分类筛选帖子，并支持保存/加载筛选预设；筛选结果过少时会自动补载更多帖子。
- 话题预览：点击话题默认弹出预览层，右侧按钮用于在新标签页打开当前话题，预览内可直接点赞、回复，以及一键参与抽奖文案回复。
- 福利羊毛快捷参与：在话题列表里，`福利羊毛` 分类的话题会在 `新开` 右侧额外显示 `参与抽奖` 按钮，点击后会直接随机发布一条参与文案。
- 抽奖参与本地记忆：一旦通过脚本的 `参与抽奖` 按钮发布成功，会按 `topicId` 记到本地存储；同一话题后续会直接显示 `已参与`。
- 已读置灰：查看过的话题会在列表里自动置灰，方便区分哪些已经读过。
- 默认切换 Horizon：进入站点时会自动将主题切换到 `Horizon`，作为后续配色注入的基础主题。
- Horizon 浅白灰配色：选中 `Horizon` 主题后，额外提供一套接近白色、仅带轻微灰度的自定义配色。
- 第三方按钮隐藏：自动隐藏其他插件注入的 `免打扰` 按钮（`.donottopic-btn`）。
- 侧边栏滚动条隐藏：左侧侧边栏仍可滚动，但不再显示滚动条。

## 文件结构

- `runscript.js`: 主脚本（Tampermonkey UserScript）

## 文档维护约定

- 脚本顶部注释不再维护详细说明，统一以 `README.md` 为准
- 功能、存储、版本规则、开发导航等变更只需要更新本 README
- 交流语言统一为中文，提交信息与代码注释也保持中文一致

## 开发者代码导航

### 顶层结构总览

- `常量定义`：集中放默认配置、滚动节奏、存储键、主题配置、筛选配置、预览配置
- `配置管理`：集中放基础配置读取、访问记录、抽奖参与记录、行为节奏计算
- `开关状态管理`：集中放漫游开关、筛选开关、累计时长、自动关闭相关状态
- `UI 组件创建`：集中放顶部双开关、运行光圈、时长提醒等站点外层 UI
- `DOM 工具函数`：集中放元素等待、主题读取、早期配色注入等通用 DOM 能力
- `主页筛选工具`：`HomeSieveModule`
- `话题预览`：`TopicPreviewModule`
- `Horizon 配色注入`：`HorizonPaletteModule`
- `侧边栏话题入口`：`SidebarTopicsLinkModule`
- `核心功能`：模块实例、模块初始化入口、漫游主流程
- `主程序入口`：`main()`、`pagehide` 结算、`load` 绑定

### 核心模块导航

- `HomeSieveModule`
  - 生命周期：`init()`、`destroy()`、`startLoop()`、`tick()`、`onRouteChange()`
  - 面板与交互：`ensureStyles()`、`createPanel()`、`bindEvents()`、`updateButtonStates()`
  - 筛选与补载：`filterTopics()`、`shouldTryRefill()`、`tryRefillVisibleTopics()`
  - 存储：`readStoredState()`、`savePreset()`、`loadPreset()`、`deletePreset()`
- `TopicPreviewModule`
  - 生命周期：`init()`、`destroy()`、`startLoop()`、`tick()`
  - 列表入口：`ensurePreviewButtons()`、`applyVisitedTopicState()`、`handleDocumentClick()`
  - 预览加载：`openPreview()`、`renderPreview()`、`renderError()`、`maybeLoadMorePreviewPosts()`
  - 图片查看器：`openImageViewer()`、`syncImageViewerTransform()`、`handleImageViewerWheel()`
  - 回复与点赞：`togglePreviewReplyComposer()`、`togglePreviewPostLike()`、`submitPreviewReply()`
- `HorizonPaletteModule`
  - 入口：`init()`、`tick()`
  - 配色注入：`ensureStyles()`、`ensureInjectedPaletteItem()`、`applyPaletteClass()`
- `SidebarTopicsLinkModule`
  - 入口：`init()`、`tick()`
  - 侧边栏改写：`ensureTopicsLink()`、`handleTopicsLinkClick()`、`updateTopicsLinkState()`

### 关键入口函数

- 开关入口：`toggleSwitch()`、`toggleSieveSwitch()`
- 顶部按钮入口：`createSwitchButton()`、`createSieveSwitchButton()`、`createSwitchIcon()`、`createSieveSwitchIcon()`
- 模块入口：`applySieveToolState()`、`initHomeSieveTool()`、`initTopicPreviewTool()`、`initHorizonPaletteTool()`、`initSidebarTopicsLinkTool()`
- 漫游主流程：`loadPage()`、`stopScrolling()`、`scrollComment()`、`startAutoScroll()`、`main()`

### 常量组导航

- 漫游节奏：`DEFAULT_CONFIG`、`SPEED_ENGINE_CONFIG`、`HUMAN_BEHAVIOR_CONFIG`
- 站点与存储：`SELECTORS`、`STORAGE_KEYS`、`SESSION_KEYS`、`URLS`
- UI 标识：`UI_IDS`、`SIEVE_UI_IDS`、`UI_THEME`
- 主题配色：`HORIZON_THEME_CONFIG`
- 话题预览：`TOPIC_PREVIEW_CONFIG`、`TOPIC_PREVIEW_IMAGE_VIEWER_CONFIG`、`POST_ACTION_TYPES`
- 筛选相关：`SIEVE_CONFIG`、`WELFARE_CATEGORY_CONFIG`

### 修改入口建议

- 调整自动漫游节奏：优先看 `SPEED_ENGINE_CONFIG`、`HUMAN_BEHAVIOR_CONFIG`、`getNextScrollTick()`
- 调整漫游累计与自动关闭：优先看 `MAX_ROAM_DURATION_MS`、`scheduleAutoStop()`、`syncRoamAccumulationCheckpoint()`
- 调整顶部按钮和运行状态 UI：优先看 `ensureToggleButtonStyle()`、`ensureRunningHalo()`、`ensureRoamDurationReminder()`
- 调整主页筛选逻辑：优先看 `HomeSieveModule.filterTopics()`、`HomeSieveModule.shouldTryRefill()`、`HomeSieveModule.tryRefillVisibleTopics()`
- 调整话题预览入口和点击行为：优先看 `TopicPreviewModule.ensurePreviewButtons()`、`TopicPreviewModule.handleDocumentClick()`
- 调整预览加载与滚动补载：优先看 `TopicPreviewModule.openPreview()`、`TopicPreviewModule.renderPreview()`、`TopicPreviewModule.maybeLoadMorePreviewPosts()`
- 调整预览图片交互：优先看 `TopicPreviewModule.openImageViewer()`、`TopicPreviewModule.syncImageViewerTransform()`、`TopicPreviewModule.handleImageViewerWheel()`
- 调整预览回复与点赞：优先看 `TopicPreviewModule.togglePreviewReplyComposer()`、`TopicPreviewModule.togglePreviewPostLike()`、`TopicPreviewModule.submitPreviewReply()`
- 调整 Horizon 配色：优先看 `HorizonPaletteModule.ensureInjectedPaletteItem()`、`getHorizonPaletteStyleText()`
- 调整侧边栏“话题/最新话题”改写：优先看 `SidebarTopicsLinkModule.ensureTopicsLink()`

## 开发维护规则

- 保持单文件，不拆出多文件，不引入构建工具
- 新增功能必须归入现有一级分区；只有职责明显独立时，才允许新增一级分区
- `HomeSieveModule`、`TopicPreviewModule` 这类大模块必须继续维持二级子区块，不允许把新逻辑零散插入任意位置
- 单个二级子区块接近或超过 `200-300` 行时，必须继续拆出新的子区块
- 模块内部顺序固定为：状态与配置、生命周期、样式与 DOM、事件绑定、渲染、数据读取与存储、行为逻辑、工具方法
- 模块样式统一收敛到各自的 `ensureStyles()`，不要把样式片段分散到其他方法
- 跨模块复用的纯函数优先放回全局工具区，不要在多个模块里复制
- 新增模块时，必须同步补上 README 的“顶层结构总览”和“核心模块导航”
- 重命名关键函数、关键常量、关键分区时，必须同步更新 README 导航
- 每次修改脚本都必须更新 `@version`；若改动影响功能、存储、导航或维护约定，README 也必须同步更新

## 安装方式

1. 安装浏览器扩展 `Violentmonkey`（暴力猴）
2. 新建脚本，并把 [`runscript.js`](./runscript.js) 的全部内容复制进去
3. 保存后打开 `https://linux.do/`
4. 脚本已写入自动更新地址，后续会从以下链接自动检查更新：
   `https://raw.githubusercontent.com/woxiqingxian/LinuxdoGlowdrift/main/runscript.js`
5. 点击顶部新增按钮进行控制：
   - 漫游开关（开始/暂停自动漫游）
   - 筛选开关（启用/停用主页筛选工具）

## 使用说明

- 建议开两个窗口：
  - 窗口 A：开启自动漫游
  - 窗口 B：保持手动浏览
- 因为开关状态使用 `sessionStorage`，每个标签页独立保存，不会互相串联
- 主页筛选工具仅在 `/, /latest, /top, /new` 路径显示
- 页面进入时若当前不是 `Horizon`，脚本会先自动切换到 `Horizon` 再继续后续功能
- 点击话题列表中的话题时，默认进入预览
- 话题列表里若当前行属于 `福利羊毛` 分类，`新开` 按钮右侧会额外出现 `参与抽奖`
- 话题右侧按钮用于在新标签页打开当前话题
- `Horizon` 主题下，右侧画笔按钮会打开站点原生配色菜单
- 脚本会在这个原生菜单里追加一个 `Beige` 配色项
- 点击 `Beige` 后启用接近白色、仅带轻微灰度的浅色覆盖
- 点击站点原生其他配色项后，会退出脚本注入的自定义浅白灰覆盖

## 顶部双开关说明

- 漫游开关（播放/暂停图标）：
  - 开启后自动进入漫游流程（滚动 + 链接跳转）
  - 开启后会记录本标签页启动时间，累计运行超过 1.5 小时自动关闭
  - 开启后页面中间显示大字提醒：
    - `历史累计漫游：XX:XX:XX`
    - `今天累计漫游：XX:XX:XX`
    - `本次累计漫游：XX:XX:XX`
  - 关闭后立即停止自动滚动
- 筛选开关（漏斗图标）：
  - 开启后在首页列表上方显示筛选面板
  - 关闭后隐藏筛选面板并恢复全部帖子显示

## 主页筛选工具说明

- 侧边栏入口：
  - 筛选面板最上方提供一个开关，用于决定是否将左侧“话题”改成“最新话题”
  - 开启后，原“话题”入口会直接指向 `"/new"`
  - 关闭后，原“话题”入口恢复指向 `"/latest"`
- 筛选维度：
  - 等级筛选：`公开(Lv0) / Lv1 / Lv2 / Lv3`
  - 分类筛选：按站点分类 ID 和父分类匹配
- 预设能力：
  - 支持按名称保存当前筛选条件
  - 支持点击快速加载预设
  - 支持删除不再需要的预设
- 状态更新：
  - 列表变化后会自动重新筛选
  - 筛选结果少于 15 条时，会优先复用 Discourse 原生入口自动补载更多帖子
  - 手动向下浏览时，若已经接近当前筛选结果底部，也会继续自动补载
  - 连续补载失败 3 次后，会停止继续尝试并提示暂无更多匹配项
  - 右上角状态文本会显示当前筛选结果数量，以及补载中或已熔断状态

## 话题预览说明

- 点击话题列表中的话题时，会直接打开预览层
- 通过脚本的 `参与抽奖` 成功后，会把当前 `topicId` 记到本地；列表按钮和预览底部按钮都会改为 `已参与`
- 右侧按钮会在新标签页打开当前话题
- 点击后会请求当前主题的 `/t/{id}.json`
- 预览层默认先加载前 `30` 楼，当已加载内容距离底部只剩约 `10` 楼时，会自动补取下一批内容
- 预览层内点击图片时，会直接弹出大图预览，不再在当前标签页跳转图片链接；查看器支持放大、缩小、重置，以及放大后的拖动查看
- 预览层内每一楼都带点赞按钮，已登录时可直接点赞或取消点赞
- 预览层底部单独提供 `回复话题` 按钮；`1 楼` 按钮文案也显示为 `回复话题`
- `2 楼` 及以后按钮文案显示为 `回复`，点击后会在当前卡片底部展开回复输入框和发布按钮
- 预览层底部仅在 `福利羊毛` 话题额外提供 `参与抽奖` 按钮，点击后会随机使用一条抽奖文案直接回复当前话题
- 预览层底部提供 `新标签查看话题` 按钮，样式与旁边按钮保持一致
- 当前随机文案默认使用长句，并过滤掉少于 `21` 字的候选；示例包括：`感谢佬友分享这波福利，认真参与一下，希望这次能有好运。 / 这波活动看起来很不错，前来支持参与，祝自己今天手气在线。 / 活动规则已经看完，现在正式留言参与，期待后面开奖有惊喜。`
- 回复输入框聚焦时，macOS 按 `Cmd+Enter`、Windows 和 Linux 按 `Ctrl+Enter` 可直接提交发布
- 通过预览打开、新标签页打开，或直接进入话题页后，列表中的对应标题会自动置灰
- 支持点击遮罩关闭，也支持按 `Esc` 关闭

## 存储设计

- `sessionStorage`
  - `linuxdoHelperEnabledInTab`: 当前标签页开关状态
  - `linuxdoHelperStartedAtInTab`: 当前标签页漫游启动时间戳（用于 1.5 小时超时自动关闭）
  - `linuxdoHelperAccountedAtInTab`: 当前标签页上次累计结算时间戳（用于持续累计）
  - `linuxdoSieveEnabledInTab`: 当前标签页筛选开关状态
- `localStorage`
  - `visitedLinks`: 已访问链接列表
- `GM_setValue / GM_getValue`
  - `linuxdoHelperBaseConfig`: 基础参数
  - `linuxdoRoamHistoryMs`: 历史累计漫游时长（毫秒）
  - `linuxdoRoamTodayStat`: 今日累计漫游信息（日期 + 毫秒）
  - `linuxdoSieveLevels`: 筛选等级选中项
  - `linuxdoSieveCats`: 筛选分类选中项
  - `linuxdoSievePresets`: 筛选预设
  - `linuxdoHorizonPalette`: Horizon 主题配色状态（`default / beige`）
  - `linuxdoParticipatedLotteryTopicIds`: 已通过脚本参与抽奖的话题 ID 列表

## 版本规则（强约定）

- 每次修改脚本都必须更新 `@version`
- 版本格式固定：`YYYY.MM.DD.HHmm`（精确到分钟）
- 若同一分钟内有多次修改，至少在下一次提交时刷新到新分钟版本

## 开发建议

- 修改行为节奏优先调整：
  - `SPEED_ENGINE_CONFIG`
  - `HUMAN_BEHAVIOR_CONFIG`
- 修改 UI 体验优先调整：
  - `ensureToggleButtonStyle()`（开始/暂停按钮）
  - `ensureRunningHalo()`（运行光圈）

## License

当前仓库未声明开源许可证。如需开源，建议补充 `LICENSE` 文件。
