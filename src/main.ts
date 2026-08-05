import { findBoardByHidIds } from "./board-db/index.js";
import { requestUsbDevice, watchForDisconnect } from "./core/device-picker.js";
import { findUsbDeviceDescriptor } from "./core/firmware-parser/usb-descriptor.js";
import { flashStm32Dfu } from "./protocols/stm32-dfu.js";
import "./styles.css";
import type { BoardEntry, FlashableDevice, FlashStepEvent } from "./types/index.js";
import { wireDropzone } from "./ui/components/dropzone.js";
import { renderErrorScreen } from "./ui/components/error-screen.js";
import { renderPicker } from "./ui/components/picker.js";
import { renderProgress } from "./ui/components/progress-bar.js";
import { appendOrUpdateStepRow, resetStepLog } from "./ui/components/step-log.js";
import { createInitialFlowState, type FlowStep } from "./ui/flow.js";

const STEP_LABELS: Record<FlowStep, string> = {
  "select-firmware": "Choose your firmware and pair your keyboard",
  "pair-device": "Choose your firmware and pair your keyboard",
  "confirm-flash": "Confirm and flash",
  flashing: "Flashing…",
  done: "Done",
  error: "Failed",
};

function render(): void {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app element not found");
  }

  const supported = "usb" in navigator;

  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <h1>QMK Browser Flasher</h1>
        <p class="app-subtitle">Flash QMK firmware to your keyboard directly from the browser.</p>
      </header>

      <p class="browser-warning" data-role="browser-warning" ${supported ? "hidden" : ""}>
        This browser does not support WebUSB — use a Chromium-based browser (Chrome, Edge, Brave).
      </p>

      <p class="status-line" data-role="status"></p>

      <section class="panel" data-role="firmware-panel">
        <h2>Firmware</h2>
        <div class="dropzone" data-role="dropzone">
          <p>Drag and drop a <code>.bin</code> file here, or</p>
          <label class="file-button" for="firmware-input">Browse files</label>
          <input type="file" id="firmware-input" accept=".bin" hidden />
          <p class="dropzone-filename" data-role="firmware-name"></p>
          <p class="dropzone-error" data-role="firmware-error"></p>
        </div>
        <p class="mismatch-warning" data-role="mismatch-warning"></p>
      </section>

      <section class="panel" data-role="prepare-panel">
        <h2>Prepare your keyboard</h2>
        <div data-role="board-picker"></div>
      </section>

      <section class="panel" data-role="pair-panel">
        <h2>Pair</h2>
        <button type="button" id="pair-button" class="primary" ${supported ? "" : "disabled"}>Pair device</button>
        <p data-role="device-info"></p>
      </section>

      <section class="panel" data-role="confirm-panel" hidden>
        <h2>Flash</h2>
        <label class="confirm-label">
          <input type="checkbox" id="confirm-checkbox" />
          I understand this will erase and overwrite the keyboard's firmware.
        </label>
        <button type="button" id="flash-button" class="primary" disabled>Flash firmware</button>
      </section>

      <section class="panel" data-role="progress-panel" hidden>
        <h2>Progress</h2>
        <div data-role="progress-container"></div>
        <table class="step-log">
          <thead>
            <tr>
              <th>Step</th>
              <th>Phase</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody data-role="step-log-body"></tbody>
        </table>
      </section>

      <section class="panel" data-role="result-panel" hidden>
        <div data-role="result-content"></div>
        <button type="button" id="reset-button">Flash another firmware</button>
      </section>
    </div>
  `;

  wire(app);
}

function wire(app: HTMLDivElement): void {
  const statusLine = app.querySelector<HTMLParagraphElement>('[data-role="status"]')!;
  const dropzone = app.querySelector<HTMLDivElement>('[data-role="dropzone"]')!;
  const firmwareInput = app.querySelector<HTMLInputElement>("#firmware-input")!;
  const firmwareName = app.querySelector<HTMLParagraphElement>('[data-role="firmware-name"]')!;
  const firmwareError = app.querySelector<HTMLParagraphElement>('[data-role="firmware-error"]')!;
  const pairButton = app.querySelector<HTMLButtonElement>("#pair-button")!;
  const deviceInfo = app.querySelector<HTMLParagraphElement>('[data-role="device-info"]')!;
  const confirmPanel = app.querySelector<HTMLElement>('[data-role="confirm-panel"]')!;
  const confirmCheckbox = app.querySelector<HTMLInputElement>("#confirm-checkbox")!;
  const flashButton = app.querySelector<HTMLButtonElement>("#flash-button")!;
  const progressPanel = app.querySelector<HTMLElement>('[data-role="progress-panel"]')!;
  const progressContainer = app.querySelector<HTMLDivElement>('[data-role="progress-container"]')!;
  const stepLogBody = app.querySelector<HTMLTableSectionElement>('[data-role="step-log-body"]')!;
  const resultPanel = app.querySelector<HTMLElement>('[data-role="result-panel"]')!;
  const resultContent = app.querySelector<HTMLDivElement>('[data-role="result-content"]')!;
  const resetButton = app.querySelector<HTMLButtonElement>("#reset-button")!;
  const mismatchWarning = app.querySelector<HTMLParagraphElement>('[data-role="mismatch-warning"]')!;

  let firmwareBytes: Uint8Array | null = null;
  let device: FlashableDevice | null = null;
  let unwatchDisconnect: (() => void) | null = null;
  let selectedBoard: BoardEntry | undefined;
  let detectedFirmwareBoard: BoardEntry | undefined;

  function updateMismatchWarning(): void {
    mismatchWarning.textContent =
      detectedFirmwareBoard && selectedBoard && detectedFirmwareBoard.id !== selectedBoard.id
        ? `This firmware looks like it's for ${detectedFirmwareBoard.name}, not the selected ${selectedBoard.name}. Double-check before flashing.`
        : "";
  }

  const picker = renderPicker(app.querySelector<HTMLDivElement>('[data-role="board-picker"]')!, (board) => {
    selectedBoard = board;
    updateMismatchWarning();
  });

  function handleDeviceDisconnected(): void {
    device = null;
    deviceInfo.textContent = "Device disconnected — pair again to continue.";
    unwatchDisconnect?.();
    unwatchDisconnect = null;
    updateFlashButtonState();
  }

  function updateStatus(step: FlowStep): void {
    statusLine.textContent = STEP_LABELS[step];
  }

  function updateFlashButtonState(): void {
    confirmPanel.hidden = !(firmwareBytes && device);
    flashButton.disabled = !(firmwareBytes && device && confirmCheckbox.checked);
    if (firmwareBytes && device) {
      updateStatus("confirm-flash");
    } else if (firmwareBytes || device) {
      updateStatus("pair-device");
    } else {
      updateStatus("select-firmware");
    }
  }

  function acceptFirmware(file: File): void {
    firmwareError.textContent = "";
    void file.arrayBuffer().then((buffer) => {
      firmwareBytes = new Uint8Array(buffer);
      firmwareName.textContent = `${file.name} (${firmwareBytes.length.toLocaleString()} bytes)`;

      const descriptor = findUsbDeviceDescriptor(firmwareBytes);
      detectedFirmwareBoard = descriptor ? findBoardByHidIds(descriptor.vendorId, descriptor.productId) : undefined;
      if (detectedFirmwareBoard && !picker.getSelectedBoard()) {
        // Nothing picked yet — the firmware itself is the strongest signal
        // of which board this is for, so use it (fires onSelectionChange,
        // which also updates the mismatch warning below).
        picker.selectBoard(detectedFirmwareBoard.id);
      }
      updateMismatchWarning();

      updateFlashButtonState();
    });
  }

  wireDropzone(
    dropzone,
    firmwareInput,
    (file) => {
      acceptFirmware(file);
    },
    (message) => {
      firmwareError.textContent = message;
    },
  );

  pairButton.addEventListener("click", () => {
    void requestUsbDevice()
      .then((paired) => {
        unwatchDisconnect?.();
        device = paired;
        deviceInfo.textContent = `Paired: ${paired.productName}`;
        unwatchDisconnect = paired.transport === "usb" ? watchForDisconnect(navigator.usb, paired.device, handleDeviceDisconnected) : null;
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
      resultPanel.hidden = false;
      resultPanel.classList.add("errored");
      resultContent.innerHTML = `<p class="result-text error">Protocol "${device.protocol}" is not implemented yet.</p>`;
      updateStatus("error");
      return;
    }

    flashButton.disabled = true;
    resultPanel.hidden = true;
    resultPanel.classList.remove("errored");
    progressPanel.hidden = false;
    resetStepLog(stepLogBody);
    updateStatus("flashing");

    const onStep = (event: FlashStepEvent): void => {
      renderProgress(progressContainer, event);
      appendOrUpdateStepRow(stepLogBody, event);
    };

    void flashStm32Dfu(device.device, firmwareBytes, onStep)
      .then((flashResult) => {
        resultPanel.hidden = false;
        resultPanel.classList.toggle("done", flashResult.ok);
        resultPanel.classList.toggle("errored", !flashResult.ok);
        if (flashResult.ok) {
          resultContent.innerHTML = `<p class="result-text ok">Success — ${flashResult.bytesWritten} bytes written and verified.</p>`;
        } else {
          renderErrorScreen(resultContent, {
            title: "Verification failed",
            message: `Flash completed but the readback didn't match what was written (${flashResult.bytesWritten} bytes written). This is safe to retry — every page is erased again before it's rewritten.`,
            retryLabel: "Try again",
            onRetry: () => flashButton.click(),
          });
        }
        updateStatus(flashResult.ok ? "done" : "error");
      })
      .catch(async (error: unknown) => {
        resultPanel.hidden = false;
        resultPanel.classList.add("errored");

        // A physical disconnect can surface here as an ordinary transfer
        // failure (e.g. "stall") before the WebUSB `disconnect` event that
        // clears `device` (via handleDeviceDisconnected) has had a chance
        // to fire — confirmed on real hardware, not just a theoretical
        // race. Give it a brief window to arrive before deciding which
        // message to show, rather than trusting `device`'s state at the
        // instant this handler starts running.
        if (device) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        if (!device) {
          renderErrorScreen(resultContent, {
            title: "Keyboard disconnected",
            message: "The connection was lost during flashing. This is safe to retry — every page is erased again before it's rewritten, so nothing already flashed is corrupted. Put the keyboard back in bootloader mode and pair again.",
            retryLabel: "Pair again",
            onRetry: () => pairButton.click(),
          });
        } else {
          renderErrorScreen(resultContent, {
            title: "Flash failed",
            message: error instanceof Error ? error.message : String(error),
            retryLabel: "Try again",
            onRetry: () => flashButton.click(),
          });
        }
        updateStatus("error");
      })
      .finally(() => {
        // The flash is fully settled at this point — clear the live
        // activity indicator so it doesn't sit there pulsing forever on
        // whatever one-shot step happened to run last (e.g. "Leaving DFU
        // mode"). The step log above already has the full history.
        renderProgress(progressContainer, undefined);
        updateFlashButtonState();
      });
  });

  resetButton.addEventListener("click", () => {
    unwatchDisconnect?.();
    unwatchDisconnect = null;
    firmwareBytes = null;
    device = null;
    detectedFirmwareBoard = undefined;
    updateMismatchWarning();
    firmwareInput.value = "";
    firmwareName.textContent = "";
    firmwareError.textContent = "";
    deviceInfo.textContent = "";
    confirmCheckbox.checked = false;
    progressPanel.hidden = true;
    resetStepLog(stepLogBody);
    renderProgress(progressContainer, undefined);
    resultPanel.hidden = true;
    resultPanel.classList.remove("done", "errored");
    resultContent.innerHTML = "";
    updateFlashButtonState();
  });

  updateStatus(createInitialFlowState().step);
}

render();
