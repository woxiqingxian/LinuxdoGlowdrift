// ==UserScript==
// @name         Linuxdo流光漫游
// @namespace    https://github.com/woxiqingxian/LinuxdoGlowdrift
// @version      2026.03.03.1234
// @description  Linuxdo论坛自动漫游助手（人类浏览节奏 + 主页筛选工具 + 双开关控制）
// @author       Cressida
// @match        https://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/woxiqingxian/LinuxdoGlowdrift/main/runscript.js
// @updateURL    https://raw.githubusercontent.com/woxiqingxian/LinuxdoGlowdrift/main/runscript.js
// ==/UserScript==

/*
 * 维护说明统一放在 README.md，本文件仅保留必要元信息与实现代码。
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
        visitedLinks: 'visitedLinks',
        roamHistoryMs: 'linuxdoRoamHistoryMs',
        roamTodayStat: 'linuxdoRoamTodayStat',
        sieveLevels: 'linuxdoSieveLevels',
        sieveCats: 'linuxdoSieveCats',
        sieveTags: 'linuxdoSieveTags',
        sievePresets: 'linuxdoSievePresets'
    };

    /** 当前标签页会话存储键名（用于区分不同窗口/标签） */
    const SESSION_KEYS = {
        enabled: 'linuxdoHelperEnabledInTab',
        migrated: 'linuxdoHelperLegacySwitchMigrated',
        sieveEnabled: 'linuxdoSieveEnabledInTab',
        startedAt: 'linuxdoHelperStartedAtInTab',
        accountedAt: 'linuxdoHelperAccountedAtInTab'
    };

    /** 页面URL */
    const URLS = {
        newPosts: 'https://linux.do/new'
    };

    /** UI 元素ID */
    const UI_IDS = {
        runningHalo: 'linuxdo-running-halo',
        runningHaloStyle: 'linuxdo-running-halo-style',
        toggleButtonStyle: 'linuxdo-toggle-button-style',
        roamDurationReminder: 'linuxdo-roam-duration-reminder',
        roamDurationReminderStyle: 'linuxdo-roam-duration-reminder-style'
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

    /** 主页筛选工具配置 */
    const SIEVE_CONFIG = {
        paths: ['/', '/latest', '/top', '/new'],
        levels: [
            { key: 'public', label: '公开(Lv0)', check: (classText) => !/lv\d+/i.test(classText) },
            { key: 'lv1', label: 'Lv1', check: (classText) => /lv1/i.test(classText) },
            { key: 'lv2', label: 'Lv2', check: (classText) => /lv2/i.test(classText) },
            { key: 'lv3', label: 'Lv3', check: (classText) => /lv3/i.test(classText) }
        ],
        categories: [
            { id: '4', name: '开发调优' },
            { id: '98', name: '国产替代' },
            { id: '14', name: '资源荟萃' },
            { id: '42', name: '文档共建' },
            { id: '10', name: '跳蚤市场' },
            { id: '106', name: '积分乐园' },
            { id: '27', name: '非我莫属' },
            { id: '32', name: '读书成诗' },
            { id: '46', name: '扬帆起航' },
            { id: '34', name: '前沿快讯' },
            { id: '92', name: '网络记忆' },
            { id: '36', name: '福利羊毛' },
            { id: '11', name: '搞七捻三' },
            { id: '102', name: '社区孵化' },
            { id: '2', name: '运营反馈' },
            { id: '45', name: '深海幽域' }
        ],
        tags: [
            '无标签', '纯水', '快问快答', '人工智能', '软件开发',
            '夸克网盘', '病友', 'ChatGPT', '树洞', 'AFF',
            'OpenAI', '影视', '百度网盘', 'VPS', '职场',
            '网络安全', '订阅节点', '抽奖', 'Cursor', '游戏',
            '动漫', '作品集', '晒年味', 'Gemini', 'PT',
            '拼车', '求资源', '配置优化', 'Claude', 'NSFW',
            '圆圆满满'
        ],
        state: {
            neutral: 0,
            include: 1,
            exclude: 2
        }
    };

    /** 主页筛选工具UI常量 */
    const SIEVE_UI_IDS = {
        panel: 'linuxdo-sieve-panel',
        style: 'linuxdo-sieve-style'
    };

    /** 元素等待超时时间（毫秒） */
    const ELEMENT_WAIT_TIMEOUT = 2000;

    /** 漫游最长运行时长（毫秒，1.5小时） */
    const MAX_ROAM_DURATION_MS = 90 * 60 * 1000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    /** 手动浏览时接近底部自动加载配置 */
    const NEAR_BOTTOM_AUTO_LOAD_CONFIG = {
        nearBottomViewportRatio: 0.5,
        minTriggerGapMs: 1000,
        fallbackCheckIntervalMs: 1400,
        triggerSelectors: [
            '.topic-list .show-more a',
            '.topic-list .show-more button',
            '.show-more a',
            '.show-more button',
            '.load-more',
            'button.load-more',
            'a.load-more',
            '.more-topics a'
        ]
    };

    // ==================== 配置管理 ====================

    /** 基础配置（用于速度比例计算） */
    let baseConfig = null;
    let autoStopTimer = null;
    let roamDurationReminderTimer = null;

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

    /** 设置当前标签页漫游起始时间戳 */
    function setRoamStartTime(timestampMs) {
        sessionStorage.setItem(SESSION_KEYS.startedAt, String(timestampMs));
    }

    /** 获取当前标签页漫游起始时间戳 */
    function getRoamStartTime() {
        const raw = sessionStorage.getItem(SESSION_KEYS.startedAt);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }
        return parsed;
    }

    /** 清理当前标签页漫游起始时间戳 */
    function clearRoamStartTime() {
        sessionStorage.removeItem(SESSION_KEYS.startedAt);
    }

    /**
     * 设置当前标签页开关状态
     * @param {boolean} enabled - 是否启用
     */
    function setSwitchState(enabled) {
        migrateLegacySwitchState();
        sessionStorage.setItem(SESSION_KEYS.enabled, enabled ? '1' : '0');
        if (enabled) {
            if (getRoamStartTime() === null) {
                setRoamStartTime(Date.now());
            }
        } else {
            clearRoamStartTime();
        }
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
     * 设置主页筛选开关状态（当前标签页）
     * @param {boolean} enabled - 是否启用
     */
    function setSieveSwitchState(enabled) {
        sessionStorage.setItem(SESSION_KEYS.sieveEnabled, enabled ? '1' : '0');
    }

    /**
     * 获取主页筛选开关状态（当前标签页）
     * 默认启用，保证首次安装即可使用筛选功能。
     * @returns {boolean} 是否启用
     */
    function getSieveSwitchState() {
        const saved = sessionStorage.getItem(SESSION_KEYS.sieveEnabled);
        if (saved === null) {
            sessionStorage.setItem(SESSION_KEYS.sieveEnabled, '1');
            return true;
        }
        return saved === '1';
    }

    /**
     * 切换主页筛选开关状态
     * @returns {boolean} 切换后的状态
     */
    function toggleSieveSwitch() {
        const currentState = getSieveSwitchState();
        const newState = !currentState;
        setSieveSwitchState(newState);

        if (newState) {
            initHomeSieveTool();
        } else {
            destroyHomeSieveTool();
        }
        console.log(`主页筛选功能已${newState ? '启用' : '禁用'}`);
        return newState;
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
            scheduleAutoStop();
            // 启用时跳转到新帖子页面
            window.location.href = URLS.newPosts;
        } else {
            // 关闭时立即停止滚动
            clearAutoStopTimer();
            stopScrolling();
        }
        console.log(`Linuxdo助手已${newState ? '启用' : '禁用'}`);
    }

    /** 清理漫游自动关闭计时器 */
    function clearAutoStopTimer() {
        if (autoStopTimer) {
            clearTimeout(autoStopTimer);
            autoStopTimer = null;
        }
    }

    /** 清理“已漫游时长”提醒计时器 */
    function clearRoamDurationReminderTimer() {
        if (roamDurationReminderTimer) {
            clearInterval(roamDurationReminderTimer);
            roamDurationReminderTimer = null;
        }
    }

    /** 安排漫游超时自动关闭 */
    function scheduleAutoStop() {
        clearAutoStopTimer();
        let roamStartTime = getRoamStartTime();
        if (roamStartTime === null) {
            roamStartTime = Date.now();
            setRoamStartTime(roamStartTime);
        }

        const elapsedMs = Date.now() - roamStartTime;
        const remainingMs = MAX_ROAM_DURATION_MS - elapsedMs;
        if (remainingMs <= 0) {
            if (!getSwitchState()) {
                return;
            }
            setSwitchState(false);
            updateRunningHaloVisibility(false);
            stopScrolling();
            syncAutoSwitchButtonState(false);
            autoStopTimer = null;
            console.log('漫游已运行超过1.5小时，已自动关闭。');
            return;
        }

        autoStopTimer = window.setTimeout(() => {
            if (!getSwitchState()) {
                return;
            }
            setSwitchState(false);
            updateRunningHaloVisibility(false);
            stopScrolling();
            syncAutoSwitchButtonState(false);
            autoStopTimer = null;
            console.log('漫游已运行超过1.5小时，已自动关闭。');
        }, remainingMs);
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

    /** 将时长格式化为 HH:MM:SS（均为两位） */
    function formatDurationAsClock(durationMs) {
        const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad2 = (value) => String(value).padStart(2, '0');
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }

    /** 确保“已漫游时长”提醒元素存在 */
    function ensureRoamDurationReminder() {
        let reminderStyle = document.getElementById(UI_IDS.roamDurationReminderStyle);
        if (!reminderStyle) {
            reminderStyle = document.createElement('style');
            reminderStyle.id = UI_IDS.roamDurationReminderStyle;
            reminderStyle.textContent = `
                #${UI_IDS.roamDurationReminder} {
                    position: fixed;
                    left: 50%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                    z-index: 2147483647;
                    font-size: clamp(34px, 6vw, 72px);
                    font-weight: 800;
                    line-height: 1;
                    letter-spacing: 0.06em;
                    color: rgba(255, 255, 255, 0.96);
                    text-shadow:
                        0 0 22px rgba(0, 0, 0, 0.45),
                        0 0 36px rgba(${UI_THEME.halo}, 0.52);
                    opacity: 0;
                    transition: opacity 220ms ease-out;
                }
                #${UI_IDS.roamDurationReminder}.active {
                    opacity: 1;
                }
            `;
            document.head.appendChild(reminderStyle);
        }

        let reminder = document.getElementById(UI_IDS.roamDurationReminder);
        if (!reminder) {
            reminder = document.createElement('div');
            reminder.id = UI_IDS.roamDurationReminder;
            reminder.textContent = '已漫游 00:00:00';
            document.body.appendChild(reminder);
        }
    }

    /** 更新“已漫游时长”提醒显示状态 */
    function updateRoamDurationReminderVisibility(enabledState) {
        ensureRoamDurationReminder();
        const reminder = document.getElementById(UI_IDS.roamDurationReminder);
        if (!reminder) {
            return;
        }

        const enabled = typeof enabledState === 'boolean' ? enabledState : getSwitchState();
        if (!enabled) {
            clearRoamDurationReminderTimer();
            reminder.classList.remove('active');
            reminder.textContent = '已漫游 00:00:00';
            return;
        }

        let roamStartTime = getRoamStartTime();
        if (roamStartTime === null) {
            roamStartTime = Date.now();
            setRoamStartTime(roamStartTime);
        }

        const refreshText = () => {
            const elapsedMs = Date.now() - roamStartTime;
            reminder.textContent = `已漫游 ${formatDurationAsClock(elapsedMs)}`;
        };

        refreshText();
        reminder.classList.add('active');
        clearRoamDurationReminderTimer();
        roamDurationReminderTimer = window.setInterval(() => {
            if (!getSwitchState()) {
                updateRoamDurationReminderVisibility(false);
                return;
            }
            refreshText();
        }, 1000);
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
        updateRoamDurationReminderVisibility(enabled);
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

    /** 同步自动漫游开关按钮状态（用于超时自动关闭场景） */
    function syncAutoSwitchButtonState(enabled) {
        const button = document.querySelector('.linuxdo-helper-auto-toggle-btn');
        if (!button) {
            return;
        }
        setToggleButtonIcon(button, enabled);
        button.title = enabled ? '停止Linuxdo助手' : '启动Linuxdo助手';
        button.setAttribute('aria-label', button.title);
        button.classList.toggle('active', enabled);
    }

    /**
     * 创建筛选开关图标
     * @param {boolean} enabled - 是否启用
     * @returns {SVGElement} SVG元素
     */
    function createSieveSVGIcon(enabled) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'fa d-icon svg-icon prefix-icon svg-string linuxdo-helper-toggle-icon');
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');

        svg.appendChild(createSvgElement('path', {
            d: 'M3 5h18l-7.4 8.1v5.1l-3.2 1.8v-6.9z',
            fill: 'currentColor',
            opacity: enabled ? '0.98' : '0.72'
        }));

        if (!enabled) {
            svg.appendChild(createSvgElement('path', {
                d: 'M5 19L19 5',
                fill: 'none',
                stroke: 'currentColor',
                'stroke-width': '2.2',
                'stroke-linecap': 'round'
            }));
        }

        return svg;
    }

    /** 更新筛选开关按钮图标 */
    function setSieveButtonIcon(buttonElement, enabled) {
        buttonElement.querySelectorAll('.linuxdo-helper-toggle-icon').forEach((node) => node.remove());
        buttonElement.appendChild(createSieveSVGIcon(enabled));
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
        iconLink.className = 'btn no-text icon btn-flat linuxdo-helper-toggle-btn linuxdo-helper-auto-toggle-btn';
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
     * 创建筛选功能开关按钮
     * @returns {HTMLElement} 开关按钮的 li 元素
     */
    function createSieveSwitchButton() {
        ensureToggleButtonStyle();

        const iconLi = document.createElement('li');
        iconLi.className = 'header-dropdown-toggle linuxdo-helper-toggle-item';

        const iconLink = document.createElement('a');
        iconLink.href = '#';
        iconLink.className = 'btn no-text icon btn-flat linuxdo-helper-toggle-btn';
        iconLink.tabIndex = 0;

        const isEnabled = getSieveSwitchState();
        iconLink.title = isEnabled ? '关闭主页筛选' : '开启主页筛选';
        iconLink.setAttribute('aria-label', iconLink.title);
        iconLink.classList.toggle('active', isEnabled);

        setSieveButtonIcon(iconLink, isEnabled);
        iconLi.appendChild(iconLink);

        iconLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const newState = toggleSieveSwitch();
            setSieveButtonIcon(iconLink, newState);
            iconLink.title = newState ? '关闭主页筛选' : '开启主页筛选';
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
    function insertSwitchButton(buttonElement, afterElement = null) {
        if (afterElement?.parentNode) {
            afterElement.parentNode.insertBefore(buttonElement, afterElement.nextSibling);
            return;
        }

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
        return switchButton;
    }

    /**
     * 创建并插入筛选开关图标到页面
     * @param {HTMLElement|null} afterElement - 参考元素（插入到其后）
     */
    async function createSieveSwitchIcon(afterElement = null) {
        const sieveSwitchButton = createSieveSwitchButton();
        await findChatButton(); // 等待聊天按钮加载
        insertSwitchButton(sieveSwitchButton, afterElement);
        return sieveSwitchButton;
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

    /** 归一化路径，避免尾随斜杠导致匹配失败 */
    function normalizePathname(pathname) {
        if (!pathname || pathname === '/') {
            return '/';
        }
        const normalized = pathname.replace(/\/+$/, '');
        return normalized || '/';
    }

    /** 是否为帖子列表页（首页/最新/热门/新帖） */
    function isTopicListPath() {
        const path = normalizePathname(window.location.pathname);
        return SIEVE_CONFIG.paths.includes(path);
    }

    /** 候选“加载更多”按钮是否可点击 */
    function isUsableLoadTrigger(element) {
        if (!(element instanceof HTMLElement)) {
            return false;
        }
        if (element.matches('[disabled], .disabled, [aria-disabled="true"]')) {
            return false;
        }
        return element.getClientRects().length > 0;
    }

    /** 查找页面中的“加载更多”触发元素 */
    function findNearBottomLoadTrigger() {
        for (const selector of NEAR_BOTTOM_AUTO_LOAD_CONFIG.triggerSelectors) {
            const element = document.querySelector(selector);
            if (isUsableLoadTrigger(element)) {
                return element;
            }
        }

        const textPattern = /加载更多|更多话题|show\s*more|load\s*more/i;
        const candidates = document.querySelectorAll('button, a');
        for (const element of candidates) {
            if (!isUsableLoadTrigger(element)) {
                continue;
            }
            const hintText = [
                element.textContent || '',
                element.getAttribute('title') || '',
                element.getAttribute('aria-label') || ''
            ].join(' ');
            if (textPattern.test(hintText)) {
                return element;
            }
        }

        return null;
    }

    /** 接近底部时自动触发加载（用于手动浏览与自动漫游） */
    function tryAutoLoadNearBottom() {
        if (!isTopicListPath()) {
            return false;
        }

        const scrollingElement = document.scrollingElement || document.documentElement;
        if (!scrollingElement) {
            return false;
        }

        const remainingPx =
            scrollingElement.scrollHeight -
            (scrollingElement.scrollTop + scrollingElement.clientHeight);
        const nearBottomThresholdPx =
            scrollingElement.clientHeight * NEAR_BOTTOM_AUTO_LOAD_CONFIG.nearBottomViewportRatio;
        if (remainingPx > nearBottomThresholdPx) {
            return false;
        }

        const now = Date.now();
        if (now - nearBottomAutoLoadLastTriggerAt < NEAR_BOTTOM_AUTO_LOAD_CONFIG.minTriggerGapMs) {
            return false;
        }
        nearBottomAutoLoadLastTriggerAt = now;

        const trigger = findNearBottomLoadTrigger();
        if (trigger) {
            trigger.click();
            console.log('接近底部，已自动触发加载更多');
            return true;
        }

        // 某些场景依赖滚动事件触发懒加载，兜底主动发一次。
        window.dispatchEvent(new Event('scroll'));
        return false;
    }

    /** 初始化“接近底部自动加载”（不依赖助手开关） */
    function initNearBottomAutoLoad() {
        if (nearBottomAutoLoadBound) {
            return;
        }

        nearBottomAutoLoadBound = true;
        const onCheck = () => {
            tryAutoLoadNearBottom();
        };

        window.addEventListener('scroll', onCheck, { passive: true });
        document.addEventListener('scroll', onCheck, { passive: true });
        nearBottomAutoLoadTimer = window.setInterval(
            onCheck,
            NEAR_BOTTOM_AUTO_LOAD_CONFIG.fallbackCheckIntervalMs
        );
    }

    // ==================== 主页筛选工具 ====================

    /**
     * 主页帖子筛选模块
     * 支持等级/分类/标签筛选，以及筛选预设的保存与加载。
     */
    class HomeSieveModule {
        constructor() {
            this.panel = null;
            this.statusEl = null;
            this.loopTimer = null;
            this.lastUrl = location.href;
            this.lastRowCount = 0;
            this.filterDirty = true;

            this.activeLevels = this.readStored(
                STORAGE_KEYS.sieveLevels,
                SIEVE_CONFIG.levels.map((item) => item.key)
            );
            this.activeCats = this.readStored(
                STORAGE_KEYS.sieveCats,
                SIEVE_CONFIG.categories.map((item) => item.id)
            );
            this.tagStates = this.readStored(STORAGE_KEYS.sieveTags, {});
            this.presets = this.readStored(STORAGE_KEYS.sievePresets, {});
        }

        readStored(key, fallback) {
            const value = GM_getValue(key, null);
            if (value === null || value === undefined) {
                return fallback;
            }
            if (Array.isArray(fallback) && !Array.isArray(value)) {
                return fallback;
            }
            if (
                typeof fallback === 'object' &&
                fallback !== null &&
                !Array.isArray(fallback) &&
                (typeof value !== 'object' || value === null || Array.isArray(value))
            ) {
                return fallback;
            }
            return value;
        }

        isHomePage() {
            return SIEVE_CONFIG.paths.includes(window.location.pathname);
        }

        hasActiveFilter() {
            const allLevel = this.activeLevels.length === SIEVE_CONFIG.levels.length;
            const allCategory = this.activeCats.length === SIEVE_CONFIG.categories.length;
            const hasTagFilter = Object.keys(this.tagStates).length > 0;
            return !(allLevel && allCategory && !hasTagFilter);
        }

        init() {
            this.ensureStyles();
            this.onRouteChange();
            this.startLoop();
        }

        destroy() {
            if (this.loopTimer) {
                clearInterval(this.loopTimer);
                this.loopTimer = null;
            }
            this.removePanel();
            this.showAllTopics();
        }

        ensureStyles() {
            if (document.getElementById(SIEVE_UI_IDS.style)) {
                return;
            }

            const style = document.createElement('style');
            style.id = SIEVE_UI_IDS.style;
            style.textContent = `
                #${SIEVE_UI_IDS.panel} {
                    margin-bottom: 14px;
                    padding: 12px 14px;
                    border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.12));
                    border-radius: 10px;
                    background: var(--secondary, rgba(255, 255, 255, 0.96));
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
                    position: relative;
                    font-size: 13px;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-row {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px;
                    padding: 8px 0;
                    border-bottom: 1px dashed var(--primary-low, rgba(0, 0, 0, 0.12));
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-row:last-child {
                    border-bottom: none;
                    padding-bottom: 0;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-title {
                    min-width: 34px;
                    color: var(--primary, #444);
                    font-weight: 600;
                    user-select: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-action {
                    padding: 3px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.16));
                    color: var(--primary-medium, #666);
                    font-size: 11px;
                    cursor: pointer;
                    user-select: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-action:hover {
                    border-color: #3b82f6;
                    color: #3b82f6;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-btn {
                    padding: 4px 9px;
                    border-radius: 5px;
                    border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.16));
                    font-size: 12px;
                    cursor: pointer;
                    color: var(--primary, #333);
                    user-select: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    white-space: nowrap;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-btn:hover {
                    border-color: #3b82f6;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-btn.active {
                    color: #16a34a;
                    border-color: #16a34a;
                    font-weight: 600;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-btn.exclude {
                    color: #dc2626;
                    border-color: #dc2626;
                    font-weight: 600;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-btn svg {
                    width: 10px;
                    height: 10px;
                    fill: currentColor;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-presets {
                    display: inline-flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 6px;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset {
                    display: inline-flex;
                    align-items: center;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset-name,
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset-del {
                    padding: 4px 8px;
                    border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.16));
                    font-size: 12px;
                    cursor: pointer;
                    user-select: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset-name {
                    border-radius: 5px 0 0 5px;
                    border-right: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset-del {
                    border-radius: 0 5px 5px 0;
                    color: #888;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-preset-del:hover {
                    color: #dc2626;
                    border-color: #dc2626;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-save-wrap {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-save-input {
                    width: 86px;
                    padding: 4px 8px;
                    border-radius: 5px;
                    border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.16));
                    font-size: 12px;
                    outline: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-save-input:focus {
                    border-color: #3b82f6;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-save-btn {
                    padding: 4px 10px;
                    border-radius: 5px;
                    border: 1px solid #3b82f6;
                    background: #3b82f6;
                    color: #fff;
                    font-size: 12px;
                    cursor: pointer;
                    user-select: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-save-btn:hover {
                    opacity: 0.9;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-empty {
                    font-size: 11px;
                    color: #9ca3af;
                    font-style: italic;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-status {
                    position: absolute;
                    top: 10px;
                    right: 12px;
                    font-size: 11px;
                    color: #6b7280;
                    opacity: 0;
                    transition: opacity 180ms ease;
                    pointer-events: none;
                }
                #${SIEVE_UI_IDS.panel} .linuxdo-sieve-status.visible {
                    opacity: 1;
                }
            `;

            document.head.appendChild(style);
        }

        createPanel() {
            if (!this.isHomePage()) {
                return;
            }

            const existing = document.getElementById(SIEVE_UI_IDS.panel);
            if (existing) {
                this.panel = existing;
                this.statusEl = existing.querySelector('.linuxdo-sieve-status');
                return;
            }

            const target = document.querySelector('.list-controls') || document.querySelector('.topic-list');
            if (!target || !target.parentNode) {
                return;
            }

            const panel = document.createElement('div');
            panel.id = SIEVE_UI_IDS.panel;
            panel.innerHTML = this.renderPanelHTML();
            target.parentNode.insertBefore(panel, target);

            this.panel = panel;
            this.statusEl = panel.querySelector('.linuxdo-sieve-status');
            this.bindEvents();
        }

        removePanel() {
            const panel = document.getElementById(SIEVE_UI_IDS.panel);
            if (panel) {
                panel.remove();
            }
            this.panel = null;
            this.statusEl = null;
        }

        renderPanelHTML() {
            const checkIcon = '<svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
            const banIcon = '<svg viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path></svg>';

            const levelButtons = SIEVE_CONFIG.levels.map((item) => {
                const active = this.activeLevels.includes(item.key);
                return `<span class="linuxdo-sieve-btn${active ? ' active' : ''}" data-type="level" data-key="${item.key}">${active ? checkIcon : ''}${item.label}</span>`;
            }).join('');

            const categoryButtons = SIEVE_CONFIG.categories.map((item) => {
                const active = this.activeCats.includes(item.id);
                return `<span class="linuxdo-sieve-btn${active ? ' active' : ''}" data-type="cat" data-key="${item.id}">${active ? checkIcon : ''}${item.name}</span>`;
            }).join('');

            const tagButtons = SIEVE_CONFIG.tags.map((tag) => {
                const state = this.tagStates[tag] || SIEVE_CONFIG.state.neutral;
                let className = 'linuxdo-sieve-btn';
                let icon = '';
                if (state === SIEVE_CONFIG.state.include) {
                    className += ' active';
                    icon = checkIcon;
                } else if (state === SIEVE_CONFIG.state.exclude) {
                    className += ' exclude';
                    icon = banIcon;
                }
                return `<span class="${className}" data-type="tag" data-key="${tag}">${icon}${tag}</span>`;
            }).join('');

            return `
                <div class="linuxdo-sieve-status"></div>
                <div class="linuxdo-sieve-row">
                    <span class="linuxdo-sieve-title">等级</span>
                    <span class="linuxdo-sieve-action" data-action="toggle-level">全选</span>
                    ${levelButtons}
                </div>
                <div class="linuxdo-sieve-row">
                    <span class="linuxdo-sieve-title">分类</span>
                    <span class="linuxdo-sieve-action" data-action="toggle-cat">全选</span>
                    ${categoryButtons}
                </div>
                <div class="linuxdo-sieve-row">
                    <span class="linuxdo-sieve-title">标签</span>
                    <span class="linuxdo-sieve-action" data-action="reset-tag">重置</span>
                    ${tagButtons}
                </div>
                <div class="linuxdo-sieve-row">
                    <span class="linuxdo-sieve-title">预设</span>
                    <div class="linuxdo-sieve-presets">${this.renderPresetChips()}</div>
                    <span class="linuxdo-sieve-save-wrap">
                        <input type="text" class="linuxdo-sieve-save-input" placeholder="名称" maxlength="10">
                        <span class="linuxdo-sieve-save-btn">保存</span>
                    </span>
                </div>
            `;
        }

        renderPresetChips() {
            const names = Object.keys(this.presets || {});
            if (names.length === 0) {
                return '<span class="linuxdo-sieve-empty">暂无预设</span>';
            }
            return names.map((name) => {
                return `
                    <span class="linuxdo-sieve-preset" data-preset="${name}">
                        <span class="linuxdo-sieve-preset-name">${name}</span>
                        <span class="linuxdo-sieve-preset-del">×</span>
                    </span>
                `;
            }).join('');
        }

        refreshPresetChips() {
            if (!this.panel) {
                return;
            }
            const wrapper = this.panel.querySelector('.linuxdo-sieve-presets');
            if (!wrapper) {
                return;
            }
            wrapper.innerHTML = this.renderPresetChips();
        }

        bindEvents() {
            if (!this.panel) {
                return;
            }

            this.panel.addEventListener('click', (event) => {
                const target = event.target.closest('[data-action], [data-type], .linuxdo-sieve-preset-name, .linuxdo-sieve-preset-del, .linuxdo-sieve-save-btn');
                if (!target) {
                    return;
                }

                if (target.dataset.action) {
                    this.handleAction(target.dataset.action);
                    return;
                }

                if (target.dataset.type) {
                    this.handleFilterButton(target);
                    return;
                }

                if (target.classList.contains('linuxdo-sieve-preset-name')) {
                    const presetName = target.closest('.linuxdo-sieve-preset')?.dataset.preset;
                    if (presetName) {
                        this.loadPreset(presetName);
                    }
                    return;
                }

                if (target.classList.contains('linuxdo-sieve-preset-del')) {
                    const presetName = target.closest('.linuxdo-sieve-preset')?.dataset.preset;
                    if (presetName && confirm(`确定删除预设 "${presetName}"？`)) {
                        this.deletePreset(presetName);
                    }
                    return;
                }

                if (target.classList.contains('linuxdo-sieve-save-btn')) {
                    const input = this.panel.querySelector('.linuxdo-sieve-save-input');
                    const name = input?.value.trim();
                    if (name) {
                        this.savePreset(name);
                        input.value = '';
                    }
                }
            });

            const input = this.panel.querySelector('.linuxdo-sieve-save-input');
            if (input) {
                input.addEventListener('keydown', (event) => {
                    if (event.key !== 'Enter') {
                        return;
                    }
                    const name = input.value.trim();
                    if (!name) {
                        return;
                    }
                    this.savePreset(name);
                    input.value = '';
                });
            }
        }

        handleAction(action) {
            if (action === 'toggle-level') {
                if (this.activeLevels.length === SIEVE_CONFIG.levels.length) {
                    this.activeLevels = [];
                } else {
                    this.activeLevels = SIEVE_CONFIG.levels.map((item) => item.key);
                }
                GM_setValue(STORAGE_KEYS.sieveLevels, this.activeLevels);
            } else if (action === 'toggle-cat') {
                if (this.activeCats.length === SIEVE_CONFIG.categories.length) {
                    this.activeCats = [];
                } else {
                    this.activeCats = SIEVE_CONFIG.categories.map((item) => item.id);
                }
                GM_setValue(STORAGE_KEYS.sieveCats, this.activeCats);
            } else if (action === 'reset-tag') {
                this.tagStates = {};
                GM_setValue(STORAGE_KEYS.sieveTags, this.tagStates);
            }

            this.filterDirty = true;
            this.updateButtonStates();
            this.filterTopics();
        }

        handleFilterButton(button) {
            const checkIcon = '<svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
            const banIcon = '<svg viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path></svg>';
            const buttonType = button.dataset.type;
            const key = button.dataset.key;

            if (buttonType === 'level') {
                const existingIndex = this.activeLevels.indexOf(key);
                const label = SIEVE_CONFIG.levels.find((item) => item.key === key)?.label || key;
                if (existingIndex >= 0) {
                    this.activeLevels.splice(existingIndex, 1);
                    button.classList.remove('active');
                    button.innerHTML = label;
                } else {
                    this.activeLevels.push(key);
                    button.classList.add('active');
                    button.innerHTML = `${checkIcon}${label}`;
                }
                GM_setValue(STORAGE_KEYS.sieveLevels, this.activeLevels);
            } else if (buttonType === 'cat') {
                const existingIndex = this.activeCats.indexOf(key);
                const label = SIEVE_CONFIG.categories.find((item) => item.id === key)?.name || key;
                if (existingIndex >= 0) {
                    this.activeCats.splice(existingIndex, 1);
                    button.classList.remove('active');
                    button.innerHTML = label;
                } else {
                    this.activeCats.push(key);
                    button.classList.add('active');
                    button.innerHTML = `${checkIcon}${label}`;
                }
                GM_setValue(STORAGE_KEYS.sieveCats, this.activeCats);
            } else if (buttonType === 'tag') {
                let state = this.tagStates[key] || SIEVE_CONFIG.state.neutral;
                state = (state + 1) % 3;
                if (state === SIEVE_CONFIG.state.neutral) {
                    delete this.tagStates[key];
                    button.classList.remove('active', 'exclude');
                    button.innerHTML = key;
                } else if (state === SIEVE_CONFIG.state.include) {
                    this.tagStates[key] = state;
                    button.classList.add('active');
                    button.classList.remove('exclude');
                    button.innerHTML = `${checkIcon}${key}`;
                } else {
                    this.tagStates[key] = state;
                    button.classList.remove('active');
                    button.classList.add('exclude');
                    button.innerHTML = `${banIcon}${key}`;
                }
                GM_setValue(STORAGE_KEYS.sieveTags, this.tagStates);
            }

            this.filterDirty = true;
            this.filterTopics();
        }

        updateButtonStates() {
            if (!this.panel) {
                return;
            }

            const checkIcon = '<svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
            const banIcon = '<svg viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path></svg>';

            this.panel.querySelectorAll('[data-type="level"]').forEach((button) => {
                const key = button.dataset.key;
                const label = SIEVE_CONFIG.levels.find((item) => item.key === key)?.label || key;
                const active = this.activeLevels.includes(key);
                button.className = `linuxdo-sieve-btn${active ? ' active' : ''}`;
                button.innerHTML = `${active ? checkIcon : ''}${label}`;
            });

            this.panel.querySelectorAll('[data-type="cat"]').forEach((button) => {
                const key = button.dataset.key;
                const label = SIEVE_CONFIG.categories.find((item) => item.id === key)?.name || key;
                const active = this.activeCats.includes(key);
                button.className = `linuxdo-sieve-btn${active ? ' active' : ''}`;
                button.innerHTML = `${active ? checkIcon : ''}${label}`;
            });

            this.panel.querySelectorAll('[data-type="tag"]').forEach((button) => {
                const key = button.dataset.key;
                const state = this.tagStates[key] || SIEVE_CONFIG.state.neutral;
                let className = 'linuxdo-sieve-btn';
                let icon = '';
                if (state === SIEVE_CONFIG.state.include) {
                    className += ' active';
                    icon = checkIcon;
                } else if (state === SIEVE_CONFIG.state.exclude) {
                    className += ' exclude';
                    icon = banIcon;
                }
                button.className = className;
                button.innerHTML = `${icon}${key}`;
            });
        }

        savePreset(name) {
            this.presets[name] = {
                levels: [...this.activeLevels],
                cats: [...this.activeCats],
                tags: { ...this.tagStates }
            };
            GM_setValue(STORAGE_KEYS.sievePresets, this.presets);
            this.refreshPresetChips();
        }

        loadPreset(name) {
            const preset = this.presets[name];
            if (!preset) {
                return;
            }
            this.activeLevels = [...(preset.levels || [])];
            this.activeCats = [...(preset.cats || [])];
            this.tagStates = { ...(preset.tags || {}) };

            GM_setValue(STORAGE_KEYS.sieveLevels, this.activeLevels);
            GM_setValue(STORAGE_KEYS.sieveCats, this.activeCats);
            GM_setValue(STORAGE_KEYS.sieveTags, this.tagStates);

            this.filterDirty = true;
            this.updateButtonStates();
            this.filterTopics();
        }

        deletePreset(name) {
            delete this.presets[name];
            GM_setValue(STORAGE_KEYS.sievePresets, this.presets);
            this.refreshPresetChips();
        }

        showAllTopics() {
            const rows = document.querySelectorAll('.topic-list-body tr.topic-list-item');
            rows.forEach((row) => {
                row.style.display = '';
            });
        }

        filterTopics() {
            const rows = document.querySelectorAll('.topic-list-body tr.topic-list-item');
            if (!rows.length) {
                this.updateStatus('');
                return 0;
            }

            if (!this.hasActiveFilter()) {
                this.showAllTopics();
                this.updateStatus('');
                return rows.length;
            }

            const includeTags = [];
            const excludeTags = [];
            SIEVE_CONFIG.tags.forEach((tag) => {
                const state = this.tagStates[tag] || SIEVE_CONFIG.state.neutral;
                if (state === SIEVE_CONFIG.state.include) {
                    includeTags.push(tag);
                } else if (state === SIEVE_CONFIG.state.exclude) {
                    excludeTags.push(tag);
                }
            });

            const allLevel = this.activeLevels.length === SIEVE_CONFIG.levels.length;
            const allCategory = this.activeCats.length === SIEVE_CONFIG.categories.length;
            let visibleCount = 0;

            rows.forEach((row) => {
                const classText = row.className || '';
                const classList = Array.from(row.classList || []);

                let levelMatch = allLevel;
                if (!levelMatch) {
                    levelMatch = SIEVE_CONFIG.levels.some((item) => {
                        return this.activeLevels.includes(item.key) && item.check(classText);
                    });
                }

                let categoryMatch = allCategory;
                if (levelMatch && !categoryMatch) {
                    const categoryNode = row.querySelector('.badge-category__wrapper span[data-category-id], .badge-category span[data-category-id]');
                    if (categoryNode) {
                        const categoryId = categoryNode.getAttribute('data-category-id');
                        const parentId = categoryNode.getAttribute('data-parent-category-id');
                        categoryMatch = this.activeCats.includes(categoryId) || (parentId && this.activeCats.includes(parentId));
                    } else {
                        categoryMatch = true;
                    }
                }

                let tagMatch = true;
                if (levelMatch && categoryMatch) {
                    const rowTags = classList
                        .filter((token) => token.startsWith('tag-'))
                        .map((token) => {
                            try {
                                return decodeURIComponent(token.slice(4));
                            } catch (_error) {
                                return token.slice(4);
                            }
                        });
                    const noTag = rowTags.length === 0;

                    if (excludeTags.length > 0) {
                        if (noTag && excludeTags.includes('无标签')) {
                            tagMatch = false;
                        } else if (rowTags.some((tag) => excludeTags.includes(tag))) {
                            tagMatch = false;
                        }
                    }

                    if (tagMatch && includeTags.length > 0) {
                        if (noTag) {
                            tagMatch = includeTags.includes('无标签');
                        } else {
                            tagMatch = rowTags.some((tag) => includeTags.includes(tag));
                        }
                    }
                }

                const visible = levelMatch && categoryMatch && tagMatch;
                row.style.display = visible ? '' : 'none';
                if (visible) {
                    visibleCount += 1;
                }
            });

            this.updateStatus(`筛选中 (${visibleCount} 条)`);
            return visibleCount;
        }

        updateStatus(text) {
            if (!this.statusEl) {
                return;
            }
            this.statusEl.textContent = text;
            this.statusEl.className = `linuxdo-sieve-status${text ? ' visible' : ''}`;
        }

        startLoop() {
            if (this.loopTimer) {
                return;
            }
            this.loopTimer = window.setInterval(() => this.tick(), 1200);
        }

        tick() {
            if (location.href !== this.lastUrl) {
                this.lastUrl = location.href;
                this.onRouteChange();
            }

            if (!this.isHomePage()) {
                return;
            }

            if (!this.panel || !document.getElementById(SIEVE_UI_IDS.panel)) {
                this.createPanel();
            }

            const rows = document.querySelectorAll('.topic-list-body tr.topic-list-item');
            const hasChanged = this.filterDirty || rows.length !== this.lastRowCount;
            if (!hasChanged) {
                return;
            }

            this.lastRowCount = rows.length;
            this.filterDirty = false;
            this.filterTopics();
        }

        onRouteChange() {
            if (this.isHomePage()) {
                this.createPanel();
                this.filterDirty = true;
                this.lastRowCount = 0;
                this.filterTopics();
            } else {
                this.removePanel();
                this.showAllTopics();
            }
        }
    }

    // ==================== 核心功能 ====================

    /** 当前运行的滚动定时器引用 */
    let currentScrollTimer = null;
    
    /** 当前评论元素引用 */
    let currentCommentElement = null;

    /** 当前人类行为状态 */
    let humanBehaviorState = null;

    /** 主页筛选工具实例 */
    let homeSieveModule = null;

    /** 接近底部自动加载监听是否已绑定 */
    let nearBottomAutoLoadBound = false;

    /** 上次触发接近底部自动加载的时间 */
    let nearBottomAutoLoadLastTriggerAt = 0;

    /** 接近底部自动加载兜底轮询定时器 */
    let nearBottomAutoLoadTimer = null;

    /** 初始化主页筛选工具（只初始化一次） */
    function initHomeSieveTool() {
        if (homeSieveModule) {
            return;
        }
        homeSieveModule = new HomeSieveModule();
        homeSieveModule.init();
    }

    /** 销毁主页筛选工具 */
    function destroyHomeSieveTool() {
        if (!homeSieveModule) {
            return;
        }
        homeSieveModule.destroy();
        homeSieveModule = null;
    }

    /** 按当前开关状态应用主页筛选功能 */
    function applySieveToolState() {
        if (getSieveSwitchState()) {
            initHomeSieveTool();
        } else {
            destroyHomeSieveTool();
        }
    }

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

            tryAutoLoadNearBottom();

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
        const autoSwitchButton = await createSwitchIcon();
        await createSieveSwitchIcon(autoSwitchButton);
        updateRunningHaloVisibility();

        // 始终启用“接近底部自动加载”，支持手动浏览场景
        initNearBottomAutoLoad();

        // 初始化主页筛选工具（由筛选开关控制）
        applySieveToolState();
        
        // 如果助手未启用，不执行后续操作
        if (!getSwitchState()) {
            clearAutoStopTimer();
            clearRoamStartTime();
            return;
        }

        scheduleAutoStop();

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
