import './styles.css'
import { createApp } from 'vue'
import App from './App.vue'
import { bootPanel } from './boot'

const app = createApp(App)

app.mount('#app')

void bootPanel().then((teardown) => {
  window.addEventListener('beforeunload', teardown)

  const originalUnmount = app.unmount.bind(app)

  app.unmount = (): void => {
    teardown()
    window.removeEventListener('beforeunload', teardown)
    originalUnmount()
  }
})
