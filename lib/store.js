/**
 * 重要日的 Markdown 文档存储。
 *
 * 一个重要日 = `${dataDir}/<id>.md`，person-readable、可直接用编辑器改：
 *
 *   ---
 *   id: 20261104-a1b2c3
 *   title: 某人生日
 *   calendar: lunar
 *   withYear: false
 *   year: 1990
 *   month: 12
 *   day: 4
 *   leap: false
 *   createdAt: 2026-11-04T10:30:00+08:00
 *   updatedAt: 2026-11-04T10:30:00+08:00
 *   ---
 *
 *   正文内容（可为空，多行，原样保留）。
 *
 * 刻意不引 js-yaml：这里只需读回自己写出的、扁平的 `key: value` 头，
 * 引一个 YAML 解析器会让"用户手改文档"变成一场与缩进规则的搏斗。
 * 单行字符串用 JSON 双引号转义（合法 YAML 标量），正文原样保留。
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

/** 允许出现在 id 里的字符——挡住路径穿越。 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Windows 保留设备名。`CON.md` 这类路径在部分 Windows API 上会打开设备而不是
 * 文件（写入"成功"但读不回来），因此在所有平台上统一拒绝，行为可预期。
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 头部字段的写出顺序。 */
const FIELD_ORDER = [
  'id', 'title', 'calendar', 'withYear', 'year', 'month', 'day', 'leap',
  // rev 是单调递增的修改计数，专用于乐观并发。不能拿 updatedAt 当版本号：
  // 同一毫秒内的两次保存会写出相同的时间戳，版本不推进，409 保护就失效了。
  'rev', 'createdAt', 'updatedAt',
]

/** 数值字段（写回时不加引号）。 */
const NUMERIC_FIELDS = new Set(['year', 'month', 'day', 'rev'])

/** 布尔字段。 */
const BOOLEAN_FIELDS = new Set(['withYear', 'leap'])

/** 取值受控、可以裸写的字符串字段（其余自由文本一律加引号，避免被读回成数字）。 */
const BARE_FIELDS = new Set(['id', 'calendar'])

export function isValidId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false
  return !WINDOWS_RESERVED.test(id)
}

export class InvalidIdError extends Error {
  constructor(id) {
    super(`非法的 id：${String(id)}`)
    this.name = 'InvalidIdError'
    this.code = 'invalid_id'
  }
}

/**
 * 生成新 id：日期前缀 + 6 位随机，便于在文件管理器里按时间排序。
 * @param {Date} [now]
 */
export function newId(now = new Date()) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  let suffix = ''
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 6; i += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `${stamp}-${suffix}`
}

/** 解析一个 YAML 标量（只支持我们自己写出的两种形态：裸值 / JSON 双引号串）。 */
function parseScalar(raw) {
  const text = raw.trim()
  if (text === '') return ''
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      // 用户手改坏了引号：退化成去引号的裸文本，比整条丢弃更有用。
      return text.replace(/^"|"$/g, '')
    }
  }
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === 'null' || text === '~') return null
  if (/^-?\d+$/.test(text)) return Number(text)
  return text
}

/** 写出一个 YAML 标量。 */
function formatScalar(key, value) {
  if (NUMERIC_FIELDS.has(key)) return String(Number(value))
  if (BOOLEAN_FIELDS.has(key)) return value === true ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const text = String(value ?? '')
  // 只有取值受控的字段裸写（id / calendar 的值域在写入前已被校验）；
  // 标题、时间戳这类自由文本一律走 JSON 双引号转义——它依然是合法 YAML
  // 标量，并且换行、冒号、引号都不会破坏头部，也绝不会被读回成数字。
  if (BARE_FIELDS.has(key) && /^[A-Za-z0-9_.:+-]+$/.test(text)) return text
  if (key === 'createdAt' || key === 'updatedAt') return JSON.stringify(text)
  return JSON.stringify(text)
}

