// Type shims for modules that ship no declarations.
// plotly.js-basic-dist-min is the prebuilt basic bundle (scatter+bar) — same
// runtime API as plotly.js; we use it through react-plotly.js's factory, so a
// minimal any-typed module declaration is sufficient here.
declare module 'plotly.js-basic-dist-min';
declare module 'react-plotly.js/factory';
