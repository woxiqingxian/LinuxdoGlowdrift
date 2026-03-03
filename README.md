# Linuxdo流光漫游 (Glowdrift)

一个用于 `linux.do` 的 Tampermonkey 浏览增强脚本。  

## 功能特性

- 默认人类自动浏览：按 scan/read/pause 节奏滚动与停顿，减少机械感，模拟更自然的浏览过程。
- 漫游超时自动关闭：单标签页内从启动开始累计运行满 1.5 小时后自动关闭，避免忘记停止。
- 漫游时长大字提醒：页面中间实时显示 `已漫游 XX:XX:XX`（时分秒均两位）。
- 主页筛选工具：在首页按等级、分类、标签筛选帖子，并支持保存/加载筛选预设。
- 浏览帖子底部自动加载：接近列表底部时自动触发“加载更多”，减少手动点按与翻页中断。

## 文件结构

- `runscript.js`: 主脚本（Tampermonkey UserScript）

## 文档维护约定

- 脚本顶部注释不再维护详细说明，统一以 `README.md` 为准
- 功能、存储、版本规则等变更只需要更新本 README
- 交流语言统一为中文，提交信息与代码注释也保持中文一致

## 安装方式

1. 安装浏览器扩展 `Tampermonkey`
2. 新建脚本并粘贴 `runscript.js` 全部内容
3. 保存后打开 `https://linux.do/`
4. 点击顶部新增按钮进行控制：
   - 漫游开关（开始/暂停自动漫游）
   - 筛选开关（启用/停用主页筛选工具）

## 使用说明

- 建议开两个窗口：
  - 窗口 A：开启自动漫游
  - 窗口 B：保持手动浏览
- 因为开关状态使用 `sessionStorage`，每个标签页独立保存，不会互相串联
- 主页筛选工具仅在 `/, /latest, /top, /new` 路径显示
- 接近底部自动加载同样仅在 `/, /latest, /top, /new` 路径生效

## 顶部双开关说明

- 漫游开关（播放/暂停图标）：
  - 开启后自动进入漫游流程（滚动 + 链接跳转）
  - 开启后会记录本标签页启动时间，累计运行超过 1.5 小时自动关闭
  - 开启后页面中间显示大字提醒：`已漫游 XX:XX:XX`
  - 关闭后立即停止自动滚动
- 筛选开关（漏斗图标）：
  - 开启后在首页列表上方显示筛选面板
  - 关闭后隐藏筛选面板并恢复全部帖子显示

## 主页筛选工具说明

- 筛选维度：
  - 等级筛选：`公开(Lv0) / Lv1 / Lv2 / Lv3`
  - 分类筛选：按站点分类 ID 和父分类匹配
  - 标签筛选：三态切换（中立 -> 包含 -> 排除）
- 预设能力：
  - 支持按名称保存当前筛选条件
  - 支持点击快速加载预设
  - 支持删除不再需要的预设
- 状态更新：
  - 列表变化后会自动重新筛选
  - 右上角状态文本会显示当前筛选结果数量

## 存储设计

- `sessionStorage`
  - `linuxdoHelperEnabledInTab`: 当前标签页开关状态
  - `linuxdoHelperStartedAtInTab`: 当前标签页漫游启动时间戳（用于 1.5 小时超时自动关闭）
  - `linuxdoSieveEnabledInTab`: 当前标签页筛选开关状态
- `localStorage`
  - `visitedLinks`: 已访问链接列表
- `GM_setValue / GM_getValue`
  - `linuxdoHelperBaseConfig`: 基础参数
  - `linuxdoSieveLevels`: 筛选等级选中项
  - `linuxdoSieveCats`: 筛选分类选中项
  - `linuxdoSieveTags`: 筛选标签三态状态
  - `linuxdoSievePresets`: 筛选预设

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
