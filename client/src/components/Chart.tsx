// Plotly chart (lazy-loaded as its own chunk, per the ReturnSignal guide).
// Uses the dist-min build via the factory so Vite bundles it cleanly.
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';

const Plot = createPlotlyComponent(Plotly);

function themeColors() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    font: dark ? '#93a1b0' : '#6b7280',
    grid: dark ? 'rgba(255,255,255,0.07)' : 'rgba(17,24,39,0.08)',
    paper: 'rgba(0,0,0,0)',
  };
}

export default function Chart({ data, layout = {}, height = 320 }: { data: any[]; layout?: any; height?: number }) {
  const c = themeColors();
  const merged = {
    autosize: true,
    height,
    margin: { l: 48, r: 18, t: 14, b: 36 },
    paper_bgcolor: c.paper,
    plot_bgcolor: c.paper,
    font: { color: c.font, family: 'Inter, system-ui, sans-serif', size: 11 },
    xaxis: { gridcolor: c.grid, zerolinecolor: c.grid, ...layout.xaxis },
    yaxis: { gridcolor: c.grid, zerolinecolor: c.grid, ...layout.yaxis },
    showlegend: false,
    ...layout,
  };
  return (
    <Plot
      data={data}
      layout={merged}
      useResizeHandler
      style={{ width: '100%', height }}
      config={{ displayModeBar: false, responsive: true }}
    />
  );
}
