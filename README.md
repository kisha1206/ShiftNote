# Payrate Calculator (offline PWA)

Plain HTML, CSS and JavaScript. No build step, no login, no network calls for data.

## Run it
Serve this folder over HTTP(S) so the service worker can install, for example:

    cd payrate-pwa && python3 -m http.server 8080

Open http://localhost:8080 on your phone or computer and use "Install app" / "Add to Home Screen".
After the first load it works with no connection. Any static host (GitHub Pages, Netlify) also works.

## Files
- index.html: app shell
- styles.css: look and feel, light and dark
- app.js: screens (Home analytics + calendar, History 7-day strip, Holidays + settings) and pay rules
- storage.js: the only place data is read or written (localStorage today)
- holidays-au.js: Australian public holidays worked out by rule for any year, national or per state/territory
- sw.js: offline cache. Bump VERSION in sw.js after changing any file.
- manifest.webmanifest, icons/: install info

## Jobs and shifts
A job is a place or role (name + pay rate), managed in the Jobs tab. The pay rate is only entered on the job; shifts take it from their job. A shift saved with no job goes under an "Untitled" job, which pays $0 until you give Untitled a rate. Changing a job's rate applies to new shifts; tick "Also use this rate for the shifts already logged" to update past ones. A shift is one block of hours at a job. The pencil button at the top opens Add shift / Add job. In the shift form, the Job dropdown lists saved jobs, an Untitled option, and "+ New job" (name and rate) for a shift at a job that isn't listed yet. Renaming a job renames its shifts. Shifts saved before jobs existed are linked to jobs automatically by name.

## Pay rules
- Pay = hours × rate, doubled when the job is a public holiday.
- Public holidays: pick a state in the Holidays tab (default is national days only). Any listed day can be switched off with "Don't count", and you can add your own (one-off or yearly). Regional days such as show days are not included.
- A job is a holiday when its date is a counted public holiday, or when the toggle on the job is switched on. The toggle can also switch a holiday off for one job.
- An end time at or before the start time means the shift ends the next day.
- Jobs can't overlap in time, including overnight shifts that run into the next day.

## Repeating jobs
When adding a job, Repeat can be Just this day, Every day, Every week, or chosen days of the week, up to an Until date (max 366 jobs). Each day is saved as its own job sharing a seriesId, so analytics and history need nothing special. If any day overlaps an existing job, nothing is saved and the clashing days are listed. A repeating job can be deleted one day at a time or from that day onwards.

## Search
History has a "Search dates" view: pick a start and end date (or a quick preset), or a single date, to see payout, hours and jobs for that period.

## Moving to an online database later
Write a new object with the same async methods as `createLocalStore()` in storage.js
(listJobs, putJob, deleteJob, listHolidays, putHoliday, deleteHoliday, getSettings,
saveSettings, exportAll, importAll, clearAll) and assign it to `window.PayStore`.
The screens don't need changes. Export a backup from the app first to migrate existing data.

## Layout on every device

The layout uses the Bootstrap 5.3 grid and utilities (bundled in `vendor/`, so it still works offline), styled to look like the Notion app.

- Phones (iPhone, Android): one column, icon-only tab bar, sheets slide up from the bottom.
- Tablets and iPad portrait (768px and up): two columns, labelled tabs, sheets open in the centre.
- iPad landscape and larger (992px and up): wider content area, tabs show icon and label side by side.
