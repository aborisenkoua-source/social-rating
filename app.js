"use strict";
/*
 * Социальный рейтинг — локальное веб-приложение (версия 2).
 *
 * Ключевые правила (v2):
 *  - Итог = кап 100 от суммы:
 *      * штрафы (kind=PENALTY, в т.ч. авто −2×) — за ВСЕ дни, навсегда;
 *      * ежедневные дела/чекпоинт (isDaily=true) — только за ПОСЛЕДНИЙ заполненный день;
 *      * прочие дела и произвольные записи — за все дни.
 *  - «Заполненный день» = есть хоть одна ручная запись ИЛИ день закрыт.
 *  - Авто-чекпоинт «Сделаны все ежедневные дела» (+2) — когда все обязательные
 *    (видимые этому ребёнку) ежедневные дела дня отмечены.
 *  - Закрытие дня: за каждое невыполненное обязательное ежедневное дело — авто −2×.
 *  - Дела могут быть общими (childId=null) или персональными (childId=childId);
 *    общие дела можно скрыть конкретному ребёнку (child.hiddenTaskIds).
 */

/* ============================================================
 * 1. КОНСТАНТЫ И SEED
 * ============================================================ */
const STORAGE_KEY = "socialRating.v2";

const KIND = { TASK: "task", CHECKPOINT: "checkpoint", PENALTY: "penalty", CUSTOM: "custom" };

const DEFAULT_COLORS = ["#1f6feb", "#12b76a", "#f79009", "#7c3aed", "#e11d48", "#0891b2"];

