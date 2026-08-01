# React 新一代样式隔离方案 —— 编译时、零运行时、原生写法

> React 样式隔离一直是个老大难——CSS Modules 写法繁琐，CSS-in-JS 有运行时开销，Tailwind 类名太长。本文介绍一种新一代方案：编译时自动隔离，零运行时，保留原生 `className="red"` 写法。

---

## 一、痛点：React 的样式隔离之殇

React 从诞生的第一天起，就没打算管 CSS。JSX 给了你把 HTML 写在 JS 里的自由，但 CSS 呢？对不起，自己想办法。

这就催生了五花八门的方案，每一种都有明显的短板：

### 1. CSS Modules —— 用得最多，但不够优雅

```tsx
import styles from './App.module.css';

function App() {
  return <div className={styles.red}>hello</div>;
  //                     ↑ 每次都要 styles.xxx，心智负担重
}
```

- 选择器被编译成 hash，实现了隔离
- 但**使用方式极其繁琐**：`className={styles.red}`，每次都得多打 `styles.`
- 动态类名拼接痛苦：`className={`${styles.a} ${active ? styles.b : ''}`}`

### 2. CSS-in-JS —— 性能税太重

```tsx
const RedDiv = styled.div`color: red;`;
// 运行时解析 CSS、生成 class、注入 <style> 标签
```

- 每个组件 mount 都要跑一次 CSS 处理
- 增加 JS bundle 体积
- Server Component 下更是一堆坑

### 3. Tailwind CSS —— 不是所有团队都喜欢"塞满一行的类名"

```tsx
<div className="flex items-center justify-between px-4 py-2 bg-blue-500 rounded-lg shadow-md hover:bg-blue-600 transition-colors">
```

- 长到离谱的 class 字符串
- 样式和语义之间隔了一层"翻译"
- 对传统 CSS 开发者不友好

### 4. BEM 等命名约定 —— 纯靠纪律

```css
.App__header___3kL2x { }
```

- 依赖开发者的自觉，没有编译期保障
- 嵌套深了类名也丑了

### 为什么 Vue 的 `<style scoped>` 那么舒服？

```vue
<style scoped>
.red { color: red; }
</style>

<template>
  <div class="red">hello</div>
</template>
```

写普通的 CSS，用普通的 `class="red"`，编译后：

- CSS 变成 `.red[data-v-abc123] { color: red; }`
- HTML 变成 `<div class="red" data-v-abc123>hello</div>`

**自然的写法 + 可靠隔离**，不用 `styles.xxx`，不用运行时开销。

那 React 能不能也用上这套？——

**这就是 `vite-plugin-scoped-css` 要做的事。**

---

## 二、效果速览

先看 Before / After，直观感受一下：

### 编译前 —— 普通的 React + CSS

```tsx
// App.tsx
import { useScoped } from 'vite-plugin-scoped-css/runtime';
import styles from './App.css';

function App() {
  useScoped(styles);
  return <div className="red">hello</div>;
}
```

```css
/* App.css */
.red { color: red; }
```

### 编译后 —— 自动隔离

```tsx
// JS 产物
import './App.css?scoped';

function App() {
  return <div className="red" data-v-19c20bfb="">hello</div>;
}
```

```css
/* CSS 产物 */
.red[data-v-19c20bfb] { color: red; }
```

### 你会注意到：

1. **`useScoped(styles)` 完全消失了**——它是编译时标记，最终产物中**零运行时代码**
2. **`className="red"` 还是原来的写法**——不用改成 `className={styles.red}`
3. **CSS 选择器自动追加了属性选择器** `[data-v-19c20bfb]`
4. **JSX 元素自动加上了对应的属性**

---

## 三、实现原理

整个插件是一个 Vite 插件工厂函数，返回三个子插件，分别在 Vite 管线中处理不同的模块类型：

