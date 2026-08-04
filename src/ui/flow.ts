export type FlowStep =
  | "select-firmware"
  | "pair-device"
  | "confirm-flash"
  | "flashing"
  | "done"
  | "error";

export interface FlowState {
  readonly step: FlowStep;
}

export function createInitialFlowState(): FlowState {
  return { step: "select-firmware" };
}
