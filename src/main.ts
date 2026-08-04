import { createInitialFlowState } from "./ui/flow.js";

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app element not found");
  }

  const supported = "usb" in navigator && "hid" in navigator;
  const state = createInitialFlowState();

  app.innerHTML = `
    <h1>QMK Browser Flasher</h1>
    <p>Step: ${state.step}</p>
    <p>${supported ? "WebUSB/WebHID supported." : "This browser does not support WebUSB/WebHID — use a Chromium-based browser."}</p>
  `;
}

render();
