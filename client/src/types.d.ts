// Minimal module declarations so we can use Plotly via the dist-min build
// (Vite-friendly) without pulling the full @types/plotly.js surface.
declare module 'plotly.js-dist-min' {
  const Plotly: any;
  export default Plotly;
}
declare module 'react-plotly.js/factory' {
  import type { ComponentType } from 'react';
  const createPlotlyComponent: (plotly: any) => ComponentType<any>;
  export default createPlotlyComponent;
}
declare module 'react-plotly.js' {
  import type { ComponentType } from 'react';
  const Plot: ComponentType<any>;
  export default Plot;
}
