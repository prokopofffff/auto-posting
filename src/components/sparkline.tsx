export function Sparkline({
  data,
  color = "var(--accent)",
  height = 28,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const w = 100;
  const h = height;
  if (data.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: h, display: "block" }}
      />
    );
  }
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: h, display: "block" }}
    >
      <polyline fill="none" stroke={color} strokeWidth="1.4" points={points} />
      <polyline
        fill={color}
        opacity="0.10"
        points={`0,${h} ${points} ${w},${h}`}
      />
    </svg>
  );
}
