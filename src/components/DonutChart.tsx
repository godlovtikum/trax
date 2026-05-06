import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import { useColors } from '../hooks/useColors';

interface Segment {
  value: number;
  color: string;
  label: string;
}

interface DonutChartProps {
  data: Segment[];
  size?: number;
  innerRadius?: number;
  centerLabel?: string;
  centerSublabel?: string;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, outerR: number, innerR: number, start: number, end: number): string {
  if (end - start >= 360) end = 359.999;
  const oa = polarToCartesian(cx, cy, outerR, end);
  const ob = polarToCartesian(cx, cy, outerR, start);
  const ia = polarToCartesian(cx, cy, innerR, end);
  const ib = polarToCartesian(cx, cy, innerR, start);
  const large = end - start > 180 ? 1 : 0;
  return `M ${ob.x} ${ob.y} A ${outerR} ${outerR} 0 ${large} 1 ${oa.x} ${oa.y} L ${ia.x} ${ia.y} A ${innerR} ${innerR} 0 ${large} 0 ${ib.x} ${ib.y} Z`;
}

export function DonutChart({ data, size = 180, innerRadius, centerLabel, centerSublabel }: DonutChartProps) {
  const colors = useColors();
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 8;
  const innerR = innerRadius ?? outerR * 0.62;
  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    return (
      <View style={[styles.empty, { width: size, height: size }]}>
        <View style={[styles.emptyCircle, { width: outerR * 2, height: outerR * 2, borderRadius: outerR, borderColor: colors.border }]} />
      </View>
    );
  }

  let startAngle = 0;
  const paths = data.map((seg, i) => {
    const sweep = (seg.value / total) * 360;
    const path = arcPath(cx, cy, outerR, innerR, startAngle, startAngle + sweep - 1);
    startAngle += sweep;
    return <Path key={i} d={path} fill={seg.color} />;
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}><G>{paths}</G></Svg>
      {(centerLabel || centerSublabel) && (
        <View style={[styles.center, { width: innerR * 2, height: innerR * 2 }]}>
          {centerLabel && <Text style={[styles.centerLabel, { color: colors.foreground }]} numberOfLines={2}>{centerLabel}</Text>}
          {centerSublabel && <Text style={[styles.centerSub, { color: colors.mutedForeground }]}>{centerSublabel}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  emptyCircle: { borderWidth: 20, opacity: 0.2 },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  centerLabel: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  centerSub: { fontSize: 11, fontWeight: '400', textAlign: 'center', marginTop: 2 },
});
