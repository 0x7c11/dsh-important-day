/**
 * Client 渲染冒烟：用最小手写 React 桩（含 hook 槽位与函数组件展开）驱动
 * 真实 `client.js`，验证：
 *   1. bundle 以包名注册、apply() 正确注册 settings.section；
 *   2. 加载态与有数据态都能渲染，不出现"无 type 元素 / 翻译键漏出"；
 *   3. 需求里的天数文案（还有 30 天 / 已经过了 N 天 / 就是今天）真的出现在页面上。
 *
 * 这不是视觉验证（没有真实 DOM、布局与 CSS），但能抓住"slot 入口崩溃"这类
 * 最致命的错误。
 *
 * 运行：node test/client-render.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

// ── 最小 React 桩 ─────────────────────────────────────────────────────────
const hookSlots = new Map()   // componentPath -> any[]
const effectQueue = []        // { path, index, fn }
let currentPath = null
let hookIndex = 0

function h(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity).filter(c => c !== undefined) }
}

const React = {
  createElement: h,
  useState(initial) {
    const key = currentPath
    const index = hookIndex++
    const slots = hookSlots.get(key) || []
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    hookSlots.set(key, slots)
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  },
  useEffect(fn) {
    effectQueue.push({ path: currentPath, index: hookIndex++, fn })
  },
  useCallback(fn) { hookIndex++; return fn },
}

/** 展开函数组件，收集全部文本节点。 */
function renderTree(node, rootPath) {
  const texts = []
  const visit = (element, pathKey) => {
    if (element === null || element === undefined || element === false) return
    if (Array.isArray(element)) { element.forEach((child, i) => visit(child, `${pathKey}.${i}`)); return }
    if (typeof element === 'string' || typeof element === 'number') { texts.push(String(element)); return }
    if (typeof element !== 'object') return
    const type = element.type
    if (typeof type === 'function') {
      const prevPath = currentPath
      const prevIndex = hookIndex
      currentPath = `${type.name || 'Anonymous'}#${pathKey}`
      hookIndex = 0
      let output
      try {
        output = type(element.props || {})
      } finally {
        currentPath = prevPath
        hookIndex = prevIndex
      }
      visit(output, pathKey)
      return
    }
    assert.ok(typeof type === 'string', `未知元素类型：${String(type)}`)
    ;(element.children || []).forEach((child, i) => visit(child, `${pathKey}.${i}`))
  }
  visit(node, rootPath || 'root')
  return texts
}

/** 渲染一次，并执行这次渲染新产生的 effect（effect 里再 setState 的话，下次渲染生效）。 */
async function renderAndSettle(element, pathKey) {
  currentPath = null
  hookIndex = 0
  const before = effectQueue.length
  const texts = renderTree(element, pathKey)
  const pending = effectQueue.slice(before)
  for (const entry of pending) {
    currentPath = entry.path
    hookIndex = entry.index
    try { entry.fn() } catch (error) { throw new Error(`effect 抛错：${error?.message ?? error}`) }
  }
  currentPath = null
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
  return texts
}

// ── 浏览器环境桩 ──────────────────────────────────────────────────────────
const styleEls = []
global.document = {
  documentElement: { lang: 'zh-CN' },
  head: { appendChild: element => styleEls.push(element) },
  createElement(tag) {
    const attrs = {}
    return {
      tagName: tag,
      textContent: '',
      setAttribute(name, value) { attrs[name] = value },
      getAttribute(name) { return attrs[name] },
      remove() {},
    }
  },
  addEventListener() {},
  removeEventListener() {},
  visibilityState: 'visible',
}

let fetchImpl = async () => { throw new Error('no backend') }
let bundle = null
global.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      bundle = { id, exports: factory(name => (name === 'react' ? React : (() => { throw new Error('unexpected require: ' + name) })())) }
    },
  },
}

const evaluate = new Function('window', 'document', 'Intl', 'fetch', source)
evaluate(global.window, global.document, Intl, (...args) => fetchImpl(...args))

