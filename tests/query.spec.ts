import { describe, expect, it } from 'vitest'
import { query } from '../src/query.ts'

describe('query', () => {
  const data = {
    foo: { bar: 42 },
    items: [
      { name: 'a', meta: { version: 1 } },
      { name: 'b', meta: { version: 2 } },
      42,
      null,
    ],
    'complex-key': 'ok',
    flag: true,
    nil: null,
    数据: { 名称: 'test' },
    arr: [1, 2, 3],
    deep: { a: { b: { c: { d: 'found' } } } },
  }

  // ── 功能用例 ──

  it('simple property access', () => {
    expect(query(data, 'foo.bar')).toBe(42)
  })

  it('nested object', () => {
    expect(query(data, 'foo')).toEqual({ bar: 42 })
  })

  it('array indexing', () => {
    expect(query(data, 'items[0]')).toEqual({ name: 'a', meta: { version: 1 } })
  })

  it('index + property', () => {
    expect(query(data, 'items[0].name')).toBe('a')
  })

  it('bracket property (single quotes)', () => {
    expect(query(data, "items[0]['name']")).toBe('a')
  })

  it('bracket property (double quotes)', () => {
    expect(query(data, 'items[0]["name"]')).toBe('a')
  })

  it('bracket property reads complex key', () => {
    expect(query(data, "['complex-key']")).toBe('ok')
  })

  it('wildcard projection extracts names', () => {
    // items[0].name='a', items[1].name='b', items[2] skipped (not object), items[3] skipped (null)
    expect(query(data, 'items[*].name')).toEqual(['a', 'b'])
  })

  it('wildcard projection with nested path', () => {
    expect(query(data, 'items[*].meta.version')).toEqual([1, 2])
  })

  it('scalar result (number)', () => {
    expect(query(data, 'foo.bar')).toBe(42)
  })

  it('boolean result', () => {
    expect(query(data, 'flag')).toBe(true)
  })

  it('null result', () => {
    expect(query(data, 'nil')).toBeNull()
  })

  it('unicode key', () => {
    expect(query(data, '数据.名称')).toBe('test')
  })

  it('empty query returns whole input', () => {
    expect(query(data, '')).toEqual(data)
  })

  it('deeply nested access', () => {
    expect(query(data, 'deep.a.b.c.d')).toBe('found')
  })

  it('combines dot and bracket', () => {
    expect(query(data, 'items[1].meta.version')).toBe(2)
  })

  it('array index 0 returns first element', () => {
    expect(query(data, 'arr[0]')).toBe(1)
  })

  it('wildcard without trailing path returns array elements', () => {
    expect(query(data, 'arr[*]')).toEqual([1, 2, 3])
  })

  // ── 错误用例 ──

  it('property not found', () => {
    expect(() => query(data, 'foo.baz')).toThrow('not found')
  })

  it('index out of bounds', () => {
    expect(() => query(data, 'items[99]')).toThrow('out of bounds')
  })

  it('wildcard on non-array', () => {
    expect(() => query(data, 'foo[*]')).toThrow('non-array')
  })

  it('index on non-array', () => {
    expect(() => query(data, 'foo[0]')).toThrow('non-array')
  })

  it('access on null intermediate', () => {
    expect(() => query(data, 'nil.foo')).toThrow('null/undefined')
  })

  // ── 攻击载荷 ──

  it('rejects constructor access (prototype safety)', () => {
    expect(() => query(data, 'constructor')).toThrow('not found')
  })

  it('rejects __proto__ access', () => {
    expect(() => query(data, '__proto__')).toThrow('not found')
  })

  it('rejects prototype access', () => {
    // 'prototype' as a data key is fine — but on a regular object it won't exist
    expect(() => query(data, 'prototype')).toThrow('not found')
  })

  it('wildcard does not leak prototype properties', () => {
    const obj = { items: [{ name: 'ok' }] }
    // Wildcard uses Object.keys — should only see own keys
    expect(query(obj, 'items[*].name')).toEqual(['ok'])
  })

  it('rejects depth over 20', () => {
    const deep = '.b'.repeat(21)
    expect(() => query({}, deep)).toThrow('depth')
  })

  it('rejects query over 200 chars', () => {
    const long = 'a'.repeat(201)
    expect(() => query({ a: 1 }, long)).toThrow('too long')
  })

  it('rejects quote injection', () => {
    expect(() => query(data, "items[0]['name' // ']")).toThrow()
  })

  it('treats eval as plain key name', () => {
    // eval is not a reserved word in our parser
    expect(() => query(data, 'eval')).toThrow('not found')
  })

  // ── 补充用例（评审 T1-T4）──

  it('empty array wildcard returns empty array (T1)', () => {
    expect(query({ arr: [] }, 'arr[*].name')).toEqual([])
  })

  it('rejects invalid JSON string input (T2)', () => {
    expect(() => query('not json', 'foo')).toThrow('invalid JSON')
  })

  it('accepts valid JSON string input (T2)', () => {
    expect(query('{"a":1}', 'a')).toBe(1)
  })

  it('wildcard skips elements missing the projected property (T3)', () => {
    expect(query({ items: [{}, { name: 'b' }, { name: 'c' }] }, 'items[*].name'))
      .toEqual(['b', 'c'])
  })

  it('multi-level wildcard returns nested arrays (T4)', () => {
    // 不支持标准扁平化（JMESPath 多级投影），返回嵌套数组
    const data = { items: [{ tags: ['a', 'b'] }, { tags: ['c'] }] }
    expect(query(data, 'items[*].tags[*]')).toEqual([['a', 'b'], ['c']])
  })
})

import { normalizeInput } from '../src/query.ts'

describe('normalizeInput', () => {
  it('passes through objects', () => {
    expect(normalizeInput({ a: 1 })).toEqual({ a: 1 })
  })

  it('parses valid JSON strings', () => {
    expect(normalizeInput('{"a":1}')).toEqual({ a: 1 })
  })

  it('rejects invalid JSON strings', () => {
    expect(() => normalizeInput('not json')).toThrow('invalid JSON')
  })
})
