# dsh-tool-json

DSH JSON 查询工具插件 —— JMESPath 核心子集查询，零依赖、零进程、纯函数。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

Agent 处理 JSON 是高频操作——API 返回值、配置文件、工具输出到处都是 JSON。当前做法是起 bash 进程跑 `node -e` 或 `jq`，每次都有进程开销和字符串序列化成本。

DSH 内置 `grep` 可以做正则匹配，但无法理解 JSON 结构。对于 `{"items":[{"id":1}]}`：

- `grep` 只能做字符串级搜索，容易误匹配值、key、或嵌套子对象中的同名 key
- `json` 走结构化路径，只匹配指定路径，不混淆 key 和 value

## 使用场景

- **API 响应提取**：`json { input: <curl 响应体>, query: "stargazers_count" }` —— 只回传命中字段，不把整个响应灌进上下文
- **配置文件定点读取**：`json { input: <package.json>, query: "scripts.build" }`
- **通配符投影**：`json { input: <测试结果 JSON>, query: "testResults[*].status" }` → `["passed","passed","failed"]`
- **存在性判断**：`query: "error.message"` 抛错即"无错误"——布尔语义直接支撑决策分支

## 安全模型

**无 `eval`、无 `new Function`。** 手写递归下降解析器 + 只读查询执行器：

- 属性读取只走 `Object.hasOwn`（自有属性），`constructor` / `__proto__` / `prototype` 不触发原型链
- 通配符投影用 `Object.keys` 语义遍历（filter/map），不走 `for...in`，不枚举原型链成员
- 查询表达式深度上限 20 层、长度上限 200 字符
- 引号注入在词法层被拒绝；`eval` / `Function` 作为 key 只是普通字符串键名
- 输入循环引用不可能：字符串经 `JSON.parse`，对象形态由 DSH 参数管线保证 lossless JSON

## 架构

```
┌──────────────────────────────┐
│         DSH Agent             │
│  json { input: <JSON>,       │
│         query: "a.b[0].c" }  │
└──────────┬───────────────────┘
           │ ctx.tools.register()
┌──────────▼───────────────────┐
│     src/index.ts             │
│     Cordis 插件入口           │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│     src/query.ts             │
│     parseQuery() → execute() │
│     递归下降查询解析器        │
└──────────────────────────────┘
```

- `src/index.ts`：Cordis 插件入口（`name`/`inject`/`apply`），注册 `json` 工具
- `src/query.ts`：`parseQuery()` 解析查询表达式为 AST 步骤，`executeQuery()` 逐路径求值；`normalizeInput()` 归一化字符串/对象双形态输入

## 工具声明

```ts
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { query } from './query.ts'

export const name = '@deepseek-ai/dsh-tool-json'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'json',
    description:
      'Query JSON with a path expression. ' +
      'Supports dot-notation (foo.bar), bracket-indexing (items[0]), ' +
      "bracket-property (items['key'] or items[\"key\"]), and wildcard " +
      'projection (items[*].name). Returns the matched value as JSON.',
    parameters: {
      input: {
        type: 'json',
        required: true,
        description: 'JSON value or JSON string to query.',
      },
      query: {
        type: 'string',
        required: true,
        description: 'Path expression, e.g. "data.items[0].name".',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args) => {
      const { input, query: queryStr } = args as { input: unknown; query: string }
      return query(input, queryStr)
    },
    timeoutMs: 1000,
  }))
}
```

关键设计：

- `input: { type: 'json' }` — **双形态**：对象直传（模型直接生成参数，零转义）或字符串（bash/read 原文透传），`normalizeInput` 统一归一化
- `output.schema: { type: 'json' }` — canonical 值是结构化 JSON，Code Mode 里 `tools.json(...)` 直接拿到对象，无需二次 parse；`render` 负责序列化为模型可见文本

## 查询语法（JMESPath 核心子集）

| 表达式 | 示例 | 说明 |
|--------|------|------|
| 点号访问 | `foo.bar` | 嵌套对象属性 |
| 方括号索引 | `items[0]` | 数组索引 |
| 方括号属性 | `items['key']` / `items["key"]` | 含特殊字符的属性名；单引号为 JMESPath 标准，双引号兼容 |
| 通配符投影 | `items[*].name` | 提取数组所有元素的 name；**只作用于数组**，非对象元素按投影语义跳过 |
| 组合嵌套 | `a.b[0].c.d` | 以上全部自由组合 |

**不支持**（低频场景，bash + node 兜底）：过滤器 `[?downloads > 1000]`、多级通配符（`items[*].tags[*]` 返回嵌套数组）、管道 `|`、函数调用。

**错误语义**：属性不存在、数组越界、通配符用于非数组、无效 JSON 均抛错——DSH 工具管线统一转为 `isError` 结果，agent 直接从错误信息学习。

## 接入方式

### 前置条件

- DSH monorepo（`snapshot-20260803T142347Z-25b2ad4f67` 或更新）
- `@deepseek-ai/dsh-tools` 通过 monorepo workspace 可用

### 步骤

**1. 放入 monorepo**

```bash
cp -r dsh-tool-json ~/.dsh/source/master/packages/tools/dsh-tool-json
```

> DSH 使用 `packages/*/*` 两层 workspace 模式。本包必须放在 `packages/tools/` 下。

**2. 注册依赖**（`apps/cli/package.json`）

```json
"@deepseek-ai/dsh-tool-json": "workspace:^"
```

**3. 配置 cordis.yml**（`apps/cli/config/base.cordis.yml`）

```yaml
- id: tool-json
  name: '@deepseek-ai/dsh-tool-json'
```

**4. 注册 tsconfig 引用**（`tsconfig.host.json` 的 `references`）

```json
{ "path": "./packages/tools/dsh-tool-json" }
```

**5. 构建并验证**

```bash
pnpm install
pnpm run build
dsh -p "用json工具从 {\"items\":[{\"name\":\"a\"}]} 提取 items[0].name"
```

## 用法

安装后，agent 自动获得 `json` 工具：

```
json { input: <JSON>, query: "items[0].name" }        → "hello"
json { input: <JSON>, query: "items[*].name" }         → ["a", "b"]
json { input: <JSON>, query: "items['complex-key']" }  → "ok"
```

## 已知限制

1. **分发链路**：`@deepseek-ai/dsh-tools` 是 DSH monorepo 私有包（未发布 npm），本插件需放入 monorepo 走 workspace 解析
2. **只读**：不能修改 JSON 字段（原地修改请用 `str_replace_editor`/`write`；v2 可考虑 `set` 模式）
3. **无过滤器表达式**：`[?downloads > 1000]` 等过滤/聚合不支持——低频，bash + node 兜底
4. **对象形态 input 依赖 DSH 参数管线**：保证 lossless JSON 语义

## 测试

```bash
pnpm test
```

包含功能用例与攻击载荷用例（`constructor`/`__proto__` 原型链防护、深度/长度上限、引号注入等）。完整用例清单见本地维护的设计文档。

## 许可

MIT
