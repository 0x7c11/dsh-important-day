/**
 * 农历 ↔ 公历换算（纯函数，无第三方依赖）。
 *
 * 实现方式：使用运行环境自带的 ICU（CLDR）"chinese" 日历。
 *   new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC' })
 *   → formatToParts() 得到 relatedYear（农历年）、month（"4bis" 表示闰四月）、day。
 *
 * 之所以不引第三方农历库：Node 22 的完整 ICU 已内置该日历，数据与
 * CLDR 一致且随系统更新；而常见 npm 农历库要么锁定到 2100 年，要么体积
 * 很大。这里只做一次"逐日扫描建月表"，再全部走缓存，单年扫描约 10ms。
 *
 * 全部日期以「UTC 零点毫秒数」表示一个"日历日"，避免本机时区 / 夏令时
 * 造成的跨天误差。调用方负责把"今天"换算成同一个坐标系。
 */

/** 一天的毫秒数。 */
export const DAY_MS = 86400000

/** 农历月名（正月 … 腊月）。 */
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']

const MONTH_NAMES_EN = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth',
  'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth',
]

/** 农历日名（初一 … 三十）。 */
const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十',
]

/**
 * 中文历 formatter。**懒创建**：这样跑在 small-icu 环境时，创建那一刻就能
 * 看出日历被降级成 gregorian，而不是拿着一个已建好的错误 formatter 继续算。
 * @returns {Intl.DateTimeFormat}
 */
