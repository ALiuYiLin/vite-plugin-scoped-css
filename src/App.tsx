import styles from './style.css'
import { useScoped } from 'virtual:scoped-css'

function App() {
  useScoped(styles)

  return (
    <div>
      <h1 className="title">Scoped CSS Demo</h1>
      <p className="red">This text is red (scoped)</p>
      <div className="box">
        <p>Content inside box (scoped)</p>
      </div>
      <p className="red">This is also red (scoped)</p>
    </div>
  )
}

export default App
