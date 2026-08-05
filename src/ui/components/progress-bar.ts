import type { FlashPhase, FlashStepEvent } from "../../types/index.js";

const PHASE_LABELS: Record<FlashPhase, string> = {
  preparing: "Preparing",
  flashing: "Flashing",
  verifying: "Verifying",
  finishing: "Finishing",
};

/** Renders the live flash progress bar: determinate (with a percentage)
 * when the event carries current/total, indeterminate (pulsing) otherwise
 * — e.g. the one-shot "Checking device state"/"Leaving DFU mode" steps
 * that have no byte count to report. Passing `undefined` clears it. */
export function renderProgress(container: HTMLElement, event: FlashStepEvent | undefined): void {
  if (!event) {
    container.innerHTML = "";
    return;
  }

  const determinate = event.current !== undefined && event.total !== undefined && event.total > 0;
  const percent = determinate ? Math.round((event.current / event.total) * 100) : 0;
  const activity = event.detail ?? event.label;

  container.innerHTML = `
    <div class="progress-label">
      <span>${PHASE_LABELS[event.phase]}: ${activity}</span>
      <span>${determinate ? `${percent}%` : "…"}</span>
    </div>
    <div class="progress-track${determinate ? "" : " indeterminate"}">
      <div class="progress-fill" style="width: ${determinate ? percent : 100}%"></div>
    </div>
  `;
}
