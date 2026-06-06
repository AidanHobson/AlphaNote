export default function Skeleton({ height = 16, width = '100%', style }: { height?: number | string; width?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function SkeletonLines({ lines = 4 }: { lines?: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={13} width={`${90 - i * 8}%`} style={{ marginBottom: 10 }} />
      ))}
    </div>
  );
}
