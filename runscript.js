// ==UserScript==
// @name         Linuxdo流光漫游
// @namespace    https://github.com/woxiqingxian/LinuxdoGlowdrift
// @version      2026.02.28.1400
// @description  Linuxdo论坛自动漫游助手（人类浏览节奏 + 标签页独立开关 + 运行光圈）
// @author       Cressida
// @match        https://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/woxiqingxian/LinuxdoGlowdrift/main/runscript.js
// @updateURL    https://raw.githubusercontent.com/woxiqingxian/LinuxdoGlowdrift/main/runscript.js
// ==/UserScript==

/*
 * Script: Linuxdo流光漫游
 * Purpose:
 * - 在 linux.do 内进行“人类行为模拟”的自动浏览（非固定速度）
 * - 自动模式与手动模式按“标签页”隔离，可同时开两个窗口分别使用
 * - 运行时用全页光圈提示，便于识别当前窗口是否在自动执行
 *
 * Core Behaviors:
 * - 行为状态机：scan/read/pause 动态切换
 * - 动态速度曲线：ramp/hill/zigzag + 节拍漂移 + 微停顿/回看
 * - 链接决策延迟：发现可跳转链接后按当前阅读状态模拟“思考时间”
 *
 * Storage Design:
 * - sessionStorage:
 *   - linuxdoHelperEnabledInTab (当前标签页是否启用自动模式)
 * - localStorage:
 *   - visitedLinks (已访问链接记录)
 * - GM storage:
 *   - linuxdoHelperBaseConfig (基础参数)
 *
 * Maintenance Rules:
 * - 任何脚本改动都必须同步更新 @version。
 * - @version 格式固定为 YYYY.MM.DD.HHmm（精确到分钟）。
 * - 如同一分钟内有多次改动，至少在下一次提交时刷新到新的分钟版本号。
 */

