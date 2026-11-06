/**
 * 重要日 → 天数 / 相位计算（纯函数）。
 *
 * 坐标系与 lunar.js 一致：一个"日历日"用该日 UTC 零点毫秒数表示。
 *
 * 两条规则（对应需求第 3 条）：
 *   含年份   —— 一次性日期：按绝对差显示「还有 N 天」/「就是今天」/「已经过了 N 天」。
 *   不含年份 —— 每年重复：取"下一次到来"的那一天，因此永远是「还有 N 天」或「就是今天」。
 *
 * 用户算例（今日 2026-11-04）：
 *   设 12-04 → 还有 30 天；设 01-04 → 还有 61 天（顺延到 2027-01-04）。
 */

import { DAY_MS, fromLunar, lunarParts, lunarShortLabel, lunarMonthName, lunarMonthNameEn, lunarDayName } from './lunar.js'

/** 相位。 */
export const PHASE = { FUTURE: 'future', TODAY: 'today', PAST: 'past' }

/** 两个日历日之间的整天差（b - a）。 */
export function daysBetween(aMs, bMs) {
  return Math.round((bMs - aMs) / DAY_MS)
}

/** 把年月日组成日历日的 UTC 毫秒数。 */
export function civilDay(year, month, day) {
  return Date.UTC(year, month - 1, day)
}

/**
 * 由本机当前时刻求"今天"的日历日。
 *
 * 用本机时区的年月日，再折回 UTC 零点——这样"今天"永远是使用者在墙上
 * 看到的那个日期，而不是 UTC 日期（东八区晚上 8 点以后两者会差一天）。
 *
 * @param {Date} [now]
 * @returns {{ year: number, month: number, day: number, utcMs: number }}
 */
export function todayOf(now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return { year, month, day, utcMs: Date.UTC(year, month - 1, day) }
}

/** 该公历年该月有多少天。 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 公历日期顺延到"今天或之后"。
 * 不含年份的 2 月 29 日在平年回落到 2 月 28 日，并给出提示码。
 */
function nextSolarOccurrence(month, day, today, withYear, year) {
  if (withYear) {
    const day2 = Math.min(day, daysInMonth(year, month))
    return { utcMs: civilDay(year, month, day2), note: day2 === day ? undefined : 'dateAdjusted' }
  }
  // note 描述的是**最终选中的那一次**。今年因为平年回落到 28 日、但那天已经
  // 过去、于是顺延到明年的 2 月 29 日（真实存在）时，最终结果并没有回落，
  // 绝不能沿用今年那次回落留下的 note——否则会把"该年没有这个日期"挂在
  // 一个完全正确的日期上，误导用户去改数据。
  const thisYear = clampToMonth(today.year, month, day)
  if (thisYear.utcMs >= today.utcMs) return thisYear
  return clampToMonth(today.year + 1, month, day)
}

/** 在某年某月构造候选日；note 只反映这一次构造是否发生回落。 */
function clampToMonth(year, month, day) {
  const day2 = Math.min(day, daysInMonth(year, month))
  return {
    utcMs: civilDay(year, month, day2),
    note: day2 === day ? undefined : 'dateAdjusted',
  }
}

/**
 * 农历日期顺延到"今天（农历）或之后"。
 * 不含年份时取当前农历年；若已过去则取下一农历年。
 */
function nextLunarOccurrence(month, day, leap, today, withYear, year) {
  const todayLunar = lunarParts(today.utcMs)
  if (withYear) {
    const hit = fromLunar(year, month, day, leap)
    if (hit === null) return null
    return { utcMs: hit.utcMs, note: hit.note }
  }
  // 与公历同理：只报告最终选中那一次的真实回落。前一年因为闰月不存在 /
  // 小月没有三十而回落，不代表下一年的同一个农历日期也需要回落。
  for (let offset = 0; offset <= 2; offset += 1) {
    const candidateYear = todayLunar.year + offset
    const hit = fromLunar(candidateYear, month, day, leap)
    if (hit === null) continue
    if (hit.utcMs < today.utcMs) continue
    return { utcMs: hit.utcMs, note: hit.note }
  }
  return null
}

