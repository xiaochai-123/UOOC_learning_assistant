// ==UserScript==
// @name         UOOC 学习助手_szu_v2
// @namespace    https://github.com/xiaochai-123
// @version      1.0
// @description  自动静音、二倍速、失焦不断播、自动连播、自动答题(视频中非测验)。跨章节递归自动播放，学习好帮手。
// @license      GPL
// @match        *://www.uooc.net.cn/*
// @grant        none
// @downloadURL https://update.greasyfork.org/scripts/555212/UOOC%20%E5%AD%A6%E4%B9%A0%E5%8A%A9%E6%89%8B_szu_v2.user.js
// @updateURL https://update.greasyfork.org/scripts/555212/UOOC%20%E5%AD%A6%E4%B9%A0%E5%8A%A9%E6%89%8B_szu_v2.meta.js
// ==/UserScript==

(function () {
    "use strict";

    // ================= 自动播放、倍速、静音 =================
    function keepPlaying() {
        const video = document.getElementById("player_html5_api");
        if (video) {
            video.muted = true;
            video.playbackRate = 2;
            if (video.paused && !video.ended) video.play();
        }
        const playBtn = document.querySelector(".vjs-big-play-button");
        if (playBtn) playBtn.click();
    }
    setInterval(keepPlaying, 500);

    // ================= 自动答题优化 =================
    let lastQuizQuestion = null;
    function autoAnswerQuiz() {
        let quizLayer = document.querySelector("#quizLayer");
        if (quizLayer && quizLayer.style.display !== "none") {
            try {
                let videoDiv = document.querySelector("div[uooc-video]");
                if (!videoDiv) return;
                let source = videoDiv.getAttribute("source");
                if (!source) return;
                let quizList = JSON.parse(source).quiz || [];
                let quizQuestionElem = document.querySelector(".smallTest-view .ti-q-c");
                if (!quizQuestionElem) return;
                let quizQuestion = quizQuestionElem.innerHTML.trim();

                if (lastQuizQuestion === quizQuestion && quizLayer.classList.contains("answered")) {
                    autoCloseQuizLayer(quizLayer);
                    return;
                }

                let quizIndex = quizList.findIndex(q => q.question === quizQuestion);
                if (quizIndex === -1) return;
                let quizAnswer = eval(quizList[quizIndex].answer);
                let quizOptions = quizLayer.querySelector("div.ti-alist");
                if (quizOptions) {
                    for (let ans of quizAnswer) {
                        let labelIndex = ans.charCodeAt() - "A".charCodeAt();
                        let opt = quizOptions.children[labelIndex];
                        if (opt) opt.click();
                    }
                    let btn = quizLayer.querySelector("button");
                    if (btn) btn.click();
                    quizLayer.classList.add("answered");
                    lastQuizQuestion = quizQuestion;
                    console.log("自动答题已完成:", quizQuestion, quizAnswer.toString());
                    autoCloseQuizLayer(quizLayer);
                }
            } catch (error) {
                console.log("自动答题发生错误:", error);
            }
        } else {
            lastQuizQuestion = null;
            let answeredLayer = document.querySelector("#quizLayer.answered");
            if (answeredLayer) answeredLayer.classList.remove("answered");
        }
    }

    function autoCloseQuizLayer(quizLayer) {
        if (!quizLayer) return;
        let btnClose =
            quizLayer.querySelector(".layui-layer-btn0") ||
            quizLayer.querySelector(".layui-layer-close") ||
            quizLayer.querySelector(".layer-close") ||
            quizLayer.querySelector("button[type=button]") ||
            quizLayer.parentElement?.querySelector(".layui-layer-btn0");
        if (btnClose) btnClose.click();
        setTimeout(() => {
            if (quizLayer && quizLayer.style.display !== "none") {
                if (btnClose) btnClose.click();
            }
        }, 500);
    }
    setInterval(autoAnswerQuiz, 500);

    // ================= 跨章节递归连播刷课核心（已整合连播功能） =================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function clearShader() {
        let shaders = document.querySelectorAll("div.layui-layer-shade");
        shaders.forEach(shader => shader.remove());
    }

    // 查找当前活跃的视频节点
    function findCurrentVideoNode() {
        let current = document.querySelector('.basic.active');
        if (current) return current;
        current = document.querySelector('.video-list li.current, .chapter-list li.current, .menu li.current, li.active, li.selected');
        if (current) return current;
        return null;
    }

    // 查找当前章节的下一个视频节点
    function findNextVideoInSameChapter(currentNode) {
        if (!currentNode) return null;
        // 找到当前章节的容器
        let chapterContainer = currentNode.closest('ul, .chapter-list, .video-list');
        if (!chapterContainer) return null;
        // 在当前章节内查找下一个视频节点
        let allVideoNodes = Array.from(chapterContainer.querySelectorAll('li, .basic'));
        let currentIndex = allVideoNodes.indexOf(currentNode);
        if (currentIndex === -1 || currentIndex >= allVideoNodes.length - 1) {
            return null; // 已经是当前章节的最后一个视频
        }
        // 查找下一个有效的视频节点
        for (let i = currentIndex + 1; i < allVideoNodes.length; i++) {
            let nextNode = allVideoNodes[i];
            if (nextNode.querySelector('.icon-video, span.icon-video') ||
                nextNode.classList.contains('taskpoint') &&
                !nextNode.innerText.includes("测验")) {
                return nextNode;
            }
        }
        return null;
    }

    // 播放下一个视频（同一章节内）
    function playNextVideoInChapter() {
        let current = findCurrentVideoNode();
        let next = findNextVideoInSameChapter(current);
        if (next) {
            let clickTarget = next.querySelector('a') || next;
            clickTarget.click();
            console.log('播放同一章节的下一个视频');
            setTimeout(() => {
                const video = document.getElementById('player_html5_api');
                if (video) {
                    video.muted = true;
                    video.playbackRate = 2;
                    video.play();
                }
            }, 1000);
            return true; // 成功找到并播放下一个视频
        }
        // 本章节已无后续视频
        return false;
    }

    // 修改后的等待视频播放完毕函数
    function waitForVideoCompletion() {
        return new Promise(resolve => {
            const video = document.getElementById('player_html5_api');
            if (!video) {
                resolve();
                return;
            }
            // 绑定结束事件
            video._recursiveResolve = resolve;
            video.onended = function() {
                console.log('视频播放结束，等待1.5秒后继续');
                setTimeout(() => {
                    if (video._recursiveResolve) {
                        video._recursiveResolve();
                    }
                }, 1500);
            };
            // 设置视频参数并播放
            video.muted = true;
            video.playbackRate = 2;
            const playBtn = document.querySelector(".vjs-big-play-button");
            if (playBtn) playBtn.click();

            // 如果视频已经在播放，设置一个超时检查
            setTimeout(() => {
                if (video.ended && video._recursiveResolve) {
                    video._recursiveResolve();
                }
            }, 500);
        });
    }

    // 查找当前大章节点
    function findCurrentChapter() {
        const currentVideoNode = findCurrentVideoNode();
        if (!currentVideoNode) return null;

        // 向上查找当前大章
        let node = currentVideoNode;
        while (node && node.parentElement) {
            if (node.parentElement.classList.contains('rank-1') ||
                node.classList.contains('rank-1-item')) {
                return node;
            }
            node = node.parentElement;
        }
        return null;
    }

    // 从当前大章开始递归查找未完成内容
    async function searchUncompleteFromCurrentChapter() {
        const catalogRoot = document.querySelector("ul.rank-1");
        if (!catalogRoot) return;

        const chapters = Array.from(catalogRoot.children);
        const currentChapter = findCurrentChapter();

        let startIndex = 0;
        if (currentChapter) {
            // 找到当前大章在章节列表中的位置
            startIndex = chapters.indexOf(currentChapter);
            if (startIndex === -1) startIndex = 0;
        }

        console.log(`从第${startIndex + 1}个大章开始递归`);

        // 从当前大章开始遍历
        for (let i = startIndex; i < chapters.length; i++) {
            const chapter = chapters[i];
            await checkActive(chapter);
        }
    }

    // 检查并播放活跃章节
    async function checkActive(catalog) {
        let children = catalog.children;
        let elem = catalog?.firstElementChild;

        if (elem && elem.classList.contains("uncomplete") && !elem.innerText.includes("测试")) {
            let iElement = elem.getElementsByTagName("i")[0];
            if (iElement && iElement.classList.contains("icon-xiangxia")) {
                elem.click();
            }
            await sleep(500);
            for (let i = 1; i < children.length; i++) {
                if (children[i].tagName === "DIV" &&
                    children[i]?.firstElementChild &&
                    !children[i].firstElementChild.classList.contains("complete")) {
                    let spanElem = children[i].firstElementChild.children[1];
                    if (spanElem && spanElem.classList.contains("taskpoint") && !spanElem.innerText.includes("测验")) {
                        // 点击播放当前视频
                        children[i].firstElementChild.click();
                        clearShader();
                        // 等待当前视频播放完毕
                        await waitForVideoCompletion();
                        // 播放同一章节的后续视频
                        while (playNextVideoInChapter()) {
                            await waitForVideoCompletion();
                        }
                    }
                } else if (children[i].tagName === "UL") {
                    await searchUncomplete(children[i]);
                }
            }
        }
    }

    // 原有的递归函数（保持兼容）
    async function searchUncomplete(query) {
        let catalog = query.children;
        for (let i = 0; i < catalog.length; i++) {
            await checkActive(catalog[i]);
        }
    }

    // 启动递归播放 - 从当前大章开始
    async function startUltimateCourseRush() {
        await searchUncompleteFromCurrentChapter();
    }

    let autoRecursiveFlag = false;

    // 主启动逻辑，检测章节播放结束并递归
    $(document).ready(function () {
        setTimeout(() => { autoRecursiveFlag = true; startUltimateCourseRush(); }, 1000);
        // 每隔800ms检测是否需要递归继续刷课
        setInterval(async function () {
            if (autoRecursiveFlag) {
                // 检测是否已经没有正在播放的视频且页面没有未完成内容
                const video = document.getElementById('player_html5_api');
                if ((!video || video.ended) && !document.querySelector(".basic.active")) {
                    // 继续从当前大章开始递归查找下一个未完成章节
                    await startUltimateCourseRush();
                }
            }
        }, 800);

        setInterval(bindVideoEnded, 800);
    });

    // 修复：绑定视频结束后跳到下一个章节的小节逻辑
    function bindVideoEnded() {
        const video = document.getElementById('player_html5_api');
        if (video && !video._autoNextBound) {
            video._autoNextBound = true;
            video.onended = function () {
                console.log('视频播放结束，检查是否有下一个视频');
                if (!playNextVideoInChapter()) {
                    // 如果没有下一个视频，允许递归到下一个小节
                    setTimeout(() => {
                        autoRecursiveFlag = true;
                        startUltimateCourseRush();
                    }, 1500);
                }
            };
        }
    }
})();