```
vitePluginScopedCSS()
├── Plugin A: scoped-css:css       → CSS 变换（enforce: 'pre'）
└── Plugin B: scoped-css:jsx       → JSX 变换（enforce: 'pre'）
```

关键是 `enforce: 'pre'`：确保在 React 插件和 Vite CSS 处理之前运行。

### 3.1 JSX 变换：两趟 AST 遍历 + 函数级隔离

JSX 变换是整个插件最复杂的部分，使用 Babel 来操作 AST。为什么是 Babel 而不是正则？因为：

- **`scope.getBinding()`** 能精确追踪标识符的引用链
- **`getFunctionParent()`** 能识别每个调用在哪个函数作用域内
- AST 层面可以同时做"加属性"和"删语句"，正则做不到

流程如下：

```
App.tsx 源码
  │
  ├── 快速跳过检查（无 useScoped / .css 则直接返回，避免浪费）
  │
  ├── @babel/parser → AST
  │
  ├── Pass 1：遍历 ImportDeclaration
  │   ├── 找到 import styles from './App.css'
  │   ├── 通过 scope.getBinding() 追踪 styles 的所有引用
  │   ├── 发现 useScoped(styles) —— 标记为 scoped
  │   ├── 计算 hash = MD5(CSS 文件路径).slice(0, 8)
  │   ├── 记录 getFunctionParent() → 函数节点映射
  │   │   Map { <App 函数节点> → [hash1], <Card 函数节点> → [hash2] }
  │   │        ↑ 这是实现组件级隔离的关键 ↑
  │   ├── 改写 import 为 './App.css?scoped'（纯副作用导入）
  │   └── 删除 useScoped() 调用语句
  │
  ├── Pass 2：遍历 JSXElement
  │   ├── jsxPath.getFunctionParent() → 当前在哪个函数
  │   ├── fnHashes.get(函数节点) → 该函数专属的 hash 列表
  │   └── 添加 data-v-hash 属性（多个 hash → 多个属性）
  │
  └── @babel/generator → 变换后代码
```

#### 函数级隔离 —— 与初版最重要的差异

第一版实现犯了一个严重错误：把文件中所有 hash 加到**全局所有 JSX 元素**上。同文件内的不同组件，样式会互相污染：

```tsx
// ❌ 初版：所有元素带全部 hash
function App()  { useScoped(stylesA); return <div className="x">A</div>; }
function Card() { useScoped(stylesB); return <div className="x">B</div>; }
// App 的 div 会带 hashA + hashB
// Card 的 div 也带 hashA + hashB
// 两个组件的样式互相污染！
```

修复方案是用 `Map<FunctionNode, hash[]>` 精确关联：

```tsx
// ✅ 修复后：每个函数只带自己调用的 hash
function App()  { return <div className="x" data-v-hashA="">A</div>; }
function Card() { return <div className="x" data-v-hashB="">B</div>; }
// 彻底隔离！
```

### 3.2 CSS 变换：逐字符扫描 + 递归处理

CSS 端拦截带 `?scoped` 查询参数的模块，对选择器追加属性选择器：

```
transformScopedCSS(css, hash)
  ├── while 扫描大括号
  │   ├── @keyframes / @font-face / @import → 完整跳过
  │   ├── @media / @supports / @container → 递归处理内部
  │   └── 普通选择器 → 追加 [data-v-hash]
  └── 返回变换后 CSS
```

选择器变换示例：

```
输入                              输出
.red { }                   →     .red[data-v-xxx] { }
.a, .b { }                 →     .a[data-v-xxx], .b[data-v-xxx] { }
@media screen { .x { } }   →     @media screen { .x[data-v-xxx] { } }
```

**不处理的选择器**：`@keyframes` 内部的 `from/to/N%`、`:root`、`:host` 等全局伪类。

### 3.3 Hash 一致性 —— 最容易踩的坑

JSX 端和 CSS 端是**独立计算 hash** 的，必须得到相同的值。在 Windows 上差点栽在这里：

