// Москва живёт в UTC+3 без перехода на летнее время
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export function mskParts(date = new Date()) {
  const d = new Date(date.getTime() + MSK_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(), // 0 = воскресенье
  };
}

// начало суток по Москве для даты, сдвинутой на offsetDays
export function mskDayStart(date = new Date(), offsetDays = 0) {
  const p = mskParts(date);
  return new Date(Date.UTC(p.year, p.month, p.day + offsetDays) - MSK_OFFSET_MS);
}

// дата по Москве в виде YYYY-MM-DD
export function mskYmd(date = new Date()) {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

// начало недели (понедельник) по Москве
export function mskWeekStart(date = new Date()) {
  const p = mskParts(date);
  const shift = (p.weekday + 6) % 7;
  return mskDayStart(date, -shift);
}

export function mskMonthStart(date = new Date(), offsetMonths = 0) {
  const p = mskParts(date);
  return new Date(Date.UTC(p.year, p.month + offsetMonths, 1) - MSK_OFFSET_MS);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export function fmtDay(date) {
  const p = mskParts(date);
  return `${p.day} ${MONTHS[p.month]}`;
}

export function fmtMonth(date) {
  const p = mskParts(date);
  return `${MONTHS_NOM[p.month]} ${p.year}`;
}

export function fmtTime(date) {
  const p = mskParts(date);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function fmtDayTime(date) {
  return `${fmtDay(date)}, ${fmtTime(date)}`;
}
