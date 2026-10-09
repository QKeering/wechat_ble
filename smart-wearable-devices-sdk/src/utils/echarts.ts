// 跨端 ECharts 兼容层：统一替换散落各页的 require('...static/echarts.min.js')。
//
// src/static/echarts.min.js 是 mp-weixin 专用的小体积 echarts 兼容层
// （完整版 ECharts 约 1MB，会撑爆小程序主包）。App/H5 端不支持 require，
// 且 l-echart 组件会自行加载完整 echarts（App 走 webview 全量版、H5 走 esm 版），
// 所以非小程序端返回 null：页面 init(echarts) 传 null 时，l-echart 会回退到
// 组件自带的 echartsLibrary（见 uni_modules/lime-echart/components/l-echart/l-echart.vue）。
let echarts: any;
// #ifdef MP-WEIXIN
echarts = require('../static/echarts.min.js');
// #endif
// #ifndef MP-WEIXIN
echarts = null;
// #endif
export default echarts;
