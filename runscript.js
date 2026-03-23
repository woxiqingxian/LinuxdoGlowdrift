// ==UserScript==
// @name         Linuxdo流光漫游
// @namespace    https://github.com/woxiqingxian/LinuxdoGlowdrift
// @version      2026.03.24.0016
// @description  Linuxdo论坛自动漫游助手（人类浏览节奏 + 主页筛选工具 + 配色注入）
// @author       Cressida
// @match        https://linux.do/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
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
        sieveDefaultTab: 'linuxdoSieveDefaultTab',
        sievePresets: 'linuxdoSievePresets',
        horizonPalette: 'linuxdoHorizonPalette'
    };

    /** 当前标签页会话存储键名（用于区分不同窗口/标签） */
    const SESSION_KEYS = {
        enabled: 'linuxdoHelperEnabledInTab',
        migrated: 'linuxdoHelperLegacySwitchMigrated',
        sieveEnabled: 'linuxdoSieveEnabledInTab',
        startedAt: 'linuxdoHelperStartedAtInTab',
        accountedAt: 'linuxdoHelperAccountedAtInTab',
        horizonThemeForced: 'linuxdoHorizonThemeForcedInTab'
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
        roamDurationReminderStyle: 'linuxdo-roam-duration-reminder-style',
        horizonPaletteStyle: 'linuxdo-horizon-palette-style',
        hiddenThirdPartyStyle: 'linuxdo-hidden-third-party-style',
        topicPreviewStyle: 'linuxdo-topic-preview-style',
        topicPreviewRoot: 'linuxdo-topic-preview-root'
    };

    /** Horizon 主题配色注入配置 */
    const HORIZON_THEME_CONFIG = {
        themeId: '-2',
        paletteDefault: 'default',
        paletteBeige: 'beige',
        beigeActiveClass: 'linuxdo-horizon-beige-active'
    };

    /** 话题预览配置 */
    const TOPIC_PREVIEW_CONFIG = {
        initialPosts: 30,
        preloadRemainingThreshold: 10,
        backgroundBatchSize: 20,
        loopIntervalMs: 900
    };

    /** Discourse 帖子动作类型 */
    const POST_ACTION_TYPES = {
        like: 2
    };

    if (ensureDefaultHorizonTheme()) {
        return;
    }

    applyEarlyHorizonPaletteBoot();

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
        tabs: [
            { key: 'new', label: 'New', path: '/new' },
            { key: 'latest', label: 'Latest', path: '/latest' }
        ],
        refillVisibleTarget: 12,
        refillCooldownMs: 2500,
        refillMaxAttempts: 3,
        refillSettleMs: 1200,
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

    function normalizeVisitedLink(href) {
        if (!href) {
            return '';
        }

        try {
            const url = new URL(href, location.origin);
            const topicMatch = url.pathname.match(/^\/t\/[^/]+\/(\d+)(?:\/\d+)?\/?$/);
            if (topicMatch) {
                return `${location.origin}/t/${topicMatch[1]}`;
            }
            url.hash = '';
            url.search = '';
            return url.href.replace(/\/$/, '');
        } catch (error) {
            return String(href || '').replace(/[#?].*$/, '').replace(/\/$/, '');
        }
    }

    function getVisitedLinkSet() {
        const visitedLinks = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.visitedLinks) || '[]'
        );
        return new Set(
            visitedLinks
                .map((href) => normalizeVisitedLink(href))
                .filter(Boolean)
        );
    }

    function persistVisitedLinkSet(visitedSet) {
        localStorage.setItem(
            STORAGE_KEYS.visitedLinks,
            JSON.stringify(Array.from(visitedSet))
        );
    }

    function markVisitedLink(href) {
        const normalizedHref = normalizeVisitedLink(href);
        if (!normalizedHref) {
            return;
        }

        const visitedSet = getVisitedLinkSet();
        if (visitedSet.has(normalizedHref)) {
            return;
        }
        visitedSet.add(normalizedHref);
        persistVisitedLinkSet(visitedSet);
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

    /** 设置当前标签页上次累计结算时间戳 */
    function setRoamAccountedAt(timestampMs) {
        sessionStorage.setItem(SESSION_KEYS.accountedAt, String(timestampMs));
    }

    /** 获取当前标签页上次累计结算时间戳 */
    function getRoamAccountedAt() {
        const raw = sessionStorage.getItem(SESSION_KEYS.accountedAt);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }
        return parsed;
    }

    /** 清理当前标签页上次累计结算时间戳 */
    function clearRoamAccountedAt() {
        sessionStorage.removeItem(SESSION_KEYS.accountedAt);
    }

    /** 获取本地日期键（YYYY-MM-DD） */
    function getDateKey(timestampMs) {
        const date = new Date(timestampMs);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /** 获取当天零点时间戳 */
    function getDayStartTimestamp(timestampMs) {
        const date = new Date(timestampMs);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }

    /** 读取历史累计漫游时长（毫秒） */
    function readRoamHistoryMs() {
        const value = Number(GM_getValue(STORAGE_KEYS.roamHistoryMs, 0));
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    /** 保存历史累计漫游时长（毫秒） */
    function saveRoamHistoryMs(durationMs) {
        GM_setValue(STORAGE_KEYS.roamHistoryMs, Math.max(0, Math.floor(durationMs)));
    }

    /** 读取“今日累计”状态 */
    function readRoamTodayStat(referenceTimestampMs = Date.now()) {
        const todayKey = getDateKey(referenceTimestampMs);
        const fallback = { date: todayKey, ms: 0 };
        const rawValue = GM_getValue(STORAGE_KEYS.roamTodayStat, fallback);
        if (!rawValue || typeof rawValue !== 'object') {
            return fallback;
        }

        const savedDate = typeof rawValue.date === 'string' ? rawValue.date : todayKey;
        const savedMs = Number(rawValue.ms);
        const normalizedMs = Number.isFinite(savedMs) && savedMs > 0 ? Math.floor(savedMs) : 0;
        if (savedDate !== todayKey) {
            return { date: todayKey, ms: 0 };
        }
        return { date: savedDate, ms: normalizedMs };
    }

    /** 保存“今日累计”状态 */
    function saveRoamTodayStat(stat) {
        const date = typeof stat?.date === 'string' ? stat.date : getDateKey(Date.now());
        const durationMs = Number(stat?.ms);
        const safeMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 0;
        GM_setValue(STORAGE_KEYS.roamTodayStat, { date, ms: safeMs });
    }

    /** 将一段时长结算到“历史累计/今日累计” */
    function addRoamDurationToStats(rangeStartMs, rangeEndMs) {
        const startMs = Number(rangeStartMs);
        const endMs = Number(rangeEndMs);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
            return;
        }

        const deltaMs = endMs - startMs;
        const historyMs = readRoamHistoryMs();
        saveRoamHistoryMs(historyMs + deltaMs);

        const todayStat = readRoamTodayStat(endMs);
        const currentDayStart = getDayStartTimestamp(endMs);
        const currentDayEnd = currentDayStart + ONE_DAY_MS;
        const overlapStart = Math.max(startMs, currentDayStart);
        const overlapEnd = Math.min(endMs, currentDayEnd);
        const todayDeltaMs = Math.max(0, overlapEnd - overlapStart);
        if (todayDeltaMs > 0) {
            saveRoamTodayStat({
                date: todayStat.date,
                ms: todayStat.ms + todayDeltaMs
            });
        } else {
            saveRoamTodayStat(todayStat);
        }
    }

    /** 结算本标签页当前漫游区间 */
    function syncRoamAccumulationCheckpoint(nowTimestampMs = Date.now(), force = false) {
        if (!force && !getSwitchState()) {
            return;
        }

        let roamStartTime = getRoamStartTime();
        if (roamStartTime === null) {
            roamStartTime = nowTimestampMs;
            setRoamStartTime(roamStartTime);
        }

        let lastAccountedAt = getRoamAccountedAt();
        if (lastAccountedAt === null || lastAccountedAt < roamStartTime) {
            lastAccountedAt = roamStartTime;
        }

        if (nowTimestampMs <= lastAccountedAt) {
            setRoamAccountedAt(lastAccountedAt);
            return;
        }

        addRoamDurationToStats(lastAccountedAt, nowTimestampMs);
        setRoamAccountedAt(nowTimestampMs);
    }

    /**
     * 设置当前标签页开关状态
     * @param {boolean} enabled - 是否启用
     */
    function setSwitchState(enabled) {
        migrateLegacySwitchState();
        if (enabled) {
            const now = Date.now();
            sessionStorage.setItem(SESSION_KEYS.enabled, '1');
            let roamStartTime = getRoamStartTime();
            if (roamStartTime === null) {
                roamStartTime = now;
                setRoamStartTime(roamStartTime);
            }
            const accountedAt = getRoamAccountedAt();
            if (
                accountedAt === null ||
                accountedAt < roamStartTime ||
                accountedAt > now
            ) {
                setRoamAccountedAt(roamStartTime);
            }
        } else {
            if (getSwitchState()) {
                syncRoamAccumulationCheckpoint(Date.now(), true);
            }
            sessionStorage.setItem(SESSION_KEYS.enabled, '0');
            clearRoamStartTime();
            clearRoamAccountedAt();
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
                    font-size: clamp(28px, 4.2vw, 52px);
                    font-weight: 800;
                    line-height: 1.42;
                    letter-spacing: 0.03em;
                    white-space: pre-line;
                    text-align: center;
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
            reminder.textContent = [
                '历史累计漫游：00:00:00',
                '今天累计漫游：00:00:00',
                '本次累计漫游：00:00:00'
            ].join('\n');
            document.body.appendChild(reminder);
        }
    }

    /** 隐藏不需要的第三方按钮 */
    function ensureHiddenThirdPartyStyle() {
        if (document.getElementById(UI_IDS.hiddenThirdPartyStyle)) {
            return;
        }

        const style = document.createElement('style');
        style.id = UI_IDS.hiddenThirdPartyStyle;
        style.textContent = `
            .donottopic-btn {
                display: none !important;
            }

            .sidebar-wrapper,
            .sidebar-container,
            .sidebar-scroll-wrap,
            .sidebar-sections {
                scrollbar-width: none;
                -ms-overflow-style: none;
            }

            .sidebar-wrapper::-webkit-scrollbar,
            .sidebar-container::-webkit-scrollbar,
            .sidebar-scroll-wrap::-webkit-scrollbar,
            .sidebar-sections::-webkit-scrollbar {
                width: 0 !important;
                height: 0 !important;
                display: none !important;
            }
        `;
        document.head.appendChild(style);
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
            reminder.textContent = [
                '历史累计漫游：00:00:00',
                '今天累计漫游：00:00:00',
                '本次累计漫游：00:00:00'
            ].join('\n');
            return;
        }

        let roamStartTime = getRoamStartTime();
        if (roamStartTime === null) {
            roamStartTime = Date.now();
            setRoamStartTime(roamStartTime);
            setRoamAccountedAt(roamStartTime);
        }

        const refreshText = () => {
            const now = Date.now();
            syncRoamAccumulationCheckpoint(now);
            const historyMs = readRoamHistoryMs();
            const todayMs = readRoamTodayStat(now).ms;
            const currentSessionMs = Math.max(0, now - roamStartTime);
            reminder.textContent = [
                `历史累计漫游：${formatDurationAsClock(historyMs)}`,
                `今天累计漫游：${formatDurationAsClock(todayMs)}`,
                `本次累计漫游：${formatDurationAsClock(currentSessionMs)}`
            ].join('\n');
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

    /** 读取指定 Cookie 值 */
    function getCookieValue(cookieName) {
        const escapedName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`));
        return match ? decodeURIComponent(match[1]) : '';
    }

    /** 读取当前主题 ID */
    function getCurrentThemeId() {
        const rawThemeIds = getCookieValue('theme_ids');
        if (!rawThemeIds) {
            return '';
        }
        return rawThemeIds.split('|')[0] || '';
    }

    /** 设置站点主题 Cookie */
    function setCurrentThemeId(themeId) {
        const rawThemeIds = getCookieValue('theme_ids');
        const separatorIndex = rawThemeIds.indexOf('|');
        const suffix = separatorIndex >= 0 ? rawThemeIds.slice(separatorIndex + 1) : '';
        const nextThemeIds = suffix ? `${themeId}|${suffix}` : themeId;
        document.cookie = `theme_ids=${encodeURIComponent(nextThemeIds)}; path=/; max-age=31536000; SameSite=Lax`;
    }

    /** 确保默认使用 Horizon 主题 */
    function ensureDefaultHorizonTheme() {
        const currentThemeId = getCurrentThemeId();
        if (currentThemeId === HORIZON_THEME_CONFIG.themeId) {
            sessionStorage.removeItem(SESSION_KEYS.horizonThemeForced);
            return false;
        }

        if (sessionStorage.getItem(SESSION_KEYS.horizonThemeForced) === '1') {
            return false;
        }

        sessionStorage.setItem(SESSION_KEYS.horizonThemeForced, '1');
        setCurrentThemeId(HORIZON_THEME_CONFIG.themeId);
        window.location.replace(window.location.href);
        return true;
    }

    /** 将样式节点插入文档，兼容 document-start 时机 */
    function appendStyleNode(styleElement) {
        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(styleElement);
        }
    }

    /** Horizon 自定义配色样式文本 */
    function getHorizonPaletteStyleText() {
        return `
            .linuxdo-horizon-beige-menu-item .user-color-palette-menu__item-choice {
                position: relative;
            }
            .linuxdo-horizon-beige-menu-item.active .user-color-palette-menu__item-choice {
                color: #667789;
                font-weight: 700;
            }
            .linuxdo-horizon-beige-menu-item.active .user-color-palette-menu__item-choice::after {
                content: '当前';
                margin-left: auto;
                font-size: 11px;
                color: #7c8b99;
                opacity: 0.95;
            }
            :root.${HORIZON_THEME_CONFIG.beigeActiveClass} {
                color-scheme: light;
                --primary: #2f3338;
                --primary-rgb: 47, 51, 56;
                --primary-very-high: #43484f;
                --primary-800: #575e67;
                --primary-700: #6a737d;
                --primary-400: #c8ced5;
                --primary-300: #d9dde2;
                --primary-low-mid: #dfe4e8;
                --primary-low: #e9edf0;
                --primary-very-low: #f7f8fa;
                --primary-or-primary-low-mid: #2f3338;
                --primary-med-or-secondary-high: #828b95;
                --secondary: #fbfbfc;
                --secondary-rgb: 251, 251, 252;
                --header_background: #f3f4f6;
                --header_background-rgb: 243, 244, 246;
                --header_primary: #31363c;
                --header_primary-very-high: #4a5057;
                --header_primary-low: #f8f9fa;
                --header_primary-low-mid: #dde2e7;
                --tertiary: #7c8b99;
                --tertiary-rgb: 124, 139, 153;
                --tertiary-hover: #697886;
                --tertiary-medium: #bcc7d1;
                --tertiary-low-or-tertiary-high: #e3e9ee;
                --tertiary-very-low: #f3f6f8;
                --tertiary-or-white: #7c8b99;
                --quaternary: #9aa6b1;
                --highlight: #ece8b8;
                --love: #c7848b;
                --danger: #b86262;
                --success: #6f9078;
                --link-color: #667789;
                --d-link-color: #667789;
                --d-hover: rgba(124, 139, 153, 0.12);
                --d-selected-hover: #ebeff3;
                --d-nav-color: #4f5963;
                --d-nav-color--hover: #667789;
                --d-nav-border-color--active: #7c8b99;
                --d-sidebar-background: linear-gradient(180deg, #f7f8fa 0%, #f2f4f6 100%);
                --d-sidebar-border-color: rgba(124, 139, 153, 0.18);
                --d-sidebar-highlight-background: rgba(124, 139, 153, 0.12);
                --d-sidebar-highlight-hover-background: rgba(124, 139, 153, 0.18);
                --d-sidebar-highlight-color: #31363c;
                --d-sidebar-highlight-prefix-color: #4f5963;
                --d-sidebar-highlight-suffix-color: #667789;
                --d-sidebar-link-icon-color: #7a8794;
                --d-sidebar-active-icon-color: #667789;
                --d-sidebar-header-color: #7a8794;
                --d-sidebar-prefix-color: #7a8794;
                --topic-list-item-background-color: #ffffff;
                --topic-list-item-background-color--visited: #fbfcfd;
                --topic-card-shadow: rgba(93, 103, 113, 0.08);
                --content-border-color: rgba(93, 103, 113, 0.12);
                --d-button-primary-bg-color: #7c8b99;
                --d-button-primary-bg-color--hover: #697886;
                --d-button-primary-text-color: #ffffff;
                --d-button-primary-text-color--hover: #ffffff;
                --d-button-primary-icon-color: #ffffff;
                --d-button-primary-icon-color--hover: #ffffff;
                --d-button-default-bg-color: #edf1f4;
                --d-button-default-text-color--hover: #ffffff;
                --d-button-flat-bg-color--hover: rgba(124, 139, 153, 0.12);
                --d-button-flat-bg-color--focus: rgba(124, 139, 153, 0.16);
                --d-button-flat-text-color--hover: #4f5963;
                --d-button-flat-icon-color--hover: #4f5963;
                --d-button-transparent-text-color--hover: #667789;
                --d-button-transparent-icon-color--hover: #667789;
                --d-input-border: 1px solid rgba(93, 103, 113, 0.16);
                --d-input-bg-color--disabled: #f1f3f5;
                --d-input-text-color: #2f3338;
                --jss_menu_background: #ffffff;
                --jss_header_background: #f4f6f7;
                --jss_header_background_highlighted: #e9edf1;
                --jss_header_color: #707983;
                --jss_content_color: #2f3338;
                --jss_content_color_highlighted: #707983;
                --reader-mode-bg-color: #ffffff;
                --fc-page-bg-color: #f8f9fb;
                --vimium-background-color: #ffffff;
                --vimium-foreground-text-color: #2f3338;
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} body {
                background:
                    radial-gradient(circle at top, rgba(232, 236, 240, 0.72), rgba(232, 236, 240, 0) 38%),
                    linear-gradient(180deg, #fafbfc 0%, #f6f7f9 320px, #f8f9fb 100%) !important;
                color: #2f3338;
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .d-header {
                background: rgba(245, 246, 248, 0.88) !important;
                border-bottom: 1px solid rgba(93, 103, 113, 0.10);
                backdrop-filter: blur(18px);
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .sidebar-wrapper,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .sidebar-container,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .menu-panel,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .select-kit-header,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .select-kit-body,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .fk-d-menu,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .search-menu,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .d-modal__container {
                background: #ffffff;
                border-color: rgba(93, 103, 113, 0.12);
                box-shadow: 0 12px 28px rgba(93, 103, 113, 0.07);
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .topic-list-body tr.topic-list-item > td,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .topic-post,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .discourse-post-container,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .category-box,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .category-list tbody tr {
                background: #ffffff;
                border-color: rgba(93, 103, 113, 0.10);
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} .btn-primary {
                box-shadow: 0 10px 22px rgba(93, 103, 113, 0.12);
            }
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} input,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} textarea,
            html.${HORIZON_THEME_CONFIG.beigeActiveClass} select {
                background: #ffffff;
                border-color: rgba(93, 103, 113, 0.14);
            }
        `;
    }

    /** 启动早期配色注入，避免页面先闪回原始 Horizon 配色 */
    function applyEarlyHorizonPaletteBoot() {
        const savedPalette = GM_getValue(
            STORAGE_KEYS.horizonPalette,
            HORIZON_THEME_CONFIG.paletteDefault
        );
        if (savedPalette !== HORIZON_THEME_CONFIG.paletteBeige) {
            return;
        }
        if (getCurrentThemeId() !== HORIZON_THEME_CONFIG.themeId) {
            return;
        }

        document.documentElement.classList.add(HORIZON_THEME_CONFIG.beigeActiveClass);

        if (document.getElementById(UI_IDS.horizonPaletteStyle)) {
            return;
        }

        const style = document.createElement('style');
        style.id = UI_IDS.horizonPaletteStyle;
        style.textContent = getHorizonPaletteStyleText();
        appendStyleNode(style);
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
            this.visibleCount = 0;
            this.isRefilling = false;
            this.waitingRefillResult = false;
            this.lastRefillAt = 0;
            this.refillAttempts = 0;
            this.refillExhausted = false;
            this.lastRefillRowCount = 0;
            this.refillRestoreScrollTop = null;

            this.activeLevels = this.readStored(
                STORAGE_KEYS.sieveLevels,
                SIEVE_CONFIG.levels.map((item) => item.key)
            );
            this.activeCats = this.readStored(
                STORAGE_KEYS.sieveCats,
                SIEVE_CONFIG.categories.map((item) => item.id)
            );
            this.tagStates = this.readStored(STORAGE_KEYS.sieveTags, {});
            this.defaultTab = this.normalizeTabKey(
                this.readStored(STORAGE_KEYS.sieveDefaultTab, 'latest')
            );
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

        normalizeTabKey(tabKey) {
            return SIEVE_CONFIG.tabs.some((item) => item.key === tabKey) ? tabKey : 'latest';
        }

        supportsTabToggle() {
            return this.isHomePage();
        }

        getCurrentTabKey() {
            const currentTab = SIEVE_CONFIG.tabs.find((item) => item.path === window.location.pathname);
            return currentTab ? currentTab.key : null;
        }

        getTabPath(tabKey) {
            return SIEVE_CONFIG.tabs.find((item) => item.key === tabKey)?.path || '/latest';
        }

        setDefaultTab(tabKey) {
            this.defaultTab = this.normalizeTabKey(tabKey);
            GM_setValue(STORAGE_KEYS.sieveDefaultTab, this.defaultTab);
        }

        navigateToTab(tabKey) {
            const targetPath = this.getTabPath(tabKey);
            if (window.location.pathname === targetPath) {
                return;
            }
            window.location.href = `${location.origin}${targetPath}`;
        }

        applyDefaultTab() {
            if (window.location.pathname !== '/') {
                return false;
            }
            const targetPath = this.getTabPath(this.defaultTab);
            if (!targetPath) {
                return false;
            }
            window.location.href = `${location.origin}${targetPath}`;
            return true;
        }

        init() {
            this.ensureStyles();
            if (this.applyDefaultTab()) {
                return;
            }
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
            const tabButtons = SIEVE_CONFIG.tabs.map((item) => {
                const active = this.defaultTab === item.key;
                return `<span class="linuxdo-sieve-btn${active ? ' active' : ''}" data-type="tab" data-key="${item.key}">${item.label}</span>`;
            }).join('');

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
                ${this.supportsTabToggle() ? `
                <div class="linuxdo-sieve-row">
                    <span class="linuxdo-sieve-title">默认Tab</span>
                    ${tabButtons}
                </div>
                ` : ''}
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

            this.resetRefillState({ resetCooldown: true });
            this.filterDirty = true;
            this.updateButtonStates();
            this.filterTopics();
        }

        handleFilterButton(button) {
            const checkIcon = '<svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
            const banIcon = '<svg viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path></svg>';
            const buttonType = button.dataset.type;
            const key = button.dataset.key;

            if (buttonType === 'tab') {
                this.setDefaultTab(key);
                this.updateButtonStates();
                this.navigateToTab(key);
                return;
            } else if (buttonType === 'level') {
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

            this.resetRefillState({ resetCooldown: true });
            this.filterDirty = true;
            this.filterTopics();
        }

        updateButtonStates() {
            if (!this.panel) {
                return;
            }

            const checkIcon = '<svg viewBox="0 0 448 512"><path d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"></path></svg>';
            const banIcon = '<svg viewBox="0 0 512 512"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"></path></svg>';

            this.panel.querySelectorAll('[data-type="tab"]').forEach((button) => {
                const active = this.defaultTab === button.dataset.key;
                button.className = `linuxdo-sieve-btn${active ? ' active' : ''}`;
            });

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
                defaultTab: this.defaultTab,
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
            this.setDefaultTab(preset.defaultTab || 'latest');

            GM_setValue(STORAGE_KEYS.sieveLevels, this.activeLevels);
            GM_setValue(STORAGE_KEYS.sieveCats, this.activeCats);
            GM_setValue(STORAGE_KEYS.sieveTags, this.tagStates);

            if (this.supportsTabToggle() && this.defaultTab !== this.getCurrentTabKey()) {
                this.navigateToTab(this.defaultTab);
                return;
            }

            this.resetRefillState({ resetCooldown: true });
            this.filterDirty = true;
            this.updateButtonStates();
            this.filterTopics();
        }

        deletePreset(name) {
            delete this.presets[name];
            GM_setValue(STORAGE_KEYS.sievePresets, this.presets);
            this.resetRefillState({ resetCooldown: true });
            this.filterDirty = true;
            this.refreshPresetChips();
            this.filterTopics();
        }

        getTopicRows() {
            return Array.from(document.querySelectorAll('.topic-list-body tr.topic-list-item'));
        }

        showAllTopics() {
            const rows = this.getTopicRows();
            rows.forEach((row) => {
                row.style.display = '';
            });
        }

        resetRefillState({ resetCooldown = false } = {}) {
            this.isRefilling = false;
            this.waitingRefillResult = false;
            this.refillAttempts = 0;
            this.refillExhausted = false;
            this.lastRefillRowCount = 0;
            this.refillRestoreScrollTop = null;
            if (resetCooldown) {
                this.lastRefillAt = 0;
            }
        }

        restoreRefillScrollPosition() {
            if (typeof this.refillRestoreScrollTop !== 'number') {
                return;
            }
            window.scrollTo({ top: this.refillRestoreScrollTop, behavior: 'auto' });
            this.refillRestoreScrollTop = null;
        }

        buildStatusText(filterResult) {
            if (!filterResult || !filterResult.hasActiveFilter || filterResult.totalRows === 0) {
                return '';
            }
            if (this.waitingRefillResult || this.isRefilling) {
                return `筛选中 (${filterResult.visibleCount} 条，补充中)`;
            }
            if (this.refillExhausted) {
                return `筛选中 (${filterResult.visibleCount} 条，暂无更多匹配项)`;
            }
            return `筛选中 (${filterResult.visibleCount} 条)`;
        }

        getCurrentFilterResult(totalRows = this.lastRowCount) {
            return {
                totalRows,
                visibleCount: this.visibleCount,
                hasActiveFilter: this.hasActiveFilter()
            };
        }

        completeRefillAttempt(success, currentRowCount) {
            if (success) {
                this.refillAttempts = 0;
                this.refillExhausted = false;
            } else {
                this.refillAttempts += 1;
                if (this.refillAttempts >= SIEVE_CONFIG.refillMaxAttempts) {
                    this.refillExhausted = true;
                }
            }

            this.waitingRefillResult = false;
            this.isRefilling = false;
            this.lastRefillRowCount = currentRowCount;
            this.restoreRefillScrollPosition();
        }

        resolvePendingRefill(currentRowCount) {
            if (!this.waitingRefillResult) {
                return;
            }

            if (currentRowCount > this.lastRefillRowCount) {
                this.completeRefillAttempt(true, currentRowCount);
                return;
            }

            if (Date.now() - this.lastRefillAt < SIEVE_CONFIG.refillSettleMs) {
                return;
            }

            this.completeRefillAttempt(false, currentRowCount);
            this.updateStatus(this.buildStatusText(this.getCurrentFilterResult(currentRowCount)));
        }

        shouldTryRefill(filterResult = this.getCurrentFilterResult()) {
            if (!this.isHomePage() || !getSieveSwitchState()) {
                return false;
            }
            if (!filterResult.hasActiveFilter || filterResult.totalRows === 0) {
                return false;
            }
            if (filterResult.visibleCount >= SIEVE_CONFIG.refillVisibleTarget) {
                return false;
            }
            if (this.waitingRefillResult || this.isRefilling || this.refillExhausted) {
                return false;
            }
            if (Date.now() - this.lastRefillAt < SIEVE_CONFIG.refillCooldownMs) {
                return false;
            }
            return true;
        }

        clickShowMoreTopics() {
            const showMoreButton = document.querySelector('.show-more.has-topics .alert.alert-info.clickable');
            if (!showMoreButton) {
                return false;
            }
            showMoreButton.click();
            return true;
        }

        triggerBottomRefill() {
            const rows = this.getTopicRows();
            const lastRow = rows.at(-1);
            const scrollingElement = document.scrollingElement || document.documentElement;
            const targetTop = lastRow
                ? Math.ceil(lastRow.getBoundingClientRect().bottom + window.scrollY + 260)
                : scrollingElement.scrollHeight;

            this.refillRestoreScrollTop = window.scrollY;
            window.scrollTo({ top: targetTop, behavior: 'auto' });
            window.dispatchEvent(new Event('scroll'));
        }

        tryRefillVisibleTopics(filterResult = this.getCurrentFilterResult()) {
            const rows = this.getTopicRows();
            if (!rows.length) {
                return;
            }

            this.isRefilling = true;
            this.waitingRefillResult = true;
            this.lastRefillAt = Date.now();
            this.lastRefillRowCount = rows.length;
            this.updateStatus(this.buildStatusText(filterResult));

            if (this.clickShowMoreTopics()) {
                return;
            }

            this.triggerBottomRefill();
        }

        filterTopics() {
            const rows = this.getTopicRows();
            const totalRows = rows.length;
            if (!rows.length) {
                this.visibleCount = 0;
                this.updateStatus('');
                return {
                    totalRows: 0,
                    visibleCount: 0,
                    hasActiveFilter: this.hasActiveFilter()
                };
            }

            const hasActiveFilter = this.hasActiveFilter();
            if (!hasActiveFilter) {
                this.showAllTopics();
                this.visibleCount = rows.length;
                this.resetRefillState({ resetCooldown: true });
                this.updateStatus('');
                return {
                    totalRows,
                    visibleCount: rows.length,
                    hasActiveFilter: false
                };
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

            this.visibleCount = visibleCount;
            const filterResult = {
                totalRows,
                visibleCount,
                hasActiveFilter: true
            };
            this.updateStatus(this.buildStatusText(filterResult));
            return filterResult;
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

            const rows = this.getTopicRows();
            const rowCount = rows.length;
            if (rowCount > this.lastRowCount) {
                if (this.waitingRefillResult && rowCount > this.lastRefillRowCount) {
                    this.completeRefillAttempt(true, rowCount);
                } else {
                    this.refillAttempts = 0;
                    this.refillExhausted = false;
                }
            }

            this.resolvePendingRefill(rowCount);

            const hasChanged = this.filterDirty || rowCount !== this.lastRowCount;
            if (!hasChanged) {
                if (this.shouldTryRefill()) {
                    this.tryRefillVisibleTopics(this.getCurrentFilterResult(rowCount));
                }
                return;
            }

            this.lastRowCount = rowCount;
            this.filterDirty = false;
            const filterResult = this.filterTopics();
            if (this.shouldTryRefill(filterResult)) {
                this.tryRefillVisibleTopics(filterResult);
            }
        }

        onRouteChange() {
            if (this.applyDefaultTab()) {
                return;
            }
            if (this.isHomePage()) {
                this.removePanel();
                this.createPanel();
                this.resetRefillState({ resetCooldown: true });
                this.filterDirty = true;
                this.lastRowCount = 0;
                this.visibleCount = 0;
                this.filterTopics();
            } else {
                this.resetRefillState({ resetCooldown: true });
                this.removePanel();
                this.showAllTopics();
            }
        }
    }

    // ==================== 话题预览 ====================

    /**
     * 话题预览模块
     * 在话题列表标题旁注入预览按钮，点击后拉取主题 JSON 并默认显示前 30 楼内容。
     */
    class TopicPreviewModule {
        constructor() {
            this.loopTimer = null;
            this.lastUrl = location.href;
            this.activePreviewRequestId = 0;
            this.previewState = null;
            this.handleDocumentClick = this.handleDocumentClick.bind(this);
            this.handleKeyDown = this.handleKeyDown.bind(this);
            this.handlePreviewBodyScroll = this.handlePreviewBodyScroll.bind(this);
        }

        init() {
            this.ensureStyles();
            this.ensureModal();
            this.getPreviewBody()?.addEventListener('scroll', this.handlePreviewBodyScroll);
            document.addEventListener('click', this.handleDocumentClick, true);
            document.addEventListener('keydown', this.handleKeyDown);
            this.tick();
            this.startLoop();
        }

        destroy() {
            if (this.loopTimer) {
                clearInterval(this.loopTimer);
                this.loopTimer = null;
            }
            this.getPreviewBody()?.removeEventListener('scroll', this.handlePreviewBodyScroll);
            document.removeEventListener('click', this.handleDocumentClick, true);
            document.removeEventListener('keydown', this.handleKeyDown);
            this.closePreview();
        }

        startLoop() {
            if (this.loopTimer) {
                return;
            }
            this.loopTimer = window.setInterval(() => this.tick(), TOPIC_PREVIEW_CONFIG.loopIntervalMs);
        }

        tick() {
            if (location.href !== this.lastUrl) {
                this.lastUrl = location.href;
                this.markCurrentTopicVisited();
                if (!this.hasTopicList()) {
                    this.closePreview();
                }
            }
            this.markCurrentTopicVisited();
            this.ensurePreviewButtons();
            this.applyVisitedTopicState();
        }

        hasTopicList() {
            return Boolean(document.querySelector('.topic-list .main-link a.title[data-topic-id]'));
        }

        ensureStyles() {
            if (document.getElementById(UI_IDS.topicPreviewStyle)) {
                return;
            }

            const style = document.createElement('style');
            style.id = UI_IDS.topicPreviewStyle;
            style.textContent = `
                .linuxdo-topic-preview-trigger {
                    height: 28px;
                    min-width: 58px;
                    padding: 0 10px;
                    margin-left: 6px;
                    border-radius: 7px;
                    border: 1px solid rgba(124, 139, 153, 0.20);
                    background: rgba(124, 139, 153, 0.08);
                    color: var(--primary-medium, #667789);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    vertical-align: middle;
                    opacity: 1;
                    font-size: 12px;
                    font-weight: 600;
                    line-height: 1;
                    white-space: nowrap;
                    transition: border-color 160ms ease, color 160ms ease, background 160ms ease;
                }
                .linuxdo-topic-preview-trigger:hover {
                    color: var(--primary, #2f3338);
                    border-color: rgba(124, 139, 153, 0.36);
                    background: rgba(124, 139, 153, 0.14);
                }
                .linuxdo-topic-preview-trigger svg {
                    width: 14px;
                    height: 14px;
                    stroke: currentColor;
                }
                .topic-list .main-link a.title.linuxdo-topic-visited {
                    color: #99a3ad !important;
                }
                .topic-list .main-link a.title.linuxdo-topic-visited:visited {
                    color: #99a3ad !important;
                }
                #${UI_IDS.topicPreviewRoot} {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: none;
                }
                #${UI_IDS.topicPreviewRoot}.visible {
                    display: block;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-mask {
                    position: absolute;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.54);
                    backdrop-filter: blur(4px);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-panel {
                    position: absolute;
                    left: 50%;
                    top: 50%;
                    transform: translate(-50%, -50%);
                    width: min(920px, calc(100vw - 32px));
                    height: 90vh;
                    border-radius: 16px;
                    overflow: hidden;
                    background: var(--secondary, #ffffff);
                    color: var(--primary, #2f3338);
                    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
                    border: 1px solid rgba(124, 139, 153, 0.14);
                    display: flex;
                    flex-direction: column;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-header {
                    padding: 22px 26px 14px;
                    border-bottom: 1px solid rgba(124, 139, 153, 0.12);
                    background: linear-gradient(180deg, rgba(124, 139, 153, 0.08), rgba(124, 139, 153, 0.02));
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-title {
                    margin: 0;
                    font-size: 22px;
                    line-height: 1.4;
                    font-weight: 700;
                    word-break: break-word;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-meta {
                    margin-top: 8px;
                    color: var(--primary-medium, #6b7280);
                    font-size: 13px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px 0 0;
                    background: var(--secondary, #ffffff);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer {
                    padding: 14px 26px 18px;
                    border-top: 1px solid rgba(124, 139, 153, 0.12);
                    font-size: 13px;
                    color: var(--primary-medium, #6b7280);
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer-actions {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-more {
                    color: var(--link-color, #667789);
                    font-weight: 600;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-close {
                    position: absolute;
                    top: 16px;
                    right: 16px;
                    width: 34px;
                    height: 34px;
                    border-radius: 999px;
                    border: 1px solid rgba(124, 139, 153, 0.16);
                    background: rgba(255, 255, 255, 0.82);
                    color: var(--primary-medium, #6b7280);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-close:hover {
                    color: var(--primary, #2f3338);
                    border-color: rgba(124, 139, 153, 0.3);
                    background: rgba(255, 255, 255, 0.96);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-loading,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-error {
                    padding: 72px 24px;
                    text-align: center;
                    color: var(--primary-medium, #6b7280);
                    font-size: 15px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-error {
                    color: #b86262;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-item {
                    display: grid;
                    grid-template-columns: 60px 1fr;
                    gap: 14px;
                    padding: 16px 26px;
                    align-items: start;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-item + .linuxdo-topic-preview-item {
                    border-top: 1px solid rgba(124, 139, 153, 0.08);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-floor {
                    font-size: 14px;
                    color: var(--tertiary, #7c8b99);
                    font-weight: 700;
                    padding-top: 6px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-post {
                    background: rgba(124, 139, 153, 0.07);
                    border: 1px solid rgba(124, 139, 153, 0.10);
                    border-radius: 12px;
                    padding: 14px 16px 56px;
                    min-width: 0;
                    position: relative;
                    transition: padding 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-post.is-replying {
                    padding-bottom: 206px;
                    border-color: rgba(124, 139, 153, 0.2);
                    background: rgba(255, 255, 255, 0.96);
                    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-author {
                    display: flex;
                    align-items: baseline;
                    gap: 10px;
                    flex-wrap: wrap;
                    margin-bottom: 10px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-author strong {
                    font-size: 15px;
                    color: var(--primary, #2f3338);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-username,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-date {
                    font-size: 12px;
                    color: var(--primary-medium, #6b7280);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-cooked {
                    font-size: 14px;
                    line-height: 1.72;
                    word-break: break-word;
                    overflow-wrap: anywhere;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-cooked img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 8px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-cooked pre {
                    overflow-x: auto;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-actions {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    position: absolute;
                    right: 16px;
                    bottom: 14px;
                    justify-content: flex-end;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-toggle,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-submit {
                    min-width: 84px;
                    height: 32px;
                    padding: 0 12px;
                    border-radius: 999px;
                    border: 1px solid rgba(124, 139, 153, 0.18);
                    background: rgba(255, 255, 255, 0.92);
                    color: var(--primary-medium, #667789);
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    transition: border-color 160ms ease, background 160ms ease, color 160ms ease, opacity 160ms ease;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like:hover,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-toggle:hover,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-submit:hover {
                    color: var(--primary, #2f3338);
                    border-color: rgba(124, 139, 153, 0.34);
                    background: rgba(124, 139, 153, 0.08);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like.is-liked {
                    color: #8a6548;
                    border-color: rgba(166, 120, 82, 0.26);
                    background: rgba(166, 120, 82, 0.12);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like.is-loading,
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like:disabled {
                    cursor: wait;
                    opacity: 0.68;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-like-count {
                    font-variant-numeric: tabular-nums;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-toggle.is-active {
                    color: #53687b;
                    border-color: rgba(83, 104, 123, 0.22);
                    background: rgba(83, 104, 123, 0.12);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-submit {
                    min-width: 92px;
                    color: #7c5a3f;
                    border-color: rgba(166, 120, 82, 0.24);
                    background: rgba(166, 120, 82, 0.14);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-actions .linuxdo-topic-preview-reply-submit {
                    display: none;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-post.is-replying .linuxdo-topic-preview-actions .linuxdo-topic-preview-reply-submit {
                    display: inline-flex;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-composer {
                    position: absolute;
                    left: 16px;
                    right: 16px;
                    bottom: 56px;
                    display: none;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-post.is-replying .linuxdo-topic-preview-reply-composer {
                    display: block;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-input {
                    width: 100%;
                    min-height: 96px;
                    resize: vertical;
                    border-radius: 12px;
                    border: 1px solid rgba(124, 139, 153, 0.18);
                    background: rgba(255, 255, 255, 0.98);
                    padding: 10px 12px;
                    color: var(--primary, #2f3338);
                    font-size: 14px;
                    line-height: 1.6;
                    box-sizing: border-box;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-input:focus {
                    outline: none;
                    border-color: rgba(166, 120, 82, 0.32);
                    box-shadow: 0 0 0 3px rgba(166, 120, 82, 0.10);
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-footer {
                    display: flex;
                    justify-content: flex-end;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer-reply {
                    display: none;
                    gap: 10px;
                }
                #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer.is-replying .linuxdo-topic-preview-footer-reply {
                    display: grid;
                }
                html.linuxdo-topic-preview-open,
                body.linuxdo-topic-preview-open {
                    overflow: hidden !important;
                }
                @media (max-width: 768px) {
                    .linuxdo-topic-preview-trigger {
                        min-width: 54px;
                        padding: 0 9px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-panel {
                        width: calc(100vw - 18px);
                        height: calc(100vh - 18px);
                        border-radius: 14px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-item {
                        grid-template-columns: 1fr;
                        gap: 8px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-floor {
                        padding-top: 0;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-actions {
                        right: 12px;
                        bottom: 12px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-post.is-replying {
                        padding-bottom: 198px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-reply-composer {
                        left: 12px;
                        right: 12px;
                        bottom: 52px;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer-row {
                        align-items: flex-start;
                        flex-direction: column;
                    }
                    #${UI_IDS.topicPreviewRoot} .linuxdo-topic-preview-footer-actions {
                        width: 100%;
                        justify-content: space-between;
                    }
                }
            `;
            appendStyleNode(style);
        }

        ensureModal() {
            let root = document.getElementById(UI_IDS.topicPreviewRoot);
            if (root) {
                return root;
            }

            root = document.createElement('div');
            root.id = UI_IDS.topicPreviewRoot;
            root.innerHTML = `
                <div class="linuxdo-topic-preview-mask" data-role="mask"></div>
                <div class="linuxdo-topic-preview-panel" role="dialog" aria-modal="true" aria-label="话题预览">
                    <button class="linuxdo-topic-preview-close" type="button" aria-label="关闭预览" data-role="close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M18 6 6 18"></path>
                            <path d="m6 6 12 12"></path>
                        </svg>
                    </button>
                    <div class="linuxdo-topic-preview-header">
                        <h2 class="linuxdo-topic-preview-title">正在加载中...</h2>
                        <div class="linuxdo-topic-preview-meta"></div>
                    </div>
                    <div class="linuxdo-topic-preview-body">
                        <div class="linuxdo-topic-preview-loading">正在加载中...</div>
                    </div>
                    <div class="linuxdo-topic-preview-footer">
                        <div class="linuxdo-topic-preview-footer-row">
                            <span class="linuxdo-topic-preview-hint">先显示前 ${TOPIC_PREVIEW_CONFIG.initialPosts} 楼，下拉接近底部时自动加载更多</span>
                            <div class="linuxdo-topic-preview-footer-actions">
                                <button
                                    class="linuxdo-topic-preview-reply-toggle"
                                    type="button"
                                    data-role="preview-reply-toggle"
                                    data-reply-scope="topic"
                                    data-reply-key="topic-footer"
                                    data-label-default="回复话题"
                                    title="回复话题"
                                >
                                    <span class="linuxdo-topic-preview-reply-toggle-label">回复话题</span>
                                </button>
                                <a class="linuxdo-topic-preview-more" href="/" target="_blank" rel="noopener noreferrer">查看完整话题</a>
                            </div>
                        </div>
                        <div class="linuxdo-topic-preview-footer-reply">
                            <textarea
                                class="linuxdo-topic-preview-reply-input"
                                data-role="preview-reply-input"
                                data-reply-scope="topic"
                                placeholder="输入回复内容..."
                            ></textarea>
                            <div class="linuxdo-topic-preview-reply-footer">
                                <button
                                    class="linuxdo-topic-preview-reply-submit"
                                    type="button"
                                    data-role="preview-reply-submit"
                                    data-reply-scope="topic"
                                    title="${this.getReplySubmitButtonText()}"
                                >
                                    ${this.getReplySubmitButtonText()}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(root);
            return root;
        }

        getModalRoot() {
            return document.getElementById(UI_IDS.topicPreviewRoot);
        }

        getPreviewBody() {
            return this.getModalRoot()?.querySelector('.linuxdo-topic-preview-body') || null;
        }

        isApplePlatform() {
            const platform = navigator.userAgentData?.platform || navigator.platform || '';
            return /mac|iphone|ipad|ipod/i.test(platform);
        }

        getReplySubmitShortcutLabel() {
            return this.isApplePlatform() ? 'Cmd+Enter' : 'Ctrl+Enter';
        }

        getReplySubmitButtonText() {
            return `发布（${this.getReplySubmitShortcutLabel()}）`;
        }

        isReplySubmitShortcut(event) {
            if (event.key !== 'Enter' || event.altKey || event.shiftKey) {
                return false;
            }
            if (this.isApplePlatform()) {
                return event.metaKey && !event.ctrlKey;
            }
            return event.ctrlKey && !event.metaKey;
        }

        ensurePreviewButtons() {
            const links = document.querySelectorAll('.topic-list .main-link a.title[data-topic-id]');
            links.forEach((link) => {
                const line = link.closest('.link-top-line');
                const topicId = link.getAttribute('data-topic-id');
                if (!line || !topicId || line.querySelector('.linuxdo-topic-preview-trigger')) {
                    return;
                }

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-flat linuxdo-topic-preview-trigger';
                button.dataset.topicId = topicId;
                button.dataset.topicHref = link.href;
                button.setAttribute('aria-label', '新标签页打开话题');
                button.title = '新标签页打开';
                button.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M14 5h5v5"></path>
                        <path d="M10 14 19 5"></path>
                        <path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"></path>
                    </svg>
                    <span>新开</span>
                `;
                line.appendChild(button);
            });
        }

        applyVisitedTopicState() {
            const visitedSet = getVisitedLinkSet();
            document
                .querySelectorAll('.topic-list .main-link a.title[data-topic-id]')
                .forEach((link) => {
                    const isVisited = visitedSet.has(normalizeVisitedLink(link.href));
                    link.classList.toggle('linuxdo-topic-visited', isVisited);
                });
        }

        markCurrentTopicVisited() {
            if (!/^\/t\/[^/]+\/\d+/.test(location.pathname)) {
                return;
            }
            markVisitedLink(location.href);
        }

        isModifiedPrimaryClick(event) {
            return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        }

        getTopicInfoFromRow(row) {
            const titleLink = row?.querySelector('.main-link a.title[data-topic-id]');
            if (!titleLink) {
                return null;
            }
            return {
                topicId: titleLink.getAttribute('data-topic-id'),
                topicHref: titleLink.href
            };
        }

        handleDocumentClick(event) {
            const previewButton = event.target.closest('.linuxdo-topic-preview-trigger');
            if (previewButton) {
                if (!this.isModifiedPrimaryClick(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                const topicHref = previewButton.dataset.topicHref;
                if (topicHref) {
                    markVisitedLink(topicHref);
                    this.applyVisitedTopicState();
                    window.open(topicHref, '_blank', 'noopener');
                }
                return;
            }

            const modalRoot = this.getModalRoot();
            if (!modalRoot || !modalRoot.classList.contains('visible')) {
                if (!this.isModifiedPrimaryClick(event)) {
                    return;
                }

                const row = event.target.closest('.topic-list-body tr.topic-list-item');
                if (!row) {
                    return;
                }

                const topicInfo = this.getTopicInfoFromRow(row);
                if (!topicInfo?.topicId) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                markVisitedLink(topicInfo.topicHref);
                this.applyVisitedTopicState();
                this.openPreview(topicInfo.topicId);
                return;
            }

            const likeButton = event.target.closest('[data-role="preview-like"]');
            if (likeButton) {
                if (!this.isModifiedPrimaryClick(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                this.togglePreviewPostLike(likeButton);
                return;
            }

            const replyToggle = event.target.closest('[data-role="preview-reply-toggle"]');
            if (replyToggle) {
                if (!this.isModifiedPrimaryClick(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                this.togglePreviewReplyComposer(replyToggle);
                return;
            }

            const replySubmit = event.target.closest('[data-role="preview-reply-submit"]');
            if (replySubmit) {
                if (!this.isModifiedPrimaryClick(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                this.submitPreviewReply(replySubmit);
                return;
            }

            const closeButton = event.target.closest('[data-role="close"]');
            const mask = event.target.closest('[data-role="mask"]');
            if (closeButton || mask) {
                event.preventDefault();
                this.closePreview();
            }
        }

        handleKeyDown(event) {
            if (this.isReplySubmitShortcut(event)) {
                const replyInput = event.target?.closest?.('[data-role="preview-reply-input"]');
                const submitButton = this.getReplySubmitButtonForInput(replyInput);
                if (submitButton && !submitButton.disabled) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation?.();
                    this.submitPreviewReply(submitButton);
                    return;
                }
            }

            if (event.key === 'Escape') {
                this.closePreview();
            }
        }

        openLoadingState() {
            const root = this.ensureModal();
            const title = root.querySelector('.linuxdo-topic-preview-title');
            const meta = root.querySelector('.linuxdo-topic-preview-meta');
            const body = root.querySelector('.linuxdo-topic-preview-body');
            const moreLink = root.querySelector('.linuxdo-topic-preview-more');
            const hint = root.querySelector('.linuxdo-topic-preview-hint');
            const footer = root.querySelector('.linuxdo-topic-preview-footer');
            const footerInput = root.querySelector('.linuxdo-topic-preview-footer [data-role="preview-reply-input"]');
            const footerToggle = root.querySelector('.linuxdo-topic-preview-footer [data-role="preview-reply-toggle"]');

            title.textContent = '正在加载中...';
            meta.textContent = '';
            body.innerHTML = '<div class="linuxdo-topic-preview-loading">正在加载中...</div>';
            moreLink.href = '/';
            hint.textContent = `先显示前 ${TOPIC_PREVIEW_CONFIG.initialPosts} 楼，下拉接近底部时自动加载更多`;
            footer?.classList.remove('is-replying');
            if (footerInput) {
                footerInput.value = '';
            }
            if (footerToggle) {
                this.setReplyToggleState(footerToggle, false);
            }
            root.classList.add('visible');
            document.documentElement.classList.add('linuxdo-topic-preview-open');
            document.body.classList.add('linuxdo-topic-preview-open');
        }

        closePreview() {
            const root = this.getModalRoot();
            this.activePreviewRequestId += 1;
            this.previewState = null;
            if (!root) {
                return;
            }
            root.classList.remove('visible');
            document.documentElement.classList.remove('linuxdo-topic-preview-open');
            document.body.classList.remove('linuxdo-topic-preview-open');
        }

        formatDate(dateString) {
            const date = new Date(dateString);
            if (Number.isNaN(date.getTime())) {
                return '';
            }
            return date.toLocaleString('zh-CN', { hour12: false });
        }

        escapeHtml(text) {
            return String(text ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        getTopicUrl(topicData, topicId) {
            const slug = topicData?.slug || 'topic';
            return `${location.origin}/t/${slug}/${topicId}`;
        }

        getPostLikeCount(post) {
            const summary = Array.isArray(post?.actions_summary)
                ? post.actions_summary.find((item) => Number(item?.id) === POST_ACTION_TYPES.like)
                : null;
            return Math.max(0, Number(summary?.count) || 0);
        }

        getCurrentUsername() {
            const discourseUser = window.Discourse?.User?.current?.();
            if (discourseUser?.username) {
                return String(discourseUser.username).toLowerCase();
            }

            const currentUser = window.currentUser;
            if (currentUser?.username) {
                return String(currentUser.username).toLowerCase();
            }

            const avatar = document.querySelector('.header-dropdown-toggle.current-user img.avatar');
            const altText = avatar?.getAttribute('alt') || '';
            if (altText.startsWith('@')) {
                return altText.slice(1).toLowerCase();
            }

            return '';
        }

        canLikePost(post) {
            const summary = Array.isArray(post?.actions_summary)
                ? post.actions_summary.find((item) => Number(item?.id) === POST_ACTION_TYPES.like)
                : null;
            if (typeof summary?.can_act === 'boolean') {
                return summary.can_act || Boolean(summary.acted);
            }

            const currentUsername = this.getCurrentUsername();
            const postUsername = String(post?.username || '').toLowerCase();
            if (currentUsername && postUsername && currentUsername === postUsername) {
                return false;
            }

            return true;
        }

        hasLikedPost(post) {
            const summary = Array.isArray(post?.actions_summary)
                ? post.actions_summary.find((item) => Number(item?.id) === POST_ACTION_TYPES.like)
                : null;
            if (typeof summary?.acted === 'boolean') {
                return summary.acted;
            }
            return Boolean(post?.yours);
        }

        buildPostLikeHtml(post) {
            const liked = this.hasLikedPost(post);
            const canLike = this.canLikePost(post);
            const likeCount = this.getPostLikeCount(post);
            const postId = Number(post?.id) || 0;
            const floorNumber = Number(post?.post_number) || 0;
            const isTopicReply = floorNumber === 1;
            const replyLabel = isTopicReply ? '回复话题' : '回复';
            const replyScope = isTopicReply ? 'topic' : 'post';
            const likeTitle = !canLike
                ? '自己的帖子不能点赞'
                : (liked ? '取消点赞' : '点赞此帖子');
            return `
                <div class="linuxdo-topic-preview-actions">
                    <button
                        class="linuxdo-topic-preview-reply-toggle"
                        type="button"
                        data-role="preview-reply-toggle"
                        data-post-id="${postId}"
                        data-reply-scope="${replyScope}"
                        data-reply-key="post-${postId}"
                        data-label-default="${replyLabel}"
                        title="${replyLabel}"
                    >
                        <span class="linuxdo-topic-preview-reply-toggle-label">${replyLabel}</span>
                    </button>
                    <button
                        class="linuxdo-topic-preview-like${liked ? ' is-liked' : ''}"
                        type="button"
                        data-role="preview-like"
                        data-post-id="${postId}"
                        data-liked="${liked ? '1' : '0'}"
                        data-like-count="${likeCount}"
                        data-can-like="${canLike ? '1' : '0'}"
                        aria-pressed="${liked ? 'true' : 'false'}"
                        title="${likeTitle}"
                        ${canLike ? '' : 'disabled'}
                    >
                        <span class="linuxdo-topic-preview-like-label">${liked ? '已赞' : '点赞'}</span>
                        <span class="linuxdo-topic-preview-like-count">${likeCount}</span>
                    </button>
                    <button
                        class="linuxdo-topic-preview-reply-submit"
                        type="button"
                        data-role="preview-reply-submit"
                        data-post-id="${postId}"
                        data-reply-scope="${replyScope}"
                        title="${this.getReplySubmitButtonText()}"
                    >
                        ${this.getReplySubmitButtonText()}
                    </button>
                </div>
            `;
        }

        buildPostReplyComposerHtml(post) {
            const postId = Number(post?.id) || 0;
            const floorNumber = Number(post?.post_number) || 0;
            const replyScope = floorNumber === 1 ? 'topic' : 'post';
            return `
                <div class="linuxdo-topic-preview-reply-composer">
                    <textarea
                        class="linuxdo-topic-preview-reply-input"
                        data-role="preview-reply-input"
                        data-post-id="${postId}"
                        data-reply-scope="${replyScope}"
                        placeholder="输入回复内容..."
                    ></textarea>
                </div>
            `;
        }

        buildPostHtml(post) {
            const displayName = this.escapeHtml(
                post.display_username || post.name || post.username || '匿名用户'
            );
            const username = post.username ? `@${this.escapeHtml(post.username)}` : '';
            const createdAt = this.escapeHtml(this.formatDate(post.created_at));
            const floorNumber = Number(post.post_number) || 0;
            return `
                <article
                    class="linuxdo-topic-preview-item"
                    data-post-id="${Number(post?.id) || 0}"
                    data-post-number="${floorNumber}"
                >
                    <div class="linuxdo-topic-preview-floor">${floorNumber} 楼</div>
                    <div class="linuxdo-topic-preview-post">
                        <div class="linuxdo-topic-preview-author">
                            <strong>${displayName}</strong>
                            <span class="linuxdo-topic-preview-username">${username}</span>
                            <span class="linuxdo-topic-preview-date">${createdAt}</span>
                        </div>
                        <div class="linuxdo-topic-preview-cooked">${post.cooked || ''}</div>
                        ${this.buildPostReplyComposerHtml(post)}
                        ${this.buildPostLikeHtml(post)}
                    </div>
                </article>
            `;
        }

        getCsrfToken() {
            return document.querySelector('meta[name="csrf-token"]')?.content || '';
        }

        getPreviewPostItem(target) {
            return target?.closest('.linuxdo-topic-preview-item') || null;
        }

        getPreviewPostCard(target) {
            return target?.closest('.linuxdo-topic-preview-post') || null;
        }

        getReplyContext(target) {
            const footer = target?.closest('.linuxdo-topic-preview-footer');
            if (footer) {
                return {
                    key: 'topic-footer',
                    host: footer,
                    toggle: footer.querySelector('[data-role="preview-reply-toggle"]'),
                    input: footer.querySelector('[data-role="preview-reply-input"]'),
                    scope: 'topic',
                    replyToPostNumber: 0
                };
            }

            const item = this.getPreviewPostItem(target);
            const card = this.getPreviewPostCard(target);
            if (!item || !card) {
                return null;
            }

            const toggle = item.querySelector('[data-role="preview-reply-toggle"]');
            const input = item.querySelector('[data-role="preview-reply-input"]');
            return {
                key: `post-${Number(item.dataset.postId) || 0}`,
                host: card,
                toggle,
                input,
                scope: toggle?.dataset.replyScope || 'post',
                replyToPostNumber: Number(item.dataset.postNumber) || 0
            };
        }

        getReplySubmitButtonForInput(input) {
            const composer = input?.closest('.linuxdo-topic-preview-reply-composer, .linuxdo-topic-preview-footer-reply');
            if (!composer) {
                return null;
            }

            const inlineButton = composer
                .closest('.linuxdo-topic-preview-item')
                ?.querySelector('.linuxdo-topic-preview-actions [data-role="preview-reply-submit"]');
            return inlineButton || composer.querySelector('[data-role="preview-reply-submit"]') || null;
        }

        closeAllReplyComposers(exceptKey = '') {
            const items = document.querySelectorAll('#linuxdo-topic-preview-root .linuxdo-topic-preview-item');
            items.forEach((item) => {
                const replyKey = `post-${Number(item.dataset.postId) || 0}`;
                if (exceptKey && replyKey === exceptKey) {
                    return;
                }

                const card = item.querySelector('.linuxdo-topic-preview-post');
                const toggle = item.querySelector('[data-role="preview-reply-toggle"]');
                const input = item.querySelector('[data-role="preview-reply-input"]');
                if (card) {
                    card.classList.remove('is-replying');
                }
                if (toggle) {
                    this.setReplyToggleState(toggle, false);
                }
                if (input) {
                    input.value = '';
                }
            });

            const footer = this.getModalRoot()?.querySelector('.linuxdo-topic-preview-footer');
            if (!footer || (exceptKey && exceptKey === 'topic-footer')) {
                return;
            }

            footer.classList.remove('is-replying');
            const footerToggle = footer.querySelector('[data-role="preview-reply-toggle"]');
            const footerInput = footer.querySelector('[data-role="preview-reply-input"]');
            if (footerToggle) {
                this.setReplyToggleState(footerToggle, false);
            }
            if (footerInput) {
                footerInput.value = '';
            }
        }

        setReplyToggleState(toggle, isActive = false, tempLabel = '') {
            if (!toggle) {
                return;
            }

            const labelNode = toggle.querySelector('.linuxdo-topic-preview-reply-toggle-label');
            toggle.classList.toggle('is-active', isActive);
            if (labelNode) {
                labelNode.textContent = tempLabel || (isActive ? '收起' : (toggle.dataset.labelDefault || '回复'));
            }
        }

        flashReplyToggle(toggle, tempLabel) {
            if (!toggle) {
                return;
            }

            const flashToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            toggle.dataset.flashToken = flashToken;
            this.setReplyToggleState(toggle, false, tempLabel);
            window.setTimeout(() => {
                if (!toggle.isConnected || toggle.dataset.flashToken !== flashToken) {
                    return;
                }
                delete toggle.dataset.flashToken;
                this.setReplyToggleState(toggle, false);
            }, 1800);
        }

        togglePreviewReplyComposer(toggle) {
            const context = this.getReplyContext(toggle);
            if (!context?.host || !context.input || !context.toggle) {
                return;
            }

            const willOpen = !context.host.classList.contains('is-replying');
            this.closeAllReplyComposers(willOpen ? context.key : '');
            if (!willOpen) {
                return;
            }

            context.host.classList.add('is-replying');
            this.setReplyToggleState(context.toggle, true);
            window.setTimeout(() => context.input.focus(), 0);
        }

        setPreviewLikeButtonState(button, liked, likeCount, isLoading = false, tempLabel = '') {
            if (!button) {
                return;
            }

            const normalizedCount = Math.max(0, Number(likeCount) || 0);
            const label = tempLabel || (liked ? '已赞' : '点赞');
            const labelNode = button.querySelector('.linuxdo-topic-preview-like-label');
            const countNode = button.querySelector('.linuxdo-topic-preview-like-count');

            button.dataset.liked = liked ? '1' : '0';
            button.dataset.likeCount = String(normalizedCount);
            button.disabled = isLoading;
            button.classList.toggle('is-liked', liked);
            button.classList.toggle('is-loading', isLoading);
            button.setAttribute('aria-pressed', liked ? 'true' : 'false');
            button.title = liked ? '取消点赞' : '点赞此帖子';

            if (labelNode) {
                labelNode.textContent = label;
            }
            if (countNode) {
                countNode.textContent = String(normalizedCount);
            }
        }

        flashPreviewLikeButton(button, liked, likeCount, tempLabel) {
            if (!button) {
                return;
            }

            const flashToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            button.dataset.flashToken = flashToken;
            this.setPreviewLikeButtonState(button, liked, likeCount, false, tempLabel);

            window.setTimeout(() => {
                if (!button.isConnected || button.dataset.flashToken !== flashToken) {
                    return;
                }
                delete button.dataset.flashToken;
                this.setPreviewLikeButtonState(button, liked, likeCount, false);
            }, 1800);
        }

        async createPreviewPostLike(postId, csrfToken) {
            const body = new URLSearchParams({
                id: String(postId),
                post_action_type_id: String(POST_ACTION_TYPES.like),
                flag_topic: 'false'
            });
            const response = await fetch(`${location.origin}/post_actions.json`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-CSRF-Token': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: body.toString()
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }

        async removePreviewPostLike(postId, csrfToken) {
            const query = new URLSearchParams({
                post_action_type_id: String(POST_ACTION_TYPES.like)
            });
            const response = await fetch(
                `${location.origin}/post_actions/${encodeURIComponent(postId)}.json?${query.toString()}`,
                {
                    method: 'DELETE',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        'X-CSRF-Token': csrfToken,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                }
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }

        async createPreviewReply(topicId, raw, csrfToken, replyToPostNumber = 0) {
            const body = new URLSearchParams({
                topic_id: String(topicId),
                raw
            });
            if (replyToPostNumber > 0) {
                body.set('reply_to_post_number', String(replyToPostNumber));
            }
            const response = await fetch(`${location.origin}/posts.json`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-CSRF-Token': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: body.toString()
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }

        async togglePreviewPostLike(button) {
            if (!button || button.classList.contains('is-loading')) {
                return;
            }

            const postId = Number(button.dataset.postId) || 0;
            const liked = button.dataset.liked === '1';
            const likeCount = Math.max(0, Number(button.dataset.likeCount) || 0);
            const canLike = button.dataset.canLike !== '0';
            const csrfToken = this.getCsrfToken();

            if (!postId) {
                this.flashPreviewLikeButton(button, liked, likeCount, '无效楼层');
                return;
            }

            if (!canLike && !liked) {
                this.flashPreviewLikeButton(button, liked, likeCount, '不能点赞自己');
                return;
            }

            if (!csrfToken) {
                this.flashPreviewLikeButton(button, liked, likeCount, '请先登录');
                return;
            }

            this.setPreviewLikeButtonState(button, liked, likeCount, true);

            try {
                if (liked) {
                    await this.removePreviewPostLike(postId, csrfToken);
                    this.setPreviewLikeButtonState(button, false, Math.max(0, likeCount - 1), false);
                    return;
                }

                await this.createPreviewPostLike(postId, csrfToken);
                this.setPreviewLikeButtonState(button, true, likeCount + 1, false);
            } catch (error) {
                console.error('话题预览点赞失败:', error);
                this.setPreviewLikeButtonState(button, liked, likeCount, false);
                this.flashPreviewLikeButton(button, liked, likeCount, '稍后重试');
            }
        }

        async submitPreviewReply(button) {
            if (!button || button.disabled) {
                return;
            }

            const context = this.getReplyContext(button);
            const topicId = Number(this.previewState?.topicId) || 0;
            const raw = context?.input?.value?.trim() || '';
            const csrfToken = this.getCsrfToken();

            if (!context?.host || !context.toggle || !context.input) {
                return;
            }

            if (!csrfToken) {
                this.flashReplyToggle(context.toggle, '请先登录');
                return;
            }

            if (!topicId) {
                this.flashReplyToggle(context.toggle, '无效话题');
                return;
            }

            if (!raw) {
                context.input.focus();
                this.flashReplyToggle(context.toggle, '请输入内容');
                return;
            }

            button.disabled = true;
            button.textContent = '发布中';

            try {
                await this.createPreviewReply(
                    topicId,
                    raw,
                    csrfToken,
                    context.scope === 'post' ? context.replyToPostNumber : 0
                );
                context.input.value = '';
                button.textContent = '已发布';
                context.host.classList.remove('is-replying');
                this.flashReplyToggle(context.toggle, '已发布');
            } catch (error) {
                console.error('话题预览回复失败:', error);
                button.textContent = '发布';
                this.flashReplyToggle(context.toggle, '稍后重试');
            } finally {
                button.disabled = false;
                if (button.isConnected) {
                    button.textContent = this.getReplySubmitButtonText();
                }
            }
        }

        updatePreviewProgress(loadedCount, totalTarget, totalPostCount, isLoadingMore = false) {
            const root = this.ensureModal();
            const hint = root.querySelector('.linuxdo-topic-preview-hint');
            if (!hint) {
                return;
            }
            if (loadedCount >= totalTarget) {
                hint.textContent = `已加载 ${loadedCount}/${totalPostCount}（已全部加载完毕）`;
                return;
            }
            if (isLoadingMore) {
                hint.textContent = `已加载 ${loadedCount}/${totalPostCount}（正在加载更多）`;
                return;
            }
            hint.textContent = `已加载 ${loadedCount}/${totalPostCount}`;
        }

        appendPreviewPosts(posts) {
            if (!posts.length) {
                return;
            }
            const root = this.ensureModal();
            const body = root.querySelector('.linuxdo-topic-preview-body');
            body.insertAdjacentHTML('beforeend', posts.map((post) => this.buildPostHtml(post)).join(''));
        }

        resetPreviewState(topicId, totalTarget, totalPostCount, streamIds, loadedCount) {
            this.previewState = {
                topicId,
                totalTarget,
                totalPostCount,
                streamIds,
                loadedCount,
                nextOffset: loadedCount,
                isLoadingMore: false
            };
        }

        getRemainingLoadedItems() {
            const body = this.getPreviewBody();
            if (!body) {
                return Number.POSITIVE_INFINITY;
            }

            const items = Array.from(body.querySelectorAll('.linuxdo-topic-preview-item'));
            if (!items.length) {
                return 0;
            }

            let lastVisibleIndex = -1;
            const viewportBottom = body.scrollTop + body.clientHeight;
            items.forEach((item, index) => {
                if (item.offsetTop < viewportBottom) {
                    lastVisibleIndex = index;
                }
            });

            if (lastVisibleIndex < 0) {
                return items.length;
            }
            return items.length - (lastVisibleIndex + 1);
        }

        shouldLoadMoreOnScroll() {
            const state = this.previewState;
            const root = this.getModalRoot();
            if (!state || !root || !root.classList.contains('visible')) {
                return false;
            }
            if (state.isLoadingMore || state.loadedCount >= state.totalTarget) {
                return false;
            }
            return this.getRemainingLoadedItems() <= TOPIC_PREVIEW_CONFIG.preloadRemainingThreshold;
        }

        handlePreviewBodyScroll() {
            this.maybeLoadMorePreviewPosts();
        }

        async maybeLoadMorePreviewPosts() {
            const state = this.previewState;
            if (!this.shouldLoadMoreOnScroll() || !state) {
                return;
            }

            const requestId = this.activePreviewRequestId;
            const batchIds = state.streamIds.slice(
                state.nextOffset,
                state.nextOffset + TOPIC_PREVIEW_CONFIG.backgroundBatchSize
            );
            if (!batchIds.length) {
                return;
            }

            state.isLoadingMore = true;
            this.updatePreviewProgress(
                state.loadedCount,
                state.totalTarget,
                state.totalPostCount,
                true
            );

            try {
                const posts = await this.fetchPostBatch(state.topicId, batchIds);
                if (requestId !== this.activePreviewRequestId || !this.previewState) {
                    return;
                }
                this.appendPreviewPosts(posts);
                state.loadedCount += posts.length;
                state.nextOffset += batchIds.length;
            } catch (error) {
                console.error('话题预览追加加载失败:', error);
            } finally {
                if (requestId !== this.activePreviewRequestId || !this.previewState) {
                    return;
                }
                state.isLoadingMore = false;
                this.updatePreviewProgress(
                    state.loadedCount,
                    state.totalTarget,
                    state.totalPostCount,
                    false
                );
                if (this.shouldLoadMoreOnScroll()) {
                    this.maybeLoadMorePreviewPosts();
                }
            }
        }

        renderPreview(topicData, topicId) {
            const root = this.ensureModal();
            const title = root.querySelector('.linuxdo-topic-preview-title');
            const meta = root.querySelector('.linuxdo-topic-preview-meta');
            const body = root.querySelector('.linuxdo-topic-preview-body');
            const moreLink = root.querySelector('.linuxdo-topic-preview-more');
            const previewBody = this.getPreviewBody();
            const streamIds = topicData?.post_stream?.stream || [];
            const totalPostCount = Math.max(
                Number(topicData?.highest_post_number) || 0,
                streamIds.length
            );
            const totalTarget = totalPostCount;
            const posts = (topicData?.post_stream?.posts || []).slice(0, TOPIC_PREVIEW_CONFIG.initialPosts);

            title.textContent = topicData?.title || '未命名话题';
            meta.textContent = `发帖时间：${this.formatDate(topicData?.created_at)}  ·  完整话题共 ${totalPostCount} 楼`;
            moreLink.href = this.getTopicUrl(topicData, topicId);

            if (!posts.length) {
                body.innerHTML = '<div class="linuxdo-topic-preview-error">没有可预览的帖子内容。</div>';
                return;
            }

            body.innerHTML = posts.map((post) => this.buildPostHtml(post)).join('');
            if (previewBody) {
                previewBody.scrollTop = 0;
            }
            this.resetPreviewState(topicId, totalTarget, totalPostCount, streamIds, posts.length);
            this.updatePreviewProgress(posts.length, totalTarget, totalPostCount, false);
            this.maybeLoadMorePreviewPosts();
        }

        renderError(message) {
            const root = this.ensureModal();
            const title = root.querySelector('.linuxdo-topic-preview-title');
            const meta = root.querySelector('.linuxdo-topic-preview-meta');
            const body = root.querySelector('.linuxdo-topic-preview-body');
            const hint = root.querySelector('.linuxdo-topic-preview-hint');

            title.textContent = '加载失败';
            meta.textContent = '';
            hint.textContent = '预览加载失败';
            body.innerHTML = `<div class="linuxdo-topic-preview-error">${message}</div>`;
        }

        async fetchPostBatch(topicId, postIds) {
            if (!postIds.length) {
                return [];
            }
            const query = postIds
                .map((id) => `post_ids[]=${encodeURIComponent(id)}`)
                .join('&');
            const response = await fetch(`${location.origin}/t/${topicId}/posts.json?${query}`, {
                credentials: 'same-origin'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            return data?.post_stream?.posts || [];
        }

        async preloadInitialPosts(topicId, streamIds, existingPosts) {
            const seededPosts = [...existingPosts];
            if (seededPosts.length >= TOPIC_PREVIEW_CONFIG.initialPosts) {
                return seededPosts;
            }

            const targetCount = Math.min(TOPIC_PREVIEW_CONFIG.initialPosts, streamIds.length);
            let nextOffset = seededPosts.length;

            while (seededPosts.length < targetCount) {
                const batchIds = streamIds.slice(
                    nextOffset,
                    Math.min(targetCount, nextOffset + TOPIC_PREVIEW_CONFIG.backgroundBatchSize)
                );
                if (!batchIds.length) {
                    break;
                }
                const posts = await this.fetchPostBatch(topicId, batchIds);
                seededPosts.push(...posts);
                nextOffset += batchIds.length;
            }

            return seededPosts.slice(0, targetCount);
        }

        async openPreview(topicId) {
            if (!topicId) {
                return;
            }

            const requestId = this.activePreviewRequestId + 1;
            this.activePreviewRequestId = requestId;
            this.openLoadingState();
            try {
                const response = await fetch(`${location.origin}/t/${topicId}.json`, {
                    credentials: 'same-origin'
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const topicData = await response.json();
                if (requestId !== this.activePreviewRequestId) {
                    return;
                }
                const streamIds = topicData?.post_stream?.stream || [];
                topicData.post_stream.posts = await this.preloadInitialPosts(
                    topicId,
                    streamIds,
                    topicData?.post_stream?.posts || []
                );
                if (requestId !== this.activePreviewRequestId) {
                    return;
                }
                this.renderPreview(topicData, topicId);
            } catch (error) {
                if (requestId !== this.activePreviewRequestId) {
                    return;
                }
                console.error('话题预览加载失败:', error);
                this.renderError('话题预览加载失败，请稍后再试。');
            }
        }
    }

    // ==================== Horizon 配色注入 ====================

    /**
     * Horizon 主题配色模块
     * 在站点原生 Horizon 主题下额外注入“米色”配色按钮与对应样式。
     */
    class HorizonPaletteModule {
        constructor() {
            this.loopTimer = null;
        }

        init() {
            this.ensureStyles();
            this.tick();
            this.startLoop();
        }

        startLoop() {
            if (this.loopTimer) {
                return;
            }
            this.loopTimer = window.setInterval(() => this.tick(), 900);
        }

        getPaletteState() {
            const saved = GM_getValue(
                STORAGE_KEYS.horizonPalette,
                HORIZON_THEME_CONFIG.paletteDefault
            );
            return saved === HORIZON_THEME_CONFIG.paletteBeige
                ? HORIZON_THEME_CONFIG.paletteBeige
                : HORIZON_THEME_CONFIG.paletteDefault;
        }

        setPaletteState(nextPalette) {
            const normalized = nextPalette === HORIZON_THEME_CONFIG.paletteBeige
                ? HORIZON_THEME_CONFIG.paletteBeige
                : HORIZON_THEME_CONFIG.paletteDefault;
            GM_setValue(STORAGE_KEYS.horizonPalette, normalized);
        }

        isHorizonThemeActive() {
            if (getCurrentThemeId() === HORIZON_THEME_CONFIG.themeId) {
                return true;
            }

            return Array.from(document.querySelectorAll('link[href*="color_definitions_scheme"]'))
                .some((link) => link.href.includes(`_${HORIZON_THEME_CONFIG.themeId}_`));
        }

        shouldApplyBeigePalette() {
            return this.isHorizonThemeActive() &&
                this.getPaletteState() === HORIZON_THEME_CONFIG.paletteBeige;
        }

        applyPaletteClass() {
            document.documentElement.classList.toggle(
                HORIZON_THEME_CONFIG.beigeActiveClass,
                this.shouldApplyBeigePalette()
            );
        }

        getMenuContent() {
            return document.querySelector('.user-color-palette-menu__content');
        }

        getNativePaletteButtons() {
            return Array.from(
                document.querySelectorAll('.user-color-palette-menu__item-choice')
            );
        }

        getInjectedPaletteItem() {
            return document.querySelector('.linuxdo-horizon-beige-menu-item');
        }

        ensureStyles() {
            if (document.getElementById(UI_IDS.horizonPaletteStyle)) {
                return;
            }

            const style = document.createElement('style');
            style.id = UI_IDS.horizonPaletteStyle;
            style.textContent = getHorizonPaletteStyleText();
            appendStyleNode(style);
        }

        removeInjectedPaletteItem() {
            const item = this.getInjectedPaletteItem();
            if (item) {
                item.remove();
            }
        }

        bindNativePaletteReset() {
            this.getNativePaletteButtons().forEach((button) => {
                if (button.dataset.linuxdoBeigeBound === '1') {
                    return;
                }
                button.dataset.linuxdoBeigeBound = '1';
                button.addEventListener('click', () => {
                    if (button.closest('.linuxdo-horizon-beige-menu-item')) {
                        return;
                    }
                    this.setPaletteState(HORIZON_THEME_CONFIG.paletteDefault);
                    this.applyPaletteClass();
                    this.syncInjectedPaletteState();
                });
            });
        }

        syncInjectedPaletteState() {
            const item = this.getInjectedPaletteItem();
            if (!item) {
                return;
            }
            item.classList.toggle(
                'active',
                this.getPaletteState() === HORIZON_THEME_CONFIG.paletteBeige
            );
        }

        ensureInjectedPaletteItem() {
            const isHorizon = this.isHorizonThemeActive();
            const menuContent = this.getMenuContent();

            if (!isHorizon || !menuContent) {
                this.removeInjectedPaletteItem();
                return;
            }

            let item = this.getInjectedPaletteItem();
            if (!item) {
                item = document.createElement('div');
                item.className = 'user-color-palette-menu__item linuxdo-horizon-beige-menu-item';
                item.dataset.colorPalette = 'Beige';
                item.innerHTML = `
                    <button class="btn btn-icon-text btn-flat user-color-palette-menu__item-choice" style="--icon-color: #a67852" type="button">
                        <svg class="fa d-icon d-icon-circle svg-icon fa-width-auto svg-string" width="1em" height="1em" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><use href="#circle"></use></svg>
                        <span class="d-button-label">Beige<!----></span>
                    </button>
                `;
                const button = item.querySelector('button');
                button.addEventListener('click', () => {
                    this.setPaletteState(HORIZON_THEME_CONFIG.paletteBeige);
                    this.applyPaletteClass();
                    this.syncInjectedPaletteState();
                });
            }

            if (item.parentElement !== menuContent) {
                menuContent.appendChild(item);
            }

            this.bindNativePaletteReset();
            this.syncInjectedPaletteState();
        }

        tick() {
            this.applyPaletteClass();
            this.ensureInjectedPaletteItem();
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

    /** 话题预览模块实例 */
    let topicPreviewModule = null;

    /** Horizon 配色模块实例 */
    let horizonPaletteModule = null;

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

    /** 初始化 Horizon 配色注入模块（只初始化一次） */
    function initHorizonPaletteTool() {
        if (horizonPaletteModule) {
            return;
        }
        horizonPaletteModule = new HorizonPaletteModule();
        horizonPaletteModule.init();
    }

    /** 初始化话题预览模块（只初始化一次） */
    function initTopicPreviewTool() {
        if (topicPreviewModule) {
            return;
        }
        topicPreviewModule = new TopicPreviewModule();
        topicPreviewModule.init();
    }

    /**
     * 加载并跳转到新页面
     * @param {Array<Object>} links - 可用链接列表
     */
    function loadPage(links) {
        if (!getSwitchState()) {
            return;
        }

        const visitedLinks = getVisitedLinkSet();
        const unvisitedLinks = links.filter(
            link => !visitedLinks.has(normalizeVisitedLink(link.href))
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
        visitedLinks.add(normalizeVisitedLink(selectedLink.href));
        persistVisitedLinkSet(visitedLinks);
        
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
        ensureHiddenThirdPartyStyle();

        // 创建控制开关按钮
        const autoSwitchButton = await createSwitchIcon();
        await createSieveSwitchIcon(autoSwitchButton);
        updateRunningHaloVisibility();
        initHorizonPaletteTool();
        initTopicPreviewTool();

        // 初始化主页筛选工具（由筛选开关控制）
        applySieveToolState();
        
        // 如果助手未启用，不执行后续操作
        if (!getSwitchState()) {
            clearAutoStopTimer();
            clearRoamStartTime();
            clearRoamAccountedAt();
            return;
        }

        scheduleAutoStop();

        // 启动自动滚动
        startAutoScroll();
    }

    // 页面切换/刷新时及时结算，避免累计时长丢失
    window.addEventListener('pagehide', () => {
        syncRoamAccumulationCheckpoint(Date.now());
    });

    // 页面加载完成后执行
    if (document.readyState === 'complete') {
        main();
    } else {
        window.addEventListener('load', main);
    }
})();
