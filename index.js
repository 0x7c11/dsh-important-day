/**
 * 重要日（Important Day）— Host 半身。
 *
 * 职责只有三件事：
 *   1. 把用户的重要日以 Markdown 文档存放在 dsh 的本地目录
 *      （默认 `%DSH_HOME%/important-day/`，一个条目一个 `.md` 文件）；
 *   2. 用 ICU 农历日历做公历↔农历换算，并算"还有多少天 / 已经过了多少天"；
 *   3. 通过宿主的 `/api` 共享通道（`ctx.connection.fetch`）暴露三个已鉴权接口，
 *      供设置面板里的 Client 半身读写。
 *
 * 刻意不用 `ctx.webServer.register({ kind: 'prefix', path: '/api/...' })`：
 * 那会绕过宿主对 `/api` 的准入判定（最长前缀优先），得自己复刻一套信任围栏。
 * `connection.fetch` 注册的精确路由由宿主先做 cookie/trust 准入，只把
 * owner 主体的请求交给处理器。
 *
 * 不写 session event、不额外建索引：文档本身就是事实来源，每次 list 都重新
 * 读目录，用户在外面用编辑器改完文件后刷新页面即可看到。
 */

import os from 'node:os'
import path from 'node:path'

import { ImportantDayStore, isValidId, newId } from './lib/store.js'
import { describeItem, daysInMonth, sourceLabel, todayOf } from './lib/countdown.js'
import { lunarLabel, lunarParts, lunarSupported } from './lib/lunar.js'

/** 路由前缀。故意足够独特，不可能与宿主路由相撞。 */
const ROUTE_PREFIX = '/api/important-day'

const ROUTES = {
  list: `${ROUTE_PREFIX}/list`,
  save: `${ROUTE_PREFIX}/save`,
  remove: `${ROUTE_PREFIX}/remove`,
}

/** 请求体上限：一条重要日的正文不该更大；超出返回 413。 */
const MAX_BODY_BYTES = 256 * 1024

const MAX_TITLE = 200
const MAX_CONTENT = 64 * 1024

/** 数据目录：`config.dataDir` 优先，否则 `%DSH_HOME%/important-day`。 */
function resolveDataDir(config) {
  const configured = typeof config?.dataDir === 'string' ? config.dataDir.trim() : ''
  if (configured !== '') return path.resolve(expandHome(configured))
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'important-day')
}

function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

/**
 * Host 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ dataDir?: string }} [config]
 */
