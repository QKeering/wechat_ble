<template>
	<view 
		v-if="showPopup" 
		class="uv-popup" 
		:class="[popupClass, isDesktop ? 'fixforpc-z-index' : '']"
		:style="[{zIndex: zIndex}]"
	>
		<view @touchstart="touchstart">
			<!-- 遮罩层 -->
			<uv-overlay
				key="1"
				v-if="maskShow && overlay"
				:show="showTrans"
				:duration="duration"
				:custom-style="overlayStyle"
				:opacity="overlayOpacity"
			  :zIndex="zIndex"
				@click="onTap"
			></uv-overlay>
			<uv-transition 
				key="2" 
				:mode="ani" 
				name="content" 
				:custom-style="transitionStyle" 
				:duration="duration"
				:show="showTrans" 
				@click="onTap"
			>
				<view 
					class="uv-popup__content" 
					:style="[contentStyle]" 
					:class="[popupClass]" 
					@click="clear"
				>
					<uv-status-bar v-if="safeAreaInsetTop"></uv-status-bar>
					<!--
						App 端「在弹窗内容上滑动，弹窗后面的页面跟着一起滚」的守卫。

						成因：uv-popup 原本只在 H5 锁 body 的 overflow（见 showPopup 里的 H5
						分支），因为 App 端页面滚动跑在 webview 上、而组件的逻辑层
						(app-service.js) 和视图层 (__uniappview.html) 是两个上下文，逻辑层根本
						够不到页面 DOM，锁不了；内容区本身又一点 touchmove 守卫都没有 ——
						遮罩那层有 uv-overlay 的 @touchmove.stop.prevent 顶着，唯独内容区是空的，
						所以只有「在弹窗里滑」才会穿透。

						修法是照搬遮罩那套：在内容上挂 @touchmove.stop.prevent，由视图层直接
						preventDefault。注意这里必须用模板修饰符（编译期生成、跑在视图层），
						不能在逻辑层 addEventListener —— 逻辑层拿到的不是页面上的真节点。

						代价：preventDefault 会把整条手势的默认滚动一起取消，弹窗内部真要滚的
						地方就再也滚不动了（uv-calendar 的月份 scroll-view、DetailInfo 的
						.panel-content 都是靠原生滚动的），所以这个守卫默认开、可按弹窗关闭，
						见 props 里的 scrollGuard。
					-->
					<!-- #ifdef APP-PLUS -->
					<view v-if="scrollGuard" class="uv-popup__guard" @touchmove.stop.prevent>
						<slot />
					</view>
					<view v-else>
						<slot />
					</view>
					<!-- #endif -->
					<!-- #ifndef APP-PLUS -->
					<slot />
					<!-- #endif -->
					<uv-safe-bottom v-if="safeAreaInsetBottom"></uv-safe-bottom>
					<view
						v-if="closeable"
						@tap.stop="close"
						class="uv-popup__content__close"
						:class="['uv-popup__content__close--' + closeIconPos]"
						hover-class="uv-popup__content__close--hover"
						hover-stay-time="150"
					>
						<uv-icon
							name="close"
							color="#909399"
							size="18"
							bold
						></uv-icon>
					</view>
				</view>
			</uv-transition>
		</view>
		<!-- #ifdef H5 -->
		<keypress v-if="maskShow" @esc="onTap" />
		<!-- #endif -->
	</view>
</template>

