<template>
<view class="ipicker" :style="containerStyle">
  <IPickerColumn
      v-for="(list,index) in value"
      :list="list"
      :value="targets[index]"
      :key="index"
      :indicator-class="indicatorClass"
      :select-row-style="selectRowStyle"
      :indicator-style="indicatorStyle"
      :height="pickerHeight"
      :row-height="rowHeight"
      @change="value=>changeColumn(index,value)"
  >
    <template #default="{item}">
      <slot :item="item">
      </slot>
    </template>
  </IPickerColumn>
</view>
</template>

<script setup lang="ts">
import IPickerColumn from "@/components/plugin/IPickerColumn.vue";
import {ref, watch} from "vue";
import type { StyleValue } from "vue";
const props=withDefaults(defineProps<{
  value: Array<Array<any>>,
  indicatorStyle?: StyleValue,
  indicatorClass?: string,
  selectRowStyle?: Record<string, string | number>,
  containerStyle?: StyleValue,
  pickerHeight?: number,
  rowHeight?: number,
}>(),{
})
// 选中的下标
const targets=ref<Array<number>>([])
watch(()=>targets.value,value=>{
  emits('change',value);
},{deep: true})
// 根据value元素个数设置选中的下标个数
watch(()=>props.value,value=>{
  targets.value=[];
  value.forEach(()=>targets.value.push(0));
},{deep: true})
const changeColumn=(index:number,value:number)=>{
  targets.value[index]=value;
}
const emits=defineEmits<{
  (e:'change',index:Array<number>):void;
}>()
</script>

<style scoped lang="scss">
.ipicker{
  width: 100%;
  display: flex;
  background: #D7FFFBFF;
}
</style>