function uid(p = "id") {
  return p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function pad2(n) { return String(n).padStart(2, "0"); }
function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoFromDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function shiftDateISO(iso, deltaDays) {
  const d = parseISO(iso); d.setDate(d.getDate() + deltaDays);
  return isoFromDate(d);
}
function fmtHuman(iso) {
  const d = parseISO(iso);
  const wd = ["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"][d.getDay()];
  const mo = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"][d.getMonth()];
  return `${wd}, ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

function seedTasks() {
  return [
    { id: uid("t"), name: "Нет замечаний по части помощи", points: 2,   isDaily: true,  isMandatory: true,  kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Сделаны упражнения",            points: 3,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Посидел с Сашей",               points: 5,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Сделал уроки вовремя",          points: 3,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Вовремя лег спать",             points: 5,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Летнее чтение",                 points: 2,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Бег",                           points: 3,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Отжимания",                     points: 3,   isDaily: true,  isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Пострижены ногти",              points: 5,   isDaily: false, isMandatory: false, kind: KIND.TASK, childId: null },
    { id: uid("t"), name: "Солгал/Схитрил",                points: -25, isDaily: false, isMandatory: false, kind: KIND.PENALTY, childId: null },
    { id: uid("t"), name: "Зубы (не почистил/плохо почистил)", points: -5, isDaily: false, isMandatory: false, kind: KIND.PENALTY, childId: null },
    { id: uid("t"), name: "Сделаны все ежедневные дела",   points: 2,   isDaily: true,  isMandatory: false, kind: KIND.CHECKPOINT, childId: null },
  ];
}
function seedScales() {
  return {
    trust: [
      { min: 0,   label: "Доверия нет, сидит по таймеру, который ставят родители" },
      { min: 50,  label: "Может сам себе ставить таймер" },
      { min: 100, label: "Таймер не нужен" },
    ],
    gadgetHours: [
      { min: 0,   hours: 0 },
      { min: 10,  hours: 1 },
      { min: 20,  hours: 2 },
      { min: 40,  hours: 3 },
      { min: 80,  hours: 4 },
      { min: 100, hours: null },
    ],
  };
}
function seedData() {
  return {
    version: 2,
    children: [
      { id: uid("c"), name: "Толя", color: DEFAULT_COLORS[0], hiddenTaskIds: [] },
      { id: uid("c"), name: "Лёша", color: DEFAULT_COLORS[1], hiddenTaskIds: [] },
    ],
    tasks: seedTasks(),
    log: {},
    scales: seedScales(),
    settings: {
      selectedChildId: null,
      dayDate: todayISO(),
      calYear: new Date().getFullYear(),
      calMonth: new Date().getMonth(),
      calView: "month",
    },
  };
}

/* ============================================================
 * 2. ХРАНИЛИЩЕ + МИГРАЦИЯ v1 -> v2
 * ============================================================ */
function migrate(data) {
  if (!data.version || data.version < 2) {
    const seed = seedData();
    data.children ||= [];
    for (const c of data.children) if (!c.hiddenTaskIds) c.hiddenTaskIds = [];
    data.tasks ||= seed.tasks;
    for (const t of data.tasks) if (t.childId === undefined) t.childId = null;
    data.log ||= {};
    for (const childId of Object.keys(data.log)) {
      for (const dateISO of Object.keys(data.log[childId])) {
        const day = data.log[childId][dateISO];
        if (!day) continue;
        if (day.finalized === undefined) day.finalized = false;
        for (const e of (day.entries || [])) {
          if (e.isDaily === undefined) {
            const t = e.taskId ? data.tasks.find(x => x.id === e.taskId) : null;
            e.isDaily = t ? !!t.isDaily : false;
          }
        }
      }
    }
    data.scales ||= seed.scales;
    data.settings ||= { selectedChildId: null };
    data.settings.dayDate ||= todayISO();
    data.settings.calYear ||= new Date().getFullYear();
    data.settings.calMonth ||= new Date().getMonth();
    data.settings.calView ||= "month";
    data.version = 2;
  }
  return data;
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error("load failed, reseeding", e);
    return seedData();
  }
}
let DB = load();

/* ============================================================
 * 2b. ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ (Supabase) — опционально, см. config.js
 * ============================================================ */
const SB = (typeof SUPABASE_URL !== "undefined" && SUPABASE_URL && typeof supabase !== "undefined")
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
const CLOUD_ROW_ID = "family";
let applyingRemote = false; // true пока применяем данные с сервера — чтобы не запустить пуш в ответ
let pushTimer = null;

function setSyncStatus(text, cls) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  el.textContent = text;
  el.className = "sync-status" + (cls ? " " + cls : "");
}
function schedulePush() {
  if (!SB || applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToCloud, 500);
}
async function pushToCloud() {
  if (!SB) return;
  try {
    const { error } = await SB.from("state").upsert({ id: CLOUD_ROW_ID, data: DB, updated_at: new Date().toISOString() });
    if (error) throw error;
    setSyncStatus("");
  } catch (e) {
    console.error("push failed", e);
    setSyncStatus("⚠ офлайн", "offline");
  }
}
async function pullFromCloud() {
  if (!SB) return;
  try {
    const { data, error } = await SB.from("state").select("data").eq("id", CLOUD_ROW_ID).maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      applyingRemote = true;
      DB = migrate(data.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
      render();
      applyingRemote = false;
    } else {
      await pushToCloud(); // в облаке ещё нет строки — создаём из текущих локальных данных
    }
    setSyncStatus("");
  } catch (e) {
    console.error("pull failed", e);
    setSyncStatus("⚠ офлайн", "offline");
  }
}
function subscribeRealtime() {
  if (!SB) return;
  SB.channel("state-changes")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "state", filter: `id=eq.${CLOUD_ROW_ID}` }, (payload) => {
      if (applyingRemote) return;
      applyingRemote = true;
      DB = migrate(payload.new.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
      render();
      applyingRemote = false;
    })
    .subscribe();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  schedulePush();
}

/* ============================================================
 * 3. ВСПОМОГАТЕЛЬНЫЕ
 * ============================================================ */
function ensureChild(id) { return DB.children.find(c => c.id === id); }
function selectedChild() {
  const c = ensureChild(DB.settings.selectedChildId);
  if (c) return c;
  if (DB.children[0]) { DB.settings.selectedChildId = DB.children[0].id; return DB.children[0]; }
  return null;
}
function dayOf(childId, dateISO) {
  DB.log[childId] ||= {};
  DB.log[childId][dateISO] ||= { entries: [], finalized: false };
  return DB.log[childId][dateISO];
}
function taskById(id) { return DB.tasks.find(t => t.id === id); }

// видимые задачи ребёнка (общие не-скрытые + свои персональные), кроме чекпоинта
function visibleTasks(childId) {
  const child = ensureChild(childId);
  const hidden = new Set(child?.hiddenTaskIds || []);
  return DB.tasks.filter(t => {
    if (t.childId && t.childId !== childId) return false;
    if (!t.childId && hidden.has(t.id)) return false;
    return true;
  });
}
function checkpointTask(childId) {
  return visibleTasks(childId).find(t => t.kind === KIND.CHECKPOINT)
      || DB.tasks.find(t => t.kind === KIND.CHECKPOINT);
}
function mandatoryTasks(childId) {
  return visibleTasks(childId).filter(t => t.isMandatory && t.isDaily && t.kind === KIND.TASK);
}
function doneTaskIds(day) {
  const set = new Set();
  for (const e of day.entries) if (e.taskId && !e.auto) set.add(e.taskId);
  return set;
}

/* ============================================================
 * 4. РАСЧЁТЫ
 * ============================================================ */
// заполнен ли день (есть ручная запись или закрыт)
function isDayFilled(childId, dateISO) {
  const day = (DB.log[childId] || {})[dateISO];
  if (!day) return false;
  if (day.finalized) return true;
  return day.entries.some(e => !e.auto);
}
function lastFilledDate(childId) {
  const dates = Object.keys(DB.log[childId] || {}).filter(d => isDayFilled(childId, d));
  if (!dates.length) return null;
  return dates.sort().reverse()[0];
}

// ИТОГ с учётом сгорания ежедневных (кап 100)
function totalScore(childId) {
  const last = lastFilledDate(childId);
  let sum = 0;
  const childLog = DB.log[childId] || {};
  for (const dateISO of Object.keys(childLog)) {
    const isLast = dateISO === last;
    for (const e of childLog[dateISO].entries) {
      if (e.kind === KIND.PENALTY) { sum += e.points; continue; }      // штрафы — навсегда
      if (e.isDaily) { if (isLast) sum += e.points; continue; }        // ежедневные — только последний день
      sum += e.points;                                                 // прочие — всегда
    }
  }
  return Math.min(sum, 100);
}

// разбивка дня для календаря (все записи, факт дня)
function dayBreakdown(childId, dateISO) {
  const day = (DB.log[childId] || {})[dateISO];
  let pos = 0, neg = 0;
  if (day) for (const e of day.entries) {
    if (e.points >= 0) pos += e.points; else neg += e.points;
  }
  return { pos, neg, total: pos + neg };
}
function dayScore(childId, dateISO) { return dayBreakdown(childId, dateISO).total; }

function trustLevel(score) {
  const arr = [...DB.scales.trust].sort((a, b) => b.min - a.min);
  for (const r of arr) if (score >= r.min) return r.label;
  return arr[arr.length - 1]?.label ?? "—";
}
function gadgetHours(score) {
  const arr = [...DB.scales.gadgetHours].sort((a, b) => b.min - a.min);
  for (const r of arr) if (score >= r.min) return r.hours;
  return arr[arr.length - 1]?.hours ?? 0;
}

/* ============================================================
 * 5. АВТО-ЧЕКПОИНТ + АВТО-ШТРАФЫ
 * ============================================================ */
function recalcCheckpoint(childId, dateISO) {
  const day = dayOf(childId, dateISO);
  const cp = checkpointTask(childId);
  // удалить прежние записи чекпоинта (любые)
  day.entries = day.entries.filter(e => e.kind !== KIND.CHECKPOINT);
  if (!cp) return;
  const done = doneTaskIds(day);
  const allDone = mandatoryTasks(childId).every(t => done.has(t.id));
  if (allDone) {
    day.entries.push({
      id: uid("e"), taskId: cp.id, name: cp.name, points: cp.points,
      kind: KIND.CHECKPOINT, isDaily: true, ts: Date.now(), auto: true,
    });
  }
}
// перегенерация авто-штрафов за невыполненные обязательные (не меняет finalized)
function regenAutoPenalties(childId, dateISO) {
  const day = dayOf(childId, dateISO);
  day.entries = day.entries.filter(e => !(e.auto && e.kind === KIND.PENALTY));
  const done = doneTaskIds(day);
  for (const t of mandatoryTasks(childId)) {
    if (!done.has(t.id)) {
      day.entries.push({
        id: uid("e"), taskId: t.id,
        name: `НЕ СДЕЛАНО: ${t.name} (−2×)`,
        points: -2 * t.points, kind: KIND.PENALTY, isDaily: false,
        ts: Date.now(), auto: true,
      });
    }
  }
}
// полный пересчёт дня (вызывать после любого изменения записей)
function recalcDay(childId, dateISO) {
  recalcCheckpoint(childId, dateISO);
  if (dayOf(childId, dateISO).finalized) regenAutoPenalties(childId, dateISO);
}

function finalizeDay(childId, dateISO) {
  const day = dayOf(childId, dateISO);
  day.finalized = true;
  regenAutoPenalties(childId, dateISO);
  recalcCheckpoint(childId, dateISO);
  save(); render();
}
function reopenDay(childId, dateISO) {
  const day = dayOf(childId, dateISO);
  day.finalized = false;
  day.entries = day.entries.filter(e => !e.auto); // убрать авто-штрафы и авто-чекпоинт
  recalcCheckpoint(childId, dateISO);
  save(); render();
}

// при старте: закрываем незакрытые прошлые заполненные дни
function autoFinalizePastDays() {
  const today = todayISO();
  for (const child of DB.children) {
    for (const dateISO of Object.keys(DB.log[child.id] || {})) {
      if (dateISO < today) {
        const day = DB.log[child.id][dateISO];
        if (!day.finalized && day.entries.some(e => !e.auto)) {
          day.finalized = true;
          regenAutoPenalties(child.id, dateISO);
          recalcCheckpoint(child.id, dateISO);
        }
      }
    }
  }
  save();
}

/* ============================================================
 * 6. ДЕЙСТВИЯ С ЗАПИСЯМИ
 * ============================================================ */
function toggleTask(childId, dateISO, taskId) {
  const day = dayOf(childId, dateISO);
  const task = taskById(taskId);
  if (!task) return;
  // снять, если уже отмечено (только ручные)
  const existing = day.entries.find(e => e.taskId === taskId && !e.auto);
  if (existing) {
    day.entries = day.entries.filter(e => e.id !== existing.id);
  } else {
    day.entries.push({
      id: uid("e"), taskId: task.id, name: task.name, points: task.points,
      kind: task.kind, isDaily: !!task.isDaily, ts: Date.now(),
    });
  }
  recalcDay(childId, dateISO);
  save(); render();
}
function addTaskOnce(childId, dateISO, taskId) {
  const day = dayOf(childId, dateISO);
  const task = taskById(taskId);
  if (!task) return;
  day.entries.push({
    id: uid("e"), taskId: task.id, name: task.name, points: task.points,
    kind: task.kind, isDaily: !!task.isDaily, ts: Date.now(),
  });
  recalcDay(childId, dateISO);
  save(); render();
}
function addCustom(childId, dateISO, name, points, saveToCatalog) {
  const day = dayOf(childId, dateISO);
  let taskId = null, isDaily = false;
  if (saveToCatalog) {
    const t = { id: uid("t"), name, points: Number(points), isDaily: false, isMandatory: false, kind: KIND.TASK, childId: null };
    DB.tasks.push(t);
    taskId = t.id; isDaily = false;
  }
  day.entries.push({
    id: uid("e"), taskId, name, points: Number(points),
    kind: saveToCatalog ? KIND.TASK : KIND.CUSTOM, isDaily, ts: Date.now(),
  });
  recalcDay(childId, dateISO);
  save(); render();
}
function removeEntry(childId, dateISO, entryId) {
  const day = dayOf(childId, dateISO);
  day.entries = day.entries.filter(e => e.id !== entryId);
  recalcDay(childId, dateISO);
  save(); render();
}
function editEntry(childId, dateISO, entryId, name, points) {
  const day = dayOf(childId, dateISO);
  const e = day.entries.find(x => x.id === entryId);
  if (!e) return;
  e.name = name;
  e.points = Number(points);
  // ручная правка авто-записи → делаем её «ручной», чтобы пересчёт не затёр
  if (e.auto) e.auto = false;
  save(); render();
}

/* ============================================================
 * 7. DOM-УТИЛИТЫ
 * ============================================================ */
const screen = document.getElementById("screen");
// Булевы атрибуты: присутствие = истина. Поэтому ставим их только когда значение truthy.
const BOOL_ATTRS = new Set(["disabled", "readonly", "hidden", "multiple", "autofocus", "required"]);
function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value") e.value = (v === null || v === undefined) ? "" : v;       // через свойство — корректно для input/option
    else if (k === "checked") e.checked = !!v;                                          // чекбокс — через свойство
    else if (k === "selected") e.selected = !!v;                                        // option — через свойство
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (BOOL_ATTRS.has(k)) { if (v) e.setAttribute(k, k); }                        // только когда truthy
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}

let CURRENT_ROUTE = "day";
function go(route) {
  CURRENT_ROUTE = route;
  syncNav();
  render();
  window.scrollTo({ top: 0 });
}
function syncNav() {
  document.querySelectorAll(".nav-btn, .bottom-nav button").forEach(b => {
    b.classList.toggle("is-active", b.dataset.route === CURRENT_ROUTE);
  });
}
function render() {
  screen.innerHTML = "";
  switch (CURRENT_ROUTE) {
    case "day":      renderDay(); break;
    case "calendar": renderCalendar(); break;
    case "tasks":    renderTasks(); break;
    case "children": renderChildren(); break;
    case "scales":   renderScales(); break;
  }
}
function emptyState(t) { return el("div", { class: "card center" }, [ el("p", { class: "muted" }, t) ]); }

function childTabsNode() {
  const wrap = el("div", { class: "child-tabs" });
  const cur = selectedChild();
  for (const c of DB.children) {
    wrap.appendChild(el("button", {
      class: "child-tab" + (cur && cur.id === c.id ? " is-active" : ""),
      onclick: () => { DB.settings.selectedChildId = c.id; save(); render(); },
    }, [ el("span", { class: "dot", style: { background: c.color } }), c.name ]));
  }
  return wrap;
}

/* ============================================================
 * 8. ЭКРАН «ДЕНЬ» (с переключателем даты)
 * ============================================================ */
function renderDay() {
  if (DB.children.length === 0) {
    screen.appendChild(emptyState("Нет детей. Добавьте на вкладке «Дети»."));
    return;
  }
  const child = selectedChild();
  const dateISO = DB.settings.dayDate || todayISO();

  screen.appendChild(childTabsNode());

  // --- переключатель даты
  const nav = el("div", { class: "date-nav" }, [
    el("button", { class: "btn btn-icon", onclick: () => { DB.settings.dayDate = shiftDateISO(dateISO, -1); save(); render(); } }, "‹"),
    el("div", { class: "date-label" }, [
      el("div", { class: "date-human" }, fmtHuman(dateISO)),
      el("div", { class: "date-flags" }, [
        dateISO === todayISO() ? el("span", { class: "tag tag-blue" }, "сегодня") : null,
        isDayFilled(child.id, dateISO) ? el("span", { class: "tag tag-green" }, "заполнен") : el("span", { class: "tag" }, "пусто"),
      ]),
    ]),
    el("button", { class: "btn btn-icon", onclick: () => { DB.settings.dayDate = shiftDateISO(dateISO, +1); save(); render(); } }, "›"),
  ]);
  nav.appendChild(el("button", { class: "btn btn-small", onclick: () => { DB.settings.dayDate = todayISO(); save(); render(); } }, "Сегодня"));
  screen.appendChild(nav);

  // --- dashboard
  const score = totalScore(child.id);
  const hoursLabel = (() => { const h = gadgetHours(score); return h === null ? "Безлимит" : h + " ч"; })();
  screen.appendChild(el("div", { class: "card dash" }, [
    el("div", { class: "score-box" }, [
      el("div", {}, [
        el("div", { class: "score-num" }, String(score)),
        el("div", { class: "score-cap" }, "из 100 (итог)"),
      ]),
      el("div", { class: "badges" }, [
        el("span", { class: "badge trust" }, "🛡 " + trustLevel(score)),
        el("span", { class: "badge hours" }, "📱 " + hoursLabel),
      ]),
    ]),
    el("div", { class: "progress" }, [ el("span", { style: { width: Math.min(100, Math.max(0, score)) + "%" } }) ]),
  ]));

  const day = dayOf(child.id, dateISO);

  // --- ежедневные дела (чек-лист)
  const daily = visibleTasks(child.id).filter(t => t.isDaily && t.kind === KIND.TASK)
    .sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory) || a.name.localeCompare(b.name));
  const done = doneTaskIds(day);
  const listCard = el("div", { class: "card" }, [ el("h3", {}, "Ежедневные дела") ]);
  const list = el("div", { class: "task-list" });
  for (const t of daily) {
    const checked = done.has(t.id);
    list.appendChild(el("div", {
      class: "task-row" + (checked ? " checked" : ""),
      onclick: () => toggleTask(child.id, dateISO, t.id),
    }, [
      el("div", { class: "check" }, "✓"),
      el("div", { class: "name" }, t.name),
      t.isMandatory ? el("span", { class: "tag mand" }, "обяз.") : null,
      el("div", { class: "pts" }, (t.points > 0 ? "+" : "") + t.points),
    ]));
  }
  if (daily.length === 0) list.appendChild(el("div", { class: "empty" }, "Нет видимых ежедневных дел"));
  listCard.appendChild(list);

  // предупреждение о грядущем штрафе
  if (!day.finalized) {
    const undone = mandatoryTasks(child.id).filter(t => !done.has(t.id));
    if (undone.length) {
      const fine = undone.reduce((s, t) => s + 2 * t.points, 0);
      listCard.appendChild(el("div", { class: "notice" },
        `Если закрыть день: за ${undone.length} обязательн. будет −${fine}.`));
    }
  } else {
    listCard.appendChild(el("div", { class: "notice locked" }, "🔒 День закрыт. Штрафы начислены."));
  }
  screen.appendChild(listCard);

  // --- дополнительно (не-ежедневные + штрафы)
  const others = visibleTasks(child.id).filter(t => !t.isDaily && t.kind === KIND.TASK);
  const penalties = visibleTasks(child.id).filter(t => t.kind === KIND.PENALTY);
  const qc = el("div", { class: "card" }, [ el("h3", {}, "Дополнительно и штрафы") ]);
  const quick = el("div", { class: "quick" });
  for (const t of others) quick.appendChild(taskChip(t, () => addTaskOnce(child.id, dateISO, t.id)));
  for (const t of penalties) quick.appendChild(taskChip(t, () => addTaskOnce(child.id, dateISO, t.id)));
  if (others.length + penalties.length === 0) quick.appendChild(el("span", { class: "muted" }, "пусто"));
  qc.appendChild(quick);
  qc.appendChild(el("div", { style: { marginTop: "10px" } }, [
    el("button", { class: "btn btn-primary", onclick: () => openCustom(child.id, dateISO) }, "+ своё дело"),
  ]));
  screen.appendChild(qc);

  // --- записи дня
  const sumPos = day.entries.filter(e => e.points >= 0).reduce((s, e) => s + e.points, 0);
  const sumNeg = day.entries.filter(e => e.points < 0).reduce((s, e) => s + e.points, 0);
  const ec = el("div", { class: "card" }, [
    el("h3", {}, `Записи за день: +${sumPos} / ${sumNeg} = ${sumPos + sumNeg}`),
  ]);
  if (day.entries.length === 0) {
    ec.appendChild(el("div", { class: "empty" }, "Пока ничего не отмечено"));
  } else {
    const wrap = el("div", { class: "entries" });
    for (const e of [...day.entries].sort((a, b) => a.ts - b.ts)) {
      wrap.appendChild(entryRow(e,
        () => removeEntry(child.id, dateISO, e.id),
        () => openEdit(child.id, dateISO, e.id)
      ));
    }
    ec.appendChild(wrap);
    ec.appendChild(el("div", { class: "notice help" },
      "Авто-штрафы (−2×) помечены «авто» и пересчитываются при изменении дел. " +
      "Чтобы убрать такой штраф — отметьте дело или сделайте его необязательным в «Дела». " +
      "Ручную корректировку можно добавить кнопкой «+ своё дело»."));
  }
  ec.appendChild(el("div", { class: "btn-row", style: { marginTop: "10px" } }, day.finalized
    ? [ el("button", { class: "btn", onclick: () => reopenDay(child.id, dateISO) }, "↺ Открыть день заново") ]
    : [ el("button", { class: "btn btn-primary", onclick: () => finalizeDay(child.id, dateISO) }, "🔒 Закрыть день (штрафы −2×)") ]
  ));
  screen.appendChild(ec);
}

function taskChip(t, onclick) {
  return el("button", { class: "chip" + (t.points < 0 ? " neg" : ""), onclick }, [
    el("span", {}, t.name),
    el("span", { class: "p" }, (t.points > 0 ? "+" : "") + t.points),
  ]);
}
function entryRow(e, onDel, onEdit) {
  return el("div", { class: "entry" + (e.points < 0 ? " penalty" : "") }, [
    el("button", { class: "e-edit", title: "Редактировать", onclick: onEdit }, "✎"),
    el("div", { class: "e-name" }, e.name + (e.auto ? "  (авто)" : "")),
    el("div", { class: "e-pts " + (e.points >= 0 ? "pos" : "neg") }, (e.points > 0 ? "+" : "") + e.points),
    el("button", { class: "e-del", title: "Удалить", onclick: onDel }, "×"),
  ]);
}

/* ============================================================
 * 9. ЭКРАН «КАЛЕНДАРЬ»
 * ============================================================ */
function renderCalendar() {
  if (DB.children.length === 0) { screen.appendChild(emptyState("Нет детей.")); return; }
  const child = selectedChild();
  screen.appendChild(childTabsNode());

  // сводка
  const score = totalScore(child.id);
  const h = gadgetHours(score);
  screen.appendChild(el("div", { class: "card" }, [ el("div", { class: "badges" }, [
    el("span", { class: "badge" }, "Итог: " + score + " / 100"),
    el("span", { class: "badge trust" }, "🛡 " + trustLevel(score)),
    el("span", { class: "badge hours" }, "📱 " + (h === null ? "Безлимит" : h + " ч")),
  ]) ]));

  const year = DB.settings.calYear, month = DB.settings.calMonth;
  const monthNames = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

  // заголовок месяца с навигацией + переключатель представлений
  const cal = el("div", { class: "card" });
  cal.appendChild(el("div", { class: "cal-head" }, [
    el("button", { class: "btn btn-icon", title: "Предыдущий месяц", onclick: () => { const d=new Date(year,month-1,1); DB.settings.calYear=d.getFullYear(); DB.settings.calMonth=d.getMonth(); save(); render(); } }, "‹"),
    el("div", { class: "cal-title" }, `${monthNames[month]} ${year}`),
    el("button", { class: "btn btn-icon", title: "Следующий месяц", onclick: () => { const d=new Date(year,month+1,1); DB.settings.calYear=d.getFullYear(); DB.settings.calMonth=d.getMonth(); save(); render(); } }, "›"),
    el("button", { class: "btn btn-small", title: "К текущему месяцу", onclick: () => { const n=new Date(); DB.settings.calYear=n.getFullYear(); DB.settings.calMonth=n.getMonth(); save(); render(); } }, "Сегодня"),
  ]));

  // переключатель «Месяц / Список»
  const view = DB.settings.calView || "month";
  const seg = el("div", { class: "seg" }, [
    el("button", { class: "seg-btn" + (view === "month" ? " is-active" : ""), onclick: () => { DB.settings.calView = "month"; save(); render(); } }, "📅 Месяц"),
    el("button", { class: "seg-btn" + (view === "list" ? " is-active" : ""), onclick: () => { DB.settings.calView = "list"; save(); render(); } }, "📃 Список"),
  ]);
  cal.appendChild(seg);

  const firstDay = new Date(year, month, 1);
  const lead = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();

  if (view === "month") {
    // ---- ПРЕДСТАВЛЕНИЕ: МЕСЯЦ (классическая сетка) ----
    const grid = el("div", { class: "cal-grid" });
    ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(wd => grid.appendChild(el("div", { class: "cal-dow" }, wd)));
    for (let i = 0; i < lead; i++) grid.appendChild(el("div", { class: "cal-cell empty" }));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      const br = dayBreakdown(child.id, iso);
      const filled = isDayFilled(child.id, iso);
      const classes = "cal-cell" + (filled ? " filled" : "") + (iso === today ? " today" : "");
      grid.appendChild(el("button", { class: classes, onclick: () => { DB.settings.dayDate = iso; save(); go("day"); } }, [
        el("div", { class: "cal-day-num" }, String(d)),
        filled ? el("div", { class: "cal-day-sum" }, [
          el("span", { class: "cal-pos" }, "+" + br.pos),
          br.neg < 0 ? el("span", { class: "cal-neg" }, String(br.neg)) : null,
        ]) : null,
        filled ? el("div", { class: "cal-day-total" + (br.total < 0 ? " neg" : "") }, String(br.total)) : null,
      ]));
    }
    // дозаполним строку до конца недели (визуальная завершённость)
    const totalCells = lead + daysInMonth;
    const tail = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < tail; i++) grid.appendChild(el("div", { class: "cal-cell empty" }));
    cal.appendChild(grid);

    // подсказка + мини-сводка месяца
    let mPos = 0, mNeg = 0, mDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      if (isDayFilled(child.id, iso)) { const br = dayBreakdown(child.id, iso); mPos += br.pos; mNeg += br.neg; mDays++; }
    }
    cal.appendChild(el("div", { class: "cal-legend" }, [
      el("span", { class: "muted" }, "Заполненные дни подсвечены. Нажмите на день — заполнить или посмотреть."),
      el("span", { class: "cal-month-summary" },
        `За месяц: ${mDays} дн. · +${mPos} / ${mNeg} = ${mPos + mNeg}`),
    ]));
  } else {
    // ---- ПРЕДСТАВЛЕНИЕ: СПИСОК (подробный список по дням) ----
    const daysList = el("div", { class: "entries" });
    let any = false;
    for (let d = daysInMonth; d >= 1; d--) {
      const iso = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      const day = (DB.log[child.id] || {})[iso];
      if (!day || day.entries.length === 0) continue;
      any = true;
      const br = dayBreakdown(child.id, iso);
      const block = el("div", { class: "cal-list-item" }, [
        el("div", { class: "cal-list-head", onclick: () => { DB.settings.dayDate = iso; save(); go("day"); } }, [
          el("strong", {}, iso + (iso === today ? " (сегодня)" : "")),
          el("span", { class: "cal-day-total" + (br.total < 0 ? " neg" : "") },
            `+${br.pos} / ${br.neg} = ${br.total}` + (day.finalized ? " 🔒" : "")),
        ]),
      ]);
      const sub = el("div", { class: "entries", style: { marginTop: "6px" } });
      for (const e of [...day.entries].sort((a, b) => a.ts - b.ts)) {
        sub.appendChild(el("div", { class: "entry" + (e.points < 0 ? " penalty" : "") }, [
          el("div", { class: "e-name" }, e.name + (e.auto ? "  (авто)" : "")),
          el("div", { class: "e-pts " + (e.points >= 0 ? "pos" : "neg") }, (e.points > 0 ? "+" : "") + e.points),
          el("button", { class: "e-del", onclick: () => removeEntry(child.id, iso, e.id) }, "×"),
        ]));
      }
      block.appendChild(sub);
      daysList.appendChild(block);
    }
    if (!any) cal.appendChild(el("div", { class: "empty" }, "В этом месяце записей нет."));
    else cal.appendChild(daysList);
  }
  screen.appendChild(cal);
}

/* ============================================================
 * 10. ЭКРАН «ДЕЛА» (СПРАВОЧНИК) — с ежедневностью, обязательностью, «для кого»
 * ============================================================ */
function renderTasks() {
  const card = el("div", { class: "card" });
  card.appendChild(el("h2", {}, "Справочник дел"));
  card.appendChild(el("p", { class: "muted" },
    "Редактируйте баллы, флаги «ежедневное» и «обязательное» (−2× при невыполнении), тип и кому дело назначено. " +
    "Чекпоинт начисляется автоматически, штрафы учитываются в итоге навсегда."));

  const table = el("table", { class: "list" });
  table.appendChild(el("tr", {}, [
    el("th", {}, "Название"), el("th", {}, "Баллы"),
    el("th", {}, "Ежедн."), el("th", {}, "Обяз."), el("th", {}, "Тип"),
    el("th", {}, "Для кого"), el("th", { class: "t-actions" }, ""),
  ]));

  const order = { [KIND.TASK]: 0, [KIND.CHECKPOINT]: 1, [KIND.PENALTY]: 2, [KIND.CUSTOM]: 3 };
  const tasks = [...DB.tasks].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name));

  for (const t of tasks) {
    const isCheckpoint = t.kind === KIND.CHECKPOINT;
    const tr = el("tr", {});
    tr.appendChild(el("td", {}, [ el("input", { value: t.name, onchange: (e) => { t.name = e.target.value; save(); } }) ]));
    tr.appendChild(el("td", {}, [ el("input", { type: "number", class: "t-input-num", value: t.points, onchange: (e) => { t.points = Number(e.target.value) || 0; save(); } }) ]));
    tr.appendChild(el("td", {}, [ el("input", { type: "checkbox", checked: !!t.isDaily, disabled: isCheckpoint, title: "Ежедневное (баллы сгорают при заполнении след. дня)", onchange: (e) => { t.isDaily = e.target.checked; save(); } }) ]));
    tr.appendChild(el("td", {}, [ el("input", { type: "checkbox", checked: !!t.isMandatory, disabled: isCheckpoint, title: "Обязательное (штраф −2× за невыполнение)", onchange: (e) => { t.isMandatory = e.target.checked; save(); } }) ]));
    tr.appendChild(el("td", {}, [ el("select", { onchange: (e) => { t.kind = e.target.value; save(); render(); } },
      [KIND.TASK, KIND.CHECKPOINT, KIND.PENALTY].map(k => el("option", { value: k, selected: t.kind === k },
        k === KIND.TASK ? "Дело" : k === KIND.CHECKPOINT ? "Чекпоинт" : "Штраф"))) ]));
    // для кого
    const sel = el("select", { onchange: (e) => { t.childId = e.target.value === "all" ? null : e.target.value; save(); render(); } });
    sel.appendChild(el("option", { value: "all", selected: t.childId == null }, "Все дети"));
    for (const c of DB.children) sel.appendChild(el("option", { value: c.id, selected: t.childId === c.id }, c.name));
    tr.appendChild(el("td", {}, [ sel ]));
    tr.appendChild(el("td", { class: "t-actions" }, [ el("button", { class: "icon-x", title: "Удалить", onclick: () => confirmDlg(`Удалить дело «${t.name}»?`, () => { DB.tasks = DB.tasks.filter(x => x.id !== t.id); save(); render(); }) }, "×") ]));
    table.appendChild(tr);
  }
  card.appendChild(table);

  // добавить (общее или персональное)
  const addRow = el("div", { class: "row", style: { marginTop: "12px" } }, [
    el("div", { class: "field" }, [
      el("span", {}, "Новое дело"),
      el("input", { id: "new-task-name", placeholder: "Название" }),
    ]),
    el("div", { class: "field" }, [
      el("span", {}, "Баллы"),
      el("input", { id: "new-task-points", type: "number", value: "1" }),
    ]),
    el("div", { class: "field" }, [
      el("span", {}, "Для кого"),
      (() => { const s = el("select", { id: "new-task-child" });
        s.appendChild(el("option", { value: "all" }, "Все дети"));
        for (const c of DB.children) s.appendChild(el("option", { value: c.id }, c.name));
        return s; })(),
    ]),
  ]);
  card.appendChild(addRow);
  card.appendChild(el("div", { class: "btn-row", style: { marginTop: "10px" } }, [
    el("button", { class: "btn btn-primary", onclick: () => {
      const name = document.getElementById("new-task-name").value.trim();
      const pts = Number(document.getElementById("new-task-points").value);
      const childVal = document.getElementById("new-task-child").value;
      if (!name) { alert("Введите название"); return; }
      if (Number.isNaN(pts)) { alert("Баллы — число"); return; }
      DB.tasks.push({ id: uid("t"), name, points: pts, isDaily: false, isMandatory: false, kind: KIND.TASK, childId: childVal === "all" ? null : childVal });
      save(); render();
    }}, "+ Добавить дело"),
  ]));
  screen.appendChild(card);
}

/* ============================================================
 * 11. ЭКРАН «ДЕТИ» — с настройкой видимости общих дел
 * ============================================================ */
function renderChildren() {
  const card = el("div", { class: "card" }, [ el("h2", {}, "Дети") ]);
  if (DB.children.length === 0) card.appendChild(el("div", { class: "empty" }, "Список пуст"));
  for (const c of DB.children) {
    const score = totalScore(c.id);
    card.appendChild(el("div", { class: "task-row", style: { cursor: "default", flexWrap: "wrap" } }, [
      el("span", { class: "dot", style: { background: c.color } }),
      el("input", { value: c.name, style: { flex: "1", minWidth: "120px", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", fontSize: "15px" }, onchange: (e) => { c.name = e.target.value; save(); render(); } }),
      el("span", { class: "muted" }, score + "/100"),
      el("input", { type: "color", value: c.color, style: { width: "36px", height: "32px", border: "0", background: "transparent" }, onchange: (e) => { c.color = e.target.value; save(); render(); } }),
      el("button", { class: "icon-x", onclick: () => confirmDlg(`Удалить ребёнка «${c.name}» со всей историей и его персональными делами?`, () => {
        delete DB.log[c.id];
        DB.tasks = DB.tasks.filter(t => t.childId !== c.id);
        DB.children = DB.children.filter(x => x.id !== c.id);
        if (DB.settings.selectedChildId === c.id) DB.settings.selectedChildId = DB.children[0]?.id || null;
        save(); render();
      }) }, "×"),
    ]));

    // управление видимостью общих дел
    const shared = DB.tasks.filter(t => !t.childId && t.kind !== KIND.CHECKPOINT);
    if (shared.length) {
      const vis = el("details", { class: "vis-details" }, [
        el("summary", {}, `Видимость общих дел для «${c.name}» (${shared.length - (c.hiddenTaskIds||[]).length} из ${shared.length})`),
      ]);
      const grid = el("div", { class: "vis-grid" });
      const hidden = new Set(c.hiddenTaskIds || []);
      for (const t of shared) {
        grid.appendChild(el("label", { class: "vis-item" + (hidden.has(t.id) ? " off" : "") }, [
          el("input", { type: "checkbox", checked: !hidden.has(t.id), onchange: (e) => {
            const set = new Set(c.hiddenTaskIds || []);
            if (e.target.checked) set.delete(t.id); else set.add(t.id);
            c.hiddenTaskIds = [...set];
            save(); render();
          } }),
          el("span", {}, `${t.name} (${t.points > 0 ? "+" : ""}${t.points})`),
        ]));
      }
      vis.appendChild(grid);
      card.appendChild(vis);
    }
  }
  card.appendChild(el("div", { class: "btn-row", style: { marginTop: "12px" } }, [
    el("button", { class: "btn btn-primary", onclick: () => promptDlg("Имя нового ребёнка", "", (name) => {
      if (!name) return;
      const c = { id: uid("c"), name, color: DEFAULT_COLORS[DB.children.length % DEFAULT_COLORS.length], hiddenTaskIds: [] };
      DB.children.push(c); DB.settings.selectedChildId = c.id; save(); render();
    }) }, "+ Добавить ребёнка"),
  ]));
  screen.appendChild(card);
}

/* ============================================================
 * 12. ЭКРАН «ШКАЛЫ»
 * ============================================================ */
function renderScales() {
  const tCard = el("div", { class: "card" }, [ el("h2", {}, "Шкала доверия (кто ставит таймер)") ]);
  const tTable = el("table", { class: "list" });
  tTable.appendChild(el("tr", {}, [ el("th", {}, "Порог"), el("th", {}, "Метка"), el("th", { class: "t-actions" }, "") ]));
  DB.scales.trust.forEach((r, i) => tTable.appendChild(el("tr", {}, [
    el("td", {}, [ el("input", { type: "number", class: "t-input-num", value: r.min, onchange: (e) => { DB.scales.trust[i].min = Number(e.target.value) || 0; DB.scales.trust.sort((a,b)=>a.min-b.min); save(); } }) ]),
    el("td", {}, [ el("input", { value: r.label, onchange: (e) => { DB.scales.trust[i].label = e.target.value; save(); } }) ]),
    el("td", { class: "t-actions" }, [ el("button", { class: "icon-x", onclick: () => { DB.scales.trust.splice(i,1); save(); render(); } }, "×") ]),
  ])));
  tCard.appendChild(tTable);
  tCard.appendChild(el("div", { class: "btn-row", style: { marginTop: "10px" } }, [ el("button", { class: "btn", onclick: () => { DB.scales.trust.push({ min: 0, label: "Метка" }); DB.scales.trust.sort((a,b)=>a.min-b.min); save(); render(); } }, "+ порог") ]));
  screen.appendChild(tCard);

  const gCard = el("div", { class: "card" }, [ el("h2", {}, "Время за гаджетами" ), el("p", {class:"muted"}, "Пустое поле «часов» = безлимит.") ]);
  const gTable = el("table", { class: "list" });
  gTable.appendChild(el("tr", {}, [ el("th", {}, "Порог"), el("th", {}, "Часов"), el("th", { class: "t-actions" }, "") ]));
  DB.scales.gadgetHours.forEach((r, i) => gTable.appendChild(el("tr", {}, [
    el("td", {}, [ el("input", { type: "number", class: "t-input-num", value: r.min, onchange: (e) => { DB.scales.gadgetHours[i].min = Number(e.target.value) || 0; DB.scales.gadgetHours.sort((a,b)=>a.min-b.min); save(); } }) ]),
    el("td", {}, [ el("input", { type: "number", class: "t-input-num", value: r.hours === null ? "" : r.hours, placeholder: "безлимит", onchange: (e) => { DB.scales.gadgetHours[i].hours = e.target.value === "" ? null : (Number(e.target.value) || 0); save(); } }) ]),
    el("td", { class: "t-actions" }, [ el("button", { class: "icon-x", onclick: () => { DB.scales.gadgetHours.splice(i,1); save(); render(); } }, "×") ]),
  ])));
  gCard.appendChild(gTable);
  gCard.appendChild(el("div", { class: "btn-row", style: { marginTop: "10px" } }, [ el("button", { class: "btn", onclick: () => { DB.scales.gadgetHours.push({ min: 0, hours: 0 }); DB.scales.gadgetHours.sort((a,b)=>a.min-b.min); save(); render(); } }, "+ порог") ]));
  screen.appendChild(gCard);
}

/* ============================================================
 * 13. ДИАЛОГИ
 * ============================================================ */
function confirmDlg(text, onOk) {
  const m = document.getElementById("confirm");
  document.getElementById("confirm-text").textContent = text;
  m.classList.remove("hidden");
  const ok = document.getElementById("confirm-ok"), cancel = document.getElementById("confirm-cancel");
  const close = () => { m.classList.add("hidden"); ok.onclick = null; cancel.onclick = null; };
  ok.onclick = () => { close(); onOk(); }; cancel.onclick = close;
}
function promptDlg(label, initial, onOk) {
  const m = document.getElementById("prompt");
  document.getElementById("prompt-label").textContent = label;
  const input = document.getElementById("prompt-input"); input.value = initial;
  m.classList.remove("hidden"); setTimeout(() => input.focus(), 10);
  const ok = document.getElementById("prompt-ok"), cancel = document.getElementById("prompt-cancel");
  const submit = () => { const v = input.value.trim(); close(); onOk(v); };
  const close = () => { m.classList.add("hidden"); ok.onclick = null; cancel.onclick = null; input.onkeydown = null; };
  ok.onclick = submit; cancel.onclick = close;
  input.onkeydown = (e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") close(); };
}

// «своё дело»
let _customCtx = null;
function openCustom(childId, dateISO) {
  _customCtx = { childId, dateISO };
  const m = document.getElementById("custom");
  document.getElementById("custom-name").value = "";
  document.getElementById("custom-points").value = "1";
  document.getElementById("custom-save").checked = false;
  m.classList.remove("hidden");
  setTimeout(() => document.getElementById("custom-name").focus(), 10);
}
function closeCustom() { document.getElementById("custom").classList.add("hidden"); _customCtx = null; }

// редактирование записи
let _editCtx = null;
function openEdit(childId, dateISO, entryId) {
  const day = dayOf(childId, dateISO);
  const e = day.entries.find(x => x.id === entryId);
  if (!e) return;
  _editCtx = { childId, dateISO, entryId };
  document.getElementById("edit-name").value = e.name;
  document.getElementById("edit-points").value = String(e.points);
  const m = document.getElementById("edit"); m.classList.remove("hidden");
  setTimeout(() => document.getElementById("edit-name").focus(), 10);
}
function closeEdit() { document.getElementById("edit").classList.add("hidden"); _editCtx = null; }

/* ============================================================
 * 14. ЭКСПОРТ / ИМПОРТ
 * ============================================================ */
function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `social-rating-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = migrate(JSON.parse(reader.result));
      confirmDlg("Импорт заменит текущие данные. Продолжить?", () => { DB = data; save(); render(); });
    } catch (e) { alert("Ошибка: " + e.message); }
  };
  reader.readAsText(file);
}

