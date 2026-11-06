/**
 * Client 半身静态检查：不渲染 React，只验证 bundle 的注册形态与本仓库约定。
 * 运行：node test/client-static.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

let passed = 0
const failures = []
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`) }
  catch (e) { failures.push({ name, e }); console.log(`  ✗ ${name}\n    ${e?.message ?? e}`) }
}

test('以 window.__ModuleLoader__.load 注册，id 等于包名', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id: '@local\/dsh-important-day'/)
})

test('只 require react，不 import 任何 dsh client 包', () => {
  const requires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  assert.deepEqual(requires, ['react'])
  assert.ok(!/require\(\s*['"]@deepseek-ai\//.test(source))
})

test('注册 settings.section 槽位，id 为 important-day', () => {
  assert.match(source, /ctx\.slots\.inject\('settings\.section'/)
  assert.match(source, /name: 'settings\.section'/)
  assert.match(source, /id: 'important-day'/)
})

test('样式只使用 --dsw-alias-* / --dsw-* 主题 token 的颜色', () => {
  const css = source.slice(source.indexOf('const CSS = ['), source.indexOf('].join('))
  const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map(m => m[0])
  // 只允许开关滑块使用纯白（和宿主原生 switch 一致）
  assert.ok(literals.every(value => value === '#fff'), `出现裸颜色：${[...new Set(literals)].join(', ')}`)
})

test('package.json 声明了 client 出口与 dsh.client', () => {
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('client.js'))
})

test('locale 资源导出了 meta.title / meta.description', () => {
  for (const lang of ['zh', 'en']) {
    const dict = JSON.parse(fs.readFileSync(path.join(root, 'locale', `${lang}.json`), 'utf8'))
    assert.ok(dict.meta.title && dict.meta.description, `${lang}.json 缺 meta`)
  }
})

test('icon.svg 存在且小于 256 KiB，只含 SVG 基本元素', () => {
  const file = path.join(root, 'icon.svg')
  const stat = fs.statSync(file)
  assert.ok(stat.size > 0 && stat.size < 256 * 1024, `icon.svg 大小异常：${stat.size}`)
  const svg = fs.readFileSync(file, 'utf8')
  assert.match(svg, /^<svg[\s>]/)
  assert.ok(!/<script/i.test(svg) && !/https?:/i.test(svg.replace(/xmlns="[^"]*"/g, '')), 'icon.svg 含脚本或外链')
})

test('页面不直接读写 localStorage（数据只在后端文档里）', () => {
  assert.ok(!/localStorage/.test(source))
})

console.log('')
if (failures.length) { console.log(`✗ ${passed} 通过，${failures.length} 失败`); process.exitCode = 1 }
else console.log(`✓ 全部 ${passed} 项 Client 静态检查通过`)
