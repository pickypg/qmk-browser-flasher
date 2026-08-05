import { describe, expect, it } from "vitest";

import { findBoardByHidIds, getBoard } from "../../src/board-db/index.js";

describe("findBoardByHidIds", () => {
  it("resolves the NuPhy Air75 V2 from its real hidVendorId/hidProductId", () => {
    const board = findBoardByHidIds(6645, 12870);

    expect(board).toBe(getBoard("nuphy-air75-v2"));
  });

  it("returns undefined for an unknown ID pair", () => {
    expect(findBoardByHidIds(0x9999, 0x8888)).toBeUndefined();
  });
});