/* ============================================================
 * 15. СТАРТ
 * ============================================================ */
function bindNav() {
  const map = { "menu-day": "day", "menu-calendar": "calendar", "menu-tasks": "tasks", "menu-children": "children", "menu-scales": "scales" };
  for (const [id, route] of Object.entries(map)) {
    const btn = document.getElementById(id);
    if (btn) { btn.dataset.route = route; btn.addEventListener("click", () => go(route)); }
  }
  document.querySelectorAll(".bottom-nav button").forEach(b => b.addEventListener("click", () => go(b.dataset.route)));
}
function ensureBottomNav() {
  let nav = document.querySelector(".bottom-nav");
  if (nav) return;
  nav = el("nav", { class: "bottom-nav" });
  for (const [route, ic, label] of [["day","📅","День"],["calendar","🗓","Календарь"],["tasks","✅","Дела"],["children","🧒","Дети"],["scales","📊","Шкалы"]]) {
    nav.appendChild(el("button", { "data-route": route }, [ el("span", { class: "ic" }, ic), label ]));
  }
  document.body.appendChild(nav);
}

// привязки кнопок шапки
document.getElementById("btn-export").addEventListener("click", exportData);
document.getElementById("btn-import").addEventListener("click", () => document.getElementById("file-import").click());
document.getElementById("file-import").addEventListener("change", (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; });

