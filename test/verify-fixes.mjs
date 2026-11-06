/**
 * 对抗复核发现的 8 个问题的独立验证（可单独运行，输出人类可读数值）。
 * 运行：node test/verify-fixes.mjs
 */
import assert from 'node:assert/strict'
import { describeItem, todayOf } from '../lib/countdown.js'
import { fromLunar } from '../lib/lunar.js'
import { isValidId, toMarkdown, fromMarkdown, splitFrontMatter } from '../lib/store.js'

const today = (y, m, d) => todayOf(new Date(y, m - 1, d))
const solar = extra => ({ calendar: 'solar', withYear: false, year: 0, month: 1, day: 1, leap: false, ...extra })
const lunar = extra => ({ calendar: 'lunar', withYear: false, year: 0, month: 1, day: 1, leap: false, ...extra })

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`) }
  catch (e) { failures.push({ name, e }); console.log(`  ✗ ${name}\n    ${e?.message ?? e}`) }
}

console.log('\n① note 跨周期不再陈旧')
test('2027-03-01 设 02-29 → 2028-02-29，无 note', () => {
  const r = describeItem(solar({ month: 2, day: 29 }), today(2027, 3, 1))
  assert.equal(r.targetDate, '2028-02-29')
  assert.equal(r.note, undefined)
})
test('2015-06-01 设农历正月初三十 → 2016-03-08，无 note', () => {
  const r = describeItem(lunar({ month: 1, day: 30 }), today(2015, 6, 1))
  assert.equal(r.targetDate, '2016-03-08')
  assert.equal(r.note, undefined)
})
test('2016-11-01 设农历闰六月初一 → 2017-07-23，无 note', () => {
  const r = describeItem(lunar({ month: 6, day: 1, leap: true }), today(2016, 11, 1))
  assert.equal(r.targetDate, '2017-07-23')
  assert.equal(r.note, undefined)
})

console.log('\n④ 双回落优先报闰月问题')
test('2015 闰正月初三十 → leapMonthMissing（而不是 shortMonthAdjusted）', () => {
  assert.equal(fromLunar(2015, 1, 30, true).note, 'leapMonthMissing')
})

console.log('\n⑤ 正文尾随空白保留')
test('各种正文往返一致', () => {
  const base = { id: '20260101-aaaaaa', title: 't', calendar: 'solar', withYear: false, year: 0, month: 1, day: 1, leap: false, rev: 0, createdAt: 'x', updatedAt: 'y' }
  for (const content of ['', '正文', '记一笔\n\n', '\n\n开头空行']) {
    assert.equal(fromMarkdown(toMarkdown({ ...base, content }), 'x').content, content, JSON.stringify(content))
  }
})

console.log('\n⑥ Windows 保留设备名被拒')
test('CON/NUL/COM1 等不可用作 id', () => {
  for (const name of ['CON', 'NUL', 'AUX', 'PRN', 'COM1', 'LPT1', 'con']) {
    assert.equal(isValidId(name), false, name)
  }
  for (const name of ['con2026', 'console', 'com10']) assert.equal(isValidId(name), true, name)
})

console.log('\n⑧ 以 --- 开头的普通笔记不被吞')
test('正文里的 # 标题保留', () => {
  const note = ['---', '', '# 我的日记', '', '---', '', '今天很开心'].join('\n')
  const { header, body } = splitFrontMatter(note)
  assert.deepEqual(header, {})
  assert.ok(body.includes('# 我的日记'))
})

console.log('')
if (failures.length) {
  console.log(`✗ ${passed} 通过，${failures.length} 失败`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 项修复验证通过`)
}
