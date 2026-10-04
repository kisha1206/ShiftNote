(function () {
  'use strict';

  const Store = window.PayStore;
  const $ = (sel, root = document) => root.querySelector(sel);

  /* ---------- Dates and money ---------- */

  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const dayNum = k => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const todayKey = () => keyOf(new Date());
  const mondayOf = k => addDays(k, -((parseKey(k).getDay() + 6) % 7));
  const firstOfMonth = k => k.slice(0, 8) + '01';

  const fmtDay = k => parseKey(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtShort = k => parseKey(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fmtRange = (a, b) => `${fmtShort(a)} – ${fmtShort(b)}`;
  const fmtTime = t => { const d = new Date(2000, 0, 1, ...t.split(':').map(Number)); return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const fmtHours = mins => { const h = Math.floor(mins / 60), m = Math.round(mins % 60); return m ? `${h}h ${pad(m)}m` : `${h}h`; };
  const money = (n, digits = 2) => state.settings.currency + n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const moneyShort = n => n >= 10000 ? state.settings.currency + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : money(n, 0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- State ---------- */

  const state = {
    jobs: [], profiles: [], holidays: [], settings: { currency: '$', lastRate: null },
    tab: 'home', period: 'week', periodOffset: 0,
    calMonth: firstOfMonth(todayKey()),
    histEnd: todayKey(), histSel: todayKey(),
    jobFilter: null,
    histMode: 'week', search: { mode: 'range', from: firstOfMonth(todayKey()), to: todayKey(), day: todayKey() },
    holYear: new Date().getFullYear()
  };

  /* ---------- Pay rules ---------- */

  // Minutes from a fixed epoch. A shift whose end is not after its start runs past midnight.
  function span(job) {
    const s = toMin(job.start);
    let e = toMin(job.end);
    if (e <= s) e += 1440;
    const base = dayNum(job.date) * 1440;
    return { s: base + s, e: base + e, mins: e - s };
  }
  // The user's own holidays win; otherwise the region's public holidays count unless switched off.
  function holidayFor(k) {
    const own = state.holidays.find(h => h.date === k) || state.holidays.find(h => h.yearly && h.date.slice(5) === k.slice(5));
    if (own) return own;
    if ((state.settings.hiddenHolidays || []).includes(k)) return null;
    return regionHolidays(+k.slice(0, 4)).find(h => h.date === k) || null;
  }
  const regionHolidays = y => window.PayHolidays ? window.PayHolidays.forYear(y, state.settings.region || 'AU') : [];
  const isHoliday = job => (job.holiday === true || job.holiday === false) ? job.holiday : !!holidayFor(job.date);
  // A shift keeps the rate its job had when it was saved. Untitled shifts have none and use the Untitled job's rate.
  const rateOf = job => job.rate > 0 ? job.rate : ((state.profiles.find(p => p.id === job.jobId) || {}).rate || 0);
  const basePay = job => span(job).mins / 60 * rateOf(job);
  const UNTITLED = 'Untitled';
  const pay = job => basePay(job) * (isHoliday(job) ? 2 : 1);

  function findOverlap(candidate, ignoreId) {
    const c = span(candidate);
    return state.jobs.find(j => {
      if (j.id === ignoreId) return false;
      if (Math.abs(dayNum(j.date) - dayNum(candidate.date)) > 1) return false;
      const o = span(j);
      return c.s < o.e && o.s < c.e;
    });
  }

  function totals(jobs) {
    let mins = 0, total = 0, extra = 0;
    for (const j of jobs) {
      const m = span(j).mins, b = basePay(j);
      mins += m; total += pay(j);
      if (isHoliday(j)) extra += b;
    }
    return { mins, total, extra, count: jobs.length };
  }

  const jobsOn = k => state.jobs.filter(j => j.date === k).sort((a, b) => a.start.localeCompare(b.start));
  const jobsBetween = (a, b) => state.jobs.filter(j => (!a || j.date >= a) && (!b || j.date <= b));

  /* ---------- Home ---------- */

  function periodRange() {
    const t = todayKey(), o = state.periodOffset;
    if (state.period === 'week') {
      const start = addDays(mondayOf(t), 7 * o), end = addDays(start, 6);
      return { start, end, label: o === 0 ? 'This week' : o === -1 ? 'Last week' : fmtRange(start, end) };
    }
    if (state.period === 'month') {
      const d = parseKey(t), m = new Date(d.getFullYear(), d.getMonth() + o, 1);
      const start = keyOf(m), end = keyOf(new Date(m.getFullYear(), m.getMonth() + 1, 0));
      return { start, end, label: o === 0 ? 'This month' : m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
    }
    return { start: null, end: null, label: 'All time' };
  }

  function chartBuckets(range) {
    const buckets = [];
    const add = (label, jobs, full) => {
      let base = 0, extra = 0;
      for (const j of jobs) { const b = basePay(j); base += b; if (isHoliday(j)) extra += b; }
      buckets.push({ label, full, base, extra });
    };
    if (state.period === 'all') {
      if (!state.jobs.length) return { buckets, every: 1 };
      const dates = state.jobs.map(j => j.date).sort();
      let m = parseKey(firstOfMonth(dates[dates.length - 1]));
      const months = [];
      for (let i = 0; i < 12; i++) {
        months.unshift(new Date(m));
        m = new Date(m.getFullYear(), m.getMonth() - 1, 1);
        if (keyOf(m) < firstOfMonth(dates[0])) break;
      }
      for (const mm of months) {
        const p = keyOf(mm).slice(0, 7);
        add(mm.toLocaleDateString(undefined, { month: 'short' }), state.jobs.filter(j => j.date.startsWith(p)),
          mm.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
      }
      return { buckets, every: months.length > 8 ? 2 : 1 };
    }
    for (let k = range.start; k <= range.end; k = addDays(k, 1)) {
      const d = parseKey(k);
      const label = state.period === 'week' ? d.toLocaleDateString(undefined, { weekday: 'short' }) : String(d.getDate());
      add(label, jobsOn(k), fmtDay(k));
    }
    return { buckets, every: state.period === 'week' ? 1 : 7 };
  }

  function niceMax(v) {
    if (v <= 0) return 100;
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * mag >= v) return s * mag;
    return 10 * mag;
  }

  function chartSVG({ buckets, every }) {
    const W = 360, H = 180, L = 46, R = 4, T = 10, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const max = niceMax(Math.max(0, ...buckets.map(b => b.base + b.extra)));
    const bw = buckets.length ? iw / buckets.length : iw;
    const barW = Math.max(3, Math.min(26, bw * 0.64));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pay per ${state.period === 'all' ? 'month' : 'day'}">`;
    for (const f of [0, 0.5, 1]) {
      const y = T + ih - f * ih;
      s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`;
      s += `<text x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(moneyShort(max * f))}</text>`;
    }
    const any = buckets.some(b => b.base > 0);
    buckets.forEach((b, i) => {
      const x = L + i * bw + (bw - barW) / 2;
      const hb = b.base / max * ih, he = b.extra / max * ih;
      const tip = `${b.full}: ${money(b.base + b.extra)}${b.extra ? ` (incl. ${money(b.extra)} holiday extra)` : ''}`;
      if (b.base > 0) {
        s += `<g><title>${esc(tip)}</title>`;
        s += `<rect class="bar" x="${x}" y="${T + ih - hb}" width="${barW}" height="${hb}" rx="3"/>`;
        if (he > 0) s += `<rect class="bar-extra" x="${x}" y="${T + ih - hb - he}" width="${barW}" height="${he}" rx="3"/>`;
        s += `</g>`;
      }
      if (i % every === 0) s += `<text x="${x + barW / 2}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
    });
    if (!any) s += `<text class="empty" x="${L + iw / 2}" y="${T + ih / 2}" text-anchor="middle">No pay logged in this period yet</text>`;
    return s + '</svg>';
  }

  function calendarHTML() {
    const first = parseKey(state.calMonth);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const t = todayKey();
    const dows = [];
    for (let i = 0; i < 7; i++) dows.push(new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
    let cells = dows.map(d => `<div class="cal-dow">${esc(d)}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += `<div class="cal-day blank"></div>`;
    for (let d = 1; d <= days; d++) {
      const k = keyOf(new Date(first.getFullYear(), first.getMonth(), d));
      const js = jobsOn(k), hol = holidayFor(k);
      const sum = js.reduce((a, j) => a + pay(j), 0);
      const cls = ['cal-day', js.length && 'has-jobs', hol && 'holiday', k === t && 'today'].filter(Boolean).join(' ');
      const label = `${fmtDay(k)}${hol ? ', ' + hol.name : ''}${js.length ? `, ${js.length} shift${js.length > 1 ? 's' : ''}, ${money(sum)}` : ''}. Add a shift`;
      cells += `<button class="${cls}" data-action="cal-day" data-date="${k}" aria-label="${esc(label)}">
        <span class="n">${d}</span>${js.length ? `<span class="amt">${esc(moneyShort(sum))}</span>` : ''}</button>`;
    }
    const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return `<div class="card">
      <div class="cal-head">
        <h2>${esc(monthName)}</h2>
        <div class="row">
          <button class="icon-btn" data-action="cal-prev" aria-label="Previous month">${ICON.left}</button>
          <button class="icon-btn" data-action="cal-next" aria-label="Next month">${ICON.right}</button>
        </div>
      </div>
      <div class="cal-grid">${cells}</div>
      <p class="cal-hint">Tap a date to add a shift on that day. Days with a gold line are public holidays and pay double.</p>
    </div>`;
  }

  const jobName = j => (j.title || '').trim() || UNTITLED;

  // Home can be narrowed to one job name; everything on it then counts that job only.
  function renderHome() {
    const range = periodRange();
    const all = state.jobs;
    const names = [...new Set(all.map(jobName))].sort((a, b) => a.localeCompare(b));
    if (state.jobFilter && !names.includes(state.jobFilter)) state.jobFilter = null;

    // Payout per job name for this period.
    const byName = new Map();
    for (const j of jobsBetween(range.start, range.end)) {
      const n = jobName(j), r = byName.get(n) || { name: n, total: 0, mins: 0, count: 0 };
      r.total += pay(j); r.mins += span(j).mins; r.count++;
      byName.set(n, r);
    }
    const rows = [...byName.values()].sort((a, b) => b.total - a.total);
    const top = rows.length ? rows[0].total : 0;

    const chips = names.length > 1 || state.jobFilter ? `<div class="filter-bar" role="group" aria-label="Filter by job">
        <span class="filter-label">${ICON.filter}Job</span>
        <button class="fchip" data-action="job-filter" data-name="" aria-pressed="${!state.jobFilter}">All jobs</button>
        ${names.map(n => `<button class="fchip" data-action="job-filter" data-name="${esc(n)}" aria-pressed="${state.jobFilter === n}">${esc(n)}</button>`).join('')}
      </div>` : '';

    const breakdown = rows.length > 1 || (rows.length && state.jobFilter) ? `<div class="card stack">
        <h2>Payout by job</h2>
        <div class="by-job">${rows.map(r => `<button class="by-job-row${state.jobFilter === r.name ? ' on' : ''}" data-action="job-filter" data-name="${esc(state.jobFilter === r.name ? '' : r.name)}">
            <span class="bj-name">${esc(r.name)}</span>
            <span class="bj-total">${esc(money(r.total))}</span>
            <span class="bj-bar"><i style="width:${top ? Math.max(2, r.total / top * 100) : 0}%"></i></span>
            <span class="bj-meta">${fmtHours(r.mins)} · ${r.count} shift${r.count === 1 ? '' : 's'}</span>
          </button>`).join('')}</div>
        <p class="cal-hint" style="margin:0">Tap a job to see the analytics for that job only.</p>
      </div>` : '';

    if (state.jobFilter) state.jobs = all.filter(j => jobName(j) === state.jobFilter);
    try { renderHomeInner(range, chips, breakdown); } finally { state.jobs = all; }
  }

  function renderHomeInner(range, chips, breakdown) {
    const t = totals(jobsBetween(range.start, range.end));
    const avg = t.mins ? t.total / (t.mins / 60) : 0;
    const seg = ['week', 'month', 'all'].map(p =>
      `<button data-action="period" data-period="${p}" aria-pressed="${state.period === p}">${{ week: 'Week', month: 'Month', all: 'All' }[p]}</button>`).join('');

    let html = `
      <div class="row between wrap">
        <h1>${state.jobFilter ? esc(state.jobFilter) : 'Your earnings'}</h1>
        <div class="seg" role="group" aria-label="Period">${seg}</div>
      </div>
      ${chips}
      <div class="payout">
        <div class="payout-period">
          ${state.period === 'all' ? '<span></span>' : `<button class="icon-btn" data-action="period-prev" aria-label="Previous period">${ICON.left}</button>`}
          <span class="period-label">${esc(range.label)}</span>
          ${state.period === 'all' ? '<span></span>' : `<button class="icon-btn" data-action="period-next" aria-label="Next period" ${state.periodOffset >= 0 ? 'disabled style="opacity:.35"' : ''}>${ICON.right}</button>`}
        </div>
        <div>
          <div class="eyebrow">Payout</div>
          <div class="payout-amount">${esc(money(t.total))}</div>
        </div>
        <div class="payout-grid">
          <div><b>${fmtHours(t.mins)}</b><span>Hours worked</span></div>
          <div><b>${t.count}</b><span>Shift${t.count === 1 ? '' : 's'}</span></div>
          <div><b>${esc(money(avg))}</b><span>Avg per hour</span></div>
        </div>
      </div>`;
    if (t.extra > 0) html += `<div class="holiday-note">Public holiday double pay added ${esc(money(t.extra))} to this period.</div>`;
    html += breakdown;

    if (!state.jobs.length && state.profiles.length) {
      html += `<div class="empty-state">
        <strong>No shifts yet</strong>
        <span>Log the hours you work at your jobs. Tap a date on the calendar or use the button below.</span>
        <button class="btn primary" data-action="add-shift">Add shift</button>
      </div>`;
    } else if (!state.jobs.length) {
      html += `<div class="empty-state">
        <strong>No jobs yet</strong>
        <span>Add the jobs you work, like a cafe or a delivery app, with their pay rate. Then log each shift with its date and hours. Everything is saved on this device only.</span>
        <div class="row wrap" style="justify-content:center">
          <button class="btn primary" data-action="new-profile">Add your first job</button>
          <button class="btn" data-action="load-sample">Try with sample data</button>
        </div>
      </div>`;
    }

    html += `<div class="card stack">
        <div class="row between"><h2>${state.period === 'all' ? 'Pay by month' : 'Pay by day'}</h2>
          <div class="legend"><span><i style="background:var(--accent)"></i>Base pay</span><span><i style="background:var(--holiday)"></i>Holiday extra</span></div>
        </div>
        ${chartSVG(chartBuckets(range))}
      </div>`;
    html += calendarHTML();
    $('#view-home').innerHTML = html;
  }

  /* ---------- History ---------- */

  function histModeSeg() {
    return `<div class="seg" role="group" aria-label="History view">
      <button data-action="hist-mode" data-mode="week" aria-pressed="${state.histMode === 'week'}">7 days</button>
      <button data-action="hist-mode" data-mode="search" aria-pressed="${state.histMode === 'search'}">Search dates</button>
    </div>`;
  }

  function renderSearch() {
    const q = state.search;
    let from = q.mode === 'day' ? q.day : q.from, to = q.mode === 'day' ? q.day : q.to;
    let problem = '';
    if (!from || !to) problem = q.mode === 'day' ? 'Pick a date to see its shifts.' : 'Pick a start date and an end date.';
    else if (from > to) problem = 'The end date is before the start date. Pick an end date on or after the start date.';
    const jobs = problem ? [] : jobsBetween(from, to).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const t = totals(jobs);
    const days = new Set(jobs.map(j => j.date)).size;

    let results = '';
    if (problem) results = `<div class="error">${esc(problem)}</div>`;
    else if (!jobs.length) results = `<div class="empty-state"><strong>No shifts ${from === to ? 'on ' + esc(fmtDay(from)) : 'between ' + esc(fmtRange(from, to))}</strong>
      ${from === to ? `<button class="btn primary" data-action="add-shift" data-date="${from}">Add shift for this day</button>` : ''}</div>`;
    else {
      let cur = '';
      results = '<div class="job-list">';
      for (const j of jobs) {
        if (j.date !== cur) {
          cur = j.date;
          const dt = totals(jobsOn(cur)), hol = holidayFor(cur);
          results += `<div class="row between wrap" style="margin-top:6px"><h3 style="font-size:var(--step-0)">${esc(fmtDay(cur))}${hol ? `<span class="badge">${esc(hol.name)}</span>` : ''}</h3>
            <span class="muted" style="font-size:var(--step--1)">${fmtHours(dt.mins)} · ${esc(money(dt.total))}</span></div>`;
        }
        results += jobCard(j);
      }
      results += '</div>';
    }

    $('#view-history').innerHTML = `
      <div class="week-head"><h1>History</h1>${histModeSeg()}</div>
      <div class="card stack">
        <div class="seg" role="group" aria-label="Search by" style="align-self:flex-start">
          <button data-action="search-mode" data-mode="range" aria-pressed="${q.mode === 'range'}">Date range</button>
          <button data-action="search-mode" data-mode="day" aria-pressed="${q.mode === 'day'}">Single date</button>
        </div>
        ${q.mode === 'day'
          ? `<div class="field"><label for="s-day">Date</label><input type="date" id="s-day" value="${q.day || ''}"></div>`
          : `<div class="grid-2">
              <div class="field"><label for="s-from">Start date</label><input type="date" id="s-from" value="${q.from || ''}"></div>
              <div class="field"><label for="s-to">End date</label><input type="date" id="s-to" value="${q.to || ''}"></div>
            </div>
            <div class="row wrap">
              <button class="btn small" data-action="search-preset" data-preset="week">This week</button>
              <button class="btn small" data-action="search-preset" data-preset="lastweek">Last week</button>
              <button class="btn small" data-action="search-preset" data-preset="month">This month</button>
              <button class="btn small" data-action="search-preset" data-preset="lastmonth">Last month</button>
            </div>`}
      </div>
      ${problem ? '' : `<div class="summary-row">
        <div class="stat"><b>${esc(money(t.total))}</b><span>Payout</span></div>
        <div class="stat"><b>${fmtHours(t.mins)}</b><span>Hours worked</span></div>
        <div class="stat"><b>${t.count}</b><span>Job${t.count === 1 ? '' : 's'}${q.mode === 'range' ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}</span></div>
      </div>
      ${t.extra > 0 ? `<div class="holiday-note">Holiday double pay added ${esc(money(t.extra))}.</div>` : ''}`}
      ${results}`;
  }

  function renderHistory(dir) {
    if (state.histMode === 'search') return renderSearch();
    const end = state.histEnd, start = addDays(end, -6), t = todayKey();
    if (state.histSel < start || state.histSel > end) state.histSel = end;
    let strip = '';
    for (let k = start; k <= end; k = addDays(k, 1)) {
      const d = parseKey(k), js = jobsOn(k), mins = js.reduce((a, j) => a + span(j).mins, 0);
      const cls = ['strip-day', k === t && 'today', holidayFor(k) && 'holiday'].filter(Boolean).join(' ');
      strip += `<button class="${cls}" data-action="hist-day" data-date="${k}" aria-pressed="${k === state.histSel}" aria-label="${esc(fmtDay(k))}${mins ? ', ' + fmtHours(mins) : ''}">
        <span class="dow">${esc(d.toLocaleDateString(undefined, { weekday: 'short' }))}</span>
        <span class="n">${d.getDate()}</span>
        <span class="h">${mins ? fmtHours(mins) : ''}</span>
      </button>`;
    }
    const week = totals(jobsBetween(start, end));
    const dayJobs = jobsOn(state.histSel);
    const hol = holidayFor(state.histSel);

    let list;
    if (dayJobs.length) {
      list = `<div class="job-list">${dayJobs.map(jobCard).join('')}</div>`;
    } else {
      list = `<div class="empty-state"><strong>No shifts on ${esc(fmtDay(state.histSel))}</strong>
        <button class="btn primary" data-action="add-shift" data-date="${state.histSel}">Add shift for this day</button></div>`;
    }
    const dayTotal = totals(dayJobs);

    $('#view-history').innerHTML = `
      <div class="week-head"><h1>History</h1>${histModeSeg()}</div>
      <div class="week-head">
        <div class="muted" style="font-weight:600">${esc(fmtRange(start, end))}</div>
        <div class="week-tools">
          <button class="icon-btn" data-action="hist-prev" aria-label="Previous 7 days">${ICON.left}</button>
          <span class="icon-btn date-jump" title="Pick the last day to show">${ICON.cal}
            <input type="date" id="hist-jump" value="${end}" aria-label="Show the 7 days ending on"></span>
          <button class="icon-btn" data-action="hist-next" aria-label="Next 7 days">${ICON.right}</button>
          ${end !== t ? `<button class="btn small" data-action="hist-today">Today</button>` : ''}
        </div>
      </div>
      <div class="strip ${dir ? 'slide-' + dir : ''}" id="strip">${strip}</div>
      <div class="swipe-hint">Swipe the days to move 7 days at a time</div>
      <div class="summary-row">
        <div class="stat"><b>${esc(money(week.total))}</b><span>7-day payout</span></div>
        <div class="stat"><b>${fmtHours(week.mins)}</b><span>7-day hours</span></div>
        <div class="stat"><b>${week.count}</b><span>Shifts</span></div>
      </div>
      <div class="row between wrap">
        <h2>${esc(fmtDay(state.histSel))}${hol ? `<span class="badge">${esc(hol.name)}</span>` : ''}</h2>
        ${dayJobs.length ? `<span class="muted">${fmtHours(dayTotal.mins)} · ${esc(money(dayTotal.total))}</span>` : ''}
      </div>
      ${list}
      ${dayJobs.length ? `<button class="new-row" data-action="add-shift" data-date="${state.histSel}"><span>+</span> New shift on this day</button>` : ''}`;
  }

  function jobCard(j) {
    const sp = span(j), hol = isHoliday(j);
    return `<button class="job" data-action="edit-shift" data-id="${esc(j.id)}">
      <span class="t">${esc(j.title || 'Job')}${hol ? '<span class="badge">Holiday ×2</span>' : ''}</span>
      <span class="p">${esc(money(pay(j)))}</span>
      <span class="d">${esc(fmtTime(j.start))} – ${esc(fmtTime(j.end))}${toMin(j.end) <= toMin(j.start) ? ' (ends next day)' : ''} · ${fmtHours(sp.mins)}${j.seriesId ? ' · Repeats' : ''}</span>
      <span class="r">${rateOf(j) ? esc(money(rateOf(j))) + '/h' : 'No pay rate'}</span>
    </button>`;
  }

  /* ---------- Holidays and settings ---------- */

  function renderSettings() {
    const y = state.holYear, region = state.settings.region || 'AU';
    const hidden = state.settings.hiddenHolidays || [];
    const regionName = window.PayHolidays ? window.PayHolidays.REGIONS[region] : '';
    const rows = regionHolidays(y).map(h => ({ ...h, kind: 'region', off: hidden.includes(h.date) }));
    for (const h of state.holidays) {
      if (h.yearly) rows.push({ ...h, date: y + h.date.slice(4), kind: 'own' });
      else if (h.date.startsWith(String(y))) rows.push({ ...h, kind: 'own' });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'own' ? -1 : 1));
    const items = rows.length ? rows.map(h => {
      const d = parseKey(h.date);
      const sub = h.kind === 'own' ? (h.yearly ? 'Added by you · every year' : 'Added by you')
        : h.off ? 'Not counted as a holiday' : d.toLocaleDateString(undefined, { weekday: 'long' });
      const btn = h.kind === 'own'
        ? `<button class="btn small danger" data-action="del-holiday" data-id="${esc(h.id)}">Remove</button>`
        : h.off ? `<button class="btn small" data-action="show-holiday" data-date="${h.date}">Count it</button>`
          : `<button class="btn small" data-action="hide-holiday" data-date="${h.date}">Don't count</button>`;
      return `<div class="hol-item${h.off ? ' off' : ''}">
        <div class="hol-date"><b>${d.getDate()}</b><span>${esc(d.toLocaleDateString(undefined, { month: 'short' }))}</span></div>
        <div class="hol-name"><div>${esc(h.name)}</div><small>${esc(sub)}</small></div>
        ${btn}
      </div>`;
    }).join('') : `<p class="muted" style="margin:0">No holidays in ${y}. Pick your state above or add your own below.</p>`;
    const opts = window.PayHolidays ? Object.entries(window.PayHolidays.REGIONS).map(([k, v]) =>
      `<option value="${k}"${k === region ? ' selected' : ''}>${esc(v)}</option>`).join('') : '';

    $('#view-settings').innerHTML = `
      <h1>Public holidays</h1>
      <div class="card stack">
        <div class="field">
          <label for="region">Where you work</label>
          <select id="region">${opts}</select>
        </div>
        <p class="muted" style="margin:0;font-size:var(--step--1)">Shifts on these dates pay double. Pick your state to include its own holidays. Regional days such as show days or the AFL Grand Final Friday are not included, so add them below if they apply to you.</p>
      </div>
      <div class="card">
        <div class="cal-head">
          <h2>${y}${region !== 'none' ? ` <span class="muted" style="font-family:var(--font-body);font-size:var(--step--1);font-weight:500">${esc(regionName)}</span>` : ''}</h2>
          <div class="row">
            <button class="icon-btn" data-action="hol-year" data-step="-1" aria-label="Previous year">${ICON.left}</button>
            <button class="icon-btn" data-action="hol-year" data-step="1" aria-label="Next year">${ICON.right}</button>
          </div>
        </div>
        <div class="hol-list">${items}</div>
      </div>
      <form class="card stack" id="hol-form" novalidate>
        <h2>Add your own holiday</h2>
        <div class="grid-2">
          <div class="field"><label for="hol-date">Date</label><input type="date" id="hol-date" required></div>
          <div class="field"><label for="hol-name">Name</label><input type="text" id="hol-name" placeholder="e.g. Royal Show Day" maxlength="60"></div>
        </div>
        <label class="check"><input type="checkbox" id="hol-yearly"> Repeats every year on this date</label>
        <div class="error" id="hol-error" hidden></div>
        <button class="btn primary" type="submit">Add holiday</button>
      </form>

      <h1>Settings</h1>
      <div class="card stack">
        <div class="field" style="max-width:180px">
          <label for="currency">Currency symbol</label>
          <input type="text" id="currency" value="${esc(state.settings.currency)}" maxlength="4">
        </div>
        <div class="stack">
          <div class="label muted" style="font-weight:600;font-size:var(--step--1)">Backup</div>
          <p class="muted" style="margin:0;font-size:var(--step--1)">Your data lives only in this browser. Export a backup file to keep a copy or move it to another device. Importing replaces what is here now.</p>
          <div class="row wrap">
            <button class="btn small" data-action="export">Export backup</button>
            <label class="btn small" for="import-file" style="cursor:pointer">Import backup</label>
            <input type="file" id="import-file" accept="application/json,.json" hidden>
          </div>
        </div>
        <div class="row wrap">
          ${state.jobs.some(j => (j.title || '').startsWith('Sample · ')) || state.profiles.some(p => p.name.startsWith('Sample · ')) ? '<button class="btn small" data-action="clear-samples">Remove sample data</button>' : ''}
          <button class="btn small danger" data-action="clear-all" id="clear-all">Delete all data</button>
        </div>
      </div>`;
  }

  /* ---------- Job form ---------- */

  let form = null; // { id, seriesId, holidayTouched, confirm, repeat: { mode, days, until }, repeatOpen }

  const DOW_NAMES = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'long' }));
  const DOW_SHORT = [0, 1, 2, 3, 4, 5, 6].map(i => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const MAX_REPEATS = 366;

  const PROP_ICON = {
    date: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    start: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    end: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12H8"/></svg>',
    rate: '<svg viewBox="0 0 24 24"><path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3.2c0 4.3 9 2.3 9 6.8 0 1.9-2 3.3-4.5 3.3S7.5 16.5 7.5 15"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/></svg>',
    until: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M9 15l2 2 4-4"/></svg>',
    job: '<svg viewBox="0 0 24 24"><rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17"/></svg>',
    holiday: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>'
  };

  function repeatLabel(r, date) {
    if (r.mode === 'daily') return 'Every day';
    if (r.mode === 'weekly') return date ? `Every ${DOW_NAMES[parseKey(date).getDay()]}` : 'Every week';
    if (r.mode === 'custom') return r.days.length ? WEEK_ORDER.filter(d => r.days.includes(d)).map(d => DOW_SHORT[d]).join(', ') : 'Pick days';
    return 'Just this day';
  }

  function occurrences(v, r) {
    if (!v.date) return [];
    if (r.mode === 'once') return [v.date];
    const first = parseKey(v.date).getDay(), out = [];
    for (let k = v.date; k <= r.until && out.length <= MAX_REPEATS; k = addDays(k, 1)) {
      const dow = parseKey(k).getDay();
      if (r.mode === 'daily' || (r.mode === 'weekly' && dow === first) || (r.mode === 'custom' && r.days.includes(dow))) out.push(k);
    }
    return out;
  }

  function defaultJobId() {
    const filtered = state.jobFilter && state.profiles.find(p => p.name === state.jobFilter);
    if (filtered) return filtered.id;
    if (state.profiles.length === 1) return state.profiles[0].id;
    return profileById(state.settings.lastJobId) ? state.settings.lastJobId : null;
  }

  function openForm({ date, id, jobId } = {}) {
    const existing = id ? state.jobs.find(j => j.id === id) : null;
    let pick = existing ? existing.jobId : (jobId || defaultJobId());
    if ((profileById(pick) || {}).name === UNTITLED) pick = null;
    const prof = profileById(pick);
    const job = existing || {
      title: '', date: date || todayKey(), start: '09:00', end: '17:00',
      rate: null, holiday: null
    };
    form = {
      jobId: prof ? prof.id : null, jobOpen: !prof && !existing, newJobOpen: false,
      id: existing ? existing.id : null,
      seriesId: existing ? existing.seriesId || null : null,
      holidayTouched: existing ? (existing.holiday === true || existing.holiday === false) : false,
      confirm: null,
      repeat: { mode: 'once', days: [parseKey(job.date).getDay()], until: addDays(job.date, 27) },
      repeatOpen: false
    };
    const seriesCount = form.seriesId ? state.jobs.filter(j => j.seriesId === form.seriesId).length : 0;

    $('#sheet-body').innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-action="close-sheet">Cancel</button>
        <span id="sheet-title">${existing ? 'Edit shift' : 'New shift'}</span>
        <button type="submit" form="job-form" class="text-btn strong">${existing ? 'Done' : 'Save'}</button>
      </div>
      <form id="job-form" class="page-form" novalidate>
        <div class="page-title" id="f-page-title"></div>
        <div class="props">
          <button type="button" class="prop" data-action="toggle-jobpick" id="f-job-btn" aria-expanded="false">
            <span class="prop-k">${PROP_ICON.job}Job</span><span class="prop-v"><span class="tag" id="f-job-val"></span></span></button>
          <div class="menu" id="f-job-menu" hidden></div>
          <label class="prop" for="f-date"><span class="prop-k">${PROP_ICON.date}Date</span>
            <span class="prop-v"><input type="date" id="f-date" required value="${job.date}"></span></label>
          <label class="prop" for="f-start"><span class="prop-k">${PROP_ICON.start}Start</span>
            <span class="prop-v"><input type="time" id="f-start" required value="${job.start}"></span></label>
          <label class="prop" for="f-end"><span class="prop-k">${PROP_ICON.end}End</span>
            <span class="prop-v"><input type="time" id="f-end" required value="${job.end}"></span></label>

          ${existing ? (form.seriesId ? `<div class="prop"><span class="prop-k">${PROP_ICON.repeat}Repeat</span><span class="prop-v muted">Part of a repeating job (${seriesCount} days)</span></div>` : '') : `
          <button type="button" class="prop" data-action="toggle-repeat" id="f-repeat-btn" aria-expanded="false">
            <span class="prop-k">${PROP_ICON.repeat}Repeat</span><span class="prop-v"><span class="tag" id="f-repeat-val">Just this day</span></span></button>
          <div class="menu" id="f-repeat-menu" hidden></div>
          <label class="prop" for="f-until" id="f-until-row" hidden><span class="prop-k">${PROP_ICON.until}Until</span>
            <span class="prop-v"><input type="date" id="f-until" value="${form.repeat.until}"></span></label>`}
          <div class="prop" id="f-hol-wrap"><span class="prop-k">${PROP_ICON.holiday}Holiday</span>
            <span class="prop-v hol-v"><small id="f-hol-hint"></small>
              <label class="switch"><input type="checkbox" id="f-holiday" aria-label="Public holiday, double pay"><i></i></label></span></div>
        </div>
        <div class="day-jobs" id="f-day-jobs"></div>
        <div class="error" id="f-error" hidden></div>
        <div class="calc"><span class="formula" id="f-formula"></span><span class="total" id="f-total"></span></div>
        <button type="submit" class="btn primary block">${existing ? 'Save changes' : 'Save job'}</button>
        ${existing ? `<div class="danger-rows">
          <button type="button" class="menu-row danger-row" data-action="delete-shift" data-scope="one">Delete this job</button>
          ${form.seriesId && seriesCount > 1 ? `<button type="button" class="menu-row danger-row" data-action="delete-shift" data-scope="later">Delete this and later repeats</button>` : ''}
        </div>` : ''}
      </form>`;
    $('#f-holiday').checked = isHoliday(job);
    $('#sheet').hidden = false;
    renderRepeat();
    renderJobPick();
    updateForm();
  }

  function renderJobPick() {
    if (!form) return;
    const prof = profileById(form.jobId);
    $('#f-page-title').textContent = prof ? prof.name : UNTITLED;
    $('#f-page-title').classList.toggle('empty', !prof);
    $('#f-job-val').textContent = prof ? (prof.rate ? `${prof.name} · ${money(prof.rate)}/h` : prof.name) : 'No job selected';
    $('#f-job-val').classList.toggle('on', !!prof);
    $('#f-job-btn').setAttribute('aria-expanded', String(form.jobOpen));
    const menu = $('#f-job-menu');
    menu.hidden = !form.jobOpen;
    if (!form.jobOpen) return;
    const list = [...state.profiles].sort((a, b) => a.name.localeCompare(b.name));
    menu.innerHTML = `<div class="menu-label">${list.length ? 'Which job is this shift for?' : 'You have no jobs yet. Create one, or save the shift as Untitled.'}</div>
      ${list.filter(p => p.name !== UNTITLED).map(p => `<button type="button" class="menu-row" role="menuitemradio" aria-checked="${p.id === form.jobId}" data-action="pick-job" data-id="${esc(p.id)}">
        <span class="mr-main"><span>${esc(p.name)}</span>${p.rate ? `<small>${esc(money(p.rate))}/h</small>` : ''}</span>
        ${p.id === form.jobId ? '<svg viewBox="0 0 24 24" class="check"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>`).join('')}
      <button type="button" class="menu-row" role="menuitemradio" aria-checked="${!form.jobId}" data-action="pick-job" data-id="">
        <span class="mr-main"><span>${UNTITLED}</span><small>No job, sort it out later</small></span>
        ${!form.jobId ? '<svg viewBox="0 0 24 24" class="check"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>
      ${form.newJobOpen ? `<div class="new-job-inline">
          <input type="text" id="f-newjob" maxlength="60" placeholder="Job name, e.g. Cafe" aria-label="New job name">
          <span class="rate-in"><span>${esc(state.settings.currency)}</span><input type="number" id="f-newrate" inputmode="decimal" min="0" step="0.01" placeholder="Rate" aria-label="Pay rate per hour"></span>
          <button type="button" class="btn primary small" data-action="create-job-inline">Add</button>
        </div>` : `<button type="button" class="menu-row add-row" data-action="new-job-inline"><span class="mr-main"><span>+ New job</span><small>For a shift at a job that is not listed</small></span></button>`}`;
    if (form.newJobOpen) setTimeout(() => { const i = $('#f-newjob'); if (i) i.focus(); }, 30);
  }

  async function createJobInline() {
    const input = $('#f-newjob');
    const name = (input.value || '').trim();
    const err = $('#f-error');
    const rate = parseFloat($('#f-newrate').value);
    if (!name) { err.textContent = 'Type a name for the new job.'; err.hidden = false; err.dataset.kind = 'submit'; return; }
    let prof = state.profiles.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (!prof && !(rate > 0)) { err.textContent = 'Enter the pay rate per hour for the new job.'; err.hidden = false; err.dataset.kind = 'submit'; return; }
    if (!prof) {
      prof = await Store.putJobProfile({ name, rate });
      state.profiles = await Store.listJobProfiles();
      toast(`Job "${name}" added`);
    }
    form.jobId = prof.id; form.jobOpen = false; form.newJobOpen = false;
    err.hidden = true; err.dataset.kind = '';
    renderJobPick(); updateForm();
  }

  function renderRepeat() {
    const menu = $('#f-repeat-menu');
    if (!menu || !form) return;
    const r = form.repeat, date = $('#f-date').value;
    const opt = (mode, label) => `<button type="button" class="menu-row" role="menuitemradio" aria-checked="${r.mode === mode}" data-action="repeat-mode" data-mode="${mode}">
      <span>${esc(label)}</span>${r.mode === mode ? '<svg viewBox="0 0 24 24" class="check"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>`;
    menu.innerHTML = `<div class="menu-label">How often do you work this job?</div>
      ${opt('once', 'Just this day')}
      ${opt('daily', 'Every day')}
      ${opt('weekly', date ? `Every week on ${DOW_NAMES[parseKey(date).getDay()]}` : 'Every week')}
      ${opt('custom', 'Choose days of the week')}
      ${r.mode === 'custom' ? `<div class="day-chips" role="group" aria-label="Days of the week">${WEEK_ORDER.map(d =>
        `<button type="button" class="chip" data-action="repeat-day" data-day="${d}" aria-pressed="${r.days.includes(d)}" aria-label="${DOW_NAMES[d]}">${esc(DOW_SHORT[d])}</button>`).join('')}</div>` : ''}`;
    menu.hidden = !form.repeatOpen;
    $('#f-repeat-btn').setAttribute('aria-expanded', String(form.repeatOpen));
    $('#f-repeat-val').textContent = repeatLabel(r, date);
    $('#f-repeat-val').classList.toggle('on', r.mode !== 'once');
    $('#f-until-row').hidden = r.mode === 'once';
  }

  function closeForm() { $('#sheet').hidden = true; form = null; jobSheet = null; }

  function readForm() {
    const until = $('#f-until');
    if (until && form) form.repeat.until = until.value;
    const prof = form && profileById(form.jobId);
    return {
      jobId: prof ? prof.id : null,
      title: prof ? prof.name : UNTITLED,
      rate: shiftRate(prof),
      date: $('#f-date').value,
      start: $('#f-start').value,
      end: $('#f-end').value,
    };
  }

  // Editing a shift keeps its saved rate unless it moves to another job.
  function shiftRate(prof) {
    const existing = form && form.id ? state.jobs.find(j => j.id === form.id) : null;
    if (existing && existing.jobId === (prof && prof.id) && existing.rate > 0) return existing.rate;
    return prof && prof.rate ? prof.rate : null;
  }

  function clashText(v, clash) {
    return `your ${clash.title ? `"${clash.title}"` : ''} shift on ${fmtDay(clash.date)}, ${fmtTime(clash.start)} – ${fmtTime(clash.end)}`;
  }

  // Returns { problem, dates }.
  function validate(v) {
    const fail = problem => ({ problem, dates: [] });
    if (!v.date) return fail('Pick the date of the shift.');
    if (!v.start || !v.end) return fail('Enter both a start time and an end time.');
    if (v.start === v.end) return fail('Start and end time are the same. Change one of them.');
    const r = form.id ? { mode: 'once' } : form.repeat;
    if (r.mode !== 'once') {
      if (!r.until) return fail('Pick the last day this shift repeats until.');
      if (r.until < v.date) return fail('The "Until" date is before the first date. Pick a later date.');
      if (r.mode === 'custom' && !r.days.length) return fail('Pick at least one day of the week.');
    }
    const dates = occurrences(v, r);
    if (!dates.length) return fail('None of the chosen days fall between the start date and the "Until" date.');
    if (dates.length > MAX_REPEATS) return fail(`That makes more than ${MAX_REPEATS} shifts. Pick an earlier "Until" date.`);
    const clashes = [];
    for (const d of dates) {
      const c = findOverlap({ ...v, date: d }, form.id);
      if (c) clashes.push(c);
    }
    if (clashes.length) {
      if (dates.length === 1) {
        const sameDay = clashes[0].date === v.date;
        return fail(`These hours overlap with ${clashText(v, clashes[0])}. ` +
          (sameDay ? 'You can add more shifts on the same day, but not in the same working hours.' : 'Change the times so the shifts do not overlap.'));
      }
      const list = clashes.slice(0, 3).map(c => clashText(v, c)).join('; ');
      return fail(`${clashes.length} of the ${dates.length} days overlap with shifts you already have: ${list}${clashes.length > 3 ? ' and more' : ''}. Change the times or the days.`);
    }
    return { problem: null, dates };
  }

  function holidayValue(date, checked) {
    if (!form.holidayTouched) return null;
    return checked === !!holidayFor(date) ? null : checked;
  }

  function updateForm(fromUser) {
    if (!form) return;
    const v = readForm();
    const repeating = !form.id && form.repeat.mode !== 'once';
    const auto = v.date ? holidayFor(v.date) : null;
    const box = $('#f-holiday');
    if (!form.holidayTouched && !fromUser) box.checked = !!auto;
    $('#f-hol-wrap').classList.toggle('on', box.checked);
    $('#f-hol-hint').textContent = repeating && !form.holidayTouched
      ? 'Public holidays pay double automatically'
      : auto ? `${auto.name} · pay ×2` : box.checked ? 'Pay ×2' : 'Off';

    const others = v.date ? jobsOn(v.date).filter(j => j.id !== form.id) : [];
    $('#f-day-jobs').innerHTML = others.length
      ? `<span class="eyebrow">Already on ${esc(fmtDay(v.date))}</span>` + others.map(j =>
        `<div><span>${esc(j.title || 'Job')}</span><span>${esc(fmtTime(j.start))} – ${esc(fmtTime(j.end))}</span></div>`).join('')
      : '';

    const err = $('#f-error');
    if (v.date && v.start && v.end && v.start !== v.end) {
      const sp = span(v);
      const crosses = toMin(v.end) <= toMin(v.start);
      const rate = v.rate > 0 ? v.rate : ((state.profiles.find(p => p.name === UNTITLED && !v.jobId) || {}).rate || 0);
      const each = sp.mins / 60 * rate;
      const res = validate(v);
      const dates = res.dates.length ? res.dates : occurrences(v, form.id ? { mode: 'once' } : form.repeat).slice(0, MAX_REPEATS);
      let total = 0, hol = 0;
      for (const d of dates) {
        const h = holidayValue(d, box.checked);
        const on = h === null ? !!holidayFor(d) : h;
        if (on) hol++;
        total += each * (on ? 2 : 1);
      }
      if (dates.length > 1) {
        $('#f-formula').textContent = `${dates.length} shifts × ${fmtHours(sp.mins)} at ${money(rate)}/h${hol ? ` · ${hol} on holidays (×2)` : ''}`;
      } else {
        $('#f-formula').textContent = `${fmtHours(sp.mins)}${crosses ? ' (ends next day)' : ''} × ${money(rate)}/h${hol ? ' × 2 holiday' : ''}`;
      }
      $('#f-total').textContent = money(total);
      if (!rate) $('#f-formula').textContent = `${dates.length > 1 ? dates.length + ' shifts × ' : ''}${fmtHours(sp.mins)} · no pay rate yet. ${v.jobId ? 'Set one on this job in the Jobs tab.' : 'Pick a job, or set a rate for Untitled in the Jobs tab.'}`;
      const overlapProblem = res.problem && /overlap/.test(res.problem);
      if (overlapProblem) { err.textContent = res.problem; err.hidden = false; } else if (err.dataset.kind !== 'submit') err.hidden = true;
    } else {
      $('#f-formula').textContent = 'Set start and end time';
      $('#f-total').textContent = money(0);
    }
  }

  function newSeriesId() {
    return 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function saveForm() {
    const v = readForm();
    const err = $('#f-error');
    const { problem, dates } = validate(v);
    if (problem) { err.textContent = problem; err.hidden = false; err.dataset.kind = 'submit'; return; }
    if (!v.jobId) {
      // No job picked: file it under an "Untitled" job so it still shows up everywhere.
      let u = state.profiles.find(p => p.name === UNTITLED);
      if (!u) { u = await Store.putJobProfile({ name: UNTITLED, rate: null }); state.profiles = await Store.listJobProfiles(); }
      v.jobId = u.id; v.title = UNTITLED; v.rate = u.rate || null;
    }
    const checked = $('#f-holiday').checked;
    const wasEdit = !!form.id;
    let saved = [];
    if (wasEdit) {
      const prev = state.jobs.find(j => j.id === form.id);
      const h = form.holidayTouched ? (checked === !!holidayFor(v.date) ? null : checked) : prev.holiday ?? null;
      saved.push(await Store.putJob({ ...prev, ...v, holiday: h }));
    } else {
      const seriesId = dates.length > 1 ? newSeriesId() : undefined;
      for (const d of dates) {
        const job = { ...v, date: d, holiday: holidayValue(d, checked) };
        if (seriesId) { job.seriesId = seriesId; job.repeat = { mode: form.repeat.mode, days: form.repeat.days, until: form.repeat.until }; }
        saved.push(await Store.putJob(job));
      }
    }
    if (v.title !== UNTITLED) state.settings.lastJobId = v.jobId;
    await Store.saveSettings(state.settings);
    await reload();
    closeForm();
    state.histSel = v.date;
    if (v.date > state.histEnd || v.date < addDays(state.histEnd, -6)) state.histEnd = v.date;
    render();
    const sum = saved.reduce((a, j) => a + pay(j), 0);
    toast(wasEdit ? 'Shift updated' : saved.length > 1 ? `Saved ${saved.length} shifts · ${money(sum)}` : `Shift saved · ${money(sum)}`);
  }

  /* ---------- Jobs (workplaces) ---------- */

  let jobSheet = null; // { id, confirm }

  function renderJobs() {
    const list = [...state.profiles].sort((a, b) => a.name.localeCompare(b.name));
    const rows = list.map(p => {
      const sh = shiftsOf(p.id), t = totals(sh);
      return `<button class="job-row" data-action="edit-profile" data-id="${esc(p.id)}">
        <span class="jr-icon">${PROP_ICON.job}</span>
        <span class="jr-main"><span class="jr-name">${esc(p.name)}</span>
          <span class="jr-meta">${p.rate ? esc(money(p.rate)) + '/h · ' : '<span class="warn">No pay rate</span> · '}${t.count} shift${t.count === 1 ? '' : 's'} · ${fmtHours(t.mins)}</span></span>
        <span class="jr-total">${esc(money(t.total))}</span>
      </button>`;
    }).join('');
    $('#view-jobs').innerHTML = `
      <h1>Jobs</h1>
      <p class="muted" style="margin:-8px 0 0;font-size:.875rem">The places or roles you work. Each shift you log belongs to one of these jobs.</p>
      <div class="job-rows">${rows || ''}
        <button class="new-row" data-action="new-profile" style="margin-top:0"><span>+</span> New job</button>
      </div>`;
  }

  function openJobSheet({ id } = {}) {
    const p = id ? profileById(id) : null;
    jobSheet = { id: p ? p.id : null, confirm: false };
    form = null;
    const sh = p ? shiftsOf(p.id) : [], t = totals(sh);
    $('#sheet-body').innerHTML = `
      <div class="grabber"></div>
      <div class="sheet-head">
        <button type="button" class="text-btn" data-action="close-sheet">Cancel</button>
        <span id="sheet-title">${p ? 'Edit job' : 'New job'}</span>
        <button type="submit" form="profile-form" class="text-btn strong">${p ? 'Done' : 'Save'}</button>
      </div>
      <form id="profile-form" class="page-form" novalidate>
        <input type="text" class="page-title-input" id="p-name" maxlength="60" placeholder="Job name" aria-label="Job name" value="${esc(p ? p.name : '')}">
        <div class="props">
          <label class="prop" for="p-rate"><span class="prop-k">${PROP_ICON.rate}Pay rate</span>
            <span class="prop-v money"><span>${esc(state.settings.currency)}</span><input type="number" id="p-rate" inputmode="decimal" min="0" step="0.01" placeholder="Empty" value="${p && p.rate ? p.rate : ''}"><span class="unit">/ hour</span></span></label>
          ${p && sh.length ? `<label class="check" style="padding:6px 4px"><input type="checkbox" id="p-apply"> Also use this rate for the ${sh.length} shift${sh.length === 1 ? '' : 's'} already logged</label>` : ''}
          ${p ? `<div class="prop"><span class="prop-k">${PROP_ICON.start}Shifts</span><span class="prop-v">${t.count} · ${fmtHours(t.mins)}</span></div>
          <div class="prop"><span class="prop-k">${PROP_ICON.rate}Total payout</span><span class="prop-v">${esc(money(t.total))}</span></div>` : ''}
        </div>
        <p class="muted" style="margin:0;font-size:.8125rem">Every shift you add for this job is paid at this rate. If the rate changes later, shifts already logged keep the old rate unless you tick the box above.</p>
        <div class="error" id="p-error" hidden></div>
        <button type="submit" class="btn primary block">${p ? 'Save changes' : 'Save job'}</button>
        ${p ? `<button type="button" class="btn block" data-action="add-shift-for" data-id="${esc(p.id)}">Add a shift for this job</button>
        <div class="danger-rows"><button type="button" class="menu-row danger-row" data-action="delete-profile">${sh.length ? `Delete job and its ${sh.length} shift${sh.length === 1 ? '' : 's'}` : 'Delete job'}</button></div>` : ''}
      </form>`;
    $('#sheet').hidden = false;
    if (!p) setTimeout(() => $('#p-name').focus({ preventScroll: true }), 50);
  }

  async function saveJobSheet() {
    const name = $('#p-name').value.trim(), rate = parseFloat($('#p-rate').value);
    const err = $('#p-error');
    if (!name) { err.textContent = 'Give the job a name, for example the business or role.'; err.hidden = false; return; }
    if (state.profiles.some(p => p.id !== jobSheet.id && p.name.toLowerCase() === name.toLowerCase())) {
      err.textContent = `You already have a job called "${name}". Pick a different name.`; err.hidden = false; return;
    }
    const prev = jobSheet.id ? profileById(jobSheet.id) : {};
    if (!(rate > 0) && name !== UNTITLED) { err.textContent = 'Enter the pay rate per hour for this job.'; err.hidden = false; return; }
    const saved = await Store.putJobProfile({ ...prev, name, rate: rate > 0 ? rate : null });
    if (jobSheet.id && $('#p-apply') && $('#p-apply').checked) {
      for (const sh of shiftsOf(saved.id)) await Store.putJob({ ...sh, rate: saved.rate });
    }
    if (jobSheet.id && prev.name !== name) {
      for (const sh of shiftsOf(saved.id)) await Store.putJob({ ...sh, title: name });
      if (state.jobFilter === prev.name) state.jobFilter = name;
    }
    const isNew = !jobSheet.id;
    await reload(); closeForm(); render();
    toast(isNew ? `Job "${name}" added. Add shifts with the + button.` : 'Job updated');
  }

  /* ---------- Misc ---------- */

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  async function reload() {
    [state.jobs, state.profiles, state.holidays, state.settings] = await Promise.all(
      [Store.listJobs(), Store.listJobProfiles(), Store.listHolidays(), Store.getSettings()]);
    if (await linkShiftsToJobs()) [state.jobs, state.profiles] = await Promise.all([Store.listJobs(), Store.listJobProfiles()]);
  }

  // Shifts saved before jobs existed only carry a name. Create a job for each name and link them.
  async function linkShiftsToJobs() {
    let changed = false;
    const byId = new Map(state.profiles.map(p => [p.id, p]));
    const byName = new Map(state.profiles.map(p => [p.name.toLowerCase(), p]));
    const sorted = [...state.jobs].sort((a, b) => a.date.localeCompare(b.date));
    for (const sh of sorted) {
      if (sh.jobId && byId.has(sh.jobId)) continue;
      const name = (sh.title || '').trim() || UNTITLED;
      let prof = byName.get(name.toLowerCase());
      if (!prof) {
        prof = await Store.putJobProfile({ name, rate: sh.rate || null });
        byId.set(prof.id, prof); byName.set(name.toLowerCase(), prof);
      } else if (sh.rate) {
        prof = await Store.putJobProfile({ ...prof, rate: sh.rate });
        byName.set(name.toLowerCase(), prof); byId.set(prof.id, prof);
      }
      await Store.putJob({ ...sh, jobId: prof.id, title: prof.name });
      changed = true;
    }
    return changed;
  }
  const profileById = id => state.profiles.find(p => p.id === id);
  const shiftsOf = id => state.jobs.filter(j => j.jobId === id);

  const SCREEN_TITLES = { home: 'Your earnings', history: 'History', jobs: 'Jobs', settings: 'Public holidays' };
  let lastTab = null;

  function render(dir) {
    $('#top-title').textContent = state.tab === 'home' && state.jobFilter ? state.jobFilter : SCREEN_TITLES[state.tab];
    if (lastTab !== state.tab) {
      const view = $('#view-' + state.tab);
      view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
      lastTab = state.tab;
    }
    for (const v of ['home', 'history', 'jobs', 'settings']) {
      $('#view-' + v).hidden = state.tab !== v;
      const tab = $('#tab-' + v);
      if (state.tab === v) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
    }
    if (state.tab === 'home') renderHome();
    if (state.tab === 'history') renderHistory(dir);
    if (state.tab === 'jobs') renderJobs();
    if (state.tab === 'settings') renderSettings();
  }

  function setTab(tab) {
    if (tab === state.tab) { $('main').scrollTo({ top: 0, behavior: 'smooth' }); return; } // tap the active tab to jump to the top
    state.tab = tab;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* ignore */ }
    render();
    $('main').scrollTop = 0;
    $('.app').classList.remove('scrolled');
  }

  function shiftHistory(days) {
    state.histEnd = addDays(state.histEnd, days);
    state.histSel = addDays(state.histSel, days);
    render(days > 0 ? 'left' : 'right');
  }

  async function loadSample() {
    const t = todayKey();
    const samples = [
      [-1, '08:00', '12:00', 24, 'Cafe shift'], [-1, '14:00', '19:00', 28, 'Delivery'],
      [-2, '09:00', '17:00', 24, 'Cafe shift'], [-3, '18:00', '23:00', 28, 'Delivery'],
      [-5, '10:00', '16:00', 24, 'Cafe shift', true], [-6, '07:30', '13:30', 24, 'Cafe shift'],
      [-8, '22:00', '04:00', 32, 'Night stock-take'], [-10, '09:00', '15:00', 24, 'Cafe shift'],
      [-12, '12:00', '20:00', 28, 'Delivery']
    ];
    for (const [d, s, e, r, title, hol] of samples) {
      await Store.putJob({ title: 'Sample · ' + title, date: addDays(t, d), start: s, end: e, rate: r, holiday: hol ? true : null });
    }
    await reload();
    render();
    toast('Added 3 sample jobs and 9 shifts. Remove them any time from the Holidays tab.');
  }

  /* ---------- Events ---------- */

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-action]');
    const menu = $('#compose-menu');
    if (!menu.hidden && !e.target.closest('#compose-menu') && !(el && el.dataset.action === 'compose')) menu.hidden = true;
    if (!el) return;
    const a = el.dataset.action;
    if (a !== 'clear-all') disarm();
    switch (a) {
      case 'tab': setTab(el.dataset.tab); break;
      case 'add-shift': menu.hidden = true; openForm({ date: el.dataset.date || (state.tab === 'history' ? state.histSel : todayKey()) }); break;
      case 'cal-day': openForm({ date: el.dataset.date }); break;
      case 'edit-shift': openForm({ id: el.dataset.id }); break;
      case 'close-sheet': closeForm(); break;
      case 'period': state.period = el.dataset.period; state.periodOffset = 0; render(); break;
      case 'period-prev': state.periodOffset--; render(); break;
      case 'period-next': if (state.periodOffset < 0) { state.periodOffset++; render(); } break;
      case 'cal-prev': case 'cal-next': {
        const d = parseKey(state.calMonth);
        state.calMonth = keyOf(new Date(d.getFullYear(), d.getMonth() + (a === 'cal-next' ? 1 : -1), 1));
        render(); break;
      }
      case 'hist-day': state.histSel = el.dataset.date; render(); break;
      case 'hist-prev': shiftHistory(-7); break;
      case 'hist-next': shiftHistory(7); break;
      case 'hist-today': state.histEnd = todayKey(); state.histSel = state.histEnd; render(); break;
      case 'delete-shift': {
        const scope = el.dataset.scope;
        if (form.confirm !== scope) {
          form.confirm = scope;
          document.querySelectorAll('.danger-row').forEach(b => b.classList.remove('armed'));
          el.classList.add('armed');
          el.textContent = scope === 'later' ? 'Tap again to delete this and later repeats' : 'Tap again to delete';
          break;
        }
        const me = state.jobs.find(j => j.id === form.id);
        const doomed = scope === 'later' ? state.jobs.filter(j => j.seriesId === me.seriesId && j.date >= me.date) : [me];
        for (const j of doomed) await Store.deleteJob(j.id);
        await reload(); closeForm(); render(); toast(doomed.length > 1 ? `Deleted ${doomed.length} shifts` : 'Shift deleted'); break;
      }
      case 'compose': {
        const m = $('#compose-menu'); m.hidden = !m.hidden; break;
      }
      case 'new-profile': $('#compose-menu').hidden = true; openJobSheet(); break;
      case 'edit-profile': openJobSheet({ id: el.dataset.id }); break;
      case 'add-shift-for': openForm({ jobId: el.dataset.id }); break;
      case 'delete-profile': {
        if (!jobSheet.confirm) { jobSheet.confirm = true; el.classList.add('armed'); el.textContent = 'Tap again to delete'; break; }
        const id = jobSheet.id, n = shiftsOf(id).length;
        for (const sh of shiftsOf(id)) await Store.deleteJob(sh.id);
        await Store.deleteJobProfile(id);
        await reload(); closeForm(); render(); toast(n ? `Job and ${n} shift${n === 1 ? '' : 's'} deleted` : 'Job deleted'); break;
      }
      case 'toggle-jobpick': form.jobOpen = !form.jobOpen; form.newJobOpen = false; renderJobPick(); break;
      case 'pick-job': {
        form.jobId = el.dataset.id || null; form.jobOpen = false;
        const p = profileById(form.jobId);
        $('#f-error').dataset.kind = ''; renderJobPick(); updateForm(); break;
      }
      case 'new-job-inline': form.newJobOpen = true; renderJobPick(); break;
      case 'create-job-inline': await createJobInline(); break;
      case 'toggle-repeat': form.repeatOpen = !form.repeatOpen; renderRepeat(); break;
      case 'repeat-mode':
        form.repeat.mode = el.dataset.mode;
        if (el.dataset.mode !== 'custom') form.repeatOpen = false;
        renderRepeat(); $('#f-error').dataset.kind = ''; updateForm(); break;
      case 'repeat-day': {
        const d = +el.dataset.day, days = form.repeat.days;
        form.repeat.days = days.includes(d) ? days.filter(x => x !== d) : [...days, d];
        renderRepeat(); $('#f-error').dataset.kind = ''; updateForm(); break;
      }
      case 'del-holiday': await Store.deleteHoliday(el.dataset.id); await reload(); render(); toast('Holiday removed'); break;
      case 'load-sample': await loadSample(); break;
      case 'job-filter': state.jobFilter = el.dataset.name || null; render(); $('main').scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'hist-mode': state.histMode = el.dataset.mode; render(); break;
      case 'search-mode': state.search.mode = el.dataset.mode; render(); break;
      case 'search-preset': {
        const t = todayKey(), mon = mondayOf(t), d = parseKey(t);
        const ranges = {
          week: [mon, addDays(mon, 6)], lastweek: [addDays(mon, -7), addDays(mon, -1)],
          month: [firstOfMonth(t), keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0))],
          lastmonth: [keyOf(new Date(d.getFullYear(), d.getMonth() - 1, 1)), keyOf(new Date(d.getFullYear(), d.getMonth(), 0))]
        };
        [state.search.from, state.search.to] = ranges[el.dataset.preset];
        render(); break;
      }
      case 'hol-year': state.holYear += +el.dataset.step; render(); break;
      case 'hide-holiday': case 'show-holiday': {
        const set = new Set(state.settings.hiddenHolidays || []);
        if (a === 'hide-holiday') set.add(el.dataset.date); else set.delete(el.dataset.date);
        state.settings.hiddenHolidays = [...set];
        await Store.saveSettings(state.settings); render();
        toast(a === 'hide-holiday' ? 'Shifts on this date now pay the normal rate' : 'Shifts on this date now pay double'); break;
      }
      case 'clear-samples':
        for (const j of state.jobs.filter(j => (j.title || '').startsWith('Sample · '))) await Store.deleteJob(j.id);
        for (const p of state.profiles.filter(p => p.name.startsWith('Sample · '))) await Store.deleteJobProfile(p.id);
        await reload(); render(); toast('Sample data removed'); break;
      case 'export': {
        const data = await Store.exportAll();
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = `payrate-backup-${todayKey()}.json`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('Backup exported'); break;
      }
      case 'clear-all':
        if (!el.classList.contains('armed')) { el.classList.add('armed'); el.textContent = 'Tap again to delete everything'; break; }
        await Store.clearAll(); await reload(); render(); toast('All data deleted'); break;
    }
  });

  function disarm() {
    const c = $('#clear-all');
    if (c && c.classList.contains('armed')) { c.classList.remove('armed'); c.textContent = 'Delete all data'; }
  }

  document.addEventListener('input', e => {
    if (!form) return;
    if (e.target.id === 'f-holiday') { form.holidayTouched = true; updateForm(true); return; }
    if (e.target.closest('#job-form')) {
      const err = $('#f-error'); err.dataset.kind = '';
      if (e.target.id === 'f-date' && e.target.value && form.repeat.mode === 'once') {
        form.repeat.days = [parseKey(e.target.value).getDay()];
        form.repeat.until = addDays(e.target.value, 27);
        if ($('#f-until')) $('#f-until').value = form.repeat.until;
      }
      renderRepeat(); updateForm();
    }
  });

  document.addEventListener('change', async e => {
    const id = e.target.id;
    if (id === 'hist-jump' && e.target.value) {
      state.histEnd = e.target.value; state.histSel = e.target.value; render();
    } else if (id === 's-from' || id === 's-to' || id === 's-day') {
      state.search[id.slice(2)] = e.target.value; render();
    } else if (id === 'region') {
      state.settings.region = e.target.value;
      await Store.saveSettings(state.settings); render();
      toast(e.target.value === 'none' ? 'Only your own holidays count now' : 'Holidays updated for ' + window.PayHolidays.REGIONS[e.target.value]);
    } else if (id === 'currency') {
      state.settings.currency = e.target.value.trim() || '$';
      await Store.saveSettings(state.settings); toast('Currency updated');
    } else if (id === 'import-file' && e.target.files[0]) {
      try {
        const data = JSON.parse(await e.target.files[0].text());
        await Store.importAll(data); await reload(); render(); toast('Backup imported');
      } catch (err) {
        toast(err.message && err.message.includes('Payrate') ? err.message : 'That file could not be read as a Payrate backup.');
      }
      e.target.value = '';
    }
  });

  document.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'job-form') {
      if (document.activeElement && document.activeElement.id === 'f-newjob') return createJobInline();
      return saveForm();
    }
    if (e.target.id === 'profile-form') return saveJobSheet();
    if (e.target.id === 'hol-form') {
      const date = $('#hol-date').value, err = $('#hol-error');
      if (!date) { err.textContent = 'Pick the date of the holiday.'; err.hidden = false; return; }
      const yearly = $('#hol-yearly').checked;
      if (state.holidays.some(h => h.date === date || (yearly && h.yearly && h.date.slice(5) === date.slice(5)))) {
        err.textContent = 'That date is already in your holidays list.'; err.hidden = false; return;
      }
      await Store.putHoliday({ date, name: $('#hol-name').value.trim() || 'Public holiday', yearly });
      await reload(); render(); toast('Holiday added. Shifts on this date now pay double.');
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && form) closeForm(); });

  // Swipe the 7-day strip left or right to move a week.
  let touchX = null, touchY = null;
  document.addEventListener('touchstart', e => {
    if (!e.target.closest('#strip')) return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) shiftHistory(dx < 0 ? 7 : -7);
  }, { passive: true });
  // Mouse drag for desktop.
  let dragX = null;
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.target.closest('#strip')) dragX = e.clientX; });
  document.addEventListener('pointerup', e => {
    if (dragX == null) return;
    const dx = e.clientX - dragX; dragX = null;
    if (Math.abs(dx) > 60) { shiftHistory(dx < 0 ? 7 : -7); e.preventDefault(); }
  });

  const ICON = {
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  // Show a hairline under the top bar once the content scrolls, like a native app.
  // Like the Notion app: once the big page title scrolls away, its name appears small in the top bar.
  $('main').addEventListener('scroll', e => $('.app').classList.toggle('scrolled', e.target.scrollTop > 44), { passive: true });

  // Drag a sheet down by its top edge to close it.
  (function sheetDrag() {
    let y0 = null, dy = 0, sheet = null;
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('.grabber, .sheet-head') || e.target.closest('button')) return;
      sheet = $('.sheet'); y0 = e.clientY; dy = 0; sheet.style.transition = 'none';
    });
    document.addEventListener('pointermove', e => {
      if (y0 == null) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (y0 == null) return;
      sheet.style.transition = 'transform .2s ease';
      if (dy > 90) { sheet.style.transform = 'translateY(100%)'; setTimeout(() => { closeForm(); sheet.style.transform = ''; sheet.style.transition = ''; }, 180); }
      else sheet.style.transform = '';
      y0 = null;
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  })();

  /* ---------- Start ---------- */

  (async function start() {
    await reload();
    const h = (location.hash || '').slice(1);
    if (['home', 'history', 'jobs', 'settings'].includes(h)) state.tab = h;
    render();
    // Home-screen shortcut: "Add shift"
    if (new URLSearchParams(location.search).get('action') === 'add-shift') openForm({});
  })();

  // Exposed for tests in the browser console.
  window.PayrateDebug = { span, findOverlap, pay, isHoliday, state };
})();