(function () {
    'use strict';

    // ==================== 常量定义 ====================
    
    /** 默认配置参数 */
    const DEFAULT_CONFIG = {
        scrollInterval: 300,      // 滚动间隔(毫秒)
        scrollStep: 880,          // 每次滚动的像素
        waitForElement: 2000,    // 找不到评论的最大等待时间(毫秒)
        waitingTime: 1000        // 看完评论等待时间(毫秒)
    };

    /** 滚动节奏配置（用于让滚动更自然，不是机械固定频率） */
    const SPEED_ENGINE_CONFIG = {
        baseTickMs: 240,       // 平均每次滚动触发间隔
        minTickMs: 120,        // 最小间隔，避免过快占用主线程
        maxTickMs: 520,        // 最大间隔，避免滚动停顿感明显
        intervalJitter: 0.22,  // 间隔随机波动比例（22%）
        stepJitter: 0.18,      // 步长随机波动比例（18%）
        baseSpeedFactor: 0.38, // 全局基础速度倍率（越小越慢）
        minStep: 16,           // 普通浏览每次最小滚动像素
        minStepReading: 6,     // 细读模式最小滚动像素
        minStepReverse: 18,    // 回滚时最小像素
        maxStep: 2600,         // 每次最大滚动像素
        minWaitForElement: 800, // 等元素超时下限
        minWaitingTime: 400    // 检测到链接后的停留时间下限
    };

    /** 人类行为模拟配置（浏览/细读/停顿 + 微停顿 + 偶发回滚） */
    const HUMAN_BEHAVIOR_CONFIG = {
        modeDurationMs: {
            scan: [2200, 7000],
            read: [1400, 5200],
            pause: [300, 1400],
            longPause: [3200, 9000]
        },
        modeSpeedFactor: {
            scan: [0.45, 0.9],
            read: [0.12, 0.38],
            pause: [0, 0]
        },
        modeWeights: {
            scan: { scan: 0.52, read: 0.34, pause: 0.14 },
            read: { scan: 0.42, read: 0.28, pause: 0.30 },
            pause: { scan: 0.72, read: 0.28, pause: 0.00 }
        },
        tempo: {
            min: 0.72,
            max: 1.28,
            driftPerTick: 0.06
        },
        microPauseChance: 0.08,
        microPauseMs: [120, 680],
        longPauseChance: 0.06,
        reverseScrollChance: 0.055,
        reverseScrollFactor: [0.12, 0.32],
        rhythmIntervalFactor: [0.82, 1.36],
        intervalWaveAmplitude: 0.24,
        intervalWavePeriodTicks: [7, 24],
        rhythmShiftChance: 0.06,
        speedCurves: {
            scan: ['hill', 'ramp-up', 'ramp-down', 'zigzag'],
            read: ['hill', 'ramp-down', 'gentle-zigzag'],
            pause: ['flat']
        },
        lingerChance: 0.10,
        burstChance: 0.07,
        burstFactor: [1.16, 1.52],
        hesitationChance: 0.09,
        hesitationFactor: [0.28, 0.74],
        linkDecisionFactor: {
            scan: [0.9, 2.2],
            read: [1.6, 3.6],
            pause: [1.3, 2.8],
            deepReadChance: 0.13,
            deepReadFactor: [2.8, 5.2]
        }
    };

    /** 元素选择器配置 */
    const SELECTORS = {
        chatButton: 'li.chat-header-icon',
        chatLink: 'a[href="/chat"]',
        headerButtons: '.header-buttons',
        headerIcons: '.d-header-icons',
        headerDropdown: 'ul.header-dropdown-toggle',
        header: 'header.d-header',
        commentList: 'html.desktop-view.not-mobile-device.text-size-normal.no-touch.discourse-no-touch',
        rawLinks: '.raw-link'
    };

    /** 存储键名 */
    const STORAGE_KEYS = {
        enabled: 'linuxdoHelperEnabled', // 旧版全局开关（仅用于迁移清理）
        baseConfig: 'linuxdoHelperBaseConfig',
        visitedLinks: 'visitedLinks'
    };

    /** 当前标签页会话存储键名（用于区分不同窗口/标签） */
    const SESSION_KEYS = {
        enabled: 'linuxdoHelperEnabledInTab',
        migrated: 'linuxdoHelperLegacySwitchMigrated'
    };

    /** 页面URL */
    const URLS = {
        newPosts: 'https://linux.do/new'
    };

    /** UI 元素ID */
    const UI_IDS = {
        runningHalo: 'linuxdo-running-halo',
        runningHaloStyle: 'linuxdo-running-halo-style',
        toggleButtonStyle: 'linuxdo-toggle-button-style'
    };

    /** 统一主题色（蓝色） */
    const UI_THEME = {
        icon: '#1f74d8',
        iconHover: '#185fb4',
        btnSurface: 'rgba(31, 116, 216, 0.14)',
        btnSurfaceHover: 'rgba(31, 116, 216, 0.22)',
        btnBorder: 'rgba(31, 116, 216, 0.44)',
        btnBorderHover: 'rgba(31, 116, 216, 0.62)',
        halo: '64, 149, 255'
    };

    /** 元素等待超时时间（毫秒） */
    const ELEMENT_WAIT_TIMEOUT = 2000;

    // ==================== 配置管理 ====================

    /** 基础配置（用于速度比例计算） */
    let baseConfig = null;

    /**
     * 获取基础配置（从存储中读取，如果没有则使用默认值）
     * @returns {Object} 基础配置对象
     */
    function getBaseConfig() {
        const savedConfig = GM_getValue(STORAGE_KEYS.baseConfig, null);
        return savedConfig ? savedConfig : { ...DEFAULT_CONFIG };
    }

    /**
     * 保存基础配置
     * @param {Object} newConfig - 新的基础配置
     */
    function saveBaseConfig(newConfig) {
        GM_setValue(STORAGE_KEYS.baseConfig, newConfig);
        baseConfig = newConfig;
    }

    /** 限制值在区间内 */
    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    /** 获取随机区间值 */
    function randomBetween(min, max) {
        return Math.random() * (max - min) + min;
    }

    /**
     * 获取实际使用的配置
     * 说明：
     * 当前不再提供速度滑块，使用固定基础倍率 + 人类行为状态机调节
     * @returns {Object} 计算后的配置对象
     */
    function getConfig() {
        if (!baseConfig) {
            baseConfig = getBaseConfig();
        }
        const ratio = 1;
        const baseInterval = Math.max(1, baseConfig.scrollInterval);
        const baseSpeedPxPerMs = baseConfig.scrollStep / baseInterval;
        const waitScale = Math.sqrt(ratio);

        return {
            scrollSpeedPxPerMs: baseSpeedPxPerMs * ratio * SPEED_ENGINE_CONFIG.baseSpeedFactor,
            waitForElement: Math.max(
                SPEED_ENGINE_CONFIG.minWaitForElement,
                Math.round(baseConfig.waitForElement / waitScale)
            ),
            waitingTime: Math.max(
                SPEED_ENGINE_CONFIG.minWaitingTime,
                Math.round(baseConfig.waitingTime / waitScale)
            )
        };
    }

    /** 按权重选择下一种行为模式 */
    function pickWeightedMode(weightMap) {
        const randomValue = Math.random();
        let cumulative = 0;

        for (const [mode, weight] of Object.entries(weightMap)) {
            cumulative += weight;
            if (randomValue <= cumulative) {
                return mode;
            }
        }

        return 'scan';
    }

    /** 获取某种行为模式的持续时间 */
    function getModeDuration(mode) {
        if (mode === 'pause' && Math.random() < HUMAN_BEHAVIOR_CONFIG.longPauseChance) {
            const [minLongPause, maxLongPause] = HUMAN_BEHAVIOR_CONFIG.modeDurationMs.longPause;
            return Math.round(randomBetween(minLongPause, maxLongPause));
        }

        const [minDuration, maxDuration] = HUMAN_BEHAVIOR_CONFIG.modeDurationMs[mode];
        return Math.round(randomBetween(minDuration, maxDuration));
    }

    /** 从数组随机取一个元素 */
    function pickRandomItem(list, fallback) {
        if (!Array.isArray(list) || list.length === 0) {
            return fallback;
        }
        const randomIndex = Math.floor(Math.random() * list.length);
        return list[randomIndex];
    }

    /** 应用某个模式的动态参数 */
    function applyModeDynamics(state, mode, now) {
        const [minFactor, maxFactor] = HUMAN_BEHAVIOR_CONFIG.modeSpeedFactor[mode];
        state.mode = mode;
        state.modeSpeedFactor = randomBetween(minFactor, maxFactor);
        state.phaseDurationMs = getModeDuration(mode);
        state.phaseStartAt = now;
        state.phaseEndAt = now + state.phaseDurationMs;
        state.phaseCurve = pickRandomItem(
            HUMAN_BEHAVIOR_CONFIG.speedCurves[mode],
            'hill'
        );
        state.rhythmIntervalFactor = randomBetween(
            HUMAN_BEHAVIOR_CONFIG.rhythmIntervalFactor[0],
            HUMAN_BEHAVIOR_CONFIG.rhythmIntervalFactor[1]
        );
        state.intervalWavePeriodTicks = Math.max(
            3,
            Math.round(
                randomBetween(
                    HUMAN_BEHAVIOR_CONFIG.intervalWavePeriodTicks[0],
                    HUMAN_BEHAVIOR_CONFIG.intervalWavePeriodTicks[1]
                )
            )
        );
        state.intervalWaveOffset = randomBetween(0, Math.PI * 2);
        state.tickIndex = 0;
    }

    /** 创建行为状态 */
    function createHumanBehaviorState() {
        const state = {
            mode: 'scan',
            phaseStartAt: 0,
            phaseDurationMs: 0,
            phaseEndAt: 0,
            phaseCurve: 'hill',
            modeSpeedFactor: 1,
            tempo: 1.0,
            microPauseUntil: 0,
            rhythmIntervalFactor: 1,
            intervalWavePeriodTicks: 12,
            intervalWaveOffset: 0,
            tickIndex: 0
        };
        applyModeDynamics(state, 'scan', Date.now());
        return state;
    }

    /** 更新行为状态 */
    function updateHumanBehaviorState(state) {
        const now = Date.now();

        if (state.microPauseUntil && now >= state.microPauseUntil) {
            state.microPauseUntil = 0;
        }

        if (now >= state.phaseEndAt) {
            const nextMode = pickWeightedMode(HUMAN_BEHAVIOR_CONFIG.modeWeights[state.mode]);
            applyModeDynamics(state, nextMode, now);
        }

        if (Math.random() < HUMAN_BEHAVIOR_CONFIG.rhythmShiftChance) {
            state.rhythmIntervalFactor = randomBetween(
                HUMAN_BEHAVIOR_CONFIG.rhythmIntervalFactor[0],
                HUMAN_BEHAVIOR_CONFIG.rhythmIntervalFactor[1]
            );
        }

        state.tempo = clamp(
            state.tempo + randomBetween(-HUMAN_BEHAVIOR_CONFIG.tempo.driftPerTick, HUMAN_BEHAVIOR_CONFIG.tempo.driftPerTick),
            HUMAN_BEHAVIOR_CONFIG.tempo.min,
            HUMAN_BEHAVIOR_CONFIG.tempo.max
        );

        if (
            !state.microPauseUntil &&
            state.mode !== 'pause' &&
            Math.random() < HUMAN_BEHAVIOR_CONFIG.microPauseChance
        ) {
            const [minPauseMs, maxPauseMs] = HUMAN_BEHAVIOR_CONFIG.microPauseMs;
            state.microPauseUntil = now + Math.round(randomBetween(minPauseMs, maxPauseMs));
        }

        return state;
    }

    /** 获取当前模式阶段进度（0-1） */
    function getPhaseProgress(state, now) {
        const duration = Math.max(1, state.phaseDurationMs || 1);
        return clamp((now - state.phaseStartAt) / duration, 0, 1);
    }

    /** 根据阶段曲线获取速度倍率 */
    function getPhaseCurveFactor(curveName, progress) {
        switch (curveName) {
            case 'ramp-up':
                return 0.58 + 0.86 * progress;
            case 'ramp-down':
                return 1.44 - 0.86 * progress;
            case 'zigzag':
                return 0.88 + 0.34 * Math.sin(progress * Math.PI * 4);
            case 'gentle-zigzag':
                return 0.92 + 0.20 * Math.sin(progress * Math.PI * 3);
            case 'flat':
                return 1.0;
            case 'hill':
            default:
                return 0.62 + 0.78 * Math.sin(progress * Math.PI);
        }
    }

    /**
     * 生成下一次滚动的步长和间隔
     * @param {Object} config - 当前配置
     * @param {Object} behaviorState - 当前行为状态
     * @returns {{interval: number, step: number}}
     */
    function getNextScrollTick(config, behaviorState) {
        const now = Date.now();
        behaviorState.tickIndex += 1;

        const wavePeriodTicks = Math.max(1, behaviorState.intervalWavePeriodTicks || 1);
        const wavePhase =
            (behaviorState.tickIndex / wavePeriodTicks) * 2 * Math.PI +
            (behaviorState.intervalWaveOffset || 0);
        const waveFactor =
            1 + Math.sin(wavePhase) * HUMAN_BEHAVIOR_CONFIG.intervalWaveAmplitude;

        const intervalDriftFactor =
            (behaviorState.rhythmIntervalFactor || 1) * waveFactor;
        const intervalJitterFactor =
            1 + (Math.random() * 2 - 1) * SPEED_ENGINE_CONFIG.intervalJitter;
        const interval = clamp(
            Math.round(
                SPEED_ENGINE_CONFIG.baseTickMs *
                intervalDriftFactor *
                intervalJitterFactor
            ),
            SPEED_ENGINE_CONFIG.minTickMs,
            SPEED_ENGINE_CONFIG.maxTickMs
        );

        if (
            behaviorState.mode === 'pause' ||
            (behaviorState.microPauseUntil && now < behaviorState.microPauseUntil)
        ) {
            return {
                interval: clamp(
                    Math.round(interval * randomBetween(1.15, 1.9)),
                    SPEED_ENGINE_CONFIG.minTickMs,
                    SPEED_ENGINE_CONFIG.maxTickMs
                ),
                step: 0
            };
        }

        if (
            behaviorState.mode === 'read' &&
            Math.random() < HUMAN_BEHAVIOR_CONFIG.lingerChance
        ) {
            return {
                interval: clamp(
                    Math.round(interval * randomBetween(1.08, 1.6)),
                    SPEED_ENGINE_CONFIG.minTickMs,
                    SPEED_ENGINE_CONFIG.maxTickMs
                ),
                step: 0
            };
        }

        const phaseProgress = getPhaseProgress(behaviorState, now);
        const phaseCurveFactor = getPhaseCurveFactor(
            behaviorState.phaseCurve,
            phaseProgress
        );

        const stepJitterFactor =
            1 + (Math.random() * 2 - 1) * SPEED_ENGINE_CONFIG.stepJitter;
        let dynamicSpeedFactor =
            behaviorState.modeSpeedFactor *
            behaviorState.tempo *
            phaseCurveFactor *
            stepJitterFactor;

        if (
            behaviorState.mode === 'scan' &&
            Math.random() < HUMAN_BEHAVIOR_CONFIG.burstChance
        ) {
            dynamicSpeedFactor *= randomBetween(
                HUMAN_BEHAVIOR_CONFIG.burstFactor[0],
                HUMAN_BEHAVIOR_CONFIG.burstFactor[1]
            );
        }

        if (Math.random() < HUMAN_BEHAVIOR_CONFIG.hesitationChance) {
            dynamicSpeedFactor *= randomBetween(
                HUMAN_BEHAVIOR_CONFIG.hesitationFactor[0],
                HUMAN_BEHAVIOR_CONFIG.hesitationFactor[1]
            );
        }

        const rawStep = config.scrollSpeedPxPerMs * interval * dynamicSpeedFactor;
        const minStep =
            behaviorState.mode === 'read'
                ? SPEED_ENGINE_CONFIG.minStepReading
                : SPEED_ENGINE_CONFIG.minStep;
        let step = clamp(
            Math.round(Math.abs(rawStep)),
            minStep,
            SPEED_ENGINE_CONFIG.maxStep
        );

        // 偶发轻微回滚，模拟人类回看内容
        if (Math.random() < HUMAN_BEHAVIOR_CONFIG.reverseScrollChance) {
            const [minReverseFactor, maxReverseFactor] = HUMAN_BEHAVIOR_CONFIG.reverseScrollFactor;
            const reverseStep = Math.round(step * randomBetween(minReverseFactor, maxReverseFactor));
            step = -Math.max(SPEED_ENGINE_CONFIG.minStepReverse, reverseStep);
        }

        return { interval, step };
    }

    /** 看到链接后的“思考时间” */
    function getHumanizedLinkDecisionWait(config, mode) {
        const decisionConfig = HUMAN_BEHAVIOR_CONFIG.linkDecisionFactor;
        const [minFactor, maxFactor] = decisionConfig[mode] || decisionConfig.scan;
        const factor =
            Math.random() < decisionConfig.deepReadChance
                ? randomBetween(decisionConfig.deepReadFactor[0], decisionConfig.deepReadFactor[1])
                : randomBetween(minFactor, maxFactor);
        return Math.round(config.waitingTime * factor);
    }

    // 初始化基础配置
    baseConfig = getBaseConfig();

    // ==================== 开关状态管理 ====================

    /**
     * 迁移旧版全局开关状态：
     * 新版改为“按标签页控制”，这里仅清理旧键避免跨窗口串联。
     */
    function migrateLegacySwitchState() {
        if (sessionStorage.getItem(SESSION_KEYS.migrated) === '1') {
            return;
        }
        sessionStorage.setItem(SESSION_KEYS.migrated, '1');
        if (GM_getValue(STORAGE_KEYS.enabled, false)) {
            GM_setValue(STORAGE_KEYS.enabled, false);
        }
    }

    /**
     * 设置当前标签页开关状态
     * @param {boolean} enabled - 是否启用
     */
    function setSwitchState(enabled) {
        migrateLegacySwitchState();
        sessionStorage.setItem(SESSION_KEYS.enabled, enabled ? '1' : '0');
    }

    /**
     * 获取助手开关状态
     * @returns {boolean} 是否启用
     */
    function getSwitchState() {
        migrateLegacySwitchState();
        return sessionStorage.getItem(SESSION_KEYS.enabled) === '1';
    }

    /**
     * 切换助手开关状态
     */
    function toggleSwitch() {
        const currentState = getSwitchState();
        const newState = !currentState;
        setSwitchState(newState);
        updateRunningHaloVisibility(newState);

        if (newState) {
            // 启用时跳转到新帖子页面
            window.location.href = URLS.newPosts;
        } else {
            // 关闭时立即停止滚动
            stopScrolling();
        }
        console.log(`Linuxdo助手已${newState ? '启用' : '禁用'}`);
    }

    // ==================== UI 组件创建 ====================

    /**
     * 确保控制按钮样式存在
     */
    function ensureToggleButtonStyle() {
        let toggleStyle = document.getElementById(UI_IDS.toggleButtonStyle);
        if (toggleStyle) {
            return;
        }

        toggleStyle = document.createElement('style');
        toggleStyle.id = UI_IDS.toggleButtonStyle;
        toggleStyle.textContent = `
            .linuxdo-helper-toggle-item {
                margin-left: 6px;
            }
            .linuxdo-helper-toggle-btn {
                width: 38px;
                height: 38px;
                min-width: 38px;
                min-height: 38px;
                border-radius: 11px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid ${UI_THEME.btnBorder};
                background: ${UI_THEME.btnSurface} !important;
                box-shadow:
                    inset 0 1px 0 rgba(255, 255, 255, 0.35),
                    0 1px 4px rgba(31, 116, 216, 0.15);
                color: ${UI_THEME.icon} !important;
                transition:
                    transform 140ms ease,
                    box-shadow 180ms ease,
                    border-color 180ms ease,
                    background 180ms ease,
                    color 180ms ease;
            }
            .linuxdo-helper-toggle-btn:hover,
            .linuxdo-helper-toggle-btn:focus-visible {
                transform: translateY(-1px);
                border-color: ${UI_THEME.btnBorderHover};
                background: ${UI_THEME.btnSurfaceHover} !important;
                box-shadow: 0 3px 10px rgba(31, 116, 216, 0.24);
                color: ${UI_THEME.iconHover} !important;
            }
            .linuxdo-helper-toggle-btn.active {
                border-color: ${UI_THEME.btnBorderHover};
                background: rgba(31, 116, 216, 0.20) !important;
                box-shadow:
                    inset 0 0 0 1px rgba(255, 255, 255, 0.30),
                    0 0 0 1px rgba(31, 116, 216, 0.18);
                color: ${UI_THEME.icon} !important;
            }
            .linuxdo-helper-toggle-btn:active {
                transform: translateY(0);
            }
            .linuxdo-helper-toggle-btn .linuxdo-helper-toggle-icon {
                width: 23px;
                height: 23px;
                color: currentColor;
                fill: currentColor !important;
                stroke: currentColor !important;
                opacity: 1;
            }
            .linuxdo-helper-toggle-btn .linuxdo-helper-toggle-icon use {
                fill: currentColor !important;
                stroke: currentColor !important;
                opacity: 1;
            }
        `;
        document.head.appendChild(toggleStyle);
    }

    /**
     * 确保运行状态光圈元素存在
     */
    function ensureRunningHalo() {
        let haloStyle = document.getElementById(UI_IDS.runningHaloStyle);
        if (!haloStyle) {
            haloStyle = document.createElement('style');
            haloStyle.id = UI_IDS.runningHaloStyle;
            haloStyle.textContent = `
                @keyframes linuxdo-running-halo-pulse {
                    0% {
                        box-shadow:
                            inset 0 0 0 2px rgba(${UI_THEME.halo}, 0.50),
                            inset 0 0 72px rgba(${UI_THEME.halo}, 0.18),
                            0 0 26px rgba(${UI_THEME.halo}, 0.34),
                            0 0 80px rgba(${UI_THEME.halo}, 0.16);
                    }
                    100% {
                        box-shadow:
                            inset 0 0 0 4px rgba(${UI_THEME.halo}, 0.86),
                            inset 0 0 180px rgba(${UI_THEME.halo}, 0.30),
                            0 0 58px rgba(${UI_THEME.halo}, 0.62),
                            0 0 140px rgba(${UI_THEME.halo}, 0.30);
                    }
                }
                #${UI_IDS.runningHalo} {
                    position: fixed;
                    inset: 0;
                    pointer-events: none;
                    z-index: 2147483646;
                    background:
                        radial-gradient(circle at 50% 50%, rgba(${UI_THEME.halo}, 0.06) 0%, rgba(${UI_THEME.halo}, 0.00) 62%),
                        linear-gradient(0deg, rgba(${UI_THEME.halo}, 0.08), rgba(${UI_THEME.halo}, 0.08));
                    opacity: 0;
                    transition: opacity 220ms ease-out;
                }
                #${UI_IDS.runningHalo}.active {
                    opacity: 1;
                    animation: linuxdo-running-halo-pulse 1.6s ease-in-out infinite alternate;
                }
            `;
            document.head.appendChild(haloStyle);
        }

        let halo = document.getElementById(UI_IDS.runningHalo);
        if (!halo) {
            halo = document.createElement('div');
            halo.id = UI_IDS.runningHalo;
            document.body.appendChild(halo);
        }
    }

    /**
     * 更新运行状态光圈显示状态
     * @param {boolean} [enabledState] - 可选，指定状态；不传则读取当前开关
     */
    function updateRunningHaloVisibility(enabledState) {
        ensureRunningHalo();
        const halo = document.getElementById(UI_IDS.runningHalo);
        if (!halo) {
            return;
        }
        const enabled = typeof enabledState === 'boolean' ? enabledState : getSwitchState();
        halo.classList.toggle('active', enabled);
    }

    /** 创建SVG子元素 */
    function createSvgElement(tagName, attrs) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    }

    /**
     * 创建SVG图标元素（机器人自动巡航风格）
     * @param {'play'|'pause'} iconType - 图标类型
     * @returns {SVGElement} SVG元素
     */
    function createSVGIcon(iconType) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'fa d-icon svg-icon prefix-icon svg-string linuxdo-helper-toggle-icon');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');

        // 外环：强调“自动巡航”状态
        svg.appendChild(createSvgElement('circle', {
            cx: '12',
            cy: '12',
            r: '9.8',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '2.3',
            opacity: '0.92'
        }));

        // 左上角信号点：增强“机器人工作中”的识别感
        svg.appendChild(createSvgElement('circle', {
            cx: '7.3',
            cy: '7.3',
            r: '1.8',
            fill: 'currentColor',
            opacity: '0.86'
        }));

        if (iconType === 'pause') {
            svg.appendChild(createSvgElement('rect', {
                x: '8.1',
                y: '7.5',
                width: '3.4',
                height: '9.0',
                rx: '1.2',
                fill: 'currentColor'
            }));
            svg.appendChild(createSvgElement('rect', {
                x: '12.9',
                y: '7.5',
                width: '3.4',
                height: '9.0',
                rx: '1.2',
                fill: 'currentColor'
            }));
        } else {
            // 播放图标做轻微右偏，视觉上更“动”
            svg.appendChild(createSvgElement('path', {
                d: 'M9.2 7.2L17.8 12L9.2 16.8Z',
                fill: 'currentColor'
            }));
        }

        return svg;
    }

    /** 统一更新按钮图标 */
    function setToggleButtonIcon(buttonElement, isEnabled) {
        buttonElement.querySelectorAll('.linuxdo-helper-toggle-icon').forEach((node) => node.remove());
        buttonElement.appendChild(createSVGIcon(isEnabled ? 'pause' : 'play'));
    }

    /**
     * 创建控制开关按钮
     * @returns {HTMLElement} 开关按钮的 li 元素
     */
    function createSwitchButton() {
        ensureToggleButtonStyle();

        const iconLi = document.createElement('li');
        iconLi.className = 'header-dropdown-toggle linuxdo-helper-toggle-item';
        
        const iconLink = document.createElement('a');
        iconLink.href = '#';
        iconLink.className = 'btn no-text icon btn-flat linuxdo-helper-toggle-btn';
        iconLink.tabIndex = 0;
        
        const isEnabled = getSwitchState();
        iconLink.title = isEnabled ? '停止Linuxdo助手' : '启动Linuxdo助手';
        iconLink.setAttribute('aria-label', iconLink.title);
        iconLink.classList.toggle('active', isEnabled);
        
        setToggleButtonIcon(iconLink, isEnabled);
        iconLi.appendChild(iconLink);

        // 点击事件处理
        iconLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            toggleSwitch();
            
            // 更新按钮状态
            const newState = getSwitchState();
            setToggleButtonIcon(iconLink, newState);
            iconLink.title = newState ? '停止Linuxdo助手' : '启动Linuxdo助手';
            iconLink.setAttribute('aria-label', iconLink.title);
            iconLink.classList.toggle('active', newState);
        });

        return iconLi;
    }

    /**
     * 查找聊天按钮元素
     * @returns {Promise<HTMLElement|null>} 聊天按钮元素或null
     */
    async function findChatButton() {
        try {
            // 尝试等待聊天按钮出现
            const chatButton = await Promise.race([
                waitForElement(SELECTORS.chatButton),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('timeout')), ELEMENT_WAIT_TIMEOUT)
                )
            ]).catch(() => null);
            
            if (chatButton) {
                return chatButton;
            }
        } catch (e) {
            // 等待失败，继续尝试直接查找
        }
        
        // 直接查找聊天按钮
        return document.querySelector(SELECTORS.chatButton) || 
               document.querySelector(SELECTORS.chatLink)?.closest('li');
    }

    /**
     * 查找备用插入位置
     * @returns {HTMLElement|null} 备用位置元素或null
     */
    function findFallbackInsertPosition() {
        return document.querySelector(SELECTORS.headerButtons) || 
               document.querySelector(SELECTORS.headerIcons) ||
               document.querySelector(SELECTORS.headerDropdown)?.parentElement;
    }

    /**
     * 将开关按钮插入到页面中
     * @param {HTMLElement} buttonElement - 开关按钮元素
     */
    function insertSwitchButton(buttonElement) {
        // 优先插入到聊天按钮旁边
        const chatButton = document.querySelector(SELECTORS.chatButton);
        if (chatButton?.parentNode) {
            chatButton.parentNode.insertBefore(buttonElement, chatButton.nextSibling);
            return;
        }

        // 备用方案：插入到其他header按钮位置
        const fallbackPosition = findFallbackInsertPosition();
        if (fallbackPosition?.parentNode) {
            fallbackPosition.parentNode.insertBefore(buttonElement, fallbackPosition.nextSibling);
            return;
        }

        // 最后方案：插入到header中
        const header = document.querySelector(SELECTORS.header) || document.querySelector('header');
        if (header) {
            const headerList = header.querySelector('ul') || header.querySelector('nav');
            if (headerList) {
                headerList.appendChild(buttonElement);
            } else {
                header.insertBefore(buttonElement, header.firstChild);
            }
        } else {
            console.log("【错误】未找到按钮插入位置！");
        }
    }

    /**
     * 创建并插入开关图标到页面
     */
    async function createSwitchIcon() {
        const switchButton = createSwitchButton();
        await findChatButton(); // 等待聊天按钮加载
        insertSwitchButton(switchButton);
    }

    // ==================== DOM 工具函数 ====================

    /**
     * 等待指定元素出现在页面中
     * @param {string} selector - CSS选择器
     * @returns {Promise<HTMLElement>} 找到的元素
     */
    function waitForElement(selector) {
        return new Promise((resolve, reject) => {
            // 先尝试直接查找
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            // 使用MutationObserver监听DOM变化
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            // 超时处理
            setTimeout(() => {
                observer.disconnect();
                console.log("【错误】未找到元素：", selector);
                reject(new Error('未找到：' + selector));
            }, getConfig().waitForElement);
        });
    }

    /**
     * 获取页面中的原始链接列表
     * @returns {Array<Object>} 链接对象数组，包含index、href、text
     */
    function getRawLinks() {
        const linkElements = document.querySelectorAll(SELECTORS.rawLinks);
        return Array.from(linkElements)
            .map((element, index) => ({
                index: index + 1,
                href: element.href,
                text: element.textContent.trim()
            }))
            .filter(link => link.href);
    }

    // ==================== 核心功能 ====================

    /** 当前运行的滚动定时器引用 */
    let currentScrollTimer = null;
    
    /** 当前评论元素引用 */
    let currentCommentElement = null;

    /** 当前人类行为状态 */
    let humanBehaviorState = null;

    /**
     * 加载并跳转到新页面
     * @param {Array<Object>} links - 可用链接列表
     */
    function loadPage(links) {
        if (!getSwitchState()) {
            return;
        }

        const visitedLinks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.visitedLinks) || '[]'
        );
        const unvisitedLinks = links.filter(
            link => !visitedLinks.includes(link.href)
        );

        // 如果没有未访问的链接，跳转到新帖子页面
        if (unvisitedLinks.length === 0) {
            window.location.href = URLS.newPosts;
            console.log("去看最新帖子");
            return;
        }

        // 随机选择一个未访问的链接
        const randomIndex = Math.floor(Math.random() * unvisitedLinks.length);
        const selectedLink = unvisitedLinks[randomIndex];
        
        // 记录已访问
        visitedLinks.push(selectedLink.href);
        localStorage.setItem(STORAGE_KEYS.visitedLinks, JSON.stringify(visitedLinks));
        
        // 跳转
        window.location.href = selectedLink.href;
    }

    /**
     * 停止当前滚动
     */
    function stopScrolling() {
        if (currentScrollTimer) {
            clearTimeout(currentScrollTimer);
            currentScrollTimer = null;
        }
        currentCommentElement = null;
        humanBehaviorState = null;
    }

    /**
     * 滚动评论区域并自动跳转
     * @param {HTMLElement} commentElement - 评论容器元素
     */
    function scrollComment(commentElement) {
        // 停止之前的滚动
        stopScrolling();
        
        // 保存当前评论元素引用
        currentCommentElement = commentElement;
        humanBehaviorState = createHumanBehaviorState();
        
        // 记录开始等待链接的时间
        let linkWaitStartTime = null;
        let linkDecisionWaitTime = null;

        const tick = () => {
            // 开关关闭时停止后续调度
            if (!getSwitchState()) {
                stopScrolling();
                return;
            }

            // 每次滚动时重新获取配置，确保速度改变立即生效
            const currentConfig = getConfig();
            updateHumanBehaviorState(humanBehaviorState);
            const { interval, step } = getNextScrollTick(currentConfig, humanBehaviorState);
            
            // 滚动
            if (step !== 0) {
                commentElement.scrollTop += step;
                commentElement.dispatchEvent(new Event('scroll'));
            }

            // 检查是否有链接
            const links = getRawLinks();
            if (links.length > 0) {
                // 记录开始等待的时间
                if (linkWaitStartTime === null) {
                    linkWaitStartTime = Date.now();
                    linkDecisionWaitTime = getHumanizedLinkDecisionWait(currentConfig, humanBehaviorState.mode);
                }
                
                // 计算已等待时间（毫秒）
                const waitedTime = Date.now() - linkWaitStartTime;
                
                if (waitedTime >= linkDecisionWaitTime) {
                    stopScrolling();
                    loadPage(links);
                    return;
                }
            } else {
                // 没有链接时重置等待时间
                linkWaitStartTime = null;
                linkDecisionWaitTime = null;
            }

            currentScrollTimer = window.setTimeout(tick, interval);
        };

        // 首次调度
        const initialInterval = getNextScrollTick(getConfig(), humanBehaviorState).interval;
        currentScrollTimer = window.setTimeout(tick, initialInterval);
    }
    
    /**
     * 启动自动滚动功能
     */
    async function startAutoScroll() {
        try {
            const commentElement = await waitForElement(SELECTORS.commentList);
            console.log('找到评论列表元素:', commentElement);
            scrollComment(commentElement);
        } catch (error) {
            console.error('启动自动滚动失败:', error);
        }
    }

    // ==================== 主程序入口 ====================

    /**
     * 主初始化函数
     */
    async function main() {
        // 创建控制开关按钮
        await createSwitchIcon();
        updateRunningHaloVisibility();
        
        // 如果助手未启用，不执行后续操作
        if (!getSwitchState()) {
            return;
        }

        // 启动自动滚动
        startAutoScroll();
    }

    // 页面加载完成后执行
    if (document.readyState === 'complete') {
        main();
    } else {
        window.addEventListener('load', main);
    }
})();
