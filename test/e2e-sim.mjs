/**
 * 端到端仿真：不启动 dsh，用假的 cordis Context 走一遍"新增 → 列表 → 文档"
 * 的真实链路，打印结果供人工核对（尤其是需求里的两条算例）。
 *
 * 运行：node test/e2e-sim.mjs
 */
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'iday-e2e-'))
const routes = new Map()
const effects = []
const ctx = {
  logger: { info() {}, warn(message) { console.log('WARN', message) } },
  effect(factory) {
    const disposer = factory()
    effects.push(disposer)
    return () => { if (typeof disposer === 'function') disposer() }
  },
  inject(_deps, callback) {
    callback({
      connection: { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path) } } },
      effect: this.effect,
    })
  },
}

apply(ctx, { dataDir: dir })

async function call(routePath, body) {
  const route = routes.get(routePath)
  if (route === undefined) throw new Error(`缺少路由 ${routePath}`)
  const init = { method: body === undefined ? 'GET' : 'POST', headers: {} }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers['content-length'] = String(Buffer.byteLength(init.body))
  }
  const response = await route.fetch(new Request('http://dsh.internal' + routePath, init))
  return { status: response.status, json: await response.json() }
}

try {
  await call('/api/important-day/save', { title: '某人生日', content: '喜欢草莓蛋糕', calendar: 'solar', withYear: false, month: 12, day: 4 })
  await call('/api/important-day/save', { title: '另一个生日', calendar: 'solar', withYear: false, month: 1, day: 4 })
  await call('/api/important-day/save', { title: '农历纪念日', calendar: 'lunar', withYear: false, month: 9, day: 26 })
  await call('/api/important-day/save', { title: '一次性纪念', calendar: 'solar', withYear: true, year: 2020, month: 1, day: 1 })

  const list = await call('/api/important-day/list')
  console.log('今天 =', list.json.today)
  console.log('数据目录 =', list.json.dataDir)
  console.log('')
  for (const item of list.json.items) {
    const repeat = item.withYear ? '含年份' : '每年'
    console.log(`- ${item.title.padEnd(10, '　')} ${item.calendar === 'lunar' ? '农历' : '公历'}/${repeat} ${item.month}-${item.day} → phase=${item.phase} days=${item.days} target=${item.targetDate}`)
  }
  console.log('')
  const files = (await fsp.readdir(dir)).filter(name => name.endsWith('.md'))
  console.log('文档数 =', files.length, ':', files.join(', '))
  const sample = await fsp.readFile(path.join(dir, files[0]), 'utf8')
  console.log('')
  console.log('--- 一个文档的样子 ---')
  console.log(sample)
  console.log('--- END ---')
} finally {
  await fsp.rm(dir, { recursive: true, force: true })
}