<script>
	// #ifdef H5
	import keypress from './keypress.js'
	// #endif
	import mpMixin from '@/uni_modules/uv-ui-tools/libs/mixin/mpMixin.js'
	import mixin from '@/uni_modules/uv-ui-tools/libs/mixin/mixin.js'
	/**
	* PopUp 弹出层
	* @description 弹出层组件，为了解决遮罩弹层的问题
	* @tutorial https://www.uvui.cn/components/popup.html
	* @property {String} mode = [top|center|bottom|left|right] 弹出方式
	* 	@value top 顶部弹出
	* 	@value center 中间弹出
	* 	@value bottom 底部弹出
	* 	@value left		左侧弹出
	* 	@value right  右侧弹出
	* @property {Number} duration 动画时长，默认300
	* @property {Boolean} overlay 是否显示遮罩，默认true
	* @property {Boolean} overlayOpacity 遮罩透明度，默认0.5 
	* @property {Object} overlayStyle 遮罩自定义样式
	* @property {Boolean} closeOnClickOverlay = [true|false] 蒙版点击是否关闭弹窗，默认true
	* @property {Number | String} zIndex 弹出层的层级
	* @property {Boolean} safeAreaInsetTop 是否留出顶部安全区（状态栏高度），默认false
	* @property {Boolean} safeAreaInsetBottom 是否为留出底部安全区适配，默认true
	* @property {Boolean} closeable 是否显示关闭图标，默认false
	* @property {Boolean} closeIconPos 自定义关闭图标位置，`top-left`-左上角，`top-right`-右上角，`bottom-left`-左下角，`bottom-right`-右下角，默认top-right
	* @property {String}  bgColor 主窗口背景色
	* @property {String}  maskBackgroundColor 蒙版颜色
	* @property {Boolean} customStyle 自定义样式
	* @event {Function} change 打开关闭弹窗触发，e={show: false}
	* @event {Function} maskClick 点击遮罩触发
	*/
	export default {
		name: 'uv-popup',
		components: {
			// #ifdef H5
			keypress
			// #endif
		},
		mixins: [mpMixin, mixin],
		emits: ['change', 'maskClick'],
		props: {
			// 弹出层类型，可选值，top: 顶部弹出层；bottom：底部弹出层；center：全屏弹出层
			// message: 消息提示 ; dialog : 对话框
			mode: {
				type: String,
				default: 'center'
			},
			// 动画时长，单位ms
			duration: {
				type: [String, Number],
				default: 300
			},
			// 层级
			zIndex: {
				type: [String, Number],
				default: 10075
			},
			bgColor: {
				type: String,
				default: '#ffffff'
			},
			safeArea: {
				type: Boolean,
				default: true
			},
			// 是否显示遮罩
			overlay: {
				type: Boolean,
				default: true
			},
			// 点击遮罩是否关闭弹窗
			closeOnClickOverlay: {
				type: Boolean,
				default: true
			},
			// 遮罩的透明度，0-1之间
			overlayOpacity: {
				type: [Number, String],
				default: 0.4
			},
			// 自定义遮罩的样式
			overlayStyle: {
				type: [Object, String],
				default: ''
			},
			// 是否为iPhoneX留出底部安全距离
			safeAreaInsetBottom: {
				type: Boolean,
				default: true
			},
			// 是否留出顶部安全距离（状态栏高度）
			safeAreaInsetTop: {
				type: Boolean,
				default: false
			},
			// 是否显示关闭图标
			closeable: {
				type: Boolean,
				default: false
			},
			// 自定义关闭图标位置，top-left为左上角，top-right为右上角，bottom-left为左下角，bottom-right为右下角
			closeIconPos: {
				type: String,
				default: 'top-right'
			},
			// mode=center，也即中部弹出时，是否使用缩放模式
			zoom: {
				type: Boolean,
				default: true
			},
			/**
			 * App 端内容区的滚动手势守卫，默认开（仅 App 生效，H5 靠锁 body、小程序不走这里）。
			 *
			 * 开着：在弹窗内容上滑动不会带着下层页面一起滚（修的是「底部弹窗里滑动，后面
			 * 页面跟着滑」的穿透问题）。实现见模板里 uv-popup__guard 那段注释。
			 *
			 * 关掉：不做任何拦截。**弹窗内部有可滚动内容时必须关掉** —— 守卫是用
			 * preventDefault 实现的，会把内部滚动一起按住。已知需要关闭的有两处：
			 * uv-calendar 的月份列表（scroll-view）和 components/DetailInfo.vue
			 * 的 .panel-content（overflow:auto），它们都已显式传 :scroll-guard="false"。
			 * 新增弹窗如果内部要滚动，记得同样关掉。
			 */
			scrollGuard: {
				type: Boolean,
				default: true
			},
			round: {
				type: [Number, String],
				default: 0
			},
			...uni.$uv?.props?.popup
		},
		watch: {
			/**
			 * 监听type类型
			 */
			type: {
				handler: function(type) {
					if (!this.config[type]) return
					this[this.config[type]](true)
				},
				immediate: true
			},
			isDesktop: {
				handler: function(newVal) {
					if (!this.config[newVal]) return
					this[this.config[this.mode]](true)
				},
				immediate: true
			},
			// H5 下禁止底部滚动
			showPopup(show) {
				// #ifdef H5
				// fix by mehaotian 处理 h5 滚动穿透的问题
				document.getElementsByTagName('body')[0].style.overflow = show ? 'hidden' : 'visible'
				// #endif
				// App 端的内容区守卫是模板上的 @touchmove.stop.prevent，由视图层直接生效，
				// 逻辑层这里不需要做任何事。详见模板里 uv-popup__guard 那段注释。
			}
		},
		data() {
			return {
				ani: [],
				showPopup: false,
				showTrans: false,
				popupWidth: 0,
				popupHeight: 0,
				config: {
					top: 'top',
					bottom: 'bottom',
					center: 'center',
					left: 'left',
					right: 'right',
					message: 'top',
					dialog: 'center',
					share: 'bottom'
				},
				transitionStyle: {
					position: 'fixed',
					left: 0,
					right: 0
				},
				maskShow: true,
				mkclick: true,
				popupClass: this.isDesktop ? 'fixforpc-top' : 'top',
				direction: ''
			}
		},
		computed: {
			isDesktop() {
				return this.popupWidth >= 500 && this.popupHeight >= 500
			},
			bg() {
				if (this.bgColor === '' || this.bgColor === 'none' || this.$uv.getPx(this.round)>0) {
					return 'transparent'
				}
				return this.bgColor
			},
			contentStyle() {
				const style = {};
				if (this.bgColor) {
					style.backgroundColor = this.bg
				}
				if(this.round) {
					const value = this.$uv.addUnit(this.round)
					const mode = this.direction?this.direction:this.mode
					style.backgroundColor = this.bgColor
					if(mode === 'top') {
						style.borderBottomLeftRadius = value
						style.borderBottomRightRadius = value
					} else if(mode === 'bottom') {
						style.borderTopLeftRadius = value
						style.borderTopRightRadius = value
					} else if(mode === 'center') {
						style.borderRadius = value
					} 
				}
				return this.$uv.deepMerge(style, this.$uv.addStyle(this.customStyle))
			}
		},
		// #ifndef VUE3
		// TODO vue2
		destroyed() {
			this.setH5Visible()
		},
		// #endif
		// #ifdef VUE3
		// TODO vue3
		unmounted() {
			this.setH5Visible()
		},
		// #endif
		created() {
			// TODO 处理 message 组件生命周期异常的问题
			this.messageChild = null
			// TODO 解决头条冒泡的问题
			this.clearPropagation = false
		},
		methods: {
			setH5Visible() {
				// #ifdef H5
				// fix by mehaotian 处理 h5 滚动穿透的问题
				document.getElementsByTagName('body')[0].style.overflow = 'visible'
				// #endif
			},
			/**
			 * 公用方法，不显示遮罩层
			 */
			closeMask() {
				this.maskShow = false
			},
			// TODO nvue 取消冒泡
			clear(e) {
				// #ifndef APP-NVUE
				e.stopPropagation()
				// #endif
				this.clearPropagation = true
			},

			open(direction) {
				// fix by mehaotian 处理快速打开关闭的情况
				if (this.showPopup) {
					return
				}
				let innerType = ['top', 'center', 'bottom', 'left', 'right', 'message', 'dialog', 'share']
				if (!(direction && innerType.indexOf(direction) !== -1)) {
					direction = this.mode
				}else {
					this.direction = direction;
				}
				if (!this.config[direction]) {
					return this.$uv.error(`缺少类型：${direction}`);
				}
				this[this.config[direction]]()
				this.$emit('change', {
					show: true,
					type: direction
				})
			},
			close(type) {
				this.showTrans = false
				this.$emit('change', {
					show: false,
					type: this.mode
				})
				clearTimeout(this.timer)
				// // 自定义关闭事件
				this.timer = setTimeout(() => {
					this.showPopup = false
				}, 300)
			},
			// TODO 处理冒泡事件，头条的冒泡事件有问题 ，先这样兼容
			touchstart() {
				this.clearPropagation = false
			},
			onTap() {
				if (this.clearPropagation) {
					// fix by mehaotian 兼容 nvue
					this.clearPropagation = false
					return
				}
				this.$emit('maskClick')
				if (!this.closeOnClickOverlay) return
				this.close()
			},
			/**
			 * 顶部弹出样式处理
			 */
			top(type) {
				this.popupClass = this.isDesktop ? 'fixforpc-top' : 'top'
				this.ani = ['slide-top']
				this.transitionStyle = {
					position: 'fixed',
					zIndex: this.zIndex,
					left: 0,
					right: 0,
					backgroundColor: this.bg
				}
				// TODO 兼容 type 属性 ，后续会废弃
				if (type) return
				this.showPopup = true
				this.showTrans = true
				this.$nextTick(() => {
					if (this.messageChild && this.mode === 'message') {
						this.messageChild.timerClose()
					}
				})
			},
			/**
			 * 底部弹出样式处理
			 */
			bottom(type) {
				this.popupClass = 'bottom'
				this.ani = ['slide-bottom']
				this.transitionStyle = {
					position: 'fixed',
					zIndex: this.zIndex,
					left: 0,
					right: 0,
					bottom: 0,
					backgroundColor: this.bg
				}
				// TODO 兼容 type 属性 ，后续会废弃
				if (type) return
				this.showPopup = true
				this.showTrans = true
			},
			/**
			 * 中间弹出样式处理
			 */
			center(type) {
				this.popupClass = 'center'
				this.ani = this.zoom?['zoom-in', 'fade']:['fade'];
				this.transitionStyle = {
					position: 'fixed',
					zIndex: this.zIndex,
					/* #ifndef APP-NVUE */
					display: 'flex',
					flexDirection: 'column',
					/* #endif */
					bottom: 0,
					left: 0,
					right: 0,
					top: 0,
					justifyContent: 'center',
					alignItems: 'center'
				}
				// TODO 兼容 type 属性 ，后续会废弃
				if (type) return
				this.showPopup = true
				this.showTrans = true
			},
			left(type) {
				this.popupClass = 'left'
				this.ani = ['slide-left']
				this.transitionStyle = {
					position: 'fixed',
					zIndex: this.zIndex,
					left: 0,
					bottom: 0,
					top: 0,
					backgroundColor: this.bg,
					/* #ifndef APP-NVUE */
					display: 'flex',
					flexDirection: 'column'
					/* #endif */
				}
				// TODO 兼容 type 属性 ，后续会废弃
				if (type) return
				this.showPopup = true
				this.showTrans = true
			},
			right(type) {
				this.popupClass = 'right'
				this.ani = ['slide-right']
				this.transitionStyle = {
					position: 'fixed',
					zIndex: this.zIndex,
					bottom: 0,
					right: 0,
					top: 0,
					backgroundColor: this.bg,
					/* #ifndef APP-NVUE */
					display: 'flex',
					flexDirection: 'column'
					/* #endif */
				}
				// TODO 兼容 type 属性 ，后续会废弃
				if (type) return
				this.showPopup = true
				this.showTrans = true
			}
		}
	}