function chineseFormatter() {
  if (cachedFormatter === undefined) {
    cachedFormatter = new Intl.DateTimeFormat('en-u-ca-chinese', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }
  return cachedFormatter
}

let cachedFormatter

/** 一个农历年的月表缓存：year -> Map<"4"/"4L", { month, leap, startMs, days }>。 */
const yearTables = new Map()

/**
 * 运行环境是否真的支持中文历。
 *
 * Node 的 small-icu 构建（把 ICU 数据裁到只剩英文）会把 `en-u-ca-chinese`
 * 静默解析成 gregorian，此时 formatToParts 给出的 month/day 是公历数字，
 * 拿去做农历计算会得出**看起来正常但完全错误**的结果。所以宁可显式失能：
 * 检测到日历不是 chinese 时，农历相关的 API 抛错，由调用方降级为"仅公历"。
 *
 * @returns {boolean}
 */
export function lunarSupported() {
  if (supportedCache !== undefined) return supportedCache
  try {
    supportedCache = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC' })
      .resolvedOptions().calendar === 'chinese'
  } catch {
    supportedCache = false
  }
  return supportedCache
}

let supportedCache

/**
 * 测试用：丢弃 formatter 与能力探测结果（模拟运行环境变化）。
 */
export function resetLunarRuntime() {
  cachedFormatter = undefined
  supportedCache = undefined
}

/**
 * 把一个 UTC 零点毫秒数拆成农历三元组。
 * @param {number} utcMs 日历日的 UTC 零点毫秒数
 * @returns {{ year: number, month: number, day: number, leap: boolean }}
 */
export function lunarParts(utcMs) {
  if (!lunarSupported()) {
    throw new Error('当前运行环境的 ICU 不含中文历（small-icu），农历换算不可用')
  }
  const parts = chineseFormatter().formatToParts(new Date(utcMs))
  let year = 0
  let month = 0
  let day = 0
  let leap = false
  for (const part of parts) {
    if (part.type === 'relatedYear' || part.type === 'year') year = Number(part.value)
    else if (part.type === 'month') {
      const raw = String(part.value)
      leap = /bis/i.test(raw)
      month = Number(raw.replace(/bis/gi, ''))
    } else if (part.type === 'day') day = Number(part.value)
  }
  if (!(year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 30)) {
    throw new Error('当前运行环境的 ICU 不含中文历（small-icu），农历换算不可用')
  }
  return { year, month, day, leap }
}

/** 农历三元组拼成月表键："4" / "4L"。 */
export function monthKey(month, leap) {
  return leap ? `${month}L` : String(month)
}

/**
 * 建（并缓存）一个农历年的月表。
 *
 * 从公历 (year-1) 年 12 月 1 日开始逐日扫描，直到农历年越过目标年。
 * 每个键记录该月的第一天与天数——这同时解决了"该月是大月还是小月"
 * 以及"该年有没有闰月"两个问题，不需要额外数据。
 *
 * @param {number} lunarYear 农历年（如 2026）
 * @returns {Map<string, { month: number, leap: boolean, startMs: number, days: number }>}
 */
export function lunarYearTable(lunarYear) {
  const cached = yearTables.get(lunarYear)
  if (cached) return cached

  const table = new Map()
  // 农历年 Y 的正月初一落在公历 Y 年的 1 月下旬到 2 月下旬之间，末日则在
  // 公历 Y+1 年的 1 月下旬到 2 月下旬之间，所以从前一年的 11 月 1 日扫到
  // 后一年的 3 月中旬一定覆盖整年（一个农历年最多 385 天）。
  const start = Date.UTC(lunarYear - 1, 10, 1)
  for (let i = 0; i < 500; i += 1) {
    const utcMs = start + i * DAY_MS
    const parts = lunarParts(utcMs)
    if (parts.year < lunarYear) continue
    if (parts.year > lunarYear) break
    const key = monthKey(parts.month, parts.leap)
    const found = table.get(key)
    if (found === undefined) {
      table.set(key, { month: parts.month, leap: parts.leap, startMs: utcMs, days: 1 })
    } else {
      found.days += 1
    }
  }
  yearTables.set(lunarYear, table)
  return table
}

/**
 * 由农历日期求公历日。
 *
 * 遇到该月只有 29 天而请求 30 日时，回落到当月最后一天并给出提示码；
 * 请求闰月而该年没有该闰月时，回落到同号平月并给出提示码——不静默改
 * 用户数据，只是展示层说明。
 *
 * @param {number} lunarYear
 * @param {number} month 1-12
 * @param {number} day 1-30
 * @param {boolean} leap 是否闰月
 * @returns {{ utcMs: number, month: number, leap: boolean, day: number, note: string|undefined } | null}
 */
export function fromLunar(lunarYear, month, day, leap) {
  const table = lunarYearTable(lunarYear)
  let entry = table.get(monthKey(month, leap === true))
  // 可能同时触发两种回落（闰月不存在 + 平月没有三十），而 note 只能带一个。
  // 优先报 leapMonthMissing：把闰月换成平月是语义上的变化，比"少一天"更重要，
  // 用户也更需要知道。
  let note
  let usedLeap = leap === true
  if (entry === undefined) {
    if (leap === true) {
      entry = table.get(monthKey(month, false))
      if (entry === undefined) return null
      note = 'leapMonthMissing'
      usedLeap = false
    } else {
      return null
    }
  }
  const usedDay = Math.min(day, entry.days)
  if (usedDay !== day && note === undefined) note = 'shortMonthAdjusted'
  return {
    utcMs: entry.startMs + (usedDay - 1) * DAY_MS,
    month: entry.month,
    leap: usedLeap,
    day: usedDay,
    note,
  }
}

/** 该农历年是否有某个月的闰月。 */
export function hasLeapMonth(lunarYear, month) {
  return lunarYearTable(lunarYear).has(monthKey(month, true))
}

/** 该农历年某月是否存在（平月或闰月）。 */
export function hasLunarMonth(lunarYear, month, leap) {
  return lunarYearTable(lunarYear).has(monthKey(month, leap === true))
}

/** 该农历年某月的天数（29 或 30）；不存在返回 0。 */
export function lunarMonthDays(lunarYear, month, leap) {
  const entry = lunarYearTable(lunarYear).get(monthKey(month, leap === true))
  return entry === undefined ? 0 : entry.days
}

/** 中文农历月名，如 "九月" / "闰四月"。 */
export function lunarMonthName(month, leap) {
  const name = `${MONTH_NAMES[month - 1] ?? String(month)}月`
  return leap ? `闰${name}` : name
}

/** 英文农历月名，如 "Ninth month" / "Leap Fourth month"。 */
export function lunarMonthNameEn(month, leap) {
  const name = `${MONTH_NAMES_EN[month - 1] ?? String(month)} month`
  return leap ? `Leap ${name}` : name
}

/** 中文农历日名，如 "初四" / "廿六"。 */
export function lunarDayName(day) {
  return DAY_NAMES[day - 1] ?? String(day)
}

/** 中文完整农历日期，如 "农历丙午年九月廿六"（不带干支则用 "农历 2026 年九月廿六"）。 */
export function lunarLabel(parts, locale = 'zh') {
  if (locale === 'en') {
    return `${lunarMonthNameEn(parts.month, parts.leap)} ${parts.day}, lunar year ${parts.year}`
  }
  return `农历 ${lunarMonthName(parts.month, parts.leap)}${lunarDayName(parts.day)}`
}

/** 中文短农历（不带年份），如 "九月廿六"。 */
export function lunarShortLabel(parts, locale = 'zh') {
  if (locale === 'en') return `${lunarMonthNameEn(parts.month, parts.leap)} ${parts.day}`
  return `${lunarMonthName(parts.month, parts.leap)}${lunarDayName(parts.day)}`
}

/** 测试用：清空月表缓存。 */
export function clearLunarCache() {
  yearTables.clear()
}
