● 从三个层面来讲：CSS 编译变换、JSX 编译变换、Hash 一致性保证。

  ---
  整体数据流

  源文件                         Vite 插件管线                    产物
  ───────                       ──────────────                   ────
  App.tsx  ──→ [scoped-css:jsx]  ──→ [@vitejs/plugin-react] ──→ JS bundle
  style.css ──→ [scoped-css:css] ──→ [Vite CSS pipeline]      ──→ CSS bundle

  关键是插件通过 enforce: 'pre' 确保在 React 插件和 Vite CSS 处理器之前运行。

  ---
  一、JSX 端：Babel AST 变换

  这是最核心的部分。当 Vite 处理 App.tsx 时，插件用 Babel 把源码解析成 AST，然后做三件事：

  1. 找到 useScoped(x) 并追踪导入源

  import styles from './style.css'      ← ImportDeclaration
         ↓
         │  binding: { referencePaths: [...] }
         ↓
  useScoped(styles)                     ← CallExpression
         ↓
         │  callee.name === 'useScoped'
         │  arguments[0] → binding → ImportDeclaration → './style.css'
         ↓
  计算 hash('./style.css') = "19c20bfb"

  关键代码逻辑：

  // 遍历所有 import 语句
  ImportDeclaration(impPath) {
    const source = impPath.node.source.value; // './style.css'

    for (const spec of specifiers) {
      const binding = impPath.scope.getBinding(spec.local.name);
      // binding.referencePaths 包含所有引用这个变量的地方

      for (const ref of binding.referencePaths) {
        const callExpr = ref.parentPath; // 引用出现在 useScoped(styles) 的 arguments 中
        if (callExpr.node.callee?.name === 'useScoped') {
          // 找到了！这个 import 是 scoped CSS
          usedByUseScoped = true;
        }
      }
    }
  }

  2. 改写产物

  找到后执行三个修改：

  ┌────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┐
  │                              修改                              │                          原因                           │
  ├────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ import styles from './style.css' → import './style.css?scoped' │ 去掉 default 导出声明，添加 ?scoped 标记让 CSS 插件识别 │
  ├────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ 删除 useScoped(styles) 语句                                    │ 纯编译时标记，运行时不需要                              │
  ├────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────┤
  │ 所有 JSX 元素加 data-v-{hash}=""                               │ 让元素能被 CSS 选择器命中                               │
  └────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────┘

  // 添加 data 属性到 JSX 元素
  JSXElement(jsxPath) {
    opening.attributes.push(
      t.jsxAttribute(t.jsxIdentifier('data-v-19c20bfb'), t.stringLiteral(''))
    );
  }

  3. 为什么用 Babel 而不是正则

  useScoped(styles) 可以出现在任何位置——箭头函数、函数声明、嵌套作用域。正则无法可靠地处理 JSX 嵌套结构。Babel 的 scope.getBinding() 能精确追踪标识符的引用链。

  ---
  二、CSS 端：选择器改写

  CSS 插件拦截带 ?scoped 查询参数的 CSS 文件，逐字符扫描，找到每个规则块，给选择器追加属性选择器：

  输入：                         输出：
  .red { color: red; }    →    .red[data-v-19c20bfb] { color: red; }

  .red, .blue { ... }     →    .red[data-v-19c20bfb], .blue[data-v-19c20bfb] { ... }

  @media screen {         →    @media screen {
    .red { ... }                   .red[data-v-19c20bfb] { ... }
  }                             }

  核心是对花括号的深度追踪：

  function findMatchingBrace(css, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') { depth--; if (depth === 0) return i; }
    }
  }

  这样能正确处理嵌套规则和 @media 查询——@media 本身不被修改，但其内部的 .red 仍会被改写。

  跳过的规则：
  - @keyframes / @font-face — 它们的选择器是 from、to、百分比，不需要 scoped
  - @import / @charset — 元规则
  - :root / :host — 全局伪类

  ---
  三、Hash 一致性：路径归一化

  这是最容易出错的环节。CSS 端和 JSX 端必须算出同一个 hash，否则样式匹配失败。

  JSX 端:  path.resolve('D:/code3/react-demo/src', './style.css')
           → 'D:\code3\react-demo\src\style.css'   ← Windows 反斜杠

  CSS 端:  Vite 传过来的 module id
           → 'D:/code3/react-demo/src/style.css'    ← Vite 统一用正斜杠

  不同分隔符 → 不同字符串 → 不同 MD5 → 样式失效。

  修复方式：两端都做 replace(/\\/g, '/') 归一化到正斜杠。

  两边统一为: 'D:/code3/react-demo/src/style.css'
  MD5 前 8 位: 19c20bfb  ✅ 一致

  ---
  四、编译时 vs 运行时

  最终产物里 useScoped 的引用次数是 0——它只在编译期间存在，作用是告诉编译器"这个组件需要 scoped 样式"。运行时开销为零。

  编译前:
    import styles from './style.css'
    import { useScoped } from 'virtual:scoped-css'

    function App() {
      useScoped(styles)              ← 标记，编译时移除
      return <div className="red" />  ← 编译时加 data-v-19c20bfb
    }

  编译后:
    import './style.css?scoped'       ← 副作用导入，加载 CSS
    // useScoped 导入和调用都被删除

    function App() {
      return <div className="red" data-v-19c20bfb="" />
    }

  CSS 和 JSX 变换的效果在构建时已经固化到产物里，不需要任何运行时配合。

  ---
  五、三个插件的协作

  Vite 的插件数组是按顺序注册的：

  export default defineConfig({
    plugins: [
      vitePluginScopedCSS(),  // 返回 3 个插件: [virtual, css, jsx]
      react(),                // @vitejs/plugin-react
    ],
  })

  Vite 内部会按 enforce 字段排序执行顺序：

                   enforce: 'pre'    默认 enforce     enforce: 'post'
                          │               │                │
  scoped-css:css ─────────┤               │                │
  scoped-css:jsx ─────────┤               │                │
                          └─ 先执行 ──→   react()    ──→  Vite 内置 CSS
                                          │
                            scoped-css:virtual (resolveId/load 不参与 enforce)

  - scoped-css:jsx 先把 TSX 中的 JSX 改写好，然后 react() 把改写后的 JSX 转成 React.createElement 调用
  - scoped-css:css 先把选择器改写好，然后 Vite 内置的 lightningcss 做压缩

  两者互不依赖，顺序靠 enforce: 'pre' 保证。