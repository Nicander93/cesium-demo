import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import * as Cesium from 'cesium'
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OWQ2NGJkZS0yODlmLTRlZjItYjZhYy03Mjc5MmM2OWM0OTkiLCJpZCI6NDAyNDQsImlhdCI6MTY2ODIzODM1OX0.au0c5QRIKaUh_Crsz6sfDfdSj2ePoQyaRcXcoXdcqOw';
// The offline renderer lab uses native controls and does not need the optional icon CDN.
router.afterEach(route => {
  if (route.path.replace(/\/$/, '') === '/water-flow-lab' || document.getElementById('demo-icon-styles')) return
  const link = document.createElement('link')
  link.id = 'demo-icon-styles'
  link.rel = 'stylesheet'
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
  document.head.appendChild(link)
})

createApp(App)
  .use(router)
  .mount('#app')