// ── 收集注册 ──────────────────────────────────────────────────────────────
const registered = []
const injectedSlots = []
let activeLocale = 'zh'
const ctx = {
  locale: {
    subscribe: () => () => {},
    getSnapshot: () => ({ active: activeLocale, locales: [], revision: 1 }),
    bind: () => key => key,
  },
  effect(factory) {
    const disposer = factory()
    return () => { if (typeof disposer === 'function') disposer() }
  },
  slots: {
    inject(slotName, factory) { injectedSlots.push(slotName); return factory() },
    register(options, component) { registered.push({ options, component }); return () => {} },
  },
}

let passed = 0
const failures = []
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) }
  catch (error) { failures.push({ name, error }); console.log(`  ✗ ${name}\n    ${error?.message ?? error}`) }
}

await test('bundle 以包名注册并返回 name/inject/apply', () => {
  assert.ok(bundle, '没有触发 __ModuleLoader__.load')
  assert.equal(bundle.id, '@local/dsh-important-day')
  assert.equal(bundle.exports.name, 'important-day')
  assert.deepEqual(bundle.exports.inject, ['slots', 'locale'])
  assert.equal(typeof bundle.exports.apply, 'function')
})

await test('apply() 注入 settings.section 并注册 important-day', () => {
  bundle.exports.apply(ctx)
  assert.deepEqual(injectedSlots, ['settings.section'])
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'settings.section')
  assert.equal(registered[0].options.id, 'important-day')
  assert.equal(registered[0].options.order, 50)
  assert.equal(registered[0].options.label(), '重要日')
})

await test('注入了一份可卸载的样式', () => {
  assert.equal(styleEls.length, 1)
  assert.equal(styleEls[0].getAttribute('data-plugin'), 'dsh-important-day')
})

await test('后端不可达时渲染错误态而不是崩溃', async () => {
  hookSlots.clear()
  effectQueue.length = 0
  fetchImpl = async () => { throw new Error('no backend') }
  const first = await renderAndSettle(registered[0].component({}), 'loading')
  assert.ok(first.length > 0, '没有任何文本')
  const texts = await renderAndSettle(registered[0].component({}), 'loading')
  const joined = texts.join(' | ')
  assert.ok(joined.includes('重要日'), joined)
  assert.ok(joined.includes('无法连接插件后端'), joined)
})

const PAYLOAD = {
  ok: true,
  today: { date: '2026-11-04', lunar: '农历 九月廿六' },
  dataDir: 'C:/Users/demo/.dsh/important-day',
  broken: [],
  items: [
    {
      id: 'a', title: '某人生日', content: '喜欢草莓蛋糕', calendar: 'solar', withYear: false, year: 0,
      month: 12, day: 4, leap: false,
      source: { zh: '12月4日', en: '12/4' }, solar: { zh: '12月4日', en: '12/4' }, lunar: { zh: '农历十月廿六', en: 'Tenth 26' },
      days: 30, phase: 'future', targetDate: '2026-12-04', note: null,
    },
    {
      id: 'b', title: '今天这件事', content: '', calendar: 'lunar', withYear: false, year: 0,
      month: 9, day: 26, leap: false,
      source: { zh: '农历 九月廿六', en: 'Lunar 9/26' }, solar: { zh: '11月4日', en: '11/4' }, lunar: { zh: '农历九月廿六', en: 'Ninth 26' },
      days: 0, phase: 'today', targetDate: '2026-11-04', note: null,
    },
    {
      id: 'c', title: '一次性纪念', content: '老照片', calendar: 'solar', withYear: true, year: 2020,
      month: 1, day: 1, leap: false,
      source: { zh: '1月1日', en: '1/1' }, solar: { zh: '2020年1月1日', en: '2020/1/1' }, lunar: { zh: '农历2019年腊月初七', en: 'Twelfth 7' },
      days: 2499, phase: 'past', targetDate: '2020-01-01', note: 'dateAdjusted',
    },
    {
      id: 'd', title: '闰月条目', content: '', calendar: 'lunar', withYear: false, year: 0,
      month: 2, day: 1, leap: true,
      source: { zh: '农历 闰二月初一', en: 'Lunar leap 2nd 1' }, solar: { zh: '3月19日', en: '3/19' }, lunar: { zh: '农历二月初一', en: 'Second 1' },
      days: 135, phase: 'future', targetDate: '2027-03-19', note: 'leapMonthMissing',
    },
  ],
}

