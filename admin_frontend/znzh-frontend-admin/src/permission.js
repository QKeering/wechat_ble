import router from './router'
import store from './store'
import { Message } from 'element-ui'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'
import { getToken } from '@/utils/auth'
import { isRelogin } from '@/utils/request'

NProgress.configure({ showSpinner: false })

router.beforeEach((to, from, next) => {
  NProgress.start()

  // 登录页始终直接放行，不能在这里触发用户信息获取或退出登录。
  if (to.path === '/login') {
    next()
    return
  }

  // 只有访问非登录页且没有 token 时，才跳转到登录页。
  if (!getToken()) {
    next(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
    NProgress.done()
    return
  }

  to.meta.title && store.dispatch('settings/setTitle', to.meta.title)

  if (store.getters.roles.length > 0) {
    next()
    return
  }

  isRelogin.show = true
  store.dispatch('GetInfo').then(() => {
    isRelogin.show = false
    store.dispatch('GenerateRoutes').then(accessRoutes => {
      router.addRoutes(accessRoutes)
      next({ ...to, replace: true })
    })
  }).catch(err => {
    isRelogin.show = false
    store.dispatch('LogOut').then(() => {
      Message.error(err)
      next({ path: '/login' })
    })
  })
})

router.afterEach(() => {
  NProgress.done()
})
