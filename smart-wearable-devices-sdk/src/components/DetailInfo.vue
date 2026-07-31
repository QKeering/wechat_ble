<template>
  <view :class="['detail-info', size]">
    <view
      class="detail-info__hit"
      hover-class="detail-info__hit--pressed"
      :hover-start-time="0"
      :hover-stay-time="100"
      @tap.stop="openPanel"
    >
      <uv-icon class="detail-info__icon" name="question-circle" size="16px"></uv-icon>
    </view>


    <!-- 底部弹出层 -->
    <uv-popup ref="popupRef" mode="bottom" @change="onChange" @tap.stop="() => {}">
      <view class="bottom-panel" @tap.stop="() => {}">
        <!-- 关闭按钮 -->
        <view class="close-btn" @tap="closePanel">
          <text class="close-icon">×</text>
        </view>
        
        <!-- 标题 -->
        <view class="panel-header">
          <text class="title">{{ modelData.title }}</text>
        </view>
        
        <!-- 内容区 -->
        <view class="panel-content">
          <text class="content-text">
            {{ modelData.detail }}
          </text>
        </view>
        
        <!-- 底部安全区域占位 -->
        <!-- <view class="safe-area-bottom"></view> -->
      </view>
    </uv-popup>


  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { getDetailInfo } from '@/common/detailInfo';

interface Props {
  id: string;
  isPopupActive: boolean;
  size?: 'normal' | 'small';
}

const props = defineProps<Props>()

const emits = defineEmits(['update:isPopupActive'])

const popupRef = ref()

const show = ref(false)

const size = computed(() => props.size === 'small' ? 'small' : 'normal');

const modelData = computed(() => {
  const detailInfo = getDetailInfo(props.id);

  const result = {
    title: detailInfo?.title,
    detail: detailInfo?.detail
  }

  return result
})

const openPanel = () => {
  popupRef.value.open('bottom')
}


const closePanel = () => {
  popupRef.value.close()
}

const onChange = (e:any) => {
  show.value = e.show
  emits('update:isPopupActive', e.show)
}

</script>

<style lang="scss" scoped>
.detail-info {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 32px;
  height: 32px;
  margin-left: 6px !important;
  color: #a7abb3;
  vertical-align: middle;
  line-height: 1;
  flex: 0 0 32px;

  &.normal {
    width: 32px;
    height: 32px;
  }

  &.small {
    width: 32px;
    height: 32px;
  }

  .detail-info__hit {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    width: 32px;
    height: 32px;
    color: #a7abb3;
    border-radius: 16px;
  }

  .detail-info__hit--pressed {
    color: #2e70fc !important;
  }

  :deep(.uv-icon),
  :deep(.uv-icon__icon) {
    color: currentColor !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

}

/* 底部面板容器 - 圆角白底 */
.bottom-panel {
  background-color: #ffffff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 30rpx;
  position: relative;
  // max-height: 70vh; /* 限制最大高度 */
  // min-height: 300rpx;

  /* 关闭按钮 */
  .close-btn {
    position: absolute;
    top: 24rpx;
    right: 24rpx;
    width: 60rpx;
    height: 60rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .close-icon {
    font-size: 48rpx;
    color: #333;
    line-height: 1;
  }

  /* 标题样式 */
  .panel-header {
    margin-bottom: 30rpx;
    padding-right: 60rpx; /* 给关闭按钮留空间 */
  }

  .title {
    font-size: 36rpx;
    font-weight: 600;
    color: #333;
  }

  /* 内容文本 */
  .panel-content {
    display: flex;
    flex-direction: column;
    gap: 20rpx;
    max-height: 60vh; /* 限制最大高度 */
    min-height: 300rpx;
    overflow: auto;
    padding-bottom: 20rpx;
  }

  .content-text {
    font-size: 30rpx;
    color: #666;
    line-height: 1.6;
    text-align: justify;
    white-space: pre-wrap;
  }

  /* 底部安全区域（适配iPhone刘海屏） */
  // .safe-area-bottom {
  //   height: constant(safe-area-inset-bottom);
  //   height: env(safe-area-inset-bottom);
  // }

}

</style>

