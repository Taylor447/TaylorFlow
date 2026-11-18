#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Core = require("../assets/placement/learning-core.js");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "TaylorFlow.html"), "utf8");
const legacyHtml = fs.readFileSync(path.join(root, "EPU IELTS Speaking.html"), "utf8");
const system = fs.readFileSync(path.join(root, "assets/placement/learning-system.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
const fail = message => { throw new Error(message); };
const check = (condition, message) => { if (!condition) fail(message); };

check(html.includes("tf-placement-v1"), "legacy placement storage key must remain in the app");
check(html.includes("learningPath") && html.includes("function progressSnapshot()"), "legacy learning path/sync contract is missing");
const snapshot = html.match(/function progressSnapshot\(\)\s*\{[\s\S]*?\n\}/u)?.[0] || "";
check(snapshot && !snapshot.includes("learningProfileV2"), "new CAT/adaptation namespace must stay outside cloud snapshots");
check(html.includes("function setInterfaceMode(mode)") && html.includes("INTERFACE_MODE_KEY"), "existing interface modes 1/2 must remain available");
check(html.includes("function applyThemeSkin(id)") && html.includes("function queueCloud()"), "existing theme and cloud-sync entry points must remain available");
check(system.includes('label[0].toLocaleUpperCase("vi-VN")'), "Vietnamese skill labels must capitalize Unicode correctly");
check(system.includes("function confidenceLabel(value)") && !system.includes("tin cậy ${esc(result.confidence)}"), "confidence labels must be localized");
check(html.includes("function rateFlashcard(grade)") && system.includes("window.rateFlashcard = function"), "spaced-repetition review must remain connected to adaptive recall");
check(html.includes("assets/placement/learning-core.js") && html.includes("assets/placement/learning-system.js"), "offline local scripts are not linked");
check(worker.includes("bank-A1-01.js") && worker.includes("bank-C2-01.js"), "service worker does not precache the full CAT bank");
check(!/\bfetch\s*\(|\bimport\s*\(/u.test(system), "learning UI must not add network fetch/import calls");
check(system.includes("start([1])") || system.includes("start([${activity.part"), "existing speaking routes are not reused");
check(system.includes("startExam(123)") && system.includes("go('col')") && system.includes("go('les')"), "existing mock, flashcard and lesson destinations must remain connected");
check(system.includes("function startPathBaseline()") && system.includes("function recordPathChallenge(result)"), "three-part speaking baseline flow is not connected to result handling");
check(system.includes("Bài CAT thích nghi 12–20 câu") && system.includes("Speaking Test hợp lệ") && html.includes("Bài kiểm tra thích nghi 12–20 câu") && html.includes("Bắt đầu Speaking Test") && !html.includes("8 câu ngắn về ngữ pháp và từ vựng"), "home still points to the legacy eight-question placement quiz");
check(system.includes("window.openLearningPathMap = openLearningPathMap") && html.includes('class="home-learning-map-link"') && legacyHtml.includes('class="home-learning-map-link"'), "the full learning map route must remain available in both app builds");
check(!html.includes('class="home-learning-actions"') && !legacyHtml.includes('class="home-learning-actions"') && !html.includes("Tiếp tục: thiết lập lộ trình") && !html.includes("Xem lộ trình 4 tuần →") && !legacyHtml.includes("Tiếp tục: thiết lập lộ trình") && !legacyHtml.includes("Xem lộ trình 4 tuần →"), "legacy home path actions must be removed");
check(html.includes("HOME_BUBBLE_APPS_KEY") && !html.includes("Tùy chỉnh ứng dụng") && !html.includes("homeBubbleCustomizer(") && !html.includes("Mở phần tùy chỉnh để thêm lối tắt"), "bubble home must hide the customization panel and preserve saved shortcut data");
check(html.includes("home-learning-accordion") && system.includes("home-learning-accordion") && html.includes('ontoggle="window.tfHomeLearningExpanded=this.open"') && system.includes('ontoggle="window.tfHomeLearningExpanded=this.open"'), "home learning plan must collapse by default and retain its open state across renders");
check(system.includes('result.blob && result.state === "ready"') && system.includes("signal.words >= 12"), "invalid or text-only baseline responses must not affect the speaking profile");
check(system.includes("updatePathSetup({ done: true") && html.includes("function queueCloud()"), "legacy learning-path save path is missing");

const now = Date.UTC(2026, 10, 18);
const old = Core.cleanProfile({ events: [{ type: "study-session", at: now - 61 * Core.DAY, durationMs: 360000, meta: { tab: "les", answerText: "private text" } }] }, now);
const compactedAgain = Core.cleanProfile(old, now);
check(old.events.length === 0 && old.aggregates.totals.sessions === 1, "expired study signals must roll up before removal");
check(compactedAgain.aggregates.totals.sessions === 1, "expired event rollup must not double count");
check(!JSON.stringify(old).includes("private text"), "event metadata must not retain answer text");
const storedPlan = Core.cleanProfile({ plan: { startedAt: now - 8 * Core.DAY, lastRebuilt: now - Core.DAY } }, now).plan;
check(storedPlan.startedAt === now - 8 * Core.DAY && storedPlan.lastRebuilt === now - Core.DAY, "plan timeline anchors must survive reload and migration");
check(system.includes("anchorAt: anchor") && system.includes("plan.todayActivities") && system.includes("value.plan.lastRebuilt = Date.now()"), "daily plan must advance by elapsed days and rebuild after learning activity");

const english = "I usually walk home after work and listen to music with my friends every evening.";
const history = [
  { id: "new", d: now - 1000, o: 6, f: 6, l: 6, g: 6, p: 5.5, scoreVersion: 19 },
  { id: "old", d: now - 2000, o: 5, f: 5, l: 5, g: 5, p: 4.5, scoreVersion: 9 },
  { id: "typed", d: now - 3000, o: 8, f: 8, l: 8, g: 8, p: null, scoreVersion: 19 },
  { id: "short", d: now - 4000, o: 8, f: 8, l: 8, g: 8, p: 8, scoreVersion: 19 }
];
const texts = { new: { text: english }, old: { text: english }, typed: { text: english }, short: { text: "Yes, maybe." } };
const accepted = Core.validSpeakingRows(history, texts, now, 19);
check(accepted.length === 2, "only real, adequate speaking evidence should contribute");
check(accepted.find(row => row.id === "old")?.weight === .25, "legacy score rows must receive lower weight");
check(accepted.some(row => row.id === "new"), "current valid speaking result was dropped");

const plan = Core.makePlan({ setup: { minutes: 5, target: 6, examDate: new Date(now + 120 * Core.DAY).toISOString().slice(0, 10) }, level: "B1", weakSkills: ["article", "preposition", "collocation"], dailyMinutes: 20, now });
check(plan.dailyMinutes === 5 && plan.stages[0].activities.reduce((sum, row) => sum + row.minutes, 0) <= 5, "plan must respect the daily time budget");
console.log("Integration contract, privacy boundary, legacy weighting, event compaction and time budget passed.");
