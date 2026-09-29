import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderAccordionGroup, BuilderSectionAccordion, nextActiveSection } from "./builder-section-accordion";

describe("BuilderSectionAccordion", () => {
  it("keeps inactive modules minimized and opens the active editor", () => {
    const markup = renderToStaticMarkup(<BuilderAccordionGroup initialSectionId="one">
      <BuilderSectionAccordion id="one" title="Module 1" type="module" order={1} durationMinutes={32} questionCount={27}><p>Question editor one</p></BuilderSectionAccordion>
      <BuilderSectionAccordion id="two" title="Module 2" type="module" order={2} durationMinutes={32} questionCount={27}><p>Question editor two</p></BuilderSectionAccordion>
    </BuilderAccordionGroup>);
    expect((markup.match(/aria-expanded="true"/g) ?? []).length).toBe(1);
    expect((markup.match(/aria-expanded="false"/g) ?? []).length).toBe(1);
    expect(markup).toContain("27 questions");
    expect(markup).toContain("Question editor one");
    expect(markup).not.toContain("Question editor two");
    expect(nextActiveSection("one", "two")).toBe("two");
    expect(nextActiveSection("one", "one")).toBeNull();
    expect(markup).toContain("Minimize all sections");
  });
});