/**
 * 计算一个条目的目标日与天数。
 *
 * @param {object} item 规范化后的条目 { calendar, withYear, year, month, day, leap }
 * @param {{ year: number, month: number, day: number, utcMs: number }} today
 * @returns {{ targetMs: number, days: number, phase: string, note: string|undefined } | null}
 */
export function resolveTarget(item, today) {
  let hit
  try {
    if (item.calendar === 'lunar') {
      hit = nextLunarOccurrence(item.month, item.day, item.leap === true, today, item.withYear, item.year)
    } else {
      hit = nextSolarOccurrence(item.month, item.day, today, item.withYear, item.year)
    }
  } catch (error) {
    // small-icu 之类"中文历不可用"的环境：不崩整页，条目降级为 invalid 并带原因。
    return { error: String(error?.message ?? error) }
  }
  if (hit === null) return null

  const diff = daysBetween(today.utcMs, hit.utcMs)
  let phase
  if (diff > 0) phase = PHASE.FUTURE
  else if (diff === 0) phase = PHASE.TODAY
  else phase = PHASE.PAST

  return { targetMs: hit.utcMs, days: Math.abs(diff), phase, note: hit.note }
}

/** 显示用的公历标签，如 "12月4日" / "2027年1月4日"。 */
export function solarLabel(targetMs, withYear, locale = 'zh') {
  const d = new Date(targetMs)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  if (locale === 'en') {
    const name = `${month}/${day}`
    return withYear ? `${year}/${name}` : name
  }
  return withYear ? `${year}年${month}月${day}日` : `${month}月${day}日`
}

/** 显示用的农历标签。 */
export function lunarLabelOf(targetMs, withYear, locale = 'zh') {
  const parts = lunarParts(targetMs)
  const body = lunarShortLabel(parts, locale)
  if (!withYear) return locale === 'en' ? body : `农历${body}`
  return locale === 'en' ? `${body}, lunar year ${parts.year}` : `农历${parts.year}年${body}`
}

/** 条目原始日期描述（不含具体落在哪一天），用于列表副标题。 */
export function sourceLabel(item, locale = 'zh') {
  if (item.calendar === 'lunar') {
    if (locale === 'en') return `Lunar ${lunarMonthNameEn(item.month, item.leap === true)} ${item.day}`
    return `农历 ${lunarMonthName(item.month, item.leap === true)}${lunarDayName(item.day)}`
  }
  return locale === 'en' ? `${item.month}/${item.day}` : `${item.month}月${item.day}日`
}

/**
 * 计算一个条目的完整展示数据。
 *
 * @param {object} item 规范化条目
 * @param {{ year: number, month: number, day: number, utcMs: number }} today
 * @param {string} locale 'zh' | 'en'
 */
export function describeItem(item, today, locale = 'zh') {
  const resolved = resolveTarget(item, today)
  if (resolved === null) {
    return { ok: false, reason: 'unresolvable' }
  }
  if (resolved.error !== undefined) {
    return { ok: false, reason: 'unavailable', detail: resolved.error }
  }
  let solar
  let lunar
  try {
    solar = solarLabel(resolved.targetMs, item.withYear === true, locale)
    lunar = lunarLabelOf(resolved.targetMs, item.withYear === true, locale)
  } catch {
    // 目标日已经确定，只是农历标签生成不出来（例如 small-icu）——公历标签仍有意义。
    solar = solarLabel(resolved.targetMs, item.withYear === true, locale)
    lunar = ''
  }
  return {
    ok: true,
    days: resolved.days,
    phase: resolved.phase,
    targetDate: new Date(resolved.targetMs).toISOString().slice(0, 10),
    solar,
    lunar,
    note: resolved.note,
  }
}
