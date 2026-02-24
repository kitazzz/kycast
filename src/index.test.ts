import { describe, expect, it } from "vitest";
import { kycast } from "./index.js";

describe("kycast exports", () => {
  it("kycast is a function", () => {
    expect(typeof kycast).toBe("function");
  });
});
