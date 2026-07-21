<template>
<view class="container" :style="containerStyle">
  <section :class="indicatorClass?`selectBox ${indicatorClass}`:'selectBox'" :style="indicatorStyle?indicatorStyle:{height: `${config.rowHeight}${unit}`}">
  </section>
  <section class="columns" :style="columnsStyle" @touchstart="touchstart" @touchmove="touchmove" @touchend="touchend">
    <section
        :class="index===currentTarget?'row select-row':'row'"
        v-for="(item,index) in list" :key="index" :style="selectRowStyle?{...selectRowStyle,...rowStyle}:rowStyle">
      <slot :item="item">
        <span>{{item}}</span>
      </slot>
    </section>
  </section>
</view>
</template>

<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type { StyleValue } from "vue";
const props=withDefaults(defineProps<{
  list: Array<any>,
  value?: number,
  indicatorStyle?: StyleValue,
  indicatorClass?: string,
  selectRowStyle?: Record<string, string | number>,
  height?: number,
  rowHeight?: number,
}>(),{
  value: 0,
  indicatorClass: "",
  height: 40,
  rowHeight: 6
})

const emits=defineEmits<{
  (e: 'change',value: number):void,
}>()

// 单位
const unit="vh";
// 配置项
const config=ref({
  rowHeight: props.rowHeight,
  containerHeight: props.height,
  columnsPx: 0,
})
const containerStyle=computed(()=>({
  height: `${config.value.containerHeight}${unit}`
}))
const columnsStyle=computed(()=>({
  top: `${config.value.columnsPx}${unit}`
}))
const rowStyle=computed(()=>({
  height: `${config.value.rowHeight}${unit}`
}))
// 列居中位置（容器高度/2）
const pYCenter=computed(()=>config.value.containerHeight/2)
// 行居中位置（行高度/2）
const rowPYCenter=computed(()=>config.value.rowHeight/2)
// 最大下滑位置
const maxPosition=computed(()=>config.value.rowHeight*props.list.length-1);
// 当前选中的列下标
const currentTarget=ref(props.value);
const computedCurrentTarget=()=>{
  // 选中行的位置为：当前列下标*行高+列居中位置-行居中位置
  config.value.columnsPx=-(currentTarget.value*config.value.rowHeight)+pYCenter.value-rowPYCenter.value;
}
watch(()=>currentTarget.value,value=>{
  // 计算当前选中的下标
  computedCurrentTarget();
  emits('change',value);
},{immediate: true})

// 监听滑动事件
let moveDistance=0;
let originPosition=0;
const moveSpeed=6;//滑动速度倍速
const touchstart=(e:TouchEvent)=>{
  const touch = e.touches[0];
  moveDistance=touch.clientY/moveSpeed;
  originPosition=config.value.columnsPx;
}
const touchmove=(e:TouchEvent)=>{
  const touch = e.touches[0];
  config.value.columnsPx=originPosition+(touch.clientY/moveSpeed)-moveDistance;
}
const touchend=(e:TouchEvent)=>{
  originPosition=moveDistance=0;
  const current=-(Math.round((config.value.columnsPx-pYCenter.value)/config.value.rowHeight)+1)
  // 判断是否超过最大下滑位置或最大上滑位置
  if(current<0){
    currentTarget.value=0;
  }else if(current>props.list.length-1){
    currentTarget.value=props.list.length-1;
  }else{
    // 根据位置重新计算当前行下标
    // 当前下标=四舍五入（当前位置/行高度）
    currentTarget.value=current;
  }
  computedCurrentTarget();
}
</script>

<style scoped lang="scss">
.container{
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 200px;
  //padding: 10px ;
  overflow: hidden;
  &:after{
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(255,255,255,0.9) 0,transparent 50%,rgba(255,255,255,0.9) 100%);
    pointer-events: none;
    z-index: 99;
  }
  .selectBox{
    box-sizing: border-box;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    left: 0;
    width: 100%;
    background: rgba(0,0,0,0.03)
  }
  .columns{
    position: absolute;
    top: 0;
    width: 100%;
    height: 100%;
    //background: red;
    z-index: 10;
    transition: 100ms;
    .row{
      display: flex;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
      width: 100%;
      height: 40px;
      text-align: center;
      font-size: 18px;
      transition: 200ms;
      //border: #000000 solid 1px;
      //color: $font-color-secondary
    }
    .select-row{
      color: #6DFFDFFF;
      font-size: 28px;
    }
  }
}
</style>
