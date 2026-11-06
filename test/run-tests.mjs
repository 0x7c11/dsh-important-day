/**
 * 重要日 单元测试（node 原生，无依赖）。
 *
 * 运行：node test/run-tests.mjs
 *
 * 覆盖三块纯逻辑：农历换算、天数/相位计算、Markdown 文档存储。
 * 其中"今日 2026-11-04"的两条算例来自需求原文，是硬断言：
 *   12-04 → 还有 30 天；01-04 → 还有 61 天。
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  lunarParts, lunarYearTable, fromLunar, hasLeapMonth, lunarMonthDays,
  lunarLabel, lunarShortLabel, lunarMonthName, lunarDayName,
} from '../lib/lunar.js'
import {
  describeItem, todayOf, daysBetween, civilDay, daysInMonth, sourceLabel, resolveTarget,
} from '../lib/countdown.js'
import { ImportantDayStore, toMarkdown, fromMarkdown, splitFrontMatter, isValidId, newId } from '../lib/store.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    process.stdout.write(`  ✓ ${name}\n`)
  } catch (error) {
    failures.push({ name, error })
    process.stdout.write(`  ✗ ${name}\n    ${error?.message ?? error}\n`)
  }
}

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    process.stdout.write(`  ✓ ${name}\n`)
  } catch (error) {
    failures.push({ name, error })
    process.stdout.write(`  ✗ ${name}\n    ${error?.message ?? error}\n`)
  }
}

function isoOf(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10)
}

// ── 农历 ──────────────────────────────────────────────────────────────────
console.log('\n农历换算')

test('2026-11-04 是农历九月廿六', () => {
  const parts = lunarParts(Date.UTC(2026, 10, 4))
  assert.equal(parts.year, 2026)
  assert.equal(parts.month, 9)
  assert.equal(parts.day, 26)
  assert.equal(parts.leap, false)
  assert.equal(lunarShortLabel(parts), '九月廿六')
})

test('春节锚点：2026-02-17 / 2025-01-29 / 2024-02-10 都是正月初一', () => {
  for (const [y, m, d, lunarYear] of [[2026, 2, 17, 2026], [2025, 1, 29, 2025], [2024, 2, 10, 2024]]) {
    const parts = lunarParts(Date.UTC(y, m - 1, d))
    assert.equal(parts.month, 1, `${y}-${m}-${d} 应为正月`)
    assert.equal(parts.day, 1, `${y}-${m}-${d} 应为初一`)
    assert.equal(parts.year, lunarYear)
  }
})

test('每个农历年的月表都是 12 或 13 个月，合计 353-385 天', () => {
  for (let year = 2015; year <= 2035; year += 1) {
    const table = lunarYearTable(year)
    assert.ok(table.size === 12 || table.size === 13, `${year} 年月数异常：${table.size}`)
    const total = [...table.values()].reduce((sum, entry) => sum + entry.days, 0)
    assert.ok(total >= 353 && total <= 385, `${year} 年天数异常：${total}`)
    for (const entry of table.values()) {
      assert.ok(entry.days === 29 || entry.days === 30, `${year} 年某月天数异常：${entry.days}`)
    }
  }
})

test('闰月识别：2025 年闰六月，2026 年没有闰月', () => {
  assert.equal(hasLeapMonth(2025, 6), true)
  assert.equal(hasLeapMonth(2026, 6), false)
  assert.equal(lunarMonthName(6, true), '闰六月')
})

test('农历 → 公历：2026 年腊月初四 = 2027-01-11', () => {
  const hit = fromLunar(2026, 12, 4, false)
  assert.equal(isoOf(hit.utcMs), '2027-01-11')
  assert.equal(hit.note, undefined)
})

test('农历 → 公历：2023 年闰二月初一 = 2023-03-22', () => {
  const hit = fromLunar(2023, 2, 1, true)
  assert.equal(isoOf(hit.utcMs), '2023-03-22')
})

test('请求不存在的闰月时回落到同号平月并标注', () => {
  const hit = fromLunar(2026, 2, 1, true)
  assert.equal(hit.note, 'leapMonthMissing')
  assert.equal(hit.leap, false)
  assert.equal(isoOf(hit.utcMs), isoOf(fromLunar(2026, 2, 1, false).utcMs))
})

test('农历三十遇到小月回落到廿九并标注', () => {
  // 找一个只有 29 天的月份（2026 年二月是 29 天）
  assert.equal(lunarMonthDays(2026, 2, false), 29)
  const hit = fromLunar(2026, 2, 30, false)
  assert.equal(hit.note, 'shortMonthAdjusted')
  assert.equal(hit.day, 29)
})

test('2026-11-04 的农历标签带年份', () => {
  const label = lunarLabel(lunarParts(Date.UTC(2026, 10, 4)), 'zh')
  assert.equal(label, '农历 九月廿六')
  assert.equal(lunarDayName(26), '廿六')
})

// ── 天数 ──────────────────────────────────────────────────────────────────
console.log('\n天数与相位')

const TODAY = todayOf(new Date(2026, 10, 4)) // 本机时区 2026-11-04
const solarItem = extra => ({ calendar: 'solar', withYear: false, year: 0, month: 1, day: 1, leap: false, ...extra })
const lunarItem = extra => ({ calendar: 'lunar', withYear: false, year: 0, month: 1, day: 1, leap: false, ...extra })

test('今日是 2026-11-04（本机时区）', () => {
  assert.equal(TODAY.year, 2026)
  assert.equal(TODAY.month, 11)
  assert.equal(TODAY.day, 4)
  assert.equal(isoOf(TODAY.utcMs), '2026-11-04')
})

test('需求算例①：设 12 月 4 日 → 还有 30 天', () => {
  const result = describeItem(solarItem({ month: 12, day: 4 }), TODAY)
  assert.equal(result.ok, true)
  assert.equal(result.phase, 'future')
  assert.equal(result.days, 30)
  assert.equal(result.targetDate, '2026-12-04')
})

test('需求算例②：设 1 月 4 日 → 还有 61 天', () => {
  const result = describeItem(solarItem({ month: 1, day: 4 }), TODAY)
  assert.equal(result.ok, true)
  assert.equal(result.phase, 'future')
  assert.equal(result.days, 61)
  assert.equal(result.targetDate, '2027-01-04')
})

test('不含年份且就是今天 → today，天数 0', () => {
  const result = describeItem(solarItem({ month: 11, day: 4 }), TODAY)
  assert.equal(result.phase, 'today')
  assert.equal(result.days, 0)
})

test('含年份且已过去 → past + 已过天数', () => {
  const result = describeItem(solarItem({ month: 10, day: 1, withYear: true, year: 2026 }), TODAY)
  assert.equal(result.phase, 'past')
  assert.equal(result.days, 34)
  assert.equal(result.targetDate, '2026-10-01')
})

test('含年份且在未来 → future + 剩余天数', () => {
  const result = describeItem(solarItem({ month: 1, day: 1, withYear: true, year: 2030 }), TODAY)
  assert.equal(result.phase, 'future')
  assert.equal(result.days, daysBetween(TODAY.utcMs, Date.UTC(2030, 0, 1)))
})

test('跨闰年：2028-02-29 存在', () => {
  const result = describeItem(solarItem({ month: 2, day: 29, withYear: true, year: 2028 }), TODAY)
  assert.equal(result.targetDate, '2028-02-29')
})

test('不含年份的 2 月 29 日在平年回落到 2 月 28 日并标注', () => {
  const result = describeItem(solarItem({ month: 2, day: 29 }), TODAY)
  assert.equal(result.note, 'dateAdjusted')
  assert.ok(result.targetDate.endsWith('-02-28'), result.targetDate)
})

test('农历不含年份：2026 年腊月初四 = 2027-01-11，从今天算 68 天', () => {
  const result = describeItem(lunarItem({ month: 12, day: 4 }), TODAY)
  assert.equal(result.phase, 'future')
  assert.equal(result.targetDate, '2027-01-11')
  assert.equal(result.days, daysBetween(TODAY.utcMs, Date.UTC(2027, 0, 11)))
})

test('农历不含年份且就是今天 → today', () => {
  const result = describeItem(lunarItem({ month: 9, day: 26 }), TODAY)
  assert.equal(result.phase, 'today')
  assert.equal(result.days, 0)
})

test('农历含年份：2027 年腊月初四 = 2027-12-31', () => {
  const result = describeItem(lunarItem({ month: 12, day: 4, withYear: true, year: 2027 }), TODAY)
  assert.equal(result.targetDate, '2027-12-31')
  assert.equal(result.phase, 'future')
})

test('note 只描述最终选中的那一次（跨周期不沿用上一年的回落）', () => {
  // ① 今天 2027-03-01，设 2 月 29 日：今年平年没有，但明年 2028 是闰年、真实存在
  const a = describeItem(solarItem({ month: 2, day: 29 }), todayOf(new Date(2027, 2, 1)))
  assert.equal(a.targetDate, '2028-02-29')
  assert.equal(a.note, undefined, '目标日真实存在时不该报 dateAdjusted')

  // ② 今天 2015-06-01，设农历正月初三十：2016 正月有 30 天
  const b = describeItem(lunarItem({ month: 1, day: 30 }), todayOf(new Date(2015, 5, 1)))
  assert.equal(b.targetDate, '2016-03-08')
  assert.equal(b.note, undefined, '目标月有三十时不该报 shortMonthAdjusted')

  // ③ 今天 2016-11-01，设农历闰六月初一：2017 有闰六月
  const c = describeItem(lunarItem({ month: 6, day: 1, leap: true }), todayOf(new Date(2016, 10, 1)))
  assert.equal(c.targetDate, '2017-07-23')
  assert.equal(c.note, undefined, '目标年有闰月时不该报 leapMonthMissing')

  // ④ 但真正回落的仍要报：2027 年正月只有 29 天，设三十就是真回落
  const d = describeItem(lunarItem({ month: 1, day: 30, withYear: true, year: 2027 }), TODAY)
  assert.equal(d.note, 'shortMonthAdjusted')
  assert.equal(lunarDayName(29), '廿九')
})

test('daysInMonth 正确', () => {
  assert.equal(daysInMonth(2026, 2), 28)
  assert.equal(daysInMonth(2028, 2), 29)
  assert.equal(daysInMonth(2026, 4), 30)
  assert.equal(daysInMonth(2026, 12), 31)
})

test('sourceLabel 生成日期描述', () => {
  assert.equal(sourceLabel(solarItem({ month: 12, day: 4 }), 'zh'), '12月4日')
  assert.equal(sourceLabel(lunarItem({ month: 12, day: 4 }), 'zh'), '农历 腊月初四')
  assert.equal(sourceLabel(lunarItem({ month: 6, day: 1, leap: true }), 'zh'), '农历 闰六月初一')
})

// ── 文档存储 ──────────────────────────────────────────────────────────────
console.log('\nMarkdown 文档存储')

const sample = {
  id: '20261104-abc123',
  title: '某人生日',
  content: '第一行\n第二行\n\n---\n分隔线之后的正文',
  calendar: 'lunar',
  withYear: false,
  year: 0,
  month: 12,
  day: 4,
  leap: false,
  createdAt: '2026-11-04T10:30:00+08:00',
  updatedAt: '2026-11-04T10:30:00+08:00',
}

test('toMarkdown / fromMarkdown 往返一致（含正文里的分隔线）', () => {
  const markdown = toMarkdown(sample)
  const back = fromMarkdown(markdown, 'x')
  assert.equal(back.id, sample.id)
  assert.equal(back.title, sample.title)
  assert.equal(back.content, sample.content)
  assert.equal(back.calendar, 'lunar')
  assert.equal(back.withYear, false)
  assert.equal(back.month, 12)
  assert.equal(back.day, 4)
})

test('标题里的引号、冒号、井号不会破坏头部', () => {
  const tricky = { ...sample, title: '他说："你好" #1: 生日' }
  const back = fromMarkdown(toMarkdown(tricky), 'x')
  assert.equal(back.title, tricky.title)
})

test('纯数字标题读回来仍是字符串，不会被当成数字', () => {
  const numeric = { ...sample, title: '2026', content: '正文' }
  const back = fromMarkdown(toMarkdown(numeric), 'x')
  assert.equal(back.title, '2026')
  assert.equal(typeof back.title, 'string')
})

test('时间戳字段带引号写出且能原样读回', () => {
  const markdown = toMarkdown(sample)
  assert.ok(markdown.includes('createdAt: "2026-11-04T10:30:00+08:00"'), markdown.slice(0, 400))
  const back = fromMarkdown(markdown, 'x')
  assert.equal(back.createdAt, '2026-11-04T10:30:00+08:00')
})

test('空正文往返仍然是空字符串', () => {
  const back = fromMarkdown(toMarkdown({ ...sample, content: '' }), 'x')
  assert.equal(back.content, '')
})

test('没有头部的文档按正文处理，缺字段则整条判为无效', () => {
  const { header, body } = splitFrontMatter('# 只有正文\n第二行')
  assert.deepEqual(header, {})
  assert.equal(body, '# 只有正文\n第二行')
  assert.equal(fromMarkdown('# 只有正文', 'fallback-id'), null)
})

test('手改文档里的越界数值被丢弃，而不是静默算出另一个日期', () => {
  const tmpl = (month, day, calendar = 'solar') => [
    '---',
    'id: 20260101-aaaaaa',
    'title: "t"',
    `calendar: ${calendar}`,
    'withYear: false',
    'year: 0',
    `month: ${month}`,
    `day: ${day}`,
    'leap: false',
    '---',
    '',
    'body',
    '',
  ].join('\n')

  // 这几条过去会被 Date.UTC 归一化成"看起来正常但错误"的日期：
  assert.equal(fromMarkdown(tmpl(13, 4), '20260101-aaaaaa'), null, 'month 13 必须被丢弃')
  assert.equal(fromMarkdown(tmpl(0, 4), '20260101-aaaaaa'), null, 'month 0 必须被丢弃')
  assert.equal(fromMarkdown(tmpl('', 4), '20260101-aaaaaa'), null, '空 month 必须被丢弃')
  assert.equal(fromMarkdown(tmpl(1, 0), '20260101-aaaaaa'), null, 'day 0 必须被丢弃')
  assert.equal(fromMarkdown(tmpl(1, 32), '20260101-aaaaaa'), null, 'day 32 必须被丢弃')
  assert.equal(fromMarkdown(tmpl(1, 99), '20260101-aaaaaa'), null, 'day 99 必须被丢弃')
  assert.equal(fromMarkdown(tmpl(13, 4, 'lunar'), '20260101-aaaaaa'), null, '农历 month 13 必须被丢弃')

  // 边界内的值照常工作：
  const ok = fromMarkdown(tmpl(12, 31), '20260101-aaaaaa')
  assert.equal(ok.month, 12)
  assert.equal(ok.day, 31)
  const lunarOk = fromMarkdown(tmpl(12, 30, 'lunar'), '20260101-aaaaaa')
  assert.equal(lunarOk.month, 12)
  assert.equal(lunarOk.day, 30)
})

test('头部 id 非法时回落到文件名，而不是整条丢弃', () => {
  const text = [
    '---',
    'id: ../../evil',
    'title: "还能看见我"',
    'calendar: solar',
    'withYear: false',
    'year: 0',
    'month: 12',
    'day: 4',
    'leap: false',
    '---',
    '',
    'body',
    '',
  ].join('\n')

  const item = fromMarkdown(text, '20260101-goodid')
  assert.notEqual(item, null, '头部 id 坏掉不该让整条消失')
  assert.equal(item.id, '20260101-goodid')
  assert.equal(item.title, '还能看见我')
})

test('withYear 为 true 但年份越界 → 整条丢弃', () => {
  const text = [
    '---',
    'id: 20260101-aaaaaa',
    'title: "t"',
    'calendar: solar',
    'withYear: true',
    'year: 3000',
    'month: 1',
    'day: 1',
    'leap: false',
    '---',
    '',
  ].join('\n')

  assert.equal(fromMarkdown(text, '20260101-aaaaaa'), null)
})

test('Windows 保留设备名不能当 id', () => {
  for (const name of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9']) {
    assert.equal(isValidId(name), false, `${name} 应被拒绝`)
  }
  // 不冲突的名字照常可用
  for (const name of ['con2026', 'console', 'null-1', 'com10', 'important-day']) {
    assert.equal(isValidId(name), true, `${name} 应可用`)
  }
})

test('正文尾随空行在"读出→再保存"后不丢失', () => {
  for (const content of ['', '正文', '记一笔\n\n', '\n\n开头就是空行', '中间\n\n有空行']) {
    const back = fromMarkdown(toMarkdown({ ...sample, content }), 'x')
    assert.equal(back.content, content, JSON.stringify(content))
  }
})

test('以 --- 开头的普通 Markdown 笔记不会被当成 front matter 吃掉', () => {
  const note = ['---', '', '# 我的日记', '', '---', '', '今天很开心'].join('\n')
  const { header, body } = splitFrontMatter(note)
  assert.deepEqual(header, {})
  assert.ok(body.includes('# 我的日记'), '正文被吃掉了：' + body)
  // 真正的 front matter 仍然解析
  const real = ['---', 'id: 20260101-aaaaaa', 'month: 1', 'day: 1', '---', '', '正文'].join('\n')
  assert.equal(splitFrontMatter(real).header.month, 1)
})

test('id 白名单挡住路径穿越', () => {
  assert.equal(isValidId('20261104-abc123'), true)
  assert.equal(isValidId('../../etc/passwd'), false)
  assert.equal(isValidId('a/b'), false)
  assert.equal(isValidId(''), false)
})

test('newId 形如 yyyymmdd-xxxxxx', () => {
  const id = newId(new Date(2026, 10, 4))
  assert.match(id, /^20261104-[a-z0-9]{6}$/)
})

await (async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-important-day-test-'))
  const store = new ImportantDayStore(dir, { log: () => {} })
  try {
    await testAsync('save → list → read → remove 全链路', async () => {
      await store.save(sample)
      const listed = await store.list()
      assert.equal(listed.length, 1)
      assert.equal(listed[0].title, sample.title)
      const read = await store.read(sample.id)
      assert.equal(read.content, sample.content)
      const file = path.join(dir, `${sample.id}.md`)
      const text = await fsp.readFile(file, 'utf8')
      assert.ok(text.startsWith('---\n'), '文档应以 front matter 开头')
      const removed = await store.remove(sample.id)
      assert.equal(removed, true)
      assert.deepEqual(await store.list(), [])
    })

    await testAsync('坏文档被跳过，不影响其他条目', async () => {
      await store.save({ ...sample, id: '20260101-good01', title: '好的' })
      await fsp.writeFile(path.join(dir, 'broken.md'), '这不是合法的 front matter\n', 'utf8')
      await fsp.writeFile(path.join(dir, 'ignore.txt'), 'x', 'utf8')
      const listed = await store.list()
      assert.equal(listed.length, 1)
      assert.equal(listed[0].title, '好的')
    })

    await testAsync('外部手改文档后 list 立刻看到', async () => {
      const file = path.join(dir, '20260101-good01.md')
      const text = await fsp.readFile(file, 'utf8')
      await fsp.writeFile(file, text.replace('title: "好的"', 'title: "改过的"'), 'utf8')
      const listed = await store.list()
      assert.equal(listed[0].title, '改过的')
    })

    await testAsync('非法 id 写入被拒绝', async () => {
      await assert.rejects(() => store.save({ ...sample, id: '../escape' }), /非法/)
    })

    await testAsync('列表按今天→未来→过去排序（由 index 层负责，这里只验数据）', async () => {
      await store.remove('20260101-good01')
      await fsp.rm(path.join(dir, 'broken.md'), { force: true })
      await fsp.rm(path.join(dir, 'ignore.txt'), { force: true })
      await store.save({ ...sample, id: '20260101-a1b2c3', title: 'A' })
      await store.save({ ...sample, id: '20260101-d4e5f6', title: 'B' })
      const listed = await store.list()
      assert.equal(listed.length, 2)
    })
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
})()

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('')
if (failures.length > 0) {
  console.log(`✗ ${passed} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error?.stack ?? failure.error}`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 项测试通过`)
}
