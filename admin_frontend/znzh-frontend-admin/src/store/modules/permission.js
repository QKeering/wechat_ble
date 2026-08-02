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
          const sdata = ensureHealthDataRoute(JSON.parse(JSON.stringify(res.data)))
          const rdata = ensureHealthDataRoute(JSON.parse(JSON.stringify(res.data)))
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

// 遍历后台传来的路由字符串，转换为组件对象
function ensureHealthDataRoute(routes) {
  if (!Array.isArray(routes)) {
    return routes
  }
  const healthRoute = {
    name: 'HealthData',
    path: 'healthData',
    component: 'user/healthData/index',
    meta: { title: '健康数据', icon: 'clipboard', noCache: false }
  }

  let existingHealthRoute = null
  const normalizeHealthDataRoute = (items) => {
    for (const route of items) {
      if (route && (route.component === 'user/healthData/index' || route.path === 'healthData')) {
        route.hidden = false
        route.path = route.path || healthRoute.path
        route.component = route.component || healthRoute.component
        route.name = route.name || healthRoute.name
        route.meta = { ...healthRoute.meta, ...(route.meta || {}), title: '健康数据' }
        existingHealthRoute = route
        return route
      }
      const matched = Array.isArray(route.children) && normalizeHealthDataRoute(route.children)
      if (matched) {
        return matched
      }
    }
    return null
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

  normalizeHealthDataRoute(routes)
  const parent = findUserParent(routes)
  if (parent && existingHealthRoute) {
    parent.hidden = false
    parent.alwaysShow = true
    parent.children = Array.isArray(parent.children) ? parent.children : []
    const alreadyInParent = parent.children.some(child => child === existingHealthRoute || child.component === 'user/healthData/index' || child.path === 'healthData')
    if (!alreadyInParent) {
      parent.children.push(existingHealthRoute)
    }
  } else if (parent) {
    parent.hidden = false
    parent.alwaysShow = true
    parent.children = Array.isArray(parent.children) ? parent.children : []
    parent.children.push(healthRoute)
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
