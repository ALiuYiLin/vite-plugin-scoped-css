# vite-plugin-scoped-css

类 Vue scoped CSS 的 React 方案——零运行时开销，纯编译时样式隔离。

## 原理

所有转换在**编译时**完成。`useScoped()` 是一个编译标记——调用语句和导入语句都会在最终产物中被移除。

| 编译前（你的代码） | 编译后（产物） |
|---|---|
| `<div className="red">` | `<div className="red" data-v-19c20bfb>` |
| `.red { color: red; }` | `.red[data-v-19c20bfb] { color: red; }` |

每个 CSS 文件会生成唯一的 hash。`<div className="red">` 只会命中来自该 scoped 样式表的 `.red` 规则——不会受其他文件或第三方 CSS 影响。

## 安装

```bash
npm install vite-plugin-scoped-css
```

## 配置

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vitePluginScopedCSS from 'vite-plugin-scoped-css'

export default defineConfig({
  plugins: [vitePluginScopedCSS(), react()],
})
```

> **注意：** scoped 插件必须放在 `@vitejs/plugin-react` **前面**。

TypeScript 项目需要在 `vite-env.d.ts` 中添加类型引用：

```ts
declare module '*.css' {
  const css: string;
  export default css;
}
```

## 使用

```tsx
import styles from './style.css'
import { useScoped } from 'vite-plugin-scoped-css'

function App() {
  useScoped(styles)

  return (
    <div>
      <h1 className="title">Hello World</h1>
      <p className="red">这段文字是红色的——但只在这个组件里。</p>
    </div>
  )
}
```

```css
/* style.css */
.title { font-weight: bold; }
.red   { color: red; }
```

**就这么简单。** 样式被限定在 `App` 组件内，不会泄漏到其他组件或第三方代码中。

## 多个样式表

一个组件可以引入多个 scoped CSS 文件：

```tsx
import styles1 from './layout.css'
import styles2 from './theme.css'
import { useScoped } from 'vite-plugin-scoped-css'

function App() {
  useScoped(styles1)
  useScoped(styles2)

  return <div className="container primary">...</div>
}
```

## 产物效果

编译后 `useScoped` 完全消失，零运行时开销：

```bash
$ npm run build
dist/assets/index-xxx.css    # 选择器追加了 [data-v-hash]
dist/assets/index-xxx.js     # 元素挂上了 data-v-hash，useScoped 已移除
```

## License

MIT
