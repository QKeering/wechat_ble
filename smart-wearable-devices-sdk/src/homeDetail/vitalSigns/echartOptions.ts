export const baseOption = {
  backgroundColor: '#fff',
  tooltip: {
    show: true, // 启用tooltip
    trigger: 'axis', // 触发方式为坐标轴触发
    axisPointer: {
      type: 'line', // 显示指示线
      lineStyle: {
        color: '#ff5a5f',
        width: 1,
        type: 'solid'
      }
    },
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderColor: 'rgba(0, 0, 0, 0.8)',
    textStyle: {
      color: '#fff',
      fontSize: 12
    }
  },
  xAxis: {
    type: 'category',
    data: ['00:00', '06:00', '12:00', '18:00', '21:00', '24:00'],
    boundaryGap: false,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false
    },
    splitLine: { show: false }
  },
  yAxis: {
    type: 'value',
    min: 0,
    max: 100,
    splitNumber: 5,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: true },
    splitLine: {
      lineStyle: { type: 'dashed', color: '#eee' }
    }
  },
  series: [
    {
      data: [60, 70, 75, 70, 65, 68],
      type: 'line',
      smooth: true,
      itemStyle: { color: '#ff5a5f' },
      lineStyle: { color: '#ff5a5f', width: 2 },
      symbol: 'circle', // 改为可见的标记
      symbolSize: 0, // 将标记大小设置为0，不显示圆点
      connectNulls: true
      // label: {
      //   show: true, // 显示标签
      //   position: 'top', // 标签位置：top（上方）、bottom（下方）、inside（内部）
      //   color: '#ff5a5f', // 标签颜色
      //   fontSize: 10, // 字体大小
      //   fontWeight: 'bold', // 字体粗细
      //   formatter: function (params: any) {
      //     // 如果值为0，返回空字符串不显示标签
      //     if (params.value == 0) {
      //       return '';
      //     }
      //     // 否则显示数值
      //     return params.value;
      //   }
      // }
    }
  ],
  grid: {
    left: 24,
    right: 24,
    top: 56,
    bottom: 34,
    containLabel: false
  }
};

/**
 * 心率、血氧、HRV 共用的趋势折线样式。
 *
 * 生命体征详情和睡眠页复用同一批组件，因此在这里固定折线形态，
 * 避免各页面因局部 option 合并顺序不同而退化成带点折线或默认样式。
 */
type VitalMetricKind = 'heartRate' | 'bloodOxygen' | 'hrv';

const VITAL_METRIC_DISPLAY_RULES: Record<VitalMetricKind, { min: number; max: number; spike: number }> = {
  heartRate: { min: 30, max: 220, spike: 45 },
  bloodOxygen: { min: 70, max: 100, spike: 6 },
  hrv: { min: 1, max: 300, spike: 120 }
};

const VITAL_METRIC_TOOLTIP_META: Record<VitalMetricKind, { label: string; unit: string }> = {
  heartRate: { label: '心率', unit: ' 次/分钟' },
  bloodOxygen: { label: '血氧饱和度', unit: '%' },
  hrv: { label: 'HRV', unit: ' 毫秒' }
};

