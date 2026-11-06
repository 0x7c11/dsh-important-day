/**
 * Host 半身冒烟测试：用假的 cordis Context 驱动 apply()，验证三个路由
 * 的完整读写链路、鉴权注册形态与错误处理。不需要启动 dsh。
 *
 * 运行：node test/host-smoke.mjs
 */

import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { apply } from '../index.js'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-important-day-host-'))

/** 最小 cordis Context 替身：记录 effect、模拟 inject(['connection'])。 */
function fakeContext() {
  const effects = []
  const routes = new Map()
  const logs = []
  const ctx = {
    logger: {
      info: message => logs.push(['info', message]),
      warn: message => logs.push(['warn', message]),
    },
    effect(factory, label) {
      const disposer = factory()
      effects.push({ label, disposer })
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    inject(deps, callback) {
      const scoped = {
        connection: {
          fetch: {
            register(route) {
              if (routes.has(route.path)) throw new Error(`duplicate route ${route.path}`)
              routes.set(route.path, route)
              return async () => { routes.delete(route.path) }
            },
          },
        },
        effect: ctx.effect,
      }
      callback(scoped)
    },
  }
  return { ctx, routes, effects, logs }
}

async function callRoute(routes, routePath, { method = 'GET', body } = {}) {
  const route = routes.get(routePath)
  assert.ok(route, `路由不存在：${routePath}`)
  assert.ok(route.methods.includes(method), `${routePath} 不接受 ${method}`)
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    init.headers['content-length'] = String(Buffer.byteLength(init.body))
  }
  const request = new Request(`http://dsh.internal${routePath}`, init)
  const response = await route.fetch(request)
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch { /* 非 JSON */ }
  return { status: response.status, json, text }
}

