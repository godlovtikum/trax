import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Text as SvgText, G, Line } from 'react-native-svg';
import { useColors } from '../hooks/useColors';
import type { MonthSeries } from '../types';

interface BarChartProps {
  data: MonthSeries[];
  width?: number;
  height?: number;
}

export function BarChart({ data, width = 320, height = 160 }: BarChartProps) {
  const colors = useColors();
  if (!data.length) return null;

  const paddingLeft = 10;
  const paddingBottom = 28;
  const paddingTop = 10;
  const chartW = width - paddingLeft;
  const chartH = height - paddingBottom - paddingTop;
  const maxVal = Math.max(...data.flatMap(d => [d.income, d.expense]), 1);
  const groupWidth = chartW / data.length;
  const barW = Math.min((groupWidth * 0.35), 18);
  const gap = 3;

  const yVal = (v: number) => paddingTop + chartH - (v / maxVal) * chartH;

  return (
    <View>
      <Svg width={width} height={height}>
        {/* Grid line */}
        <Line x1={paddingLeft} y1={paddingTop} x2={width} y2={paddingTop} stroke={colors.border} strokeWidth={0.5} />
        <Line x1={paddingLeft} y1={paddingTop + chartH / 2} x2={width} y2={paddingTop + chartH / 2} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3 3" />

        {data.map((item, i) => {
          const baseX = paddingLeft + i * groupWidth + (groupWidth - barW * 2 - gap) / 2;
          const ih = Math.max((item.income / maxVal) * chartH, 2);
          const eh = Math.max((item.expense / maxVal) * chartH, 2);
          return (
            <G key={i}>
              <Rect x={baseX} y={yVal(item.income)} width={barW} height={ih} fill={colors.income} rx={3} opacity={0.9} />
              <Rect x={baseX + barW + gap} y={yVal(item.expense)} width={barW} height={eh} fill={colors.expense} rx={3} opacity={0.9} />
              <SvgText
                x={baseX + barW + gap / 2}
                y={height - 6}
                fontSize={9}
                textAnchor="middle"
                fill={colors.mutedForeground}
                fontWeight="400"
              >
                {item.label}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.income }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Income</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: colors.expense }]} />
          <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Expense</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '400' },
});
