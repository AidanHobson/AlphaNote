import type { ReactNode } from 'react';

export default function Card({ title, sub, right, children, className = '', style, onClick }: {
  title?: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void;
}) {
  return (
    <div className={`card ${className}`} style={style} onClick={onClick}>
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
