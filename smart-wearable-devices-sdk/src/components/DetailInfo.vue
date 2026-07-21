<template>
  <view :class="['detail-info', size]">
    
    <view class="icon-container" @tap.stop="openPanel">i</view>


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
  display: inline-block;
  color: #afafaf;    /* 图标颜色，例如信息蓝 */
  vertical-align: baseline;

  &.normal {
    width: 16px;
    height: 16px;

    .icon-container {
      line-height: 16px;
      font-size: 24rpx;
      transform: translateY(-2rpx);
    }
  }

  &.small {
    width: 12px;
    height: 12px;
    // vertical-align: text-top;

    .icon-container {
      line-height: 12px;
      font-size: 14rpx;
      transform: translateY(-4rpx);
    }
  }

  
  .icon-container {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 200px;
    border: 2px solid #afafaf;
    text-align: center;
    font-weight: bold;
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

