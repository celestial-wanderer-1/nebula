/// <reference types="vite/client" />

// Set by vite.config.ts.
declare const __NEBULA_MOCK__: boolean;
declare const __NEBULA_BUILD__: string;

// The basic Plotly bundle ships no types; it is the plotly.js API.
declare module "plotly.js-basic-dist-min" {
  import Plotly from "plotly.js";
  export default Plotly;
}
