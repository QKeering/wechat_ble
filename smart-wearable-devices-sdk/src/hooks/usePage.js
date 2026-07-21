import {
	reactive,
	toRefs
} from 'vue'

export default function usePage (getData) {
	// 创建响应式状态对象
	const state = reactive({
		status: 'more', // 列表加载状态：'more'（更多），'loading'（加载中），'noMore'（没有更多）
		page: 1, // 当前页码
		total: 0, // 总条目数
		list: [], // 列表数据
		contentText: { // 加载提示文字
			contentdown: '查看更多',
			contentrefresh: '加载中',
			contentnomore: '没有更多了'
		},
		isLoadMore: false // 是否正在加载更多
	})

	/**
	 * 处理加载更多事件
	 * @param {Function} func - 负责获取数据的异步函数
	 */
	async function handleLoadMore (func) {
		if (state.list.length >= state.total) return // 如果已加载所有数据，则不继续加载

		state.status = 'loading' // 更新加载状态为加载中
		state.page++ // 增加页码

		try {
			const res = await func(state.page) // 执行传入的数据获取函数并传递当前页码
			setList(res) // 设置列表数据
		} catch (error) {
			console.error('Error during data loading:', error) // 捕获并记录错误
			state.page-- // 加载失败则回退页码
		} finally {
			state.status = state.list.length < state.total ? 'more' : 'noMore' // 更新加载状态
		}
	}

	/**
	 * 设置列表数据
	 * @param {Object} res - 请求结果对象
	 * @param {Array} [res.rows] - 数据列表
	 * @param {Number} [res.count] - 数据总条数
	 */
	function setList (res) {
		// 根据是否第一页决定是替换还是追加数据
		state.list = state.page === 1 ? res?.rows || [] : [...state.list, ...(res?.rows || [])]
		state.total = res?.count || 0
		setStatus() // 更新加载状态
	}

	/**
	 * 根据当前数据设置加载状态
	 */
	function setStatus () {
		state.status = state.list.length >= state.total ? 'noMore' : 'more'
		state.contentText.contentdown = state.status === 'noMore' ? '没有更多了' : '查看更多'
	}

	/**
	 * 初始化或重置列表数据
	 */
	function initList () {
		Object.assign(state, {
			status: 'more',
			page: 1,
			total: 0,
			list: [],
			contentText: {
				contentdown: '查看更多',
				contentrefresh: '加载中',
				contentnomore: '没有更多了'
			},
			isLoadMore: false
		})
	}

	// 返回可解构的对象，将状态属性转换为响应式引用，并返回自定义方法
	return {
		...toRefs(state),
		initList,
		setList,
		handleLoadMore
	}
}