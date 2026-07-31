import { useScoped } from 'vite-plugin-scoped-css/runtime'
import styles from './style.css'
import infoStyle from  './style2.css'


function App() {
  useScoped(styles)

  return (
    <div>
      <h1 className="title">Scoped CSS Demo</h1>
      <p className="red">This text is red (scoped)</p>
      <div className="box">
        <p>Content inside box (scoped)</p>
        <MyInfos></MyInfos>
      </div>
      <p className="red">This is also red (scoped)</p>
    </div>
  )
}

function MyInfos(){
  useScoped(infoStyle)
  return <div><p>Content inside box (scoped)</p></div>
}

export default App
