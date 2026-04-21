type Day = { day: string; published: number; failed: number };

export function AnalyticsSparkline({ data }: { data: Day[] }) {
  const width = 640;
  const height = 120;
  const pad = { top: 8, right: 4, bottom: 22, left: 24 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const max = Math.max(1, ...data.map((d) => d.published + d.failed));
  const barW = innerW / data.length;
  const barInnerW = Math.max(2, barW - 2);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-32 w-full"
      role="img"
      aria-label="Daily posts over the last 30 days"
    >
      {/* y-axis guide */}
      <line
        x1={pad.left}
        x2={width - pad.right}
        y1={pad.top + innerH}
        y2={pad.top + innerH}
        className="stroke-border"
      />
      <text
        x={pad.left - 6}
        y={pad.top + 8}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        {max}
      </text>
      <text
        x={pad.left - 6}
        y={pad.top + innerH + 3}
        textAnchor="end"
        className="fill-muted-foreground text-[10px]"
      >
        0
      </text>

      {data.map((d, i) => {
        const x = pad.left + i * barW + (barW - barInnerW) / 2;
        const total = d.published + d.failed;
        const h = (total / max) * innerH;
        const failedH = (d.failed / max) * innerH;
        const publishedH = h - failedH;
        const yFailed = pad.top + innerH - failedH;
        const yPublished = yFailed - publishedH;
        const showLabel = i % 5 === 0 || i === data.length - 1;
        return (
          <g key={d.day}>
            {publishedH > 0 && (
              <rect
                x={x}
                y={yPublished}
                width={barInnerW}
                height={publishedH}
                className="fill-foreground/80"
              />
            )}
            {failedH > 0 && (
              <rect
                x={x}
                y={yFailed}
                width={barInnerW}
                height={failedH}
                className="fill-destructive/70"
              />
            )}
            {showLabel && (
              <text
                x={x + barInnerW / 2}
                y={height - 4}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {d.day.slice(5)}
              </text>
            )}
            <title>
              {d.day}: {d.published} published
              {d.failed > 0 ? `, ${d.failed} failed` : ""}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
