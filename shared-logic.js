"use strict";
/*
 * Общая бизнес-логика «Социального рейтинга» — БЕЗ обращений к DOM/localStorage.
 * Используется браузерным app.js (как обычный global-скрипт) И Telegram-ботом
 * (Supabase Edge Function, Deno) — там этот же файл лежит копией в
 * supabase/functions/telegram-bot/shared-logic.js с одной добавленной строкой
 * `export { ... }` в самом низу (Deno грузит его как ES-модуль).
 *
 * ВАЖНО: при изменении правил начисления баллов правьте именно этот файл,
 * затем скопируйте его (без изменений, кроме экспорта) в оба места.
 *
 * В отличие от app.js, здесь ничего не читает/не пишет глобальную переменную DB —
 * объект данных (`db`) передаётся первым параметром явно.
 *
 * Всё завёрнуто в IIFE: верхнеуровневые const/let разных <script> в браузере
 * делят один лексический скоуп страницы, и без обёртки KIND/STORAGE_KEY/
 * DEFAULT_COLORS здесь конфликтовали бы с одноимёнными const в app.js.
 */
(function () {
/* ============================================================
 * КОНСТАНТЫ И SEED
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
 * МИГРАЦИЯ v1 -> v2
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

/* ============================================================
 * ВСПОМОГАТЕЛЬНЫЕ (принимают db явным параметром)
 * ============================================================ */
function ensureChild(db, id) { return db.children.find(c => c.id === id); }
function dayOf(db, childId, dateISO) {
  db.log[childId] ||= {};
  db.log[childId][dateISO] ||= { entries: [], finalized: false };
  return db.log[childId][dateISO];
}
function taskById(db, id) { return db.tasks.find(t => t.id === id); }

// видимые задачи ребёнка (общие не-скрытые + свои персональные), кроме чекпоинта
function visibleTasks(db, childId) {
  const child = ensureChild(db, childId);
  const hidden = new Set(child?.hiddenTaskIds || []);
  return db.tasks.filter(t => {
    if (t.childId && t.childId !== childId) return false;
    if (!t.childId && hidden.has(t.id)) return false;
    return true;
  });
}
function checkpointTask(db, childId) {
  return visibleTasks(db, childId).find(t => t.kind === KIND.CHECKPOINT)
      || db.tasks.find(t => t.kind === KIND.CHECKPOINT);
}
function mandatoryTasks(db, childId) {
  return visibleTasks(db, childId).filter(t => t.isMandatory && t.isDaily && t.kind === KIND.TASK);
}
function doneTaskIds(day) {
  const set = new Set();
  for (const e of day.entries) if (e.taskId && !e.auto) set.add(e.taskId);
  return set;
}

/* ============================================================
 * РАСЧЁТЫ
 * ============================================================ */
// заполнен ли день (есть ручная запись или закрыт)
function isDayFilled(db, childId, dateISO) {
  const day = (db.log[childId] || {})[dateISO];
  if (!day) return false;
  if (day.finalized) return true;
  return day.entries.some(e => !e.auto);
}
function lastFilledDate(db, childId) {
  const dates = Object.keys(db.log[childId] || {}).filter(d => isDayFilled(db, childId, d));
  if (!dates.length) return null;
  return dates.sort().reverse()[0];
}

// ИТОГ с учётом сгорания ежедневных (кап 100)
function totalScore(db, childId) {
  const last = lastFilledDate(db, childId);
  let sum = 0;
  const childLog = db.log[childId] || {};
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

// разбивка дня (все записи, факт дня)
function dayBreakdown(db, childId, dateISO) {
  const day = (db.log[childId] || {})[dateISO];
  let pos = 0, neg = 0;
  if (day) for (const e of day.entries) {
    if (e.points >= 0) pos += e.points; else neg += e.points;
  }
  return { pos, neg, total: pos + neg };
}
function dayScore(db, childId, dateISO) { return dayBreakdown(db, childId, dateISO).total; }

function trustLevel(db, score) {
  const arr = [...db.scales.trust].sort((a, b) => b.min - a.min);
  for (const r of arr) if (score >= r.min) return r.label;
  return arr[arr.length - 1]?.label ?? "—";
}
function gadgetHours(db, score) {
  const arr = [...db.scales.gadgetHours].sort((a, b) => b.min - a.min);
  for (const r of arr) if (score >= r.min) return r.hours;
  return arr[arr.length - 1]?.hours ?? 0;
}

/* ============================================================
 * АВТО-ЧЕКПОИНТ + АВТО-ШТРАФЫ
 * ============================================================ */
function recalcCheckpoint(db, childId, dateISO) {
  const day = dayOf(db, childId, dateISO);
  const cp = checkpointTask(db, childId);
  day.entries = day.entries.filter(e => e.kind !== KIND.CHECKPOINT);
  if (!cp) return;
  const done = doneTaskIds(day);
  const allDone = mandatoryTasks(db, childId).every(t => done.has(t.id));
  if (allDone) {
    day.entries.push({
      id: uid("e"), taskId: cp.id, name: cp.name, points: cp.points,
      kind: KIND.CHECKPOINT, isDaily: true, ts: Date.now(), auto: true,
    });
  }
}
function regenAutoPenalties(db, childId, dateISO) {
  const day = dayOf(db, childId, dateISO);
  day.entries = day.entries.filter(e => !(e.auto && e.kind === KIND.PENALTY));
  const done = doneTaskIds(day);
  for (const t of mandatoryTasks(db, childId)) {
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
function recalcDay(db, childId, dateISO) {
  recalcCheckpoint(db, childId, dateISO);
  if (dayOf(db, childId, dateISO).finalized) regenAutoPenalties(db, childId, dateISO);
}

function finalizeDay(db, childId, dateISO) {
  const day = dayOf(db, childId, dateISO);
  day.finalized = true;
  regenAutoPenalties(db, childId, dateISO);
  recalcCheckpoint(db, childId, dateISO);
}
function reopenDay(db, childId, dateISO) {
  const day = dayOf(db, childId, dateISO);
  day.finalized = false;
  day.entries = day.entries.filter(e => !e.auto);
  recalcCheckpoint(db, childId, dateISO);
}

// при старте: закрываем незакрытые прошлые заполненные дни
function autoFinalizePastDays(db) {
  const today = todayISO();
  for (const child of db.children) {
    for (const dateISO of Object.keys(db.log[child.id] || {})) {
      if (dateISO < today) {
        const day = db.log[child.id][dateISO];
        if (!day.finalized && day.entries.some(e => !e.auto)) {
          day.finalized = true;
          regenAutoPenalties(db, child.id, dateISO);
          recalcCheckpoint(db, child.id, dateISO);
        }
      }
    }
  }
}

/* ============================================================
 * ДЕЙСТВИЯ С ЗАПИСЯМИ
 * ============================================================ */
function toggleTask(db, childId, dateISO, taskId) {
  const day = dayOf(db, childId, dateISO);
  const task = taskById(db, taskId);
  if (!task) return;
  const existing = day.entries.find(e => e.taskId === taskId && !e.auto);
  if (existing) {
    day.entries = day.entries.filter(e => e.id !== existing.id);
  } else {
    day.entries.push({
      id: uid("e"), taskId: task.id, name: task.name, points: task.points,
      kind: task.kind, isDaily: !!task.isDaily, ts: Date.now(),
    });
  }
  recalcDay(db, childId, dateISO);
}
function addTaskOnce(db, childId, dateISO, taskId) {
  const day = dayOf(db, childId, dateISO);
  const task = taskById(db, taskId);
  if (!task) return;
  day.entries.push({
    id: uid("e"), taskId: task.id, name: task.name, points: task.points,
    kind: task.kind, isDaily: !!task.isDaily, ts: Date.now(),
  });
  recalcDay(db, childId, dateISO);
}
function addCustom(db, childId, dateISO, name, points, saveToCatalog) {
  const day = dayOf(db, childId, dateISO);
  let taskId = null, isDaily = false;
  if (saveToCatalog) {
    const t = { id: uid("t"), name, points: Number(points), isDaily: false, isMandatory: false, kind: KIND.TASK, childId: null };
    db.tasks.push(t);
    taskId = t.id; isDaily = false;
  }
  day.entries.push({
    id: uid("e"), taskId, name, points: Number(points),
    kind: saveToCatalog ? KIND.TASK : KIND.CUSTOM, isDaily, ts: Date.now(),
  });
  recalcDay(db, childId, dateISO);
}
function removeEntry(db, childId, dateISO, entryId) {
  const day = dayOf(db, childId, dateISO);
  day.entries = day.entries.filter(e => e.id !== entryId);
  recalcDay(db, childId, dateISO);
}
function editEntry(db, childId, dateISO, entryId, name, points) {
  const day = dayOf(db, childId, dateISO);
  const e = day.entries.find(x => x.id === entryId);
  if (!e) return;
  e.name = name;
  e.points = Number(points);
  if (e.auto) e.auto = false;
}

/* ============================================================
 * ЭКСПОРТ В ОБЩЕЕ ПРОСТРАНСТВО ИМЁН
 * Через globalThis.SharedLogic, а не через голые глобальные имена —
 * чтобы app.js мог объявить свои собственные функции с теми же
 * именами (dayOf, toggleTask, ...), не столкнувшись с hoisting-
 * коллизией между двумя <script>. Работает одинаково в браузере
 * и в Deno (Edge Function), globalThis есть в обоих рантаймах.
 * ============================================================ */
globalThis.SharedLogic = {
  STORAGE_KEY, KIND, DEFAULT_COLORS,
  uid, pad2, todayISO, isoFromDate, parseISO, shiftDateISO, fmtHuman,
  seedTasks, seedScales, seedData, migrate,
  ensureChild, dayOf, taskById, visibleTasks, checkpointTask, mandatoryTasks, doneTaskIds,
  isDayFilled, lastFilledDate, totalScore, dayBreakdown, dayScore, trustLevel, gadgetHours,
  recalcCheckpoint, regenAutoPenalties, recalcDay, finalizeDay, reopenDay, autoFinalizePastDays,
  toggleTask, addTaskOnce, addCustom, removeEntry, editEntry,
};
})();