```
JSX 端:  用 path.resolve() 生成路径 → 反斜杠 \
CSS 端:  Vite module id → 正斜杠 /

❌ 不归一化 → hash 不对，样式全部失效
✅ path.replace(/\\/g, '/').split('?')[0] → 统一后再 MD5
```

### 3.4 包入口分离 —— 避免 Babel 跑进浏览器

`vite-plugin-scoped-css` 的插件代码（jsx 变换）依赖 Babel（~600KB）。但这部分只跑在**编译时**。

组件中 import 的 `useScoped` 只需要一个空实现——作为编译时标记存在：

```json
// package.json exports
{
  ".":         "./dist/index.js",     // 插件入口（Node.js → 有 Babel）
  "./runtime": "./dist/runtime.js"    // useScoped 入口（浏览器 → 零依赖，~10 字节）
}
```

```ts
// dist/runtime.js —— 全部内容
export function useScoped(_styles) {}
```

Babel 插件在编译时会完整移除这个 import，所以即使不拆 runtime 路径 Babel 也不会被打包。但拆开是一个更安全的设计——万一有用户不做 import 移除（比如没启用插件），至少 browser bundle 不会凭空多出 600KB。

---

## 四、安装与使用

```bash
npm install vite-plugin-scoped-css
```

```ts
// vite.config.ts
import vitePluginScopedCSS from 'vite-plugin-scoped-css';

export default {
  plugins: [vitePluginScopedCSS()],
};
```

```tsx
// 组件代码
import { useScoped } from 'vite-plugin-scoped-css/runtime';
import styles from './App.css';

function App() {
  useScoped(styles);  // 编译时标记，产物中完全消失
  return <div className="red">hello</div>;
}
```

就这么简单。不需要改 `className` 写法，不需要引入任何运行时库。

---

## 五、与其它方案的对比

| 方案 | 隔离性 | 使用方式 | 运行时 | 动态样式 |
|------|--------|----------|--------|----------|
| CSS Modules | ✅ | `styles.xxx` | 无 | 一般 |
| CSS-in-JS | ✅ | 模板字符串 | 有 | ✅ |
| Tailwind | 无隔离 | `class="flex ..."` | 无 | ✅ |
| BEM | 靠纪律 | `class="block__el--mod"` | 无 | ✅ |
| **vite-plugin-scoped-css** | ✅ | `class="red"` 原生写法 | **无** | ✅ |

核心优势：**CSS Modules 级别的隔离 + 原生 CSS 写法 + 零运行时**。

---

## 六、局限与适用场景

### 当前局限

- **仅 Vite**：不支持 Webpack、Turbopack
- **CSS 预处理器支持有限**：`?scoped` 查询参数需要在 Vite CSS 管线的最前端拦截。如果和 Less/Sass 的 loader 序有问题，可能无法正确处理
- **不支持非组件内的样式注入**：如果 CSS 文件不以 `?scoped` 引用，自然不会被处理——但这其实也是一层保护

### 最适合的场景

- 从 Vue 转 React、怀念 `<style scoped>` 的开发者
- 中小型 React 项目——不想引入大型 CSS 方案
- 组件库——天然适合，每个组件独立 scoped

---

## 七、总结

`vite-plugin-scoped-css` 解决的是一个"小而痛"的问题：

- 不是要取代 CSS Modules 或 Tailwind
- 而是给那些**只想好好写普通 CSS、不想折腾**的人一个选择

它做的事本质上就是一件事：

> 让你像写 Vue 的 `<style scoped>` 一样，在 React 里写普通的 `className="red"`，然后忘了样式冲突这件事。

编译时搞定一切，产物里不留痕迹。

```bash
npm install vite-plugin-scoped-css
```

源码：[GitHub](https://github.com/ALiuYiLin/vite-plugin-scoped-css)

---

*如果你有类似的痛点或者更好的想法，欢迎 issue / PR。*
