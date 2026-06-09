import { useEffect, useRef } from 'react';

// Loads a TradingView embed widget. Retries on transient CDN drops, then shows
// a graceful fallback (ported from OpenStock, including the company-profile fix).
export default function TradingView({ scriptName, config, height = 460 }: { scriptName: string; config: Record<string, unknown>; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let cancelled = false;

    const load = (retriesLeft: number) => {
      if (cancelled) return;
      container.innerHTML = '';
      const wrap = document.createElement('div');
      wrap.className = 'tradingview-widget-container';
      wrap.style.height = `${height}px`;
      const widget = document.createElement('div');
      widget.className = 'tradingview-widget-container__widget';
      widget.style.height = `${height}px`;
      wrap.appendChild(widget);

      const script = document.createElement('script');
      script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${scriptName}.js`;
      script.async = true;
      // textContent (not innerHTML) so the config is treated as raw text — a crafted
      // symbol containing "</script>…" can never break out and inject markup.
      script.textContent = JSON.stringify({ ...config, width: '100%', height, autosize: true });
      script.onerror = () => {
        if (retriesLeft > 0) setTimeout(() => load(retriesLeft - 1), 600);
        else widget.innerHTML = '<div class="empty" style="height:100%;display:grid;place-items:center;border:none;">Chart unavailable — could not reach TradingView.</div>';
      };
      wrap.appendChild(script);
      container.appendChild(wrap);
    };

    load(2);
    return () => { cancelled = true; container.innerHTML = ''; };
  }, [scriptName, JSON.stringify(config), height]);

  return <div className="tv-wrap" ref={ref} style={{ height }} />;
}
