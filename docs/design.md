# vite-plugin-scoped-css 设计文档

## 总览

这是一个 Vite 插件，为 React 提供类似 Vue `scoped` 的样式隔离——**纯编译时**，零运行时开销。

```
源文件                           Vite 插件管线                      产物
───────                         ──────────────                     ────
App.tsx  ──→ [scoped-css:jsx] → [@vitejs/plugin-react]  ──→ JS bundle
style.css ──→ [scoped-css:css] → [Vite CSS pipeline]      ──→ CSS bundle
```

关键设计：`enforce: 'pre'` 确保在 React 插件和 Vite CSS 处理器之前运行。

---

## 架构

插件是一个返回 3 个 Vite 插件数组的工厂函数：

```
vitePluginScopedCSS()
├── Plugin A: scoped-css:virtual     → 虚拟模块 virtual:scoped-css（兼容旧用法）
├── Plugin B: scoped-css:css         → CSS 变换（enforce: pre）
└── Plugin C: scoped-css:jsx         → JSX 变换（enforce: pre）
```

### 包入口分离

为**避免 Babel（~600KB）被打包进浏览器**，包拆成两个入口：

| 入口 | 用在哪 | 依赖 |
|------|--------|------|
| `vite-plugin-scoped-css` | `vite.config.ts`（Node.js 端） | Babel |
| `vite-plugin-scoped-css/runtime` | 组件代码（浏览器端） | 零依赖，~10 字节 |

```tsx
// 组件中只导入 runtime——零开销
import { useScoped } from 'vite-plugin-scoped-css/runtime';
```

Babel 插件在编译时会**完整移除**这个 import 和所有 `useScoped()` 调用，所以即使不拆 runtime 路径也不会有 Babel 入包，但拆开更安全。

---

## 一、JSX 变换（Babel AST）

### 整体流程

```
App.tsx 源码
  │
  ├── 快速跳过检查（无 useScoped / .css 则跳过）
  │
  ├── @babel/parser → AST
  │
  ├── Pass 1：遍历 ImportDeclaration
  │   ├── 找到 import styles from './style.css'
  │   ├── 通过 scope.getBinding() 追踪 styles 的引用
  │   ├── 发现 useScoped(styles) → 标记为 scoped
  │   ├── 计算 hash = MD5(CSS 文件路径).slice(0, 8)
  │   ├── 记录 callExpr.getFunctionParent() → 函数节点的映射
  │   │   Map { <App 函数节点> → [hash1], <Card 函数节点> → [hash2] }
  │   ├── 改写 import 为 './style.css?scoped'
  │   └── 移除 useScoped() 调用语句
  │
  ├── Pass 2：遍历 JSXElement
  │   ├── jsxPath.getFunctionParent() → 函数节点
  │   ├── fnHashes.get(函数节点) → 该函数专属的 hash 列表
  │   └── 添加 data-v-hash 属性
  │
  └── @babel/generator → 变换后代码
```

### 为什么用 Babel？

- `scope.getBinding()` 精确追踪标识符引用链，跨作用域定位
- `getFunctionParent()` 按函数隔离 hash，实现**按组件 scoped**
- 可以同时做"添加属性"和"删除语句"两个操作

正则无法可靠处理 JSX 嵌套和跨作用域引用。

### 函数级隔离

这是与初版最重要的差异。初版把所有 hash 加到文件内**全部 JSX 元素**，导致同文件不同组件的样式互相污染。

```tsx
// 源码
function App()   { useScoped(stylesA); return <div className="x">A</div>; }
function Card()  { useScoped(stylesB); return <div className="x">B</div>; }

// 产物
function App()   { return <div className="x" data-v-hashA="">A</div>; }
function Card()  { return <div className="x" data-v-hashB="">B</div>; }
//                          ↑ App 不带 hashB，Card 不带 hashA ↑
```

用 `Map<FunctionNode, hash[]>` 精确关联。

---

## 二、CSS 变换

拦截带 `?scoped` 查询参数的 CSS 文件，逐字符扫描规则块，追加属性选择器。

### 核心算法

```
transformScopedCSS(css, hash)
  ├── while 扫描每个 {
  │   ├── @keyframes / @font-face / @import → 完整跳过
  │   ├── @media / @supports / @container → 递归处理内部
  │   └── 普通选择器 → transformSelector 追加 [data-v-hash]
  └── 返回变换后 CSS
```

### 选择器变换规则

```
输入                              输出
.red { }                   →     .red[data-v-xxx] { }
.a, .b { }                 →     .a[data-v-xxx], .b[data-v-xxx] { }
@media screen { .x { } }   →     @media screen { .x[data-v-xxx] { } }
```

### 跳过的规则

- `@keyframes` / `@font-face` / `@import` / `@charset` / `@namespace` — 整体跳过
- `from` / `to` / `N%` — keyframe 选择器
- `:root` / `:host` — 全局伪类

---

## 三、Hash 一致性

JSX 端和 CSS 端**独立计算 hash**，必须完全一致。

```
JSX 端:  path.resolve(tsxDir, './style.css') → 归一化正斜杠 → MD5
CSS 端:  Vite 的 module id → 归一化正斜杠         → MD5

归一化: path.replace(/\\/g, '/').split('?')[0]
```

如果两端路径不同（Windows 反斜杠 vs Vite 正斜杠），hash 不匹配，样式彻底失效。

---

## 四、编译时 vs 运行时

所有变换在 **Vite build** 阶段完成，产物中零运行时代码。

```
// ── 编译前 ──
import { useScoped } from 'vite-plugin-scoped-css/runtime';
import styles from './style.css';

function App() {
  useScoped(styles);
  return <div className="red">hello</div>;
}

// ── 编译后 ──
import './style.css?scoped';

function App() {
  return <div className="red" data-v-19c20bfb="">hello</div>;
}
```

`useScoped` 完全消失——它是编译时标记，无运行时痕迹。

---

## 五、构建流程

```
pnpm build
  ├── tsc -p tsconfig.build.json    → src/*.ts → dist/*.js + dist/*.d.ts
  └── cp src/types.d.ts dist/       → 环境声明复制到 dist
```

- `tsconfig.json` — 开发类型检查（`noEmit: true`）
- `tsconfig.build.json` — 构建配置（extends 基础，`noEmit: false`, `declaration: true`）

---

## 六、发布入口

```
package.json exports:
  "."           → dist/index.js    + dist/index.d.ts   （插件工厂，vite.config.ts 用）
  "./runtime"   → dist/runtime.js  + dist/runtime.d.ts （useScoped，组件代码用）
```

`files: ["dist"]` — src / tests / docs 不参与发布。
