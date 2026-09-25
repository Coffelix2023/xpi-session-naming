import { fauxProvider, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  modelLabel,
  modelRow,
  modelSearchText,
  type PickerTheme,
  sameModel,
} from "./model-picker.ts";

/** Tags styling instead of emitting ANSI, so assertions stay readable. */
const TAG_THEME: PickerTheme = {
  bold: (text) => `<b>${text}</b>`,
  fg: (color, text) => `<${color}>${text}</${color}>`,
};

function model(id: string, provider: string, name?: string): Model<string> {
  return Object.assign(
    {},
    fauxProvider({
      models: [
        {
          id,
          name,
        },
      ],
      provider,
    }).models[0],
    {
      provider,
    },
  ) as Model<string>;
}

describe("modelLabel", () => {
  it("shows name and id when the name adds information", () => {
    expect(modelLabel(model("mimo-v2.6-flash", "MIMO", "Mimo Flash"))).toBe(
      "Mimo Flash  mimo-v2.6-flash",
    );
  });

  it("shows only the id when the name is the id", () => {
    expect(modelLabel(model("mimo-v2.6-flash", "MIMO", "mimo-v2.6-flash"))).toBe(
      "mimo-v2.6-flash",
    );
  });

  it("shows only the id when there is no name", () => {
    expect(modelLabel(model("mimo-v2.6-flash", "MIMO"))).toBe("mimo-v2.6-flash");
  });
});

describe("modelSearchText", () => {
  it("matches on name, id, provider, and the canonical reference", () => {
    const text = modelSearchText(model("deepseek-v4.1-pro", "CMD-PRO", "DS Pro"));
    expect(text).toBe("DS Pro deepseek-v4.1-pro CMD-PRO CMD-PRO/deepseek-v4.1-pro");
  });
});

describe("sameModel", () => {
  it("compares provider and id, not object identity", () => {
    expect(sameModel(model("m", "P"), model("m", "P"))).toBe(true);
    expect(sameModel(model("m", "P"), model("m", "Q"))).toBe(false);
    expect(sameModel(model("m", "P"), model("n", "P"))).toBe(false);
    expect(sameModel(undefined, model("m", "P"))).toBe(false);
  });
});

describe("modelRow", () => {
  const chosen = model("deepseek-v4.1-pro", "CMD-PRO", "DS Pro");

  it("marks the selected row and the current naming model", () => {
    expect(
      modelRow(chosen, {
        current: chosen,
        selected: true,
        theme: TAG_THEME,
      }),
    ).toBe(
      "<accent>→ </accent><accent>DS Pro</accent>  <muted>deepseek-v4.1-pro</muted><muted> [CMD-PRO]</muted><success> ✓</success>",
    );
  });

  it("leaves unselected rows plain, with no check when they are not current", () => {
    const row = modelRow(chosen, {
      current: model("other", "MIMO"),
      selected: false,
      theme: TAG_THEME,
    });
    expect(row.startsWith("  DS Pro")).toBe(true);
    expect(row).not.toContain("✓");
  });

  it("falls back to the id for a model whose name is the id", () => {
    const row = modelRow(model("mimo-v2.6-flash", "MIMO", "mimo-v2.6-flash"), {
      current: undefined,
      selected: false,
      theme: TAG_THEME,
    });
    expect(row).toBe("  mimo-v2.6-flash<muted> [MIMO]</muted>");
  });
});
