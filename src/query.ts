/**
 * JMESPath 核心子集查询解析器 + 执行器 —— 零依赖，纯函数。
 *
 * 语法：点号访问 (foo.bar) | 方括号索引 (items[0]) | 方括号属性
 * (items['key'] | items["key"]) | 通配符投影 (items[*].name)
 *
 * 安全：无 eval/new Function；Object.hasOwn 防原型链；
 * Object.keys 遍历防泄漏；深度上限 20 层；长度上限 200 字符。
 */

const MAX_DEPTH = 20
const MAX_LENGTH = 200

// ── 查询 AST ──

type QueryStep =
  | { kind: 'dot'; key: string }
  | { kind: 'bracket'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }

// ── 解析器 ──

function parseQuery(input: string): QueryStep[] {
  if (input.length > MAX_LENGTH) throw new Error(`Query too long (${input.length} > ${MAX_LENGTH})`)
  if (input === '') return []
  const steps: QueryStep[] = []
  let pos = 0

  const peek = (): string | undefined => input.charAt(pos)
  const take = (): string => input.charAt(pos++)
  const err = (msg: string): never => { throw new Error(`json: ${msg} at position ${pos}`) }

  while (pos < input.length) {
    if (steps.length >= MAX_DEPTH) err(`query depth exceeds ${MAX_DEPTH}`)

    if (peek() === '.') {
      take() // '.'
      const start = pos
      while (pos < input.length && /[A-Za-z0-9_$-￿]/.test(input.charAt(pos))) pos++
      if (pos === start) err('expected property name after "."')
      steps.push({ kind: 'dot', key: input.slice(start, pos) })
      continue
    }

    if (peek() === '[') {
      take() // '['
      if (peek() === '*') {
        take()
        if (peek() !== ']') err('expected "]" after "*"')
        take()
        steps.push({ kind: 'wildcard' })
        continue
      }

      if (peek() === "'" || peek() === '"') {
        const quote = take()
        const start = pos
        while (pos < input.length && input.charAt(pos) !== quote) pos++
        if (pos >= input.length) err(`missing closing ${quote}`)
        const key = input.slice(start, pos)
        take() // closing quote
        if (peek() !== ']') err('expected "]" after property key')
        take()
        steps.push({ kind: 'bracket', key })
        continue
      }

      if (/[0-9]/.test(peek()!)) {
        const start = pos
        while (pos < input.length && /[0-9]/.test(input.charAt(pos))) pos++
        const idx = Number(input.slice(start, pos))
        if (peek() !== ']') err('expected "]" after index')
        take()
        steps.push({ kind: 'index', index: idx })
        continue
      }

      err('expected "*", digit, or quote after "["')
    }

    // 起始位置：裸标识符（无前导 "." 的点号访问）
    if (pos === 0 && /[A-Za-z_$-￿]/.test(peek()!)) {
      const start = pos
      while (pos < input.length && /[A-Za-z0-9_$-￿]/.test(input.charAt(pos))) pos++
      steps.push({ kind: 'dot', key: input.slice(start, pos) })
      continue
    }

    err(`unexpected character "${peek()}"`)
  }

  return steps
}

// ── 执行器 ──

function executeQuery(steps: QueryStep[], value: unknown): unknown {
  let current: unknown = value
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    if (current === null || current === undefined) throw new Error(`json: cannot access property on null/undefined`)
    if (typeof current !== 'object') throw new Error(`json: cannot access property on ${typeof current}`)

    if (step.kind === 'dot' || step.kind === 'bracket') {
      if (!Object.hasOwn(current as object, step.key)) throw new Error(`json: property "${step.key}" not found`)
      current = (current as Record<string, unknown>)[step.key]
      continue
    }

    if (step.kind === 'index') {
      if (!Array.isArray(current)) throw new Error('json: index access on non-array')
      if (step.index >= (current as unknown[]).length) throw new Error(`json: index ${step.index} out of bounds (length ${(current as unknown[]).length})`)
      current = (current as unknown[])[step.index]
      continue
    }

    if (step.kind === 'wildcard') {
      if (!Array.isArray(current)) throw new Error('json: wildcard projection on non-array')
      const arr = current as unknown[]
      const remaining = steps.slice(i + 1)
      if (remaining.length === 0) {
        current = arr // 无后续路径：返回全体元素（含标量）
      } else {
        current = arr
          .filter(item => item !== null && item !== undefined && typeof item === 'object')
          .map(item => {
            try {
              return executeQuery(remaining, item)
            } catch {
              return null // 元素缺少属性时 JMESPath 跳过
            }
          })
          .filter(r => r !== null)
      }
      return current // 通配符是终态
    }
  }
  return current
}

// ── 输入归一化 ──

export function normalizeInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as unknown
    } catch {
      throw new Error('json: invalid JSON input')
    }
  }
  return input
}

// ── 公开接口 ──

export function query(jsonInput: unknown, queryStr: string): unknown {
  const steps = parseQuery(queryStr)
  return executeQuery(steps, normalizeInput(jsonInput))
}
