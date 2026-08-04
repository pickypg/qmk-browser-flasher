export type FlowStep =
  | "select-board"
  | "select-firmware"
  | "await-bootloader"
  | "pair-device"
  | "flashing"
  | "verifying"
  | "done"
  | "error";

// TODO(M1+): drive the step-by-step flash flow (board/firmware selection ->
// bootloader-entry prompt -> device pairing -> flash -> verify) and expose
// state transitions for the UI components to render.
export interface FlowState {
  readonly step: FlowStep;
}

export function createInitialFlowState(): FlowState {
  return { step: "select-board" };
}
