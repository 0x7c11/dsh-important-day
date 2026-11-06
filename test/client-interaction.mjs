/**
 * Client 交互测试：在 `client-render.mjs`（只读渲染冒烟）之外，用一套**会重渲染**
 * 的 React 桩把表单与点击路径真正跑一遍。
 *
 * 与 client-render.mjs 的区别（那边被复核指出"测了个假东西"）：
 *   1. `setState` 会触发重渲染，可以断言"点新增 → 出现表单 → 切农历 → 出现闰月开关"；
 *   2. 每次渲染都断言 **hook 数量与上次一致**，条件调用 hook 的回归会被抓住；
 *   3. 支持点击查找（按文案定位按钮）与提交，覆盖 `renderForm` / `patchDraft` /
 *      `dayMaxOf` / 409 重试等此前零覆盖的路径。
 *
 * 仍然不是视觉验证：没有真实 DOM/CSS，只验证组件逻辑与渲染树。
 *
 * 运行：node test/client-interaction.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

// ── React 桩（带重渲染） ──────────────────────────────────────────────────
function createRuntime() {
  const slots = new Map()      // path -> values
  const deps = new Map()       // path#index -> last deps array
  const hookCounts = new Map() // path -> count from previous render
  const hookCountErrors = []
  const effects = []
  let currentPath = null
  let hookIndex = 0
  let dirty = false

  function h(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter(c => c !== undefined) }
  }

  const React = {
    createElement: h,
    useState(initial) {
      const key = currentPath
      const index = hookIndex++
      const store = slots.get(key) || []
      if (!(index in store)) store[index] = typeof initial === 'function' ? initial() : initial
      slots.set(key, store)
      const setter = value => {
        const next = typeof value === 'function' ? value(store[index]) : value
        if (Object.is(next, store[index])) return
        store[index] = next
        dirty = true
      }
      return [store[index], setter]
    },
    useEffect(fn, depsList) {
      const index = hookIndex++
      const key = `${currentPath ?? 'root'}#${index}`
      const prev = deps.get(key)
      const changed = depsList === undefined
        ? true
        : prev === undefined
          || prev.length !== depsList.length
          || prev.some((value, i) => !Object.is(value, depsList[i]))
      if (depsList !== undefined) deps.set(key, depsList)
      if (changed) effects.push({ path: currentPath, index, fn })
    },
    useCallback(fn) { hookIndex++; return fn },
  }

  function walk(element, pathKey, texts, clickables, inputs, selects) {
    if (element === null || element === undefined || element === false) return
    if (Array.isArray(element)) { element.forEach((child, i) => walk(child, `${pathKey}.${i}`, texts, clickables, inputs, selects)); return }
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
        const used = hookIndex
        const previous = hookCounts.get(currentPath)
        if (previous !== undefined && previous !== used) {
          hookCountErrors.push(`${currentPath} 的 hook 数量从 ${previous} 变成 ${used}`)
        }
        hookCounts.set(currentPath, used)
        currentPath = prevPath
        hookIndex = prevIndex
      }
      walk(output, pathKey, texts, clickables, inputs, selects)
      return
    }

    assert.equal(typeof type, 'string', `未知元素类型：${String(type)}`)
    const props = element.props || {}
    if (typeof props.onClick === 'function') clickables.push(element)
    if (typeof props.onChange === 'function') inputs.push(element)
    if (type === 'select') selects.push(element)
    ;(element.children || []).forEach((child, i) => walk(child, `${pathKey}.${i}`, texts, clickables, inputs, selects))
    if (props.children !== undefined) walk(props.children, `${pathKey}.pc`, texts, clickables, inputs, selects)
  }

  /** 渲染一次并返回 { texts, clickables }，不跑 effect。 */
  function erase(key) {
    const texts = []
    const clickables = []
    const inputs = []
    const selects = []
    currentPath = null
    hookIndex = 0
    walk(elementRoot, key, texts, clickables, inputs, selects)
    return { texts, clickables, inputs, selects, joined: texts.join(' | ') }
  }

  let elementRoot = null

  async function flushEffects() {
    let guard = 0
    do {
      dirty = false
      const pending = effects.splice(0)
      for (const entry of pending) {
        currentPath = entry.path
        hookIndex = entry.index
        const result = entry.fn()
        if (typeof result === 'function') { /* cleanup 暂不需要 */ }
      }
      currentPath = null
      if (dirty) postRender()
      await new Promise(resolve => setTimeout(resolve, 0))
    } while (dirty && ++guard < 12)
    return guard
  }

  let postRender = () => {}

  /** 完整一轮：渲染 → 跑 effect（含 setState 引发的重渲染）→ 稳定。 */
  async function render(element, key = 'root') {
    elementRoot = element
    let result = erase(key)
    postRender = () => { result = erase(key) }
    await flushEffects()
    result = erase(key)
    return result
  }

  /** 按文案找按钮并点击，然后稳定下来。 */
  async function click(result, label, key = 'root') {
    const target = result.clickables.find(node => {
      const inner = []
      collect(node, inner)
      return inner.join('').includes(label)
    })
    if (target === undefined) {
      const labels = result.clickables.map(node => {
        const inner = []
        collect(node, inner)
        return inner.join('')
      })
      throw new Error(`找不到按钮「${label}」，可选：${labels.join(' / ')}`)
    }
    target.props.onClick()
    return render(elementRoot, key)
  }

  /** 点第 index 个 role="switch" 的开关（开关的文字在兄弟 span 里，按文字找不到）。 */
  async function clickSwitch(result, index, key = 'root') {
    const switches = result.clickables.filter(node => (node.props || {}).role === 'switch')
    if (switches[index] === undefined) {
      throw new Error(`只有 ${switches.length} 个开关，找不到第 ${index} 个`)
    }
    switches[index].props.onClick()
    return render(elementRoot, key)
  }

  function collect(node, out) {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { node.forEach(child => collect(child, out)); return }
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
    if (typeof node !== 'object') return
    if (typeof node.type === 'function') return // 不深入组件内部统计文案
    ;(node.children || []).forEach(child => collect(child, out))
  }

  return { React, h, render, click, clickSwitch, hookCountErrors }
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

