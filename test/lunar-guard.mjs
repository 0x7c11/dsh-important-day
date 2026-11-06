/**
 * 中文历不可用（small-icu）时的降级测试：用"狸猫换太子"的方式替换全局
 * Intl.DateTimeFormat，模拟 small-icu 把 chinese 静默解析成 gregorian，
 * 验证插件不会给出错误日期，而是明确报错/降级。
 *
 * 运行：node test/lunar-guard.mjs
 */
import assert from 'node:assert/strict'

const Real = Intl.DateTimeFormat
let mode = 'real'

class FakeDateTimeFormat extends Real {
  constructor(locale, options) {
    super(locale, options)
    this.__fake = mode === 'gregorian'
  }
  resolvedOptions() {
    const real = super.resolvedOptions()
    if (!this.__fake) return real
    return { ...real, calendar: 'gregorian' }
  }
  formatToParts(date) {
    if (!this.__fake) return super.formatToParts(date)
    // small-icu 的表现：把 chinese 当成 gregorian
    return new Real('en-CA', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' }).formatToParts(date)
  }
}
Intl.DateTimeFormat = FakeDateTimeFormat

const lunar = await import('../lib/lunar.js')
const { describeItem, todayOf } = await import('../lib/countdown.js')

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`) }
  catch (error) { failures.push({ name, error }); console.log(`  ✗ ${name}\n    ${error?.message ?? error}`) }
}

test('真实 ICU：lunarSupported() 为 true', () => {
  mode = 'real'
  assert.equal(lunar.lunarSupported(), true)
})

test('模拟 small-icu：lunarSupported() 为 false', () => {
  mode = 'gregorian'
  lunar.resetLunarRuntime()
  assert.equal(lunar.lunarSupported(), false)
  mode = 'real'
  lunar.resetLunarRuntime()
})

test('模拟 small-icu：lunarParts 抛错而不是返回公历数字', () => {
  mode = 'gregorian'
  lunar.resetLunarRuntime()
  assert.throws(() => lunar.lunarParts(Date.UTC(2026, 10, 4)), /中文历|ICU/)
  mode = 'real'
  lunar.resetLunarRuntime()
})

test('模拟 small-icu：农历条目降级为 unavailable，不给出错误天数', () => {
  mode = 'gregorian'
  lunar.resetLunarRuntime()
  const today = todayOf(new Date(2026, 10, 4))
  const result = describeItem({ calendar: 'lunar', withYear: false, year: 0, month: 12, day: 4, leap: false }, today)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unavailable')
  mode = 'real'
  lunar.resetLunarRuntime()
})

test('模拟 small-icu：公历条目完全不受影响', () => {
  mode = 'gregorian'
  const today = todayOf(new Date(2026, 10, 4))
  const result = describeItem({ calendar: 'solar', withYear: false, year: 0, month: 12, day: 4, leap: false }, today)
  assert.equal(result.ok, true)
  assert.equal(result.days, 30)
  mode = 'real'
})

test('恢复正常后一切如常（缓存不残留错误结果）', () => {
  mode = 'real'
  lunar.clearLunarCache()
  lunar.resetLunarRuntime()
  assert.equal(lunar.lunarSupported(), true)
  const today = todayOf(new Date(2026, 10, 4))
  const result = describeItem({ calendar: 'lunar', withYear: false, year: 0, month: 12, day: 4, leap: false }, today)
  assert.equal(result.ok, true)
  assert.equal(result.targetDate, '2027-01-11')
})

console.log('')
if (failures.length) { console.log(`✗ ${passed} 通过，${failures.length} 失败`); process.exitCode = 1 }
else console.log(`✓ 全部 ${passed} 项中文历降级测试通过`)