export function apply(ctx, config) {
  const log = message => {
    try {
      if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
      else console.warn(message)
    } catch { /* 日志不可用不影响主流程 */ }
  }
  const info = message => {
    try {
      if (typeof ctx.logger?.info === 'function') ctx.logger.info(message)
      else console.log(message)
    } catch { /* 同上 */ }
  }

  const dataDir = resolveDataDir(config)
  const store = new ImportantDayStore(dataDir, { log })

  // 尽早建目录：面板第一次打开时目录已存在，用户也能在文件管理器里直接看到。
  try {
    store.ensureSync()
  } catch (error) {
    log(`[important-day] 无法创建数据目录 ${dataDir}：${error?.message ?? error}`)
  }

  const listItems = async () => {
    const today = todayOf(new Date())
    const { items: raw, broken } = await store.scan()
    const rows = raw.map(item => {
      const zh = describeItem(item, today, 'zh')
      const en = describeItem(item, today, 'en')
      return {
        id: item.id,
        title: item.title,
        content: item.content,
        calendar: item.calendar,
        withYear: item.withYear === true,
        year: item.year,
        month: item.month,
        day: item.day,
        leap: item.leap === true,
        rev: item.rev,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        source: { zh: sourceLabel(item, 'zh'), en: sourceLabel(item, 'en') },
        ...(zh.ok
          ? {
            days: zh.days,
            phase: zh.phase,
            targetDate: zh.targetDate,
            solar: { zh: zh.solar, en: en.ok ? en.solar : zh.solar },
            lunar: { zh: zh.lunar, en: en.ok ? en.lunar : zh.lunar },
            note: zh.note,
          }
          : { days: null, phase: 'invalid', note: zh.reason === 'unavailable' ? 'unavailable' : 'unresolvable' }),
      }
    })
    rows.sort(compareRows)
    // 「今天」的农历日期同样可能因为 small-icu 取不到；此时降级为只显示公历。
    let todayLunar = ''
    let lunarAvailable = true
    try {
      todayLunar = lunarLabel(lunarParts(today.utcMs), 'zh')
    } catch {
      lunarAvailable = false
    }
    return {
      today: {
        date: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
        lunar: todayLunar,
      },
      lunarAvailable,
      dataDir,
      items: rows,
      // 读不出来的文档列表：页面据此提示用户去修哪个文件，而不是让它静默消失。
      broken,
    }
  }

  const saveItem = async body => {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') throw badRequest('标题不能为空')
    if (title.length > MAX_TITLE) throw badRequest(`标题不能超过 ${MAX_TITLE} 个字符`)
    const content = typeof body.content === 'string' ? body.content : ''
    if (content.length > MAX_CONTENT) throw badRequest('内容太长')

    const calendar = body.calendar === 'lunar' ? 'lunar' : 'solar'
    // 中文历不可用时（small-icu）不接受农历条目：否则会存下一份永远算不出来的
    // 数据。UI 已禁用该选项，这里再拦一道，挡住直接打 API 的调用。
    if (calendar === 'lunar' && !lunarSupported()) {
      throw badRequest('当前运行环境的 ICU 不含中文历，无法保存农历重要日')
    }
    const withYear = body.withYear === true
    const month = Number(body.month)
    const day = Number(body.day)
    if (!Number.isInteger(month) || month < 1 || month > 12) throw badRequest('月份必须在 1-12 之间')

    let year = 0
    if (withYear) {
      year = Number(body.year)
      if (!Number.isInteger(year) || year < 1900 || year > 2200) throw badRequest('年份必须在 1900-2200 之间')
    }

    // 公历：含年份时按该年实际天数校验；不含年份时允许 2 月 29 日（闰年才有，
    // 平年会自动回落到 2 月 28 日并在条目上标注）。
    const maxDay = calendar === 'lunar'
      ? 30
      : withYear
        ? daysInMonth(year, month)
        : daysInMonth(2028, month)
    if (!Number.isInteger(day) || day < 1 || day > maxDay) {
      throw badRequest(calendar === 'lunar' ? '农历日期必须在 1-30 之间' : `公历日期必须在 1-${maxDay} 之间`)
    }
    // 农历条目落盘前先真正算一次：既验证运行环境支持中文历（small-icu 会抛），
    // 也让"闰月不存在 / 小月没有三十"这类回落能立刻被保存方看到。
    if (calendar === 'lunar') {
      let probe
      try {
        probe = describeItem({ calendar, withYear, year, month, day, leap: body.leap === true }, todayOf(new Date()), 'zh')
      } catch (error) {
        throw badRequest(String(error?.message ?? error))
      }
      if (probe.ok === false && probe.reason === 'unavailable') throw badRequest(String(probe.detail ?? '农历换算不可用'))
    }

    const requestedId = typeof body.id === 'string' ? body.id : ''
    const id = requestedId !== '' ? requestedId : newId()
    if (!isValidId(id)) throw badRequest('非法的 id')
    const existing = requestedId !== '' ? await store.read(id) : undefined

    // 乐观并发：文档是用户可以直接手改的，所以"面板里读到的版本"和"磁盘上的
    // 版本"可能不同。客户端回传它编辑时看到的 rev，对不上就拒绝覆盖——否则
    // 用户刚在编辑器里改的内容会被面板上一次保存静默吞掉。
    //
    // 版本号用单调递增的 rev 而不是 updatedAt：同一毫秒内的两次保存会写出
    // 相同的时间戳，若拿时间戳当版本号，版本不推进，409 保护就形同虚设。
    // 旧客户端（或手工构造的请求）可能只带 expectedUpdatedAt，这里一并兼容。
    const expectedRev = Number.isInteger(body.expectedRev) ? body.expectedRev : undefined
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : ''
    if (existing !== undefined) {
      if (expectedRev !== undefined && existing.rev !== expectedRev) throw conflict()
      if (expectedRev === undefined && expectedUpdatedAt !== '' && existing.updatedAt !== expectedUpdatedAt) {
        throw conflict()
      }
    } else if (requestedId !== '') {
      // 带了 id 却找不到文件 = 这条已经被删掉了（或文件名被改过）。如果允许它
      // 静默重建，多窗口场景下就会"删了又自己回来"，而且没有任何提示。
      // 让用户明确地重新新增，比悄悄复活一份旧数据更诚实。
      // 注意：新增条目不传 id、也不该受这条约束——这里按"有没有带 id"判断，
      // 不能按 rev > 0 判断（新草稿的 expectedRev 也是 0）。
      throw notFound('这个重要日已经被删除了')
    }

    const nowIso = localIsoNow()

    const item = {
      id,
      title,
      content,
      calendar,
      withYear,
      year,
      month,
      day,
      leap: calendar === 'lunar' && body.leap === true,
      rev: existing !== undefined ? existing.rev + 1 : 0,
      createdAt: existing !== undefined && existing.createdAt !== '' ? existing.createdAt : nowIso,
      updatedAt: nowIso,
    }
    await store.save(item)
    return item
  }

  const removeItem = async body => {
    const id = typeof body.id === 'string' ? body.id : ''
    if (!isValidId(id)) throw badRequest('非法的 id')
    const removed = await store.remove(id)
    if (!removed) throw notFound('这个重要日已经不存在了')
    return { id }
  }

  ctx.inject(['connection'], scoped => {
    const connection = scoped.connection

    scoped.effect(() => connection.fetch.register({
      path: ROUTES.list,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async () => json(200, { ok: true, ...(await listItems()) }),
    }), 'important-day: list route')

    scoped.effect(() => connection.fetch.register({
      path: ROUTES.save,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        const parsed = await readJson(request)
        if (parsed.error !== undefined) return parsed.error
        try {
          const item = await saveItem(parsed.value)
          return json(200, { ok: true, item, ...(await listItems()) })
        } catch (error) {
          return errorResponse(error)
        }
      },
    }), 'important-day: save route')

    scoped.effect(() => connection.fetch.register({
      path: ROUTES.remove,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async request => {
        const parsed = await readJson(request)
        if (parsed.error !== undefined) return parsed.error
        try {
          await removeItem(parsed.value)
          return json(200, { ok: true, ...(await listItems()) })
        } catch (error) {
          return errorResponse(error)
        }
      },
    }), 'important-day: remove route')

    info(`[important-day] 数据目录 ${dataDir}，接口已挂载于 ${ROUTE_PREFIX}`)
  })
}

