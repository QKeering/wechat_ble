import auth from '@/plugins/auth'
import router, { constantRoutes, dynamicRoutes } from '@/router'
import { getRouters } from '@/api/menu'
import Layout from '@/layout/index'
import ParentView from '@/components/ParentView'
import InnerLink from '@/layout/components/InnerLink'

const permission = {
  state: {
    routes: [],
    addRoutes: [],
    defaultRoutes: [],
    topbarRouters: [],
    sidebarRouters: []
  },
  mutations: {
    SET_ROUTES: (state, routes) => {
      state.addRoutes = routes
      state.routes = constantRoutes.concat(routes)
    },
    SET_DEFAULT_ROUTES: (state, routes) => {
      state.defaultRoutes = constantRoutes.concat(routes)
    },
    SET_TOPBAR_ROUTES: (state, routes) => {
      state.topbarRouters = routes
    },
    SET_SIDEBAR_ROUTERS: (state, routes) => {
      state.sidebarRouters = routes
    },
  },
  actions: {
    // 生成路由
    GenerateRoutes({ commit }) {
      return new Promise(resolve => {
        // 向后端请求路由数据
        getRouters().then(res => {
          const sdata = ensureUserDataRoutes(JSON.parse(JSON.stringify(res.data)))
          const rdata = ensureUserDataRoutes(JSON.parse(JSON.stringify(res.data)))
          const sidebarRoutes = filterAsyncRouter(sdata)
          const rewriteRoutes = filterAsyncRouter(rdata, false, true)
          const asyncRoutes = filterDynamicRoutes(dynamicRoutes)
          rewriteRoutes.push({ path: '*', redirect: '/404', hidden: true })
          router.addRoutes(asyncRoutes)
          commit('SET_ROUTES', rewriteRoutes)
          commit('SET_SIDEBAR_ROUTERS', constantRoutes.concat(sidebarRoutes))
          commit('SET_DEFAULT_ROUTES', sidebarRoutes)
          commit('SET_TOPBAR_ROUTES', sidebarRoutes)
          resolve(rewriteRoutes)
        })
      })
    }
  }
}

// 遍历后台传来的路由字符串，转换为组件对象；补齐用户管理下的固定业务页面
function ensureUserDataRoutes(routes) {
  if (!Array.isArray(routes)) {
    return routes
  }
  const userDataRoutes = [
    {
      name: 'HealthData',
      path: 'healthData',
      component: 'user/healthData/index',
      meta: { title: '健康数据', icon: 'clipboard', noCache: false }
    },
    {
      name: 'BatteryLog',
      path: 'batteryLog',
      component: 'user/batteryLog/index',
      meta: { title: '电量日志', icon: 'battery', noCache: false }
    }
  ]

  const existingRoutes = new Map()
  const normalizeUserDataRoutes = (items) => {
    for (const route of items) {
      const matchedRoute = userDataRoutes.find(item =>
        route && (route.component === item.component || route.path === item.path)
      )
      if (matchedRoute) {
        route.hidden = false
        route.path = route.path || matchedRoute.path
        route.component = route.component || matchedRoute.component
        route.name = route.name || matchedRoute.name
        route.meta = { ...matchedRoute.meta, ...(route.meta || {}), title: matchedRoute.meta.title }
        existingRoutes.set(matchedRoute.path, route)
      }
      if (Array.isArray(route.children)) {
        normalizeUserDataRoutes(route.children)
      }
    }
  }

  const findUserParent = (items) => {
    for (const route of items) {
      const children = Array.isArray(route.children) ? route.children : []
      const isUserParent = children.some(child =>
        child.component === 'user/user/index' ||
        child.component === 'user/log/index' ||
        child.path === 'user' ||
        child.path === 'log'
      )
      if (isUserParent) {
        return route
      }
      const matched = findUserParent(children)
      if (matched) {
        return matched
      }
    }
    return null
  }

  normalizeUserDataRoutes(routes)
  const parent = findUserParent(routes)
  if (parent) {
    parent.hidden = false
    parent.alwaysShow = true
    parent.children = Array.isArray(parent.children) ? parent.children : []
    userDataRoutes.forEach(item => {
      const route = existingRoutes.get(item.path) || { ...item, meta: { ...item.meta } }
      const alreadyInParent = parent.children.some(child =>
        child === route ||
        child.component === item.component ||
        child.path === item.path
      )
      if (!alreadyInParent) {
        parent.children.push(route)
      }
    })
  }
  return routes
}

function filterAsyncRouter(asyncRouterMap, lastRouter = false, type = false) {
  return asyncRouterMap.filter(route => {
    if (type && route.children) {
      route.children = filterChildren(route.children)
    }
    if (route.component) {
      // Layout ParentView 组件特殊处理
      if (route.component === 'Layout') {
        route.component = Layout
      } else if (route.component === 'ParentView') {
        route.component = ParentView
      } else if (route.component === 'InnerLink') {
        route.component = InnerLink
      } else {
        route.component = loadView(route.component)
      }
    }
    if (route.children != null && route.children && route.children.length) {
      route.children = filterAsyncRouter(route.children, route, type)
    } else {
      delete route['children']
      delete route['redirect']
    }
    return true
  })
}

function filterChildren(childrenMap, lastRouter = false) {
  var children = []
  childrenMap.forEach(el => {
    el.path = lastRouter ? lastRouter.path + '/' + el.path : el.path
    if (el.children && el.children.length && el.component === 'ParentView') {
      children = children.concat(filterChildren(el.children, el))
    } else {
      children.push(el)
    }
  })
  return children
}

// 动态路由遍历，验证是否具备权限
export function filterDynamicRoutes(routes) {
  const res = []
  routes.forEach(route => {
    if (route.permissions) {
      if (auth.hasPermiOr(route.permissions)) {
        res.push(route)
      }
    } else if (route.roles) {
      if (auth.hasRoleOr(route.roles)) {
        res.push(route)
      }
    }
  })
  return res
}

export const loadView = (view) => {
  if (process.env.NODE_ENV === 'development') {
    return (resolve) => require([`@/views/${view}`], resolve)
  } else {
    // 使用 import 实现生产环境的路由懒加载
    return () => import(`@/views/${view}`)
  }
}

export default permission