export const applyVitalSignsLineStyle = (
  option: any,
  color = '#ff5a5f',
  metric: VitalMetricKind = 'heartRate'
) => {
  const series = option?.series?.[0];
  if (!series) return option;

  const sourceSeriesData: unknown[] = Array.isArray(series.data) ? series.data : [];
  const sourceAxisData = Array.isArray(option?.xAxis?.data) ? option.xAxis.data : [];
  const axisLength = Math.max(sourceAxisData.length, sourceSeriesData.length, 2);
  // Some mini-program ECharts/WebView combinations draw category placeholders
  // (null, undefined or '-') down to the Y-axis minimum. Feeding those sparse
  // placeholders to a line series therefore creates a row of false vertical
  // bars. Keep only real samples and encode the original bucket index as the
  // numeric X coordinate; this preserves the true position in the day without
  // ever sending a missing value to the renderer.
  const displayRule = VITAL_METRIC_DISPLAY_RULES[metric];
  const rawPoints = sourceSeriesData.reduce((points: Array<[number, number]>, value: unknown, index: number) => {
    const rawValue = Array.isArray(value) ? value[1] : value;
    const rawX = Array.isArray(value) ? value[0] : index;
    const numeric = Number(rawValue);
    const numericX = Number(rawX);
    if (
      rawValue !== null &&
      rawValue !== '' &&
      Number.isFinite(numeric) &&
      numeric >= displayRule.min &&
      numeric <= displayRule.max &&
      Number.isFinite(numericX)
    ) {
      points.push([numericX, numeric]);
    }
    return points;
  }, []);
  const grouped = new Map<number, number[]>();
  rawPoints.forEach(([x, value]) => grouped.set(x, [...(grouped.get(x) || []), value]));
  const deduplicated = Array.from(grouped.entries())
    .map(([x, values]) => {
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
      return [x, median] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  const normalizedSeriesData = deduplicated.filter((point, index, points) => {
    if (index === 0 || index === points.length - 1) return true;
    const previous = points[index - 1];
    const following = points[index + 1];
    const neighborsStable = Math.abs(previous[1] - following[1]) <= displayRule.spike / 2;
    return !(
      neighborsStable &&
      Math.abs(point[1] - previous[1]) > displayRule.spike &&
      Math.abs(point[1] - following[1]) > displayRule.spike
    );
  });
  const validPointCount = normalizedSeriesData.length;
  const tooltipMeta = VITAL_METRIC_TOOLTIP_META[metric];
  const formatTimelineCoordinate = (value: unknown) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value ?? '');
    const sourceIndex = Math.max(0, Math.min(sourceAxisData.length - 1, Math.round(numeric)));
    return String(sourceAxisData[sourceIndex] ?? value);
  };

  option.animation = true;
  option.animationDuration = 320;
  option.animationEasing = 'cubicOut';
  option.xAxis = {
    ...(option.xAxis || {}),
    type: 'value',
    data: undefined,
    min: 0,
    max: axisLength - 1,
    boundaryGap: [0, 0],
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      show: false,
      formatter: (value: unknown) => formatTimelineCoordinate(value)
    },
    axisPointer: {
      label: {
        show: true,
        formatter: (params: any) => formatTimelineCoordinate(params?.value)
      }
    },
    splitLine: { show: false }
  };
  option.yAxis = {
    ...(option.yAxis || {}),
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      ...(option.yAxis?.axisLabel || {}),
      // Rendered by MetricYAxisLabels in the view layer. Canvas axis labels
      // disappear on some Android WebViews even when show=true.
      show: false,
      color: '#666',
      fontSize: 12,
      margin: 10,
      formatter: (value: unknown) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? `${Math.round(numeric)}` : '';
      }
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed',
        color: '#edf0f4',
        width: 1
      }
    }
  };
  option.grid = {
    ...(option.grid || {}),
    // Reserve an explicit label gutter. containLabel alone is unreliable in
    // the mini-program canvas renderer and previously clipped the Y values.
    left: 46,
    right: 12,
    bottom: 18,
    containLabel: false
  };
  option.series[0] = {
    ...series,
    // Keep Y values as plain numbers so older cached mini-program chart
    // runtimes can still render the curve. The lightweight renderer uses the
    // companion xPositions field when available to preserve the real time
    // position; older runtimes safely ignore it and still draw the data.
    data: normalizedSeriesData.map((point) => point[1]),
    xPositions: normalizedSeriesData.map((point) => point[0]),
    type: 'line',
    smooth: 0.38,
    showSymbol: validPointCount === 1,
    symbol: validPointCount === 1 ? 'circle' : 'none',
    symbolSize: validPointCount === 1 ? 7 : 0,
    connectNulls: false,
    itemStyle: { color },
    lineStyle: {
      color,
      width: 2.5,
      cap: 'round',
      join: 'round'
    },
    emphasis: {
      disabled: true
    }
  };
  option.tooltip = {
    ...(option.tooltip || {}),
    show: true,
    trigger: 'axis',
    triggerOn: 'mousemove|click',
    confine: true,
    alwaysShowContent: true,
    formatter: (params: any) => {
      const item = Array.isArray(params) ? params[0] : params;
      if (!item) return '';
      const point = normalizedSeriesData[Number(item.dataIndex)] || [];
      const time = formatTimelineCoordinate(point[0] ?? item.axisValue ?? item.dataIndex);
      const rawValue = Array.isArray(item.value) ? item.value[item.value.length - 1] : item.value;
      const numeric = Number(rawValue);
      const value = Number.isFinite(numeric) ? Math.round(numeric) : rawValue;
      return `${time}<br/>${tooltipMeta.label}：${value}${tooltipMeta.unit}`;
    }
  };
  return option;
};
