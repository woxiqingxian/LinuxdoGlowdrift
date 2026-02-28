# Linuxdo流光漫游 (Glowdrift)

一个用于 `linux.do` 的 Tampermonkey 自动漫游脚本。  
目标是模拟“人类浏览节奏”，而不是机械固定速度滚动。

## 功能特性

- 人类行为模拟：`scan / read / pause` 状态机动态切换
- 非固定速度：速度曲线、节拍漂移、微停顿、偶发回看
- 标签页隔离开关：自动窗口和手动窗口互不影响
- 运行中光圈：页面全屏提示当前是否在自动执行
- 随机跳转未访问链接：尽量减少重复浏览

## 文件结构

- `runscript.js`: 主脚本（Tampermonkey UserScript）

## 安装方式

1. 安装浏览器扩展 `Tampermonkey`
2. 新建脚本并粘贴 `runscript.js` 全部内容
3. 保存后打开 `https://linux.do/`
4. 点击顶部新增的开始/暂停按钮进行控制

## 使用说明

- 建议开两个窗口：
  - 窗口 A：开启自动漫游
  - 窗口 B：保持手动浏览
- 因为开关状态使用 `sessionStorage`，每个标签页独立保存，不会互相串联

## 存储设计

- `sessionStorage`
  - `linuxdoHelperEnabledInTab`: 当前标签页开关状态
- `localStorage`
  - `visitedLinks`: 已访问链接列表
- `GM_setValue / GM_getValue`
  - `linuxdoHelperBaseConfig`: 基础参数

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