</script>
<style lang="scss" scoped>
	.uv-popup {
		position: fixed;
		/* #ifndef APP-NVUE */
		z-index: 99;

		/* #endif */
		&.top,
		&.left,
		&.right {
			/* #ifdef H5 */
			top: var(--window-top);
			/* #endif */
			/* #ifndef H5 */
			top: 0;
			/* #endif */
		}

		/* App 端内容区的守卫层（见模板里 uv-popup__guard 的注释）。
		   display: contents 让它本身不产生盒子 —— 只是多一个 DOM 节点用来接 touchmove
		   冒泡，布局上完全透明，弹窗里按百分比算的高度也不会因为多了一层而失效。
		   （老 WebView（Chrome<65）不认 display:contents，会退化成一个块级盒子，
		   那种情况下弹窗内容仍会正常显示，只是内部百分比高度可能受影响。） */
		/* #ifdef APP-PLUS */
		.uv-popup__guard {
			display: contents;
		}
		/* #endif */

		.uv-popup__content {
			/* #ifndef APP-NVUE */
			display: block;
			overflow: hidden;
			/* #endif */
			position: relative;

			&.left,
			&.right {
				/* #ifdef H5 */
				padding-top: var(--window-top);
				/* #endif */
				/* #ifndef H5 */
				padding-top: 0;
				/* #endif */
				flex: 1;
			}
			&__close {
				position: absolute;

				&--hover {
					opacity: 0.4;
				}
			}
			
			&__close--top-left {
				top: 15px;
				left: 15px;
			}
			
			&__close--top-right {
				top: 15px;
				right: 15px;
			}
			
			&__close--bottom-left {
				bottom: 15px;
				left: 15px;
			}
			
			&__close--bottom-right {
				right: 15px;
				bottom: 15px;
			}
		}
	}

	.fixforpc-z-index {
		/* #ifndef APP-NVUE */
		z-index: 999;
		/* #endif */
	}

	.fixforpc-top {
		top: 0;
	}
</style>
