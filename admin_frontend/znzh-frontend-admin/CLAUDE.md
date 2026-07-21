# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**znzh-frontend-admin** - Vue 2 admin frontend for QKeer Smart Ring management system. Based on RuoYi-Vue framework.

- **Framework**: Vue 2.6.12 + Element UI 2.15.14
- **State Management**: Vuex 3.6.0
- **Router**: Vue Router 3.4.9
- **Build Tool**: Vue CLI 4.4.6
- **Dev Server Port**: 80

## Build Commands

```bash
# Install dependencies
cd znzh-frontend-admin && npm install

# Development server (starts on port 80)
npm run dev

# Build for production
npm run build:prod

# Build for staging
npm run build:stage

# Preview production build locally
npm run preview
```

## Backend API

- **Base URL**: `http://localhost:8127` (configurable in `vue.config.js`)
- **API Prefix**: `/dev-api` (development), configured via `.env` files
- **Auth**: JWT Bearer token, stored in cookies/localStorage

## Architecture

### Source Structure
```
src/
├── api/           # API service modules (device, system, user, monitor)
├── assets/         # Static assets (styles, images, icons)
├── components/     # Reusable components (Pagination, Editor, Upload)
├── directive/      # Vue directives (permission, drag)
├── layout/         # Layout components (Sidebar, Header, TagsView)
├── plugins/        # Vue plugins (auth, cache, modal, tab)
├── router/         # Router configuration
├── store/          # Vuex store modules (user, permission, app, settings)
├── utils/          # Utilities (request, auth, validate, dict)
└── views/          # Page components
```

### API Module Pattern
API modules in `src/api/` follow naming convention: `{module}/{resource}.js`
- `device/device.js`, `device/model.js`, `device/ota.js`
- `system/user.js`, `system/role.js`, `system/dept.js`
- `monitor/online.js`, `monitor/job.js`, `monitor/operlog.js`

### Request Layer
- `src/utils/request.js` - Axios instance with interceptors
- Handles JWT token injection
- Implements duplicate request prevention
- Maps error codes to localized messages

### State Management
Vuex store modules in `src/store/modules/`:
- `user` - User authentication, token, info
- `permission` - Route permissions, loaded menus
- `app` - Sidebar, size, device
- `settings` - Theme, fixed header, tagsview
- `tagsView` - Opened tabs cache

### View Organization
```
views/
├── device/         # Device management (device, model, ota)
├── system/         # System management (user, role, dept, menu, config)
├── monitor/        # System monitoring (online, job, cache, operlog)
├── user/           # User health data, logs
├── tool/           # Code generation, build tools
├── dashboard/      # Dashboard charts
├── error/          # 401, 404 pages
└── login.vue       # Login page
```

## Key Patterns

### Component Registration
Global components registered in `src/main.js`:
- `DictTag`, `Pagination`, `RightToolbar`, `Editor`
- `FileUpload`, `ImageUpload`, `ImagePreview`

### Global Methods
Available via `Vue.prototype`:
- `getDicts`, `getConfigKey` - Dict and config fetching
- `parseTime`, `resetForm`, `addDateRange` - Utility functions
- `selectDictLabel`, `selectDictLabels` - Dict label formatting
- `download` - File download
- `handleTree` - Tree data handling

### Route Types
- `constantRoutes` - Static routes (login, error pages)
- `asyncRoutes` - Dynamic routes loaded from backend based on user permissions

## Configuration

### Environment Files
- `.env.development` - Development (VUE_APP_BASE_API=/dev-api)
- `.env.staging` - Staging
- `.env.production` - Production

### Vue Config
- `vue.config.js` - Webpack configuration, devServer proxy settings
- Proxy rewrites `/dev-api` to backend `http://localhost:8127`

## Development Notes

- Routes are lazy-loaded in production (code splitting)
- SVG icons stored in `src/assets/icons/svg`
- Element UI theme customization in `src/assets/styles/element-variables.scss`
- Password encryption uses `jsencrypt` (RSA) before sending to backend
