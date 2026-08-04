import { describe, expect, it } from "vitest";

import { createInitialFlowState } from "../../src/ui/flow.js";

describe("createInitialFlowState", () => {
  it("starts at the select-board step", () => {
    expect(createInitialFlowState().step).toBe("select-board");
  });
});