/** 列表排序：今天 → 未来的（越近越前）→ 已过去的（越近越前）→ 无法解析的。 */
function compareRows(a, b) {
  const rank = row => (row.phase === 'today' ? 0 : row.phase === 'future' ? 1 : row.phase === 'past' ? 2 : 3)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (a.days === null && b.days === null) return compareText(a.title, b.title)
  if (a.days === null) return 1
  if (b.days === null) return -1
  if (a.days !== b.days) return a.days - b.days
  return compareText(a.title, b.title)
}

function compareText(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), 'zh-Hans-CN')
}

/**
 * 本机时区的 ISO 时间戳（带偏移），写进文档便于人读。
 *
 * **带毫秒**：这个字段同时充当乐观并发的版本号，只到秒的话同一秒内的两次
 * 保存会拿到相同的版本，409 保护就形同虚设。
 */
function localIsoNow(now = new Date()) {
  const pad = value => String(Math.abs(value)).padStart(2, '0')
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T`
    + `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    + `.${String(now.getMilliseconds()).padStart(3, '0')}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

/** `apply` 的边界错误：带 HTTP 状态码，路由层直接转成响应。 */
function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const badRequest = message => httpError(400, message)
const notFound = message => httpError(404, message)
const conflict = () => httpError(409, '这个重要日在别处被修改过了，请刷新后再试')

function errorResponse(error) {
  const status = typeof error?.status === 'number' ? error.status : 500
  const message = status === 500 ? '服务器内部错误' : String(error?.message ?? error)
  if (status === 500) console.warn(`[important-day] 请求失败：${error?.stack ?? error}`)
  return json(status, { ok: false, error: message, code: status === 409 ? 'conflict' : undefined })
}

function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 读 JSON 请求体，带大小上限。返回 `{ value }` 或 `{ error: Response }`。 */
async function readJson(request) {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return { error: json(413, { ok: false, error: '请求体太大' }) }
  }
  let text
  try {
    text = await request.text()
  } catch {
    return { error: json(400, { ok: false, error: '无法读取请求体' }) }
  }
  // 必须按 UTF-8 字节数比：中文一个字 3 字节，用 text.length（UTF-16 码元）
  // 会让上限放宽到三倍；chunked 请求没有 content-length，就完全绕过限制。
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { error: json(413, { ok: false, error: '请求体太大' }) }
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { error: json(400, { ok: false, error: '请求体不是合法的 JSON' }) }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: json(400, { ok: false, error: '请求体必须是 JSON 对象' }) }
  }
  return { value }
}

export const name = 'important-day'
