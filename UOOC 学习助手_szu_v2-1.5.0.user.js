// ==UserScript==
// @name         UOOC 学习助手_szu_v2
// @namespace    https://github.com/xiaochai-123
// @version      1.5.0
// @description  自动静音、二倍速、失焦不断播、自动连播、视频内弹窗答题(best-effort)。适配 UOOC 新版学习页 /home/learn/new (AngularJS)，修复旧版目录/连播选择器失效；连播感知“闯关模式”，遇锁定章节自动停止提示。
// @license      GPL
// @match        *://www.uooc.net.cn/*
// @match        *://uooc.net.cn/*
// @match        *://*.uooc.net.cn/*
// @match        *://uooc.online/*
// @match        *://*.uooc.online/*
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/555212/UOOC%20%E5%AD%A6%E4%B9%A0%E5%8A%A9%E6%89%8B_szu_v2.user.js
// @updateURL https://update.greasyfork.org/scripts/555212/UOOC%20%E5%AD%A6%E4%B9%A0%E5%8A%A9%E6%89%8B_szu_v2.meta.js
// ==/UserScript==

(function () {
    "use strict";

    // 防重复注入（同页多次执行只保留一个实例）
    if (window.__uoocLoaded) { console.log('[UOOC] 已在运行，跳过重复注入'); return; }
    window.__uoocLoaded = true;

    // ===================== 配置 =====================
    const CFG = {
        rate: 2,                  // 播放倍速（如怀疑触发防作弊导致不计进度，可改为 1）
        mute: true,               // 静音
        autoNextDefault: false,   // 载入后是否默认开启自动连播
        skipFinished: true,       // 连播时只找“未完成(finished!=1)”的视频
        skipCurrentIfFinished: true, // 开启连播时，若当前视频已完成则直接找下一个
        tickMs: 800,              // 主循环间隔
        lookaheadMax: 60,         // 连播向后预查的最大节数（遇锁定会提前停）
        debug: true,
    };
    const VIDEO_TYPE = '10';

    // ===================== 工具 =====================
    const log = (...a) => { if (CFG.debug) console.log('[UOOC]', ...a); panelLog(a.join(' ')); };
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const qs = (s, r = document) => r.querySelector(s);
    const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
    const getVideo = () => document.getElementById('player_html5_api');
    const getAngular = () => window.angular;

    function scopeOf(el) { try { return getAngular() && getAngular().element(el).scope(); } catch (e) { return null; } }
    function findScopeWith(key, startEl) {
        const el = startEl || qs('.level_1_title') || qs('.level_2_title') || qs('[uooc-video]') || document.body;
        let s = scopeOf(el);
        for (let i = 0; i < 14 && s; i++) {
            try { if (s[key] !== undefined && s[key] !== null) return s; } catch (e) {}
            s = s.$parent;
        }
        return null;
    }
    function getChapterList() { const s = findScopeWith('chapterList'); return s ? s.chapterList : null; }
    function getCourseId() {
        const m = location.pathname.match(/\/learn\/new\/(\d+)/);
        if (m) return m[1];
        try { return String(JSON.parse(qs('[uooc-video]').getAttribute('source')).course_id); } catch (e) {}
        const hm = location.hash.match(/#\/(\d+)/); return hm ? hm[1] : null;
    }
    function getCurrentSource() {
        try { return JSON.parse(qs('[uooc-video]').getAttribute('source')); } catch (e) { return null; }
    }

    // 把 chapterList 拍平为有序叶子节：{chapterId, section}
    function flattenLeaves() {
        const cl = getChapterList();
        if (!cl) return [];
        const out = [];
        const walk = (nodes, chapterId) => {
            (nodes || []).forEach(n => {
                if (n.children && n.children.length) walk(n.children, chapterId);
                else out.push({ chapterId, section: n });
            });
        };
        cl.forEach(ch => walk(ch.children || ch.sections || [], ch.id));
        return out;
    }
    const isVideoSrc = (s) => s && String(s.type) === VIDEO_TYPE;

    // 直接请求某节资源（不打扰当前视频）。返回 {code, msg, data:[sources]}。code=600 表示闯关锁定。
    async function fetchUnit(chapterId, sectionId) {
        const cid = getCourseId();
        const u = `/home/learn/getUnitLearn?catalog_id=${sectionId}&chapter_id=${chapterId}&cid=${cid}&hidemsg_=true&section_id=${sectionId}`;
        try { const r = await fetch(u, { credentials: 'include' }); return await r.json(); }
        catch (e) { return { code: -1, msg: String(e), data: null }; }
    }

    // ===================== 自动播放 =====================
    function keepPlaying() {
        const v = getVideo();
        if (v) {
            if (CFG.mute) v.muted = true;
            if (CFG.rate && v.playbackRate !== CFG.rate) { try { v.playbackRate = CFG.rate; } catch (e) {} }
            if (v.paused && !v.ended && v.readyState >= 2) v.play().catch(() => {});
        }
        const big = qs('.vjs-big-play-button');
        if (big && getComputedStyle(big).display !== 'none') big.click();
    }

    // 失焦续播：欺骗可见性 + 拦截 visibilitychange/blur（防作弊常据此暂停）
    function defeatVisibilityPause() {
        try {
            Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
            Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
        } catch (e) {}
        const block = (e) => e.stopImmediatePropagation();
        window.addEventListener('blur', block, true);
        document.addEventListener('visibilitychange', block, true);
        window.addEventListener('webkitvisibilitychange', block, true);
    }

    // ===================== 自动连播 =====================
    let autoNext = CFG.autoNextDefault;
    let advancing = false;
    let lastPlayedId = null;

    function playVideoSource(courseId, chapterId, sectionId, sourceId, title) {
        lastPlayedId = String(sourceId);
        location.hash = `#/${courseId}/${chapterId}/${sectionId}/${sourceId}/section`;
        log('▶ 连播 → ' + (title || sourceId));
        // 切换后视频元素会重建，连点几次确保起播
        let n = 0; const t = setInterval(() => { keepPlaying(); if (++n > 8) clearInterval(t); }, 600);
    }

    // 核心：从当前位置向后预查，找“下一个该播的视频”。返回 {video}|{locked}|{done}
    async function findNextVideo() {
        const cur = getCurrentSource();
        const courseId = getCourseId();
        const leaves = flattenLeaves();
        if (!leaves.length) return { error: '无目录(chapterList)' };

        let startIdx = 0;
        if (cur && cur.catalog_id != null) {
            const i = leaves.findIndex(l => String(l.section.id) === String(cur.catalog_id));
            if (i >= 0) startIdx = i;
        }
        const end = Math.min(leaves.length, startIdx + CFG.lookaheadMax);
        for (let i = startIdx; i < end; i++) {
            const leaf = leaves[i];
            const data = await fetchUnit(leaf.chapterId, leaf.section.id);
            if (data.code === 600) return { locked: true, msg: data.msg, section: leaf.section };
            if (data.code !== 1 || !Array.isArray(data.data)) continue;
            let pool = data.data;
            if (i === startIdx && cur) {
                const ci = pool.findIndex(s => String(s.id) === String(cur.id));
                if (ci >= 0) pool = pool.slice(ci + 1); // 当前节里只看当前视频之后的
            }
            const vid = pool.find(s => isVideoSrc(s) && (!CFG.skipFinished || s.finished != 1));
            if (vid) return { video: vid, courseId, chapterId: leaf.chapterId, sectionId: leaf.section.id };
            await sleep(60); // 轻微节流
        }
        return { done: true };
    }

    async function advance(reason) {
        if (!autoNext || advancing) return;
        advancing = true;
        try {
            log('查找下一个视频…(' + reason + ')');
            const r = await findNextVideo();
            if (r.video) {
                if (String(r.video.id) === lastPlayedId) { log('下一个与刚播放相同，跳过'); return; }
                playVideoSource(r.courseId, r.chapterId, r.sectionId, r.video.id, r.video.title);
            } else if (r.locked) {
                autoNext = false; refreshBtn();
                log('⛔ 已停：' + (r.msg || '下一节被闯关模式锁定'));
                log('（请先手动完成前面的测验/作业，再开启连播）');
            } else if (r.done) {
                autoNext = false; refreshBtn();
                log('✅ 已无更多待看视频，连播结束');
            } else {
                log('⚠ ' + (r.error || '未找到下一个视频'));
            }
        } finally {
            setTimeout(() => { advancing = false; }, 2500);
        }
    }

    function bindEnded() {
        const v = getVideo();
        if (v && !v._uoocBound) {
            v._uoocBound = true;
            v.addEventListener('ended', () => {
                if (autoNext) { log('视频结束'); setTimeout(() => advance('ended'), 1200); }
            });
        }
    }

    // ===================== 视频内弹窗答题（best-effort，新版弹窗结构待样本确认） =====================
    function tryHandleQuizPopup() {
        const cur = getCurrentSource();
        const quiz = (cur && cur.quiz) || [];
        if (!quiz.length) return;
        const layers = qsa('.layui-layer,[class*="popup"],[class*="dialog"],[class*="modal"],[class*="quiz"],[class*="test-view"]')
            .filter(el => el.offsetParent !== null && el.querySelector('button,[class*="btn"]'));
        if (!layers.length) return;
        const layer = layers[0];
        const qText = (layer.innerText || '').replace(/\s+/g, ' ').trim();
        for (const q of quiz) {
            const stem = (q.question || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (!stem || !qText.includes(stem.slice(0, 12))) continue;
            let ans = q.answer; try { ans = eval(q.answer); } catch (e) {}
            const opts = qsa('[class*="option"],li,label', layer);
            (Array.isArray(ans) ? ans : [ans]).forEach(a => { const idx = String(a).charCodeAt(0) - 65; if (opts[idx]) opts[idx].click(); });
            const submit = layer.querySelector('[class*="submit"],[class*="confirm"],button');
            if (submit) submit.click();
            log('弹窗答题(best-effort) → ' + stem.slice(0, 18));
            return;
        }
    }

    // ===================== 可视状态面板 =====================
    let panelEl, panelLogEl, btnEl;
    const panelLogs = [];
    function panelLog(msg) {
        if (!panelLogEl) return;
        panelLogs.push(new Date().toLocaleTimeString().slice(0, 8) + '  ' + msg);
        while (panelLogs.length > 9) panelLogs.shift();
        panelLogEl.textContent = panelLogs.join('\n');
    }
    function refreshBtn() {
        if (!btnEl) return;
        btnEl.textContent = '自动连播：' + (autoNext ? '开启 ✅' : '关闭');
        btnEl.style.background = autoNext ? '#1b5e20' : '#b71c1c';
    }
    function buildPanel() {
        if (panelEl || !document.body) return;
        panelEl = document.createElement('div');
        Object.assign(panelEl.style, { position: 'fixed', top: '120px', right: '20px', zIndex: 999999, width: '236px',
            background: 'rgba(0,40,40,.92)', color: '#b9f5e8', font: '12px/1.55 monospace',
            border: '1px solid #00796b', borderRadius: '10px', padding: '10px', boxShadow: '0 4px 18px rgba(0,0,0,.35)' });
        const title = document.createElement('div');
        title.textContent = 'UOOC 助手 v1.5';
        Object.assign(title.style, { fontWeight: 'bold', marginBottom: '6px', color: '#fff' });
        btnEl = document.createElement('button');
        Object.assign(btnEl.style, { width: '100%', padding: '8px', marginBottom: '8px', border: 'none',
            borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#fff' });
        btnEl.onclick = () => { autoNext = !autoNext; refreshBtn(); if (autoNext) onAutoNextOn(); };
        refreshBtn();
        panelLogEl = document.createElement('pre');
        Object.assign(panelLogEl.style, { margin: 0, whiteSpace: 'pre-wrap', maxHeight: '170px', overflow: 'hidden' });
        panelEl.append(title, btnEl, panelLogEl);
        document.body.appendChild(panelEl);
    }
    function onAutoNextOn() {
        keepPlaying();
        const cur = getCurrentSource();
        // 当前视频已完成 → 直接找下一个；否则正常播放，结束后再连播
        if (CFG.skipCurrentIfFinished && cur && cur.finished == 1) setTimeout(() => advance('toggle-finished'), 400);
        else log('已开启，将在本视频结束后自动连播');
    }

    // ===================== 主循环 =====================
    function tick() {
        try {
            keepPlaying();
            bindEnded();
            tryHandleQuizPopup();
            if (autoNext && !advancing) { const v = getVideo(); if (v && v.ended) advance('tick-ended'); }
        } catch (e) {}
    }

    function boot() {
        if (!document.body) return setTimeout(boot, 300);
        buildPanel();
        defeatVisibilityPause();
        setInterval(tick, CFG.tickMs);
        keepPlaying();
        log('已载入 v1.5 · 课程=' + getCourseId());
        window.__uooc = {
            CFG, get autoNext() { return autoNext; }, set autoNext(v) { autoNext = v; refreshBtn(); },
            getVideo, getCurrentSource, getChapterList, flattenLeaves, getCourseId,
            fetchUnit, findNextVideo, advance, playVideoSource, keepPlaying, findScopeWith,
        };
    }
    boot();
})();
