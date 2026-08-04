import { describe, expect, it } from "vitest";

import { resolveContactRecipient } from "./recipient";

describe("resolveContactRecipient", () => {
  it("prefers a dialable phone number and offers trunk variants", () => {
    const r = resolveContactRecipient({
      phone: "+57 310 869 4208",
      wa_id: "573108694208",
    });
    expect(r?.isPhone).toBe(true);
    expect(r?.value).toBe("573108694208");
    // Variants exist so a number registered with a trunk 0 still lands.
    expect(r!.variants.length).toBeGreaterThan(1);
    expect(r!.variants[0]).toBe("573108694208");
  });

  it("falls back to the BSUID when the contact has no phone", () => {
    // The regression this guards: automations and flows selected only
    // `phone`, bailed on the empty string, and never sent anything to
    // customers who message from a WhatsApp username.
    const r = resolveContactRecipient({
      phone: "",
      wa_id: "CO.1008736792153700",
    });
    expect(r?.isPhone).toBe(false);
    expect(r?.value).toBe("CO.1008736792153700");
    // A BSUID is opaque — permuting it would address a different person.
    expect(r?.variants).toEqual(["CO.1008736792153700"]);
  });

  it("falls back to the BSUID when the phone is present but unusable", () => {
    const r = resolveContactRecipient({
      phone: "12",
      wa_id: "CO.1008736792153700",
    });
    expect(r?.isPhone).toBe(false);
    expect(r?.value).toBe("CO.1008736792153700");
  });

  it("returns null when the contact is genuinely unreachable", () => {
    expect(resolveContactRecipient({ phone: "", wa_id: null })).toBeNull();
    expect(resolveContactRecipient({})).toBeNull();
    expect(resolveContactRecipient(null)).toBeNull();
  });

  it("ignores surrounding whitespace on a BSUID", () => {
    const r = resolveContactRecipient({
      phone: null,
      wa_id: "  CO.1008736792153700  ",
    });
    expect(r?.value).toBe("CO.1008736792153700");
  });
});
