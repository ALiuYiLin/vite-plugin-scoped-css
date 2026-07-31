import { useScoped } from 'vite-plugin-scoped-css/runtime'
import appCss from './style.css'
import cardCss from './card.css'
import bannerCss from './banner.css'

/* ── App：红色主题 ── */
function App() {
  useScoped(appCss)

  return (
    <div>
      <h1 className="title">App — 红色主题 (scoped)</h1>
      <p className="text">
        这段文字应该是红色的，只受 style.css 影响。
      </p>
      <div className="box">
        <p>App 的 box 容器</p>
        <Card />
        <Banner />
      </div>
    </div>
  )
}

/* ── Card：蓝色主题，和 App 同名 class ── */
function Card() {
  useScoped(cardCss)

  return (
    <div className="box">
      <h2 className="title">Card — 蓝色主题 (scoped)</h2>
      <p className="text">
        这里如果隔离生效，文字是蓝色，不是红色。
      </p>
    </div>
  )
}

/* ── Banner：绿色主题，再次同名 ── */
function Banner() {
  useScoped(bannerCss)

  return (
    <div className="box">
      <h2 className="title">Banner — 绿色主题 (scoped)</h2>
      <p className="text">
        这里如果隔离生效，文字是绿色，不是红色/蓝色。
      </p>
      <BannerInner />
    </div>
  )
}

/* ── BannerInner：不调用 useScoped，应该没有 data-v-* ── */
function BannerInner() {
  return (
    <p style={{ fontStyle: 'italic' }}>
      这是 Banner 的子组件。没有 useScoped，元素上不带 data-v-hash，
      所以不会被任何 scoped 样式命中。
    </p>
  )
}

export default App