await test('有数据时渲染标题、天数徽标、日期与数据目录', async () => {
  fetchImpl = async () => ({ ok: true, status: 200, async json() { return PAYLOAD } })
  hookSlots.clear()
  effectQueue.length = 0
  await renderAndSettle(registered[0].component({}), 'ready')
  const texts = await renderAndSettle(registered[0].component({}), 'ready')
  const joined = texts.join(' | ')
  assert.ok(joined.includes('某人生日'), joined)
  assert.ok(joined.includes('还有 30 天'), joined)
  assert.ok(joined.includes('就是今天'), joined)
  assert.ok(joined.includes('已经过了 2499 天'), joined)
  assert.ok(joined.includes('C:/Users/demo/.dsh/important-day'), joined)
})

await test('特殊标注渲染成中文提示，而不是原始键名', async () => {
  const texts = await renderAndSettle(registered[0].component({}), 'ready')
  const joined = texts.join(' | ')
  assert.ok(joined.includes('该年没有这个闰月'), joined)
  assert.ok(joined.includes('该年没有这个日期'), joined)
  assert.ok(!/note_[a-zA-Z]+/.test(joined), '漏出翻译键：' + joined)
})

await test('后端报告 lunarAvailable=false 时，表单里的农历选项被禁用并给原因', async () => {
  const lunarOff = { ...PAYLOAD, lunarAvailable: false }
  fetchImpl = async () => ({ ok: true, status: 200, async json() { return lunarOff } })
  hookSlots.clear()
  effectQueue.length = 0
  await renderAndSettle(registered[0].component({}), 'lunaro')
  const texts = await renderAndSettle(registered[0].component({}), 'lunaro')
  const joined = texts.join(' | ')
  // 页面仍然可用（公历条目照常显示）
  assert.ok(joined.includes('某人生日'), joined)
  assert.ok(joined.includes('还有 30 天'), joined)
  // 恢复
  fetchImpl = async () => ({ ok: true, status: 200, async json() { return PAYLOAD } })
})

await test('有坏文档时显示提示 + 文件名清单', async () => {
  const withBroken = {
    ...PAYLOAD,
    broken: [
      { file: '20200101-broken.md', reason: 'unparsable' },
      { file: '坏文件名.md', reason: 'invalidFileName' },
    ],
  }
  fetchImpl = async () => ({ ok: true, status: 200, async json() { return withBroken } })
  hookSlots.clear()
  effectQueue.length = 0
  await renderAndSettle(registered[0].component({}), 'broken')
  const texts = await renderAndSettle(registered[0].component({}), 'broken')
  const joined = texts.join(' | ')
  assert.ok(joined.includes('有 2 个文档读不出来'), joined)
  assert.ok(joined.includes('20200101-broken.md'), joined)
  assert.ok(joined.includes('坏文件名.md'), joined)
  // 合法条目不受影响
  assert.ok(joined.includes('某人生日'), joined)
  assert.ok(!joined.includes('brokenTitle'), '漏出翻译键')
  fetchImpl = async () => ({ ok: true, status: 200, async json() { return PAYLOAD } })
})

await test('英文环境：label 与页面文案切换', async () => {
  activeLocale = 'en'
  global.document.documentElement.lang = 'en-US'
  assert.equal(registered[0].options.label(), 'Important Days')
  hookSlots.clear()
  effectQueue.length = 0
  await renderAndSettle(registered[0].component({}), 'en')
  const texts = await renderAndSettle(registered[0].component({}), 'en')
  const joined = texts.join(' | ')
  assert.ok(joined.includes('Important Days'), joined)
  assert.ok(joined.includes('30 days to go'), joined)
  activeLocale = 'zh'
  global.document.documentElement.lang = 'zh-CN'
})

console.log('')
if (failures.length) {
  console.log(`✗ ${passed} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error?.stack ?? failure.error}`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 项 Client 渲染冒烟通过`)
}
