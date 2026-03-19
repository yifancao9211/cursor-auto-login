import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { MotionPlugin } from "@vueuse/motion";
import "./main.css";

const app = createApp(App);
app.use(createPinia());
app.use(MotionPlugin);
app.mount("#app");

// Override renderer console to forward logs to main process logger
(function setupRendererLogForwarding() {
  const _origLog = console.log.bind(console);
  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);

  function fmt(...args) {
    return args.map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
  }

  console.log = (...args) => {
    _origLog(...args);
    window.api?.sendRendererLog?.("info", fmt(...args));
  };
  console.warn = (...args) => {
    _origWarn(...args);
    window.api?.sendRendererLog?.("warn", fmt(...args));
  };
  console.error = (...args) => {
    _origError(...args);
    window.api?.sendRendererLog?.("error", fmt(...args));
  };
})();
