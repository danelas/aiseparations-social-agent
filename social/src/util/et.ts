// ET → UTC helper. US Eastern observes DST: EDT (UTC-4) Mar 2nd Sun → Nov 1st Sun; else EST (UTC-5).

function nthSundayOfMonth(year: number, month0: number, n: number): number {
  const first = new Date(Date.UTC(year, month0, 1));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return firstSunday + (n - 1) * 7;
}

export function isEDT(d: Date): boolean {
  const y = d.getUTCFullYear();
  const dstStart = Date.UTC(y, 2, nthSundayOfMonth(y, 2, 2), 7, 0, 0);
  const dstEnd = Date.UTC(y, 10, nthSundayOfMonth(y, 10, 1), 6, 0, 0);
  const t = d.getTime();
  return t >= dstStart && t < dstEnd;
}

export function etHourToUtc(etHour: number, etMinute = 0, ref: Date = new Date()): Date {
  const offset = isEDT(ref) ? 4 : 5;
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const d = ref.getUTCDate();
  const utc = new Date(Date.UTC(y, m, d, etHour + offset, etMinute, 0));
  // if target UTC already passed (we're running after that ET hour today), roll to tomorrow
  if (utc.getTime() <= ref.getTime()) {
    utc.setUTCDate(utc.getUTCDate() + 1);
  }
  return utc;
}
