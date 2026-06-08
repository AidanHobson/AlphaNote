import type { ReactNode } from 'react';

export default function Card({ title, sub, right, children, className = '', style, onClick }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={`card ${className}`}
      style={style}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!(); } } : undefined}
    >
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="card-title" style={{ margin: 0 }}>{title}{sub && <span className="card-sub">· {sub}</span>}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}