/**
 * 拆分 front matter 与正文。
 *
 * 只把文件**开头**的第一段 `---` 当头部，因此正文里出现分隔线不会破坏
 * 解析；没有头部时正文即全文（容错：用户可能手工删掉了头部）。
 */
export function splitFrontMatter(text) {
  const source = text.replace(/^\uFEFF/, '')
  if (!source.startsWith('---')) return { header: {}, body: source }
  const lines = source.split(/\r?\n/)
  // lines[0] === '---'
  let end = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return { header: {}, body: source }
  // 只有"头部里至少有一个 key: value"才算 front matter。否则像用户手写的一篇
  // 以 `---` 分隔线开头的普通 Markdown 笔记，会被误当成头部吃掉第一段正文。
  let looksLikeHeader = false
  for (let i = 1; i < end; i += 1) {
    if (/^\s*[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(lines[i])) {
      looksLikeHeader = true
      break
    }
  }
  if (!looksLikeHeader) return { header: {}, body: source }
  const header = {}
  for (let i = 1; i < end; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    if (key === '') continue
    header[key] = parseScalar(line.slice(colon + 1))
  }
  const body = lines.slice(end + 1).join('\n')
  return { header, body }
}

/** 把条目序列化成一个 Markdown 文档。 */
export function toMarkdown(item) {
  const lines = ['---']
  for (const key of FIELD_ORDER) {
    if (item[key] === undefined || item[key] === null) continue
    lines.push(`${key}: ${formatScalar(key, item[key])}`)
  }
  lines.push('---', '')
  const body = typeof item.content === 'string' ? item.content : ''
  // 头部之后固定一个空行做分隔，正文**逐字写出**（不追加终止换行）：
  // 这样"读出 → 再保存"对尾随空行也是幂等的，用户写在末尾的空行不会消失。
  return `${lines.join('\n')}\n${body}`
}

/**
 * 去掉头部之后那一个分隔空行（写文件时固定插入的），其余原样保留。
 * 只吃一个换行，不吃空白——否则用户正文末尾的空行会在"读出→保存"中丢失。
 */
function stripLeadingSeparator(body) {
  return body.replace(/^\r?\n/, '')
}

/** 把文档文本解析成条目；缺关键字段或值域越界返回 null。 */
export function fromMarkdown(text, fallbackId) {
  const { header, body } = splitFrontMatter(text)
  // 头部 id 只是"作者意图"：非法时回落到文件名，而不是整条丢弃——一份
  // 文件名合法、头部被手改坏的文档，用户显然更希望它还出现在列表里。
  const headerId = typeof header.id === 'string' ? header.id.trim() : ''
  const id = isValidId(headerId) ? headerId : fallbackId
  if (!isValidId(id)) return null

  const calendar = header.calendar === 'lunar' ? 'lunar' : 'solar'
  const month = Number(header.month)
  const day = Number(header.day)
  // 值域必须在这里也校验一遍：UI 与 API 都拦住了 0/13/32，但文档是用户
  // 可以直接编辑的。`month: 0` / `month: 13` 若不拦，会被 Date.UTC 归一化成
  // 上一年 12 月 / 下一年 1 月，算出一个**看起来正常但完全错误**的日期。
  if (!Number.isInteger(month) || month < 1 || month > 12) return null
  const maxDay = calendar === 'lunar' ? 30 : 31
  if (!Number.isInteger(day) || day < 1 || day > maxDay) return null

  const withYear = header.withYear === true
  const year = Number(header.year)
  const rev = Number(header.rev)
  const safeYear = Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : 0
  if (withYear && safeYear === 0) return null

  return {
    id,
    title: typeof header.title === 'string' ? header.title : '',
    // 头部之后固定一个空行，读回时只去掉那一个分隔空行；正文其余部分原样
    // 保留，包括用户刻意留在末尾的空行（早期版本在这里 trim 尾部空白，会导致
    // 每次"读出来再保存"都永久丢一点内容）。
    content: stripLeadingSeparator(body),
    calendar,
    withYear,
    year: safeYear,
    month,
    day,
    leap: header.leap === true,
    rev: Number.isInteger(rev) && rev >= 0 ? rev : 0,
    createdAt: typeof header.createdAt === 'string' ? header.createdAt : '',
    updatedAt: typeof header.updatedAt === 'string' ? header.updatedAt : '',
  }
}

/**
 * 目录存储。所有方法都是异步的；list 每次都重新读目录，因此用户在外
 * 面用编辑器改完文件后，页面上刷新一次就能看到。
 */
export class ImportantDayStore {
  /**
   * @param {string} dataDir 绝对路径
   * @param {{ log?: (msg: string) => void }} [options]
   */
  constructor(dataDir, { log } = {}) {
    this.dataDir = path.resolve(dataDir)
    this.log = log ?? (() => {})
  }

  /** 确保目录存在（幂等）。 */
  async ensure() {
    await fsp.mkdir(this.dataDir, { recursive: true })
  }

  /** 同步版，供 apply 阶段尽早建目录。 */
  ensureSync() {
    fs.mkdirSync(this.dataDir, { recursive: true })
  }

  /** 一个条目的文件路径。 */
  fileOf(id) {
    if (!isValidId(id)) throw new InvalidIdError(id)
    return path.join(this.dataDir, `${id}.md`)
  }

  /**
   * 读取全部条目。单个坏文档不会让整页失败：它被记进 `broken` 并附上文件名，
   * 页面据此提示"这个文件读不出来，请修一下"，而不是静默消失。
   * @returns {Promise<{ items: object[], broken: Array<{ file: string, reason: string }> }>}
   */
  async scan() {
    await this.ensure()
    let entries
    try {
      entries = await fsp.readdir(this.dataDir, { withFileTypes: true })
    } catch (error) {
      this.log(`[important-day] 读取数据目录失败：${error?.message ?? error}`)
      return { items: [], broken: [] }
    }
    const items = []
    const broken = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.md')) continue
      const fallbackId = entry.name.slice(0, -3)
      if (!isValidId(fallbackId)) {
        broken.push({ file: entry.name, reason: 'invalidFileName' })
        this.log(`[important-day] 文件名不是合法 id，已忽略：${entry.name}`)
        continue
      }
      const full = path.join(this.dataDir, entry.name)
      try {
        const text = await fsp.readFile(full, 'utf8')
        const item = fromMarkdown(text, fallbackId)
        if (item === null) {
          broken.push({ file: entry.name, reason: 'unparsable' })
          this.log(`[important-day] 跳过无法解析的文档：${entry.name}`)
          continue
        }
        item.id = fallbackId
        item.file = full
        items.push(item)
      } catch (error) {
        broken.push({ file: entry.name, reason: 'unreadable' })
        this.log(`[important-day] 读取文档失败：${entry.name}：${error?.message ?? error}`)
      }
    }
    return { items, broken }
  }

  /** 只要条目列表时用这个（`scan()` 的薄封装）。 */
  async list() {
    const { items } = await this.scan()
    return items
  }

  /** 读单个条目；不存在返回 undefined。 */
  async read(id) {
    const full = this.fileOf(id)
    let text
    try {
      text = await fsp.readFile(full, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    return fromMarkdown(text, id) ?? undefined
  }

  /**
   * 写入（新增或覆盖）一个条目。
   *
   * 先写同目录临时文件再 rename：中途崩溃不会留下半个文档，而 rename 在
   * 同一目录内是原子的。
   */
  async save(item) {
    if (!isValidId(item.id)) throw new InvalidIdError(item.id)
    await this.ensure()
    const full = this.fileOf(item.id)
    const markdown = toMarkdown(item)
    const temp = path.join(this.dataDir, `.${item.id}.${process.pid}.${Date.now()}.tmp`)
    await fsp.writeFile(temp, markdown, 'utf8')
    try {
      await fsp.rename(temp, full)
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => {})
      throw error
    }
    return { ...item, file: full }
  }

  /** 删除一个条目；不存在返回 false。 */
  async remove(id) {
    const full = this.fileOf(id)
    try {
      await fsp.rm(full)
      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }
}
