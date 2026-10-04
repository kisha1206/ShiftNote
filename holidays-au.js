/*
 * Australian public holidays, worked out by rule for any year so nothing has
 * to be downloaded. Covers national days plus each state's and territory's
 * statewide days. Regional days (show days, AFL Grand Final Friday, Royal
 * Hobart Regatta) are left out; people add those to their own list.
 * When a fixed holiday falls on a weekend, both the real date and the
 * weekday substitute are listed, since weekend workers are often paid for
 * the real date and weekday workers for the substitute.
 */
(function () {
  'use strict';

  const REGIONS = {
    'AU': 'Australia, national days only',
    'AU-ACT': 'Australian Capital Territory',
    'AU-NSW': 'New South Wales',
    'AU-NT': 'Northern Territory',
    'AU-QLD': 'Queensland',
    'AU-SA': 'South Australia',
    'AU-TAS': 'Tasmania',
    'AU-VIC': 'Victoria',
    'AU-WA': 'Western Australia',
    'none': 'None, I add holidays myself'
  };

  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Gregorian Easter Sunday (anonymous algorithm).
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  // nth Monday of a month (month is 0-based).
  const nthWeekday = (y, m, dow, n) => { const first = new Date(y, m, 1); return new Date(y, m, 1 + ((dow - first.getDay() + 7) % 7) + 7 * (n - 1)); };
  const nthMonday = (y, m, n) => nthWeekday(y, m, 1, n);
  const lastMonday = (y, m) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
  const mondayOnOrAfter = (y, m, day) => { const d = new Date(y, m, day); d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); return d; };
  const plus = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  const cache = {};

  function auHolidays(y, region) {
    const ck = y + '|' + region;
    if (cache[ck]) return cache[ck];
    if (!REGIONS[region] || region === 'none') return (cache[ck] = []);
    const st = region.split('-')[1] || null;
    const is = (...codes) => st && codes.includes(st);
    const list = [];
    const add = (d, name) => list.push({ date: keyOf(d), name });

    // New Year's Day and Australia Day move to Monday when on a weekend.
    for (const [m, day, name] of [[0, 1, "New Year's Day"], [0, 26, 'Australia Day']]) {
      const d = new Date(y, m, day), w = d.getDay();
      add(d, name);
      if (w === 6 || w === 0) add(plus(d, w === 6 ? 2 : 1), name + ' (substitute)');
    }

    const e = easter(y);
    add(plus(e, -2), 'Good Friday');
    if (is('NSW', 'VIC', 'QLD', 'SA', 'NT', 'ACT')) add(plus(e, -1), 'Easter Saturday');
    if (is('NSW', 'VIC', 'QLD', 'WA', 'ACT')) add(e, 'Easter Sunday');
    add(plus(e, 1), 'Easter Monday');

    const anzac = new Date(y, 3, 25), aw = anzac.getDay();
    add(anzac, 'Anzac Day');
    if ((is('WA', 'ACT') && (aw === 6 || aw === 0)) || (is('NT') && aw === 0)) add(plus(anzac, aw === 6 ? 2 : 1), 'Anzac Day (substitute)');

    // State and territory days.
    if (is('VIC')) { add(nthMonday(y, 2, 2), 'Labour Day'); add(nthWeekday(y, 10, 2, 1), 'Melbourne Cup Day'); }
    if (is('WA')) { add(nthMonday(y, 2, 1), 'Labour Day'); add(nthMonday(y, 5, 1), 'Western Australia Day'); add(lastMonday(y, 8), "King's Birthday"); }
    if (is('SA')) { add(nthMonday(y, 2, 2), 'Adelaide Cup Day'); add(nthMonday(y, 9, 1), 'Labour Day'); }
    if (is('TAS')) add(nthMonday(y, 2, 2), 'Eight Hours Day');
    if (is('ACT')) { add(nthMonday(y, 2, 2), 'Canberra Day'); add(mondayOnOrAfter(y, 4, 27), 'Reconciliation Day'); add(nthMonday(y, 9, 1), 'Labour Day'); }
    if (is('NSW')) add(nthMonday(y, 9, 1), 'Labour Day');
    if (is('QLD')) { add(nthMonday(y, 4, 1), 'Labour Day'); add(nthMonday(y, 9, 1), "King's Birthday"); }
    if (is('NT')) { add(nthMonday(y, 4, 1), 'May Day'); add(nthMonday(y, 7, 1), 'Picnic Day'); }
    if (is('NSW', 'VIC', 'SA', 'TAS', 'ACT', 'NT')) add(nthMonday(y, 5, 2), "King's Birthday");

    // Christmas and Boxing Day, with weekday substitutes.
    const boxingName = is('SA') ? 'Proclamation Day' : 'Boxing Day';
    const xmas = new Date(y, 11, 25), xw = xmas.getDay();
    add(xmas, 'Christmas Day');
    add(new Date(y, 11, 26), boxingName);
    if (xw === 6) { add(new Date(y, 11, 27), 'Christmas Day (substitute)'); add(new Date(y, 11, 28), boxingName + ' (substitute)'); }
    if (xw === 0) add(new Date(y, 11, 27), 'Christmas Day (substitute)');
    if (xw === 5) add(new Date(y, 11, 28), boxingName + ' (substitute)');

    list.sort((a, b) => a.date.localeCompare(b.date));
    return (cache[ck] = list);
  }

  window.PayHolidays = { REGIONS, forYear: auHolidays };
})();