// модалки
document.getElementById("confirm-cancel").addEventListener("click", () => document.getElementById("confirm").classList.add("hidden"));
document.getElementById("prompt-cancel").addEventListener("click", () => document.getElementById("prompt").classList.add("hidden"));
document.getElementById("custom-cancel").addEventListener("click", closeCustom);
document.getElementById("custom-ok").addEventListener("click", () => {
  const name = document.getElementById("custom-name").value.trim();
  const pts = Number(document.getElementById("custom-points").value);
  const saveIt = document.getElementById("custom-save").checked;
  if (!name) { alert("Укажите, что сделано"); return; }
  if (Number.isNaN(pts)) { alert("Баллы — число"); return; }
  const ctx = _customCtx; closeCustom(); addCustom(ctx.childId, ctx.dateISO, name, pts, saveIt);
});
document.getElementById("edit-cancel").addEventListener("click", closeEdit);
document.getElementById("edit-ok").addEventListener("click", () => {
  const name = document.getElementById("edit-name").value.trim();
  const pts = Number(document.getElementById("edit-points").value);
  if (!name) { alert("Укажите название"); return; }
  if (Number.isNaN(pts)) { alert("Баллы — число"); return; }
  const ctx = _editCtx; closeEdit(); editEntry(ctx.childId, ctx.dateISO, ctx.entryId, name, pts);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    ["confirm","prompt","custom","edit"].forEach(id => document.getElementById(id).classList.add("hidden"));
    _customCtx = null; _editCtx = null;
  }
});

