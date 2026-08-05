import type { FlashPhase, FlashStepEvent } from "../../types/index.js";

/** Unit word used when formatting a live "current / total" status, keyed
 * by phase — omitted phases (preparing/finishing) never carry current/total. */
const PROGRESS_UNITS: Partial<Record<FlashPhase, string>> = {
  erasing: "pages",
  writing: "bytes",
  verifying: "bytes",
};

function keyFor(event: FlashStepEvent): string {
  return `${event.phase}:${event.label}`;
}

function formatStatusText(event: FlashStepEvent): string {
  if (event.status === "ok") {
    return "Done";
  }
  if (event.status === "error") {
    return event.error ? `Failed: ${event.error}` : "Failed";
  }
  if (event.current !== undefined && event.total !== undefined) {
    const unit = PROGRESS_UNITS[event.phase];
    return unit ? `${event.current} / ${event.total} ${unit}` : `${event.current} / ${event.total}`;
  }
  return "Running…";
}

export function resetStepLog(tbody: HTMLTableSectionElement): void {
  tbody.innerHTML = "";
}

/** Appends one row per named operation on "start" and updates that same
 * row's status cell on every later event for it — "progress" events keep
 * the row live (e.g. "3 / 10 pages") without adding a new row per chunk,
 * so an operation with many device round-trips (erasing dozens of pages,
 * writing hundreds of blocks) still shows as a single line. */
export function appendOrUpdateStepRow(tbody: HTMLTableSectionElement, event: FlashStepEvent): void {
  const key = keyFor(event);

  if (event.status === "start") {
    const row = document.createElement("tr");
    row.dataset.stepKey = key;
    row.innerHTML = `
      <td>${event.label}</td>
      <td>${event.phase}</td>
      <td><span class="step-status running">${formatStatusText(event)}</span></td>
    `;
    tbody.appendChild(row);
    return;
  }

  const matches = Array.from(tbody.rows).filter((row) => row.dataset.stepKey === key);
  const row = matches[matches.length - 1];
  if (!row) {
    return;
  }
  const statusCell = row.querySelector<HTMLElement>(".step-status");
  if (!statusCell) {
    return;
  }
  statusCell.className = `step-status ${event.status === "progress" ? "running" : event.status}`;
  statusCell.textContent = formatStatusText(event);
}
