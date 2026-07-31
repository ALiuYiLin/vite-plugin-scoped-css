
编译前
```tsx
import styles from './style.css'
const App = ()=>{
  useScoped(styles)
  return <div className="red"></div>
}
```
编译后
```html
<div class="red data-v-[hash]"></div>
```
```css
.red[data-v-[hash]]{
  color: red;
}
```