/* ============================================================
 * 16. АВТОРИЗАЦИЯ И СТАРТ
 * ============================================================ */
function showLogin() { document.getElementById("login-screen").classList.remove("hidden"); }
function hideLogin() { document.getElementById("login-screen").classList.add("hidden"); }

async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  const { error } = await SB.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = "Неверный email или пароль"; errEl.classList.remove("hidden"); }
}

function startApp() {
  autoFinalizePastDays();
  syncNav();
  render();
}

async function onAuthed() {
  hideLogin();
  document.getElementById("btn-logout").classList.remove("hidden");
  startApp();
  await pullFromCloud();
  subscribeRealtime();
}

async function initAuth() {
  document.getElementById("login-ok").addEventListener("click", doLogin);
  document.getElementById("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  const { data: { session } } = await SB.auth.getSession();
  if (session) { onAuthed(); } else { showLogin(); }
  SB.auth.onAuthStateChange((_event, session) => {
    if (session) onAuthed();
    else { document.getElementById("btn-logout").classList.add("hidden"); showLogin(); }
  });
}

document.getElementById("btn-logout").addEventListener("click", async () => {
  if (SB) await SB.auth.signOut();
  else location.reload();
});

bindNav();
ensureBottomNav();
if (SB) initAuth(); else startApp();