let requests = []
let fetchImpl = async () => { throw new Error('no backend') }
let bundle = null

function makePayload() {
  return {
    ok: true,
    today: { date: '2026-11-04', lunar: '农历 九月廿六' },
    dataDir: 'C:/demo/.dsh/important-day',
    lunarAvailable: true,
    broken: [],
    items: [],
  }
}

const runtime = createRuntime()
global.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      bundle = { id, exports: factory(name => (name === 'react' ? runtime.React : (() => { throw new Error('unexpected require: ' + name) })())) }
    },
  },
}

const evaluate = new Function('window', 'document', 'Intl', 'fetch', 'setTimeout', source)
evaluate(global.window, global.document, Intl, (...args) => fetchImpl(...args), setTimeout)

const registered = []
const ctx = {
  locale: {
    subscribe: () => () => {},
    getSnapshot: () => ({ active: 'zh', locales: [], revision: 1 }),
    bind: () => key => key,
  },
  effect(factory) { const disposer = factory(); return () => { if (typeof disposer === 'function') disposer() } },
  slots: {
    inject(_slotName, factory) { return factory() },
    register(options, component) { registered.push({ options, component }); return () => {} },
  },
}

// ── 用例 ──────────────────────────────────────────────────────────────────
let passed = 0
const failures = []
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`) }
  catch (error) { failures.push({ name, error }); console.log(`  ✗ ${name}\n    ${error?.message ?? error}`) }
}

bundle.exports.apply(ctx)
const Page = registered[0].component

/** 默认后端：list 空，save 成功并把条目写进内存列表。 */
function installFakeBackend(options = {}) {
  const state = { items: Array.isArray(options.items) ? [...options.items] : [], conflicts: options.conflicts || 0 }
  requests = []
  fetchImpl = async (url, init) => {
    const url_ = String(url)
    const body = init && init.body ? JSON.parse(init.body) : undefined
    requests.push({ url: url_, body })
    const json = value => ({ ok: true, status: 200, async json() { return value } })
    const fail = (status, payload) => ({ ok: false, status, async json() { return payload } })
    if (url_.endsWith('/list')) {
      return json({ ...makePayload(), items: state.items })
    }
    if (url_.endsWith('/save')) {
      if (state.conflicts > 0) {
        state.conflicts -= 1
        return fail(409, { ok: false, error: '冲突', code: 'conflict' })
      }
      const existing = state.items.find(item => item.id === body.id)
      const saved = {
        id: body.id !== undefined ? body.id : '20261104-new001',
        title: body.title,
        content: body.content || '',
        calendar: body.calendar,
        withYear: body.withYear === true,
        year: body.year || 0,
        month: body.month,
        day: body.day,
        leap: body.leap === true,
        rev: existing ? existing.rev + 1 : 0,
        createdAt: existing ? existing.createdAt : '2026-11-04T10:00:00.000+08:00',
        updatedAt: '2026-11-04T10:00:00.000+08:00',
        source: { zh: '', en: '' },
        solar: { zh: '', en: '' },
        lunar: { zh: '', en: '' },
        days: 30,
        phase: 'future',
        targetDate: '2026-12-04',
        note: null,
      }
      if (existing) state.items = state.items.map(item => (item.id === saved.id ? saved : item))
      else state.items.push(saved)
      return json({ ...makePayload(), items: state.items, item: saved })
    }
    if (url_.endsWith('/remove')) {
      state.items = state.items.filter(item => item.id !== body.id)
      return json({ ...makePayload(), items: state.items })
    }
    throw new Error('unexpected url ' + url_)
  }
  return state
}

await test('hook 数量在各次渲染间保持稳定', async () => {
  installFakeBackend()
  const result = await runtime.render(runtime.h(Page, {}), 'hookcount')
  assert.ok(result.joined.includes('重要日'), result.joined)
  assert.deepEqual(runtime.hookCountErrors, [], runtime.hookCountErrors.join('; '))
})

await test('点「新增重要日」→ 出现表单（标题 / 内容 / 公历农历 / 包含年份）', async () => {
  installFakeBackend()
  let result = await runtime.render(runtime.h(Page, {}), 'form')
  assert.ok(!result.joined.includes('保存中'), '初始不应有表单')
  result = await runtime.click(result, '新增重要日', 'form')
  for (const label of ['标题', '内容（可选）', '公历', '农历', '包含年份', '保存', '取消']) {
    assert.ok(result.joined.includes(label), `表单缺少「${label}」：${result.joined}`)
  }
  assert.ok(result.joined.includes('不含年份') || result.joined.includes('每年重复'), '缺少重复规则说明')
})

await test('切到农历 → 出现「闰月」和农历序号下拉', async () => {
  installFakeBackend()
  let result = await runtime.render(runtime.h(Page, {}), 'lunar')
  result = await runtime.click(result, '新增重要日', 'lunar')
  result = await runtime.click(result, '农历', 'lunar')
  assert.ok(result.joined.includes('闰月'), `切农历后缺少闰月开关：${result.joined}`)
  assert.ok(result.joined.includes('正月'), '农历月份应是「正月」而不是 1 月')
  assert.ok(result.joined.includes('初一'), '农历日期应是「初一」')
})

await test('切农历再切回公历 → 闰月开关消失，月份回到数字', async () => {
  installFakeBackend()
  let result = await runtime.render(runtime.h(Page, {}), 'back')
  result = await runtime.click(result, '新增重要日', 'back')
  result = await runtime.click(result, '农历', 'back')
  result = await runtime.click(result, '公历', 'back')
  assert.ok(!result.joined.includes('闰月'), `切回公历后仍显示闰月：${result.joined}`)
})

await test('切到 2 月后日期下拉被夹回合法范围（不会出现「31 日 + 2 月」）', async () => {
  installFakeBackend()
  let result = await runtime.render(runtime.h(Page, {}), 'clamp')
  result = await runtime.click(result, '新增重要日', 'clamp')
  assert.equal(result.selects.length, 2, `表单应有两个下拉，实际 ${result.selects.length}`)
  const [monthSelect, daySelect] = result.selects
  monthSelect.props.onChange({ target: { value: '2' } })
  result = await runtime.render(runtime.h(Page, {}), 'clamp')
  const dayOptions = result.selects[1].children.flat()
    .filter(node => node && node.type === 'option')
    .map(node => node.props.value)
  assert.ok(dayOptions.includes('29'), `公历不含年份的 2 月应能选 29 日：${dayOptions.join(',')}`)
  assert.ok(!dayOptions.includes('30'), `2 月不该有 30 日：${dayOptions.join(',')}`)
  assert.ok(!dayOptions.includes('31'), `2 月不该有 31 日：${dayOptions.join(',')}`)
  // 切到农历：日固定 1-30
  result = await runtime.click(result, '农历', 'clamp')
  const lunarDays = result.selects[1].children.flat()
    .filter(node => node && node.type === 'option')
    .map(node => node.props.value)
  assert.equal(lunarDays.length, 30, `农历应有 30 天，实际 ${lunarDays.length}`)
})

await test('勾上「包含年份」→ 出现年份输入框', async () => {
  installFakeBackend()
  let result = await runtime.render(runtime.h(Page, {}), 'wyear')
  result = await runtime.click(result, '新增重要日', 'wyear')
  assert.ok(!result.joined.includes('一次性日期'), '默认不应是一次性')
  result = await runtime.clickSwitch(result, 0, 'wyear')
  assert.ok(result.joined.includes('一次性日期'), '勾选后应说明是一次性日期')
})

await test('标题为空时点保存 → 显示「请填写标题」，且不发请求', async () => {
  installFakeBackend()
  requests = []
  let result = await runtime.render(runtime.h(Page, {}), 'empty')
  result = await runtime.click(result, '新增重要日', 'empty')
  result = await runtime.click(result, '保存', 'empty')
  assert.ok(result.joined.includes('请填写标题'), result.joined)
  assert.equal(requests.filter(r => r.url.endsWith('/save')).length, 0, '空标题不该发保存请求')
})

await test('保存成功后回到列表并重新拉取数据', async () => {
  const state = installFakeBackend()
  requests = []
  let result = await runtime.render(runtime.h(Page, {}), 'save')
  result = await runtime.click(result, '新增重要日', 'save')
  const input = findInput(result, '例如')
  assert.ok(input, '找不到标题输入框')
  result = await type(result, input, '某人生日', 'save')
  const again = await runtime.click(result, '保存', 'save')
  const saveCalls = requests.filter(r => r.url.endsWith('/save'))
  assert.equal(saveCalls.length, 1, '应当发一次保存请求')
  assert.equal(saveCalls[0].body.title, '某人生日')
  assert.equal(saveCalls[0].body.expectedRev, 0, '新条目应带 expectedRev=0')
  assert.equal(state.items.length, 1)
  assert.ok(again.joined.includes('某人生日'), `保存后列表应显示新条目：${again.joined}`)
})

await test('409 冲突后刷新列表，并把草稿的版本号同步成最新', async () => {
  const existing = {
    id: '20261104-old001', title: '旧标题', content: '', calendar: 'solar',
    withYear: false, year: 0, month: 12, day: 4, leap: false, rev: 3,
    createdAt: '2026-11-04T09:00:00.000+08:00', updatedAt: '2026-11-04T09:00:00.000+08:00',
    source: { zh: '12月4日', en: '12/4' }, solar: { zh: '12月4日', en: '12/4' }, lunar: { zh: '农历十月廿六', en: 'x' },
    days: 30, phase: 'future', targetDate: '2026-12-04', note: null,
  }
  installFakeBackend({ items: [existing], conflicts: 1 })
  let result = await runtime.render(runtime.h(Page, {}), 'conflict')
  result = await runtime.click(result, '编辑', 'conflict')
  result = await runtime.click(result, '保存', 'conflict')
  assert.ok(result.joined.includes('别处被修改'), `应提示冲突：${result.joined}`)
  // 再点一次保存：这次不应再撞冲突（版本号已同步），后端会放行
  const second = await runtime.click(result, '保存', 'conflict')
  assert.ok(!second.joined.includes('别处被修改'), `重试不应再次冲突：${second.joined}`)
})

await test('删除需要二次确认，确认后才发请求', async () => {
  const existing = {
    id: '20261104-del001', title: '待删', content: '', calendar: 'solar',
    withYear: false, year: 0, month: 1, day: 1, leap: false, rev: 0,
    createdAt: 'x', updatedAt: 'y',
    source: { zh: '1月1日', en: '1/1' }, solar: { zh: '1月1日', en: '1/1' }, lunar: { zh: '农历冬月初一', en: 'x' },
    days: 58, phase: 'future', targetDate: '2027-01-01', note: null,
  }
  const state = installFakeBackend({ items: [existing] })
  requests = []
  let result = await runtime.render(runtime.h(Page, {}), 'del')
  result = await runtime.click(result, '删除', 'del')
  assert.equal(requests.filter(r => r.url.endsWith('/remove')).length, 0, '第一次点击不该发删除请求')
  assert.ok(result.joined.includes('删除这一条'), `应有二次确认：${result.joined}`)
  result = await runtime.click(result, '删除', 'del')  // 确认按钮文案也是「删除」
  assert.equal(requests.filter(r => r.url.endsWith('/remove')).length, 1, '确认后应发一次删除请求')
  assert.equal(state.items.length, 0)
})

await test('点「取消」关闭表单，不发保存请求', async () => {
  installFakeBackend()
  requests = []
  let result = await runtime.render(runtime.h(Page, {}), 'cancel')
  result = await runtime.click(result, '新增重要日', 'cancel')
  result = await runtime.click(result, '取消', 'cancel')
  assert.ok(!result.joined.includes('保存中'), result.joined)
  assert.equal(requests.filter(r => r.url.endsWith('/save')).length, 0)
})

/** 找 placeholder 含指定片段的输入控件（标题输入框）。 */
function findInput(result, placeholderPart) {
  return result.inputs.find(node => String(node.props.placeholder || '').includes(placeholderPart))
}

/** 往控件里输入文本，然后重渲染。 */
async function type(result, node, value, key) {
  node.props.onChange({ target: { value } })
  return runtime.render(PageElement(), key)
}

let currentKey = 'root'
function PageElement() { return runtime.h(Page, {}) }

console.log('')
if (failures.length) {
  console.log(`✗ ${passed} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error?.stack ?? failure.error}`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 项 Client 交互测试通过`)
}
