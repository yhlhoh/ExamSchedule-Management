document.addEventListener("DOMContentLoaded", () => {
    // 先把常用 DOM 节点收好，计时循环里就不用一遍遍找
    const elements = {
        examName: document.getElementById("examName"),
        message: document.getElementById("message"),
        currentTime: document.getElementById("current-time"),
        currentSubject: document.getElementById("current-subject"),
        examTiming: document.getElementById("exam-timing"),
        remainingTime: document.getElementById("remaining-time"),
        status: document.getElementById("status"),
        examTableBody: document.getElementById("exam-table-body"),
        room: document.getElementById("room"),
        infoToggleBtn: document.getElementById("info-toggle-btn"),
        paperInfo: document.getElementById("paper-info"),
        reminderOverlay: document.getElementById("reminder-overlay")
    };

    const countButtons = Array.from(document.querySelectorAll(".count-btn"));
    const paperFieldIds = ["paper-count", "paper-pages", "sheet-count", "sheet-pages"];
    const paperInputs = paperFieldIds.reduce((acc, id) => {
        const input = document.getElementById(id);
        if (input) acc[id] = input;
        return acc;
    }, {});

    // 把页面状态放在一个地方，后面谁用都能拿到
    const state = {
        offsetSeconds: Number(getCookie("offsetTime")) || 0,
        showPaperInfo: getCookie("showPaperInfo") === "true",
        autoToggle: getCookie("autoToggle") === "true",
        schedule: null,
        timers: { clock: null, exam: null },
        notifiedExamId: null,
        statusCells: new Map()
    };

    initializeVisibility();
    setupEventListeners();
    loadPaperInfo();
    fetchData();

    // 初始化一下显示状态，避免页面刚载入时闪屏
    function initializeVisibility() {
        if (!elements.paperInfo || !elements.currentSubject) {
            return;
        }

        if (state.autoToggle) {
            setPaperAndSubjectDisplay("none", "block");
            return;
        }

        if (state.showPaperInfo) {
            setPaperAndSubjectDisplay("block", "none");
        } else {
            setPaperAndSubjectDisplay("none", "block");
        }
    }

    function setPaperAndSubjectDisplay(paperDisplay, subjectDisplay) {
        if (elements.paperInfo) {
            elements.paperInfo.style.display = paperDisplay;
        }
        if (elements.currentSubject) {
            elements.currentSubject.style.display = subjectDisplay;
        }
    }

    // 绑定各种交互；只在有实际变动时再去动 localStorage
    function setupEventListeners() {
        if (elements.infoToggleBtn) {
            elements.infoToggleBtn.addEventListener("click", () => {
                if (state.autoToggle) return;
                state.showPaperInfo = !state.showPaperInfo;
                setCookie("showPaperInfo", state.showPaperInfo, 365);
                if (state.showPaperInfo) {
                    setPaperAndSubjectDisplay("block", "block");
                } else {
                    setPaperAndSubjectDisplay("none", "block");
                }
            });
        }

        countButtons.forEach(btn => {
            const target = paperInputs[btn.dataset.target];
            if (!target) return;

            btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                const currentValue = parseInt(target.value, 10) || 0;
                const nextValue = action === "increase" ? currentValue + 1 : Math.max(0, currentValue - 1);
                target.value = nextValue;
                updatePaperInfo();
            });
        });

        Object.values(paperInputs).forEach(input => {
            input.addEventListener("change", () => {
                const value = parseInt(input.value, 10) || 0;
                input.value = Math.max(0, value);
                updatePaperInfo();
            });
        });
    }

    // 拉取后端配置，顺便把计时器都安排好，失败就提示给前台
    function fetchData() {
        const urlParams = new URLSearchParams(window.location.search);
        const configId = urlParams.get("configId");

        if (!configId) {
            errorSystem.show("未提供配置ID，请从主页进入");
            return;
        }

        stopTimers();

        fetch(`/api/get_config.php?id=${encodeURIComponent(configId)}`)
            .then(async response => {
                if (!response.ok) {
                    let errorMessage = "服务器响应异常";
                    try {
                        const errPayload = await response.json();
                        if (errPayload && errPayload.message) {
                            errorMessage = errPayload.message;
                        }
                    } catch (e) {
                        // ignore parsing error and use default message
                    }
                    throw new Error(errorMessage);
                }
                return response.json();
            })
            .then(data => {
                state.schedule = normalizeSchedule(data);
                displayExamInfo(state.schedule);
                renderExamTable(state.schedule.examInfos);
                updateCurrentTime();
                updateExamInfo();
                startTimers();
            })
            .catch(error => errorSystem.show("获取考试数据失败: " + error.message));
    }

    // 预处理原始数据：补 ID、算时间，后面用着省心
    function normalizeSchedule(data) {
        const normalized = { ...data };
        const rawExams = Array.isArray(data.examInfos) ? data.examInfos : [];

        normalized.examInfos = rawExams
            .map((exam, index) => {
                const startDate = new Date(exam.start);
                const endDate = new Date(exam.end);
                if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
                    console.warn("无效的考试时间", exam);
                    return null;
                }
                return {
                    ...exam,
                    id: exam.id ?? index,
                    startDate,
                    endDate,
                    subjects: exam.name ? exam.name.split("/").map(name => name.trim()).filter(Boolean) : ["未命名科目"]
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.startDate - b.startDate);

        return normalized;
    }

    function displayExamInfo(data) {
        try {
            if (!data) return;
            const existingTitleNode = elements.examName
                ? Array.from(elements.examName.childNodes).find(node => node.nodeType === 3)
                : null;
            const currentTitle = existingTitleNode ? existingTitleNode.textContent.trim() : "";
            const examNameText = data.examName || currentTitle;
            const roomText = data.room || (elements.room ? elements.room.textContent : "");

            if (elements.examName) {
                const roomSpan = elements.room || document.createElement("span");
                roomSpan.id = "room";
                roomSpan.textContent = roomText;
                elements.examName.textContent = examNameText ? `${examNameText} ` : "";
                elements.examName.appendChild(roomSpan);
                elements.room = roomSpan;
            }

            if (elements.message) {
                elements.message.textContent = data.message || "";
            }
        } catch (e) {
            errorSystem.show("显示考试信息失败: " + e.message);
        }
    }

    // 管一下计时器，别让 setInterval 开太多
    function startTimers() {
        stopTimers();
        state.timers.clock = setInterval(updateCurrentTime, 1000);
        state.timers.exam = setInterval(updateExamInfo, 1000);
    }

    // 清理旧计时器，重新拉数据时才不会叠罗汉
    function stopTimers() {
        Object.keys(state.timers).forEach(key => {
            if (state.timers[key]) {
                clearInterval(state.timers[key]);
                state.timers[key] = null;
            }
        });
    }

    // 当前时间记得加上偏移量，别在各处重复算
    function getNow() {
        return new Date(Date.now() + state.offsetSeconds * 1000);
    }

    function updateCurrentTime() {
        try {
            if (!elements.currentTime) return;
            const now = getNow();
            elements.currentTime.textContent = now.toLocaleTimeString("zh-CN", { hour12: false });
        } catch (e) {
            errorSystem.show("更新时间失败: " + e.message);
        }
    }

    // 每秒跑一圈，把左侧状态和右侧表格都更新一下
    function updateExamInfo() {
        try {
            if (!state.schedule || !Array.isArray(state.schedule.examInfos)) return;
            const now = getNow();
            const { currentExam, nextExam, lastExam } = locateExamState(state.schedule.examInfos, now);

            if (state.autoToggle && elements.paperInfo && elements.currentSubject) {
                setPaperAndSubjectDisplay(currentExam ? "block" : "none", "block");
            }

            if (currentExam) {
                updateCurrentExamSection(currentExam, now);
            } else {
                updateNonExamSection(nextExam, lastExam, now);
            }

            updateExamStatuses(now);
        } catch (e) {
            console.error("更新考试信息失败:", e);
            errorSystem.show("更新考试信息失败: " + e.message);
        }
    }

    // 正在考试的逻辑，顺带处理 15 分钟提醒
    function updateCurrentExamSection(exam, now) {
        if (elements.currentSubject) {
            elements.currentSubject.textContent = `当前科目: ${exam.name}`;
        }

        if (elements.examTiming) {
            elements.examTiming.textContent = `起止时间: ${formatExamTimeRange(exam)}`;
        }

        const remainingSeconds = Math.max(0, Math.round((exam.endDate - now) / 1000));
        const timeParts = splitTime(remainingSeconds);
        const timeText = `${timeParts.hours}时 ${timeParts.minutes}分 ${timeParts.seconds}秒`;
        const isClosingSoon = timeParts.hours === 0 && timeParts.minutes <= 14;

        if (elements.remainingTime) {
            elements.remainingTime.textContent = `${isClosingSoon ? "倒计时" : "剩余时间"}: ${timeText}`;
            elements.remainingTime.style.color = isClosingSoon ? "red" : "#93b4f7";
            elements.remainingTime.style.fontWeight = isClosingSoon ? "bold" : "normal";
        }

        if (elements.status) {
            elements.status.textContent = `状态: ${isClosingSoon ? "即将结束" : "进行中"}`;
            elements.status.style.color = isClosingSoon ? "red" : "#5ba838";
        }

        handleReminder(exam, remainingSeconds);
    }

    // 不在考试时的几种场景：快开始、刚结束、彻底空档
    function updateNonExamSection(nextExam, lastExam, now) {
        if (elements.examTiming) {
            elements.examTiming.textContent = nextExam ? `起止时间: ${formatExamTimeRange(nextExam)}` : "";
        }

        if (nextExam) {
            const secondsUntilStart = Math.max(0, Math.round((nextExam.startDate - now) / 1000));
            const timeParts = splitTime(secondsUntilStart);
            const timeText = `${timeParts.hours}时 ${timeParts.minutes}分 ${timeParts.seconds}秒`;
            const isStartingSoon = secondsUntilStart <= 15 * 60;

            if (elements.currentSubject) {
                elements.currentSubject.textContent = `${isStartingSoon ? "即将开始" : "下一场科目"}: ${nextExam.name}`;
            }

            if (elements.remainingTime) {
                if (isStartingSoon) {
                    elements.remainingTime.textContent = `倒计时: ${timeText}`;
                    elements.remainingTime.style.color = "orange";
                    elements.remainingTime.style.fontWeight = "bold";
                } else {
                    elements.remainingTime.textContent = "";
                    elements.remainingTime.style.color = "#93b4f7";
                    elements.remainingTime.style.fontWeight = "normal";
                }
            }

            if (elements.status) {
                elements.status.textContent = `状态: ${isStartingSoon ? "即将开始" : "未开始"}`;
                elements.status.style.color = isStartingSoon ? "#DBA014" : "#EAEE5B";
            }

            if (!isStartingSoon) {
                state.notifiedExamId = null;
            }
            return;
        }

        if (lastExam && now - lastExam.endDate <= 60 * 1000) {
            if (elements.currentSubject) {
                elements.currentSubject.textContent = `上场科目: ${lastExam.name}`;
            }
            if (elements.status) {
                elements.status.textContent = "状态: 已结束";
                elements.status.style.color = "red";
            }
        } else {
            if (elements.currentSubject) {
                elements.currentSubject.textContent = "考试均已结束";
            }
            if (elements.status) {
                elements.status.textContent = "状态: 空闲";
                elements.status.style.color = "#3946AF";
            }
        }

        if (elements.remainingTime) {
            elements.remainingTime.textContent = "";
            elements.remainingTime.style.fontWeight = "normal";
            elements.remainingTime.style.color = "#93b4f7";
        }

        state.notifiedExamId = null;
    }

    function formatExamTimeRange(exam) {
        const startText = formatTimeWithoutSeconds(exam.startDate.toLocaleTimeString("zh-CN", { hour12: false }));
        const endText = formatTimeWithoutSeconds(exam.endDate.toLocaleTimeString("zh-CN", { hour12: false }));
        return `${startText} - ${endText}`;
    }

    function splitTime(totalSeconds) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return { hours, minutes, seconds };
    }

    // 盖板提醒什么时候弹、什么时候收
    function handleReminder(exam, remainingSeconds) {
        if (!elements.reminderOverlay) return;

        if (remainingSeconds <= 15 * 60 && remainingSeconds > 0) {
            if (state.notifiedExamId !== exam.id) {
                state.notifiedExamId = exam.id;
                elements.reminderOverlay.classList.add("show");
                setTimeout(() => {
                    elements.reminderOverlay.classList.remove("show");
                }, 5000);
            }
        } else if (remainingSeconds > 15 * 60) {
            state.notifiedExamId = null;
        } else if (remainingSeconds === 0) {
            elements.reminderOverlay.classList.remove("show");
        }
    }

    // 找出当前、下一场和上一场，交给 UI 自己决定怎么展示
    function locateExamState(exams, now) {
        const currentExam = exams.find(exam => now >= exam.startDate && now <= exam.endDate) || null;
        let nextExam = null;
        let lastExam = null;

        for (const exam of exams) {
            if (now < exam.startDate) {
                nextExam = exam;
                break;
            }
        }

        for (let i = exams.length - 1; i >= 0; i--) {
            if (now > exams[i].endDate) {
                lastExam = exams[i];
                break;
            }
        }

        return { currentExam, nextExam, lastExam };
    }

    // 画右侧表格，同时把状态标签缓存下来，后续刷新更快
    function renderExamTable(exams) {
        if (!elements.examTableBody) return;
        elements.examTableBody.replaceChildren();
        state.statusCells.clear();

        if (!exams.length) return;

        const fragment = document.createDocumentFragment();
        const groups = groupExamsByDate(exams);

        groups.forEach(group => {
            let isFirstRowForGroup = true;
            const totalRows = group.exams.reduce((rows, exam) => rows + exam.subjects.length, 0);

            group.exams.forEach(exam => {
                exam.subjects.forEach((subject, index) => {
                    const row = document.createElement("tr");

                    if (isFirstRowForGroup) {
                        const dateCell = document.createElement("td");
                        dateCell.rowSpan = totalRows;
                        dateCell.innerHTML = group.label;
                        row.appendChild(dateCell);
                        isFirstRowForGroup = false;
                    }

                    const subjectCell = document.createElement("td");
                    subjectCell.textContent = subject;
                    row.appendChild(subjectCell);

                    if (index === 0) {
                        const startCell = document.createElement("td");
                        startCell.rowSpan = exam.subjects.length;
                        startCell.textContent = formatTimeWithoutSeconds(exam.startDate.toLocaleTimeString("zh-CN", { hour12: false }));
                        row.appendChild(startCell);

                        const endCell = document.createElement("td");
                        endCell.rowSpan = exam.subjects.length;
                        endCell.textContent = formatTimeWithoutSeconds(exam.endDate.toLocaleTimeString("zh-CN", { hour12: false }));
                        row.appendChild(endCell);

                        const statusCell = document.createElement("td");
                        statusCell.rowSpan = exam.subjects.length;
                        const statusTag = document.createElement("span");
                        statusCell.appendChild(statusTag);
                        row.appendChild(statusCell);
                        state.statusCells.set(exam.id, { tag: statusTag, exam });
                    }

                    fragment.appendChild(row);
                });
            });
        });

        elements.examTableBody.appendChild(fragment);
        updateExamStatuses(getNow());
    }

    // 先按日期和上下午切分，好做表格的行合并
    function groupExamsByDate(exams) {
        const groupsMap = new Map();

        exams.forEach(exam => {
            const date = exam.startDate;
            const periodLabel = getPeriodLabel(date.getHours());
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${periodLabel}`;
            if (!groupsMap.has(key)) {
                const label = `${date.getMonth() + 1}月${date.getDate()}日<br>${periodLabel}`;
                groupsMap.set(key, { label, exams: [] });
            }
            groupsMap.get(key).exams.push(exam);
        });

        return Array.from(groupsMap.values());
    }

    function getPeriodLabel(hour) {
        if (hour < 12) return "上午";
        if (hour < 18) return "下午";
        return "晚上";
    }

    // 把缓存好的状态标签逐个更新
    function updateExamStatuses(now = getNow()) {
        state.statusCells.forEach(({ tag, exam }) => {
            const status = resolveExamStatus(exam, now);
            tag.textContent = status;
            tag.className = `exam-status-tag exam-status-${status}`;
        });
    }

    // 算出考试处于哪个阶段，开考前 15 分钟提前改成“即将开始”
    function resolveExamStatus(exam, now) {
        if (now < exam.startDate) {
            return now >= new Date(exam.startDate.getTime() - 15 * 60 * 1000) ? "即将开始" : "未开始";
        }
        if (now > exam.endDate) {
            return "已结束";
        }
        return "进行中";
    }

    // 试卷/答题卡的数字随手存一下，下次刷新还能看到
    function updatePaperInfo() {
        const paperInfo = {
            paperCount: parseInt(paperInputs["paper-count"]?.value, 10) || 0,
            paperPages: parseInt(paperInputs["paper-pages"]?.value, 10) || 0,
            sheetCount: parseInt(paperInputs["sheet-count"]?.value, 10) || 0,
            sheetPages: parseInt(paperInputs["sheet-pages"]?.value, 10) || 0
        };
        localStorage.setItem("paperInfo", JSON.stringify(paperInfo));
    }

    // 页面刚起步时把旧数据填回去，兼容一路走来的字段命名
    function loadPaperInfo() {
        try {
            const savedInfo = localStorage.getItem("paperInfo");
            if (!savedInfo) return;
            const info = JSON.parse(savedInfo);
            Object.entries(paperInputs).forEach(([id, input]) => {
                const key = idToCamel(id);
                const storedValue = Object.prototype.hasOwnProperty.call(info, key)
                    ? info[key]
                    : Object.prototype.hasOwnProperty.call(info, id)
                        ? info[id]
                        : undefined;

                if (storedValue !== undefined) {
                    input.value = storedValue;
                } else if (!input.value) {
                    input.value = 0;
                }
            });
        } catch (e) {
            console.error("加载页数信息失败:", e);
        }
    }

    function idToCamel(id) {
        return id.split("-").map((part, index) => index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)).join("");
    }
});
