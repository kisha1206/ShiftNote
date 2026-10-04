/*
 * Storage layer for Payrate.
 *
 * Every screen talks to window.PayStore only, never to localStorage directly.
 * To move to an online database later, write another object with the same
 * async methods (for example one that calls a REST API) and assign it to
 * window.PayStore instead of createLocalStore(). Nothing else has to change.
 *
 * Shapes:
 *   Job      { id, name, rate: number | null, createdAt }    (a workplace or role)
 *   Shift    { id, jobId, title (the job's name), date: 'YYYY-MM-DD', start: 'HH:MM',
 *              end: 'HH:MM', rate: number, holiday: true | false | null,
 *              seriesId?, repeat?, createdAt }
 *              holiday null = follow the holidays list automatically.
 *              Shifts are stored under the older "jobs" key and methods
 *              (listJobs/putJob/deleteJob) so existing data keeps working.
 *   Holiday  { id, date: 'YYYY-MM-DD', name, yearly: boolean }
 *   Settings { currency: string, lastRate: number | null,
 *              region: 'AU' | 'AU-NSW' | ... | 'none', hiddenHolidays: ['YYYY-MM-DD'] }
 */
(function () {
  'use strict';

  const KEYS = { profiles: 'payrate.jobprofiles.v1', jobs: 'payrate.jobs.v1', holidays: 'payrate.holidays.v1', settings: 'payrate.settings.v1' };
  const DEFAULT_SETTINGS = { currency: '$', lastRate: null, region: 'AU', hiddenHolidays: [] };

  function createLocalStore() {
    // In-memory copy keeps the app usable when localStorage is blocked
    // (private windows, previews). Data then lasts only for the session.
    const memory = {};

    function read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw != null) return JSON.parse(raw);
      } catch (e) { /* fall through to memory */ }
      return key in memory ? memory[key] : fallback;
    }

    function write(key, value) {
      memory[key] = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* memory only */ }
    }

    function newId() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    return {
      kind: 'local',

      async listJobs() { return read(KEYS.jobs, []); },

      async putJob(job) {
        const jobs = read(KEYS.jobs, []);
        const saved = { ...job, id: job.id || newId(), createdAt: job.createdAt || new Date().toISOString() };
        const i = jobs.findIndex(j => j.id === saved.id);
        if (i >= 0) jobs[i] = saved; else jobs.push(saved);
        write(KEYS.jobs, jobs);
        return saved;
      },

      async deleteJob(id) { write(KEYS.jobs, read(KEYS.jobs, []).filter(j => j.id !== id)); },

      async listJobProfiles() { return read(KEYS.profiles, []); },

      async putJobProfile(p) {
        const list = read(KEYS.profiles, []);
        const saved = { ...p, id: p.id || newId(), createdAt: p.createdAt || new Date().toISOString() };
        const i = list.findIndex(x => x.id === saved.id);
        if (i >= 0) list[i] = saved; else list.push(saved);
        write(KEYS.profiles, list);
        return saved;
      },

      async deleteJobProfile(id) { write(KEYS.profiles, read(KEYS.profiles, []).filter(p => p.id !== id)); },

      async listHolidays() { return read(KEYS.holidays, []); },

      async putHoliday(h) {
        const list = read(KEYS.holidays, []);
        const saved = { ...h, id: h.id || newId() };
        const i = list.findIndex(x => x.id === saved.id);
        if (i >= 0) list[i] = saved; else list.push(saved);
        write(KEYS.holidays, list);
        return saved;
      },

      async deleteHoliday(id) { write(KEYS.holidays, read(KEYS.holidays, []).filter(h => h.id !== id)); },

      async getSettings() { return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }; },

      async saveSettings(s) { write(KEYS.settings, { ...DEFAULT_SETTINGS, ...s }); },

      async exportAll() {
        return {
          app: 'payrate', version: 1, exportedAt: new Date().toISOString(),
          jobProfiles: read(KEYS.profiles, []), jobs: read(KEYS.jobs, []), holidays: read(KEYS.holidays, []), settings: read(KEYS.settings, {})
        };
      },

      async importAll(data) {
        if (!data || !Array.isArray(data.jobs) || !Array.isArray(data.holidays)) {
          throw new Error('This file is not a Payrate backup.');
        }
        write(KEYS.profiles, Array.isArray(data.jobProfiles) ? data.jobProfiles : []);
        write(KEYS.jobs, data.jobs);
        write(KEYS.holidays, data.holidays);
        write(KEYS.settings, { ...DEFAULT_SETTINGS, ...(data.settings || {}) });
      },

      async clearAll() {
        write(KEYS.profiles, []);
        write(KEYS.jobs, []);
        write(KEYS.holidays, []);
        write(KEYS.settings, { ...DEFAULT_SETTINGS });
      }
    };
  }

  window.PayStore = createLocalStore();
})();
