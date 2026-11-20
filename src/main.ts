import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import { registerSW } from "./lib/pwa.ts";

registerSW();

mount(App, { target: document.getElementById("app")! });
