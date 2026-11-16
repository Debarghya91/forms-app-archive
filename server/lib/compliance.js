// Compliance calendar: computed from the due-dates pack, filtered by
// profile type. Dates are the next occurrence of each standard rule
// after today. Nothing here claims portal data; every task carries a
// verify note. Stored compliance_tasks rows (configured mode) can
// override a task's status by task key.
import { loadPack } from "./tax.js";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function nextMonthly(day, offsetMonths, from) {
  const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = 0; i < 24; i++) {
    const target = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i + offsetMonths - 1, day)
    );
    if (isoDate(target) > isoDate(from)) return target;
  }
  return null;
}

// Quarter ends: March, June, September, December. Due in the month
// after the quarter end, on the schedule day.
function nextQuarterEnd(day, offsetMonths, from) {
  const quarterEndMonths = [2, 5, 8, 11]; // 0-based: Mar, Jun, Sep, Dec
  const candidates = [];
  for (let year = from.getUTCFullYear(); year <= from.getUTCFullYear() + 1; year++) {
    for (const m of quarterEndMonths) {
      candidates.push(new Date(Date.UTC(year, m + offsetMonths, day)));
    }
  }
  candidates.sort((a, b) => a - b);
  return candidates.find((d) => isoDate(d) > isoDate(from)) || null;
}

function nextYearly(month, day, from) {
  for (let year = from.getUTCFullYear(); year <= from.getUTCFullYear() + 1; year++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (isoDate(d) > isoDate(from)) return d;
  }
  return null;
}

function nextFixedMonths(months, day, from) {
  const candidates = [];
  for (let year = from.getUTCFullYear(); year <= from.getUTCFullYear() + 1; year++) {
    for (const m of months) candidates.push(new Date(Date.UTC(year, m - 1, day)));
  }
  candidates.sort((a, b) => a - b);
  return candidates.find((d) => isoDate(d) > isoDate(from)) || null;
}

export function nextDue(entry, from) {
  const schedule = entry.schedule || {};
  const ref = from || new Date();
  if (schedule.kind === "monthly") return nextMonthly(schedule.day, schedule.offset_months || 1, ref);
  if (schedule.kind === "quarter_end") {
    return nextQuarterEnd(schedule.day, schedule.offset_months || 1, ref);
  }
  if (schedule.kind === "yearly") return nextYearly(schedule.month, schedule.day, ref);
  if (schedule.kind === "fixed_months") return nextFixedMonths(schedule.months, schedule.day, ref);
  return null;
}

export function findDueDateEntry(key) {
  const pack = loadPack("due-dates");
  return (pack.due_dates || []).find((e) => e.key === key) || null;
}

function taskShape(entry, pack, stored, from) {
  const due = nextDue(entry, from);
  if (!due) return null;
  const noteParts = [entry.rule + "."];
  if (entry.note) noteParts.push(entry.note);
  noteParts.push("Verify on the official portal.");
  const task = {
    key: entry.key,
    title: entry.label,
    due: isoDate(due),
    category: entry.category,
    status: (stored && stored.status) || "pending",
    source: "due-dates pack v" + pack.version,
    note: noteParts.join(" "),
  };
  if (stored && stored.note) task.user_note = stored.note;
  return task;
}

// Shape for one entry, used by the PATCH response.
export function singleTask(key, stored, from) {
  const pack = loadPack("due-dates");
  const entry = findDueDateEntry(key);
  if (!entry) return null;
  return taskShape(entry, pack, stored || {}, from);
}

// Build tasks for a profile type. storedByKey maps task keys to
// {status, note} from the compliance_tasks table.
export function buildComplianceTasks(profileType, storedByKey, from) {
  const pack = loadPack("due-dates");
  const stored = storedByKey || {};
  const tasks = [];
  for (const entry of pack.due_dates || []) {
    if (!entry.applicable_to.includes(profileType)) continue;
    const task = taskShape(entry, pack, stored[entry.key], from);
    if (task) tasks.push(task);
  }
  tasks.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return tasks;
}