let passed = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}\n    ${error?.message ?? error}`)
  }
}

try {
  const { ctx, routes } = fakeContext()
  apply(ctx, { dataDir: dir })

  await test('注册了三个精确路由，且都是缓冲请求体', () => {
    assert.equal(routes.size, 3)
    for (const routePath of ['/api/important-day/list', '/api/important-day/save', '/api/important-day/remove']) {
      const route = routes.get(routePath)
      assert.ok(route, `缺少 ${routePath}`)
      assert.equal(route.requestBody, 'buffered')
    }
  })

  await test('空目录 list 返回空列表与今天日期', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/list')
    assert.equal(status, 200)
    assert.equal(json.ok, true)
    assert.deepEqual(json.items, [])
    assert.match(json.today.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(json.today.lunar, /^农历/)
    assert.equal(json.dataDir, dir)
  })

  let savedId = ''

  await test('save 新增一条农历每年重复的条目', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '某人生日', content: '记得买蛋糕', calendar: 'lunar', withYear: false, month: 12, day: 4, leap: false },
    })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.ok, true)
    assert.equal(json.items.length, 1)
    savedId = json.items[0].id
    assert.match(savedId, /^\d{8}-[a-z0-9]{6}$/)
    assert.equal(json.items[0].title, '某人生日')
    assert.equal(json.items[0].content, '记得买蛋糕')
    assert.equal(json.items[0].calendar, 'lunar')
    assert.equal(json.items[0].phase, 'future')
  })

  await test('文档写成了带 front matter 的 Markdown', async () => {
    const text = await fsp.readFile(path.join(dir, `${savedId}.md`), 'utf8')
    assert.ok(text.startsWith('---\nid: '), text.slice(0, 40))
    assert.ok(text.includes('title: "某人生日"'))
    assert.ok(text.includes('calendar: lunar'))
    assert.ok(text.trimEnd().endsWith('记得买蛋糕'))
  })

  await test('save 更新同一条目（id 复用，createdAt 保留）', async () => {
    const before = await callRoute(routes, '/api/important-day/list')
    const created = before.json.items[0].createdAt
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { id: savedId, title: '某人生日（改）', content: '换成了鲜花', calendar: 'solar', withYear: true, year: 2027, month: 1, day: 4 },
    })
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.items.length, 1)
    assert.equal(json.items[0].title, '某人生日（改）')
    assert.equal(json.items[0].calendar, 'solar')
    assert.equal(json.items[0].withYear, true)
    assert.equal(json.items[0].targetDate, '2027-01-04')
    assert.equal(json.items[0].createdAt, created)
  })

  await test('含年份且已过去时显示已经过了多少天', async () => {
    const { json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '过去的事', calendar: 'solar', withYear: true, year: 2020, month: 1, day: 1 },
    })
    const row = json.items.find(item => item.title === '过去的事')
    assert.equal(row.phase, 'past')
    assert.ok(row.days > 2000, String(row.days))
  })

  await test('排序：今天 → 未来（近的在前）→ 过去', async () => {
    const { json } = await callRoute(routes, '/api/important-day/list')
    const phases = json.items.map(item => item.phase)
    const order = phases.map(phase => (phase === 'today' ? 0 : phase === 'future' ? 1 : 2))
    for (let i = 1; i < order.length; i += 1) {
      assert.ok(order[i - 1] <= order[i], `相位顺序错乱：${phases.join(',')}`)
    }
    const futures = json.items.filter(item => item.phase === 'future').map(item => item.days)
    const sorted = [...futures].sort((a, b) => a - b)
    assert.deepEqual(futures, sorted, '未来条目未按临近程度排序')
  })

  await test('错误：标题为空 → 400', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '   ', calendar: 'solar', month: 1, day: 1 },
    })
    assert.equal(status, 400)
    assert.match(json.error, /标题/)
  })

  await test('错误：月份越界 → 400', async () => {
    const { status } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: 'x', calendar: 'solar', month: 13, day: 1 },
    })
    assert.equal(status, 400)
  })

  await test('错误：非法 JSON → 400', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: '{not json',
    })
    assert.equal(status, 400)
    assert.match(json.error, /JSON/)
  })

  await test('错误：含年份但年份缺省 → 400', async () => {
    const { status } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: 'x', calendar: 'solar', withYear: true, month: 1, day: 1 },
    })
    assert.equal(status, 400)
  })

  await test('错误：删除不存在的条目 → 404', async () => {
    const { status } = await callRoute(routes, '/api/important-day/remove', {
      method: 'POST',
      body: { id: '20200101-zzzzzz' },
    })
    assert.equal(status, 404)
  })

  await test('错误：路径穿越 id → 400', async () => {
    const { status } = await callRoute(routes, '/api/important-day/remove', {
      method: 'POST',
      body: { id: '../../x' },
    })
    assert.equal(status, 400)
  })

  await test('remove 删除成功并返回剩余列表', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/remove', {
      method: 'POST',
      body: { id: savedId },
    })
    assert.equal(status, 200, JSON.stringify(json))
    assert.ok(json.items.every(item => item.id !== savedId))
    await assert.rejects(() => fsp.access(path.join(dir, `${savedId}.md`)))
  })

  await test('农历闰月条目可以保存并在列表里标注', async () => {
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '闰月生日', calendar: 'lunar', withYear: false, month: 2, day: 1, leap: true },
    })
    assert.equal(status, 200, JSON.stringify(json))
    const row = json.items.find(item => item.title === '闰月生日')
    assert.equal(row.leap, true)
    // 当前年份（2026）没有闰二月 → 回落并标注
    assert.equal(row.note, 'leapMonthMissing')
  })

  await test('并发保护：旧 expectedRev 拒绝覆盖（409）', async () => {
    const created = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '并发测试', calendar: 'solar', withYear: false, month: 3, day: 3 },
    })
    const row = created.json.items.find(item => item.title === '并发测试')
    assert.ok(row, '没建出来')
    assert.equal(row.rev, 0)
    const first = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: {
        id: row.id, title: '并发测试-改1', calendar: 'solar', withYear: false, month: 3, day: 3,
        expectedRev: row.rev,
      },
    })
    assert.equal(first.status, 200, JSON.stringify(first.json))
    assert.equal(first.json.items.find(item => item.id === row.id).rev, 1)
    const stale = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: {
        id: row.id, title: '并发测试-改2', calendar: 'solar', withYear: false, month: 3, day: 3,
        expectedRev: row.rev,
      },
    })
    assert.equal(stale.status, 409, JSON.stringify(stale.json))
    assert.equal(stale.json.code, 'conflict')
    const final = await callRoute(routes, '/api/important-day/list')
    assert.equal(final.json.items.find(item => item.id === row.id).title, '并发测试-改1')
  })

  await test('并发保护在同一毫秒内连续保存也不会失效（rev 单调递增，不靠时间戳）', async () => {
    const created = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '同毫秒', calendar: 'solar', withYear: false, month: 6, day: 6 },
    })
    const row = created.json.items.find(item => item.title === '同毫秒')
    // 背靠背连打两次：很可能落在同一毫秒里
    const a = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { id: row.id, title: '同毫秒-1', calendar: 'solar', withYear: false, month: 6, day: 6, expectedRev: row.rev },
    })
    assert.equal(a.status, 200, JSON.stringify(a.json))
    const b = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { id: row.id, title: '同毫秒-2', calendar: 'solar', withYear: false, month: 6, day: 6, expectedRev: row.rev },
    })
    // 关键断言：即使两次 updatedAt 相同，rev 也已经推进，第二次必须被拒
    assert.equal(b.status, 409, JSON.stringify(b.json))
    const final = await callRoute(routes, '/api/important-day/list')
    const latest = final.json.items.find(item => item.id === row.id)
    assert.equal(latest.title, '同毫秒-1')
    assert.equal(latest.rev, 1)
  })

  await test('删除后不能被旧 rev 静默复活（404）', async () => {
    const created = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: '会被删的', calendar: 'solar', withYear: false, month: 7, day: 7 },
    })
    const row = created.json.items.find(item => item.title === '会被删的')
    assert.ok(row, '没建出来')
    const removed = await callRoute(routes, '/api/important-day/remove', {
      method: 'POST',
      body: { id: row.id },
    })
    assert.equal(removed.status, 200)
    // 拿旧 id + 旧 rev 再保存：必须 404，而不是静默重建
    const ghost = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: {
        id: row.id, title: '幽灵', calendar: 'solar', withYear: false, month: 7, day: 7,
        expectedRev: row.rev,
      },
    })
    assert.equal(ghost.status, 404, JSON.stringify(ghost.json))
    const final = await callRoute(routes, '/api/important-day/list')
    assert.ok(final.json.items.every(item => item.id !== row.id), '条目又复活了')
  })

  await test('请求体上限按 UTF-8 字节算（中文不会被放行 3 倍）', async () => {
    // 133180 个中文字符 ≈ 399KB 字节，超过 256KB 上限
    const junk = '中'.repeat(133180)
    const { status, json } = await callRoute(routes, '/api/important-day/save', {
      method: 'POST',
      body: { title: 'x', calendar: 'solar', month: 1, day: 1, junk },
    })
    assert.equal(status, 413, JSON.stringify(json))
  })

  await test('坏文档会出现在 broken 列表里，而不是静默消失', async () => {
    const brokenDoc = [
      '---',
      'id: 20200101-broken',
      'month: 13',
      'day: 4',
      '---',
      '',
      'body',
      '',
    ].join('\n')
    await fsp.writeFile(path.join(dir, '20200101-broken.md'), brokenDoc, 'utf8')
    await fsp.writeFile(path.join(dir, '不是合法文件名.md'), 'x', 'utf8')
    const { json } = await callRoute(routes, '/api/important-day/list')
    assert.ok(Array.isArray(json.broken), '缺少 broken 字段')
    const files = json.broken.map(item => item.file)
    assert.ok(files.includes('20200101-broken.md'), files.join(','))
    assert.ok(files.includes('不是合法文件名.md'), files.join(','))
    // 合法条目照常显示
    assert.ok(json.items.length > 0)
    await fsp.rm(path.join(dir, '20200101-broken.md'), { force: true })
    await fsp.rm(path.join(dir, '不是合法文件名.md'), { force: true })
  })

  await test('client 与 host 的接口契约字段齐全', async () => {
    const { json } = await callRoute(routes, '/api/important-day/list')
    for (const item of json.items) {
      for (const key of ['id', 'title', 'content', 'calendar', 'withYear', 'month', 'day', 'leap', 'source', 'solar', 'lunar', 'phase', 'days', 'targetDate']) {
        assert.ok(key in item, `缺少字段 ${key}`)
      }
      assert.equal(typeof item.source, 'object')
      assert.equal(typeof item.solar, 'object')
      assert.equal(typeof item.lunar, 'object')
    }
  })
} finally {
  await fsp.rm(dir, { recursive: true, force: true })
}

console.log('')
if (failures.length > 0) {
  console.log(`✗ ${passed} 通过，${failures.length} 失败`)
  for (const failure of failures) console.log(`  - ${failure.name}: ${failure.error?.stack ?? failure.error}`)
  process.exitCode = 1
} else {
  console.log(`✓ 全部 ${passed} 项 Host 冒烟测试通过`)
}
