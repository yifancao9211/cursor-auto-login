import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { MotionPlugin } from "@vueuse/motion";
import "./main.css";

const app = createApp(App);
app.use(createPinia());
app.use(MotionPlugin);
app.mount("#app");
