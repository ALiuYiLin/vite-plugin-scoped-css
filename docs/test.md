# 测试说明

## 运行

```bash
pnpm test          # 一次性运行
pnpm test:watch    # watch 模式
```

## 架构

每个测试通过 `buildFixture()` 在临时目录中创建一个完整的 Vite 项目，调用 `vite.build()` 构建后，直接断言 `dist/assets` 中的产物内容。

```
buildFixture({ components, styles })
  ├── 写入 src/App.tsx（组件代码）
  ├── 写入 src/*.css（样式文件）
  ├── 写入 src/main.tsx（入口 + createRoot 挂载，防止 tree-shake）
  ├── 写入 vite.config.ts（加载插件）
  ├── vite.build()
  └── 返回 { css, js }（构建产物字符串）
```

共 **11** 个测试，覆盖 **6** 个维度。

---

## CSS 变换

### 1. 选择器追加 hash

验证基本功能：CSS 选择器被追加 `[data-v-hash]`。

```
输入:  .red { color: red; }
输出:  .red[data-v-xxx] { color: red; }
```

### 2. 逗号分隔选择器

多个选择器各自追加 hash。

```
输入:  .a, .b { color: red; }
输出:  .a[data-v-xxx], .b[data-v-xxx] { color: red; }
```

### 3. 跳过 @keyframes

`@keyframes` 内部的 `from` / `to` 选择器**不应该**被 scoped。

```
输入:  @keyframes spin { from { ... } to { ... } }
        .x { color: red; }
输出:  from, to 不变，.x 追加 [data-v-xxx]
```

### 4. @media 内嵌套规则

`@media` 内部的选择器需要**递归变换**。

```
输入:  @media screen { .x { color: red; } }
输出:  @media screen { .x[data-v-xxx] { color: red; } }
```

---

## JSX 变换

### 5. 元素加 data-v-*

组件内所有 JSX 元素被添加 `data-v-hash` 属性。

```tsx
// 输入
<div className="red">hi</div>

// 输出 (React.createElement)
{ className: "red", "data-v-xxx": "" }
```

### 6. useScoped 被移除

`useScoped()` 调用和 `import { useScoped }` 在最终产物中**不存在**，零运行时开销。

---

## 函数级隔离

### 7. 不同组件不同 hash

同一文件中两个组件各自调用 `useScoped()`，JSX 元素**只带自己的 hash**，不交叉污染。

```tsx
function App()   { useScoped(stylesA); return <div className="x">...</div>; }
function Card()  { useScoped(stylesB); return <div className="x">...</div>; }
// App 的 div → data-v-hashA（只有 A 的 hash）
// Card 的 div → data-v-hashB（只有 B 的 hash）
```

### 8. CSS 与 JS hash 一致

同一个 CSS 文件在 CSS 产物和 JS 产物中的 hash 值**完全相同**。

---

## 边界情况

### 9. 无 useScoped 不添加 hash

没有调用 `useScoped()` 的组件，元素上**不出现**任何 `data-v-*` 属性。

### 10. 单组件多样式表

一个组件调用多次 `useScoped()`，元素上同时带多个 hash。

```tsx
useScoped(s1); useScoped(s2);
// div 携带 data-v-hash1 和 data-v-hash2
```

### 11. hash 确定性

不同路径的 CSS 文件生成不同 hash，同一路径生成相同 hash，确保跨构建一致。
