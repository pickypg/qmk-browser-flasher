import { requestUsbDevice } from "./core/device-picker.js";
import { flashStm32Dfu } from "./protocols/stm32-dfu.js";
import type { FlashableDevice } from "./types/index.js";
import { createInitialFlowState } from "./ui/flow.js";

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app element not found");
  }

  const supported = "usb" in navigator;
  const state = createInitialFlowState();

  app.innerHTML = `
    <h1>QMK Browser Flasher</h1>
    ${supported ? "" : "<p>This browser does not support WebUSB — use a Chromium-based browser.</p>"}
    <p data-role="status">Step: ${state.step}</p>
    <div>
      <label for="firmware-input">Firmware (.bin)</label>
      <input type="file" id="firmware-input" accept=".bin" />
    </div>
    <button type="button" id="pair-button" ${supported ? "" : "disabled"}>Pair device</button>
    <p data-role="device-info"></p>
    <div data-role="confirm-section" hidden>
      <label>
        <input type="checkbox" id="confirm-checkbox" />
        I understand this will erase and overwrite the keyboard's firmware.
      </label>
      <button type="button" id="flash-button" disabled>Flash</button>
    </div>
    <p data-role="progress"></p>
    <p data-role="result"></p>
  `;

  wire(app);
}

function wire(app: HTMLDivElement): void {
  const firmwareInput = app.querySelector<HTMLInputElement>("#firmware-input")!;
  const pairButton = app.querySelector<HTMLButtonElement>("#pair-button")!;
  const deviceInfo = app.querySelector<HTMLParagraphElement>('[data-role="device-info"]')!;
  const confirmSection = app.querySelector<HTMLDivElement>('[data-role="confirm-section"]')!;
  const confirmCheckbox = app.querySelector<HTMLInputElement>("#confirm-checkbox")!;
  const flashButton = app.querySelector<HTMLButtonElement>("#flash-button")!;
  const progress = app.querySelector<HTMLParagraphElement>('[data-role="progress"]')!;
  const result = app.querySelector<HTMLParagraphElement>('[data-role="result"]')!;

  let firmwareBytes: Uint8Array | null = null;
  let device: FlashableDevice | null = null;

  function updateFlashButtonState(): void {
    flashButton.disabled = !(firmwareBytes && device && confirmCheckbox.checked);
  }

  firmwareInput.addEventListener("change", () => {
    const file = firmwareInput.files?.[0];
    if (!file) {
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      firmwareBytes = new Uint8Array(buffer);
      updateFlashButtonState();
    });
  });

  pairButton.addEventListener("click", () => {
    void requestUsbDevice()
      .then((paired) => {
        device = paired;
        deviceInfo.textContent = `Paired: ${paired.productName}`;
        confirmSection.hidden = false;
        updateFlashButtonState();
      })
      .catch((error: unknown) => {
        deviceInfo.textContent = `Pairing failed: ${error instanceof Error ? error.message : String(error)}`;
      });
  });

  confirmCheckbox.addEventListener("change", updateFlashButtonState);

  flashButton.addEventListener("click", () => {
    if (!firmwareBytes || !device) {
      return;
    }
    if (device.protocol !== "stm32-dfu" || device.transport !== "usb") {
      result.textContent = `Protocol "${device.protocol}" is not implemented yet.`;
      return;
    }

    flashButton.disabled = true;
    result.textContent = "";
    progress.textContent = "Flashing...";

    void flashStm32Dfu(device.device, firmwareBytes, (p) => {
      progress.textContent = `Flashing... ${p.bytesWritten}/${p.totalBytes} bytes`;
    })
      .then((flashResult) => {
        progress.textContent = "";
        result.textContent = flashResult.ok
          ? `Success — ${flashResult.bytesWritten} bytes written and verified.`
          : `Flash completed but verification failed (${flashResult.bytesWritten} bytes written).`;
      })
      .catch((error: unknown) => {
        progress.textContent = "";
        result.textContent = `Flash failed: ${error instanceof Error ? error.message : String(error)}`;
      })
      .finally(() => {
        updateFlashButtonState();
      });
  });
}

render();
