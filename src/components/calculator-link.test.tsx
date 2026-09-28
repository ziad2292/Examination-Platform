import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalculatorLink, DESMOS_CALCULATOR_URL } from "./calculator-link";

describe("CalculatorLink", () => {
  it("opens Desmos safely without replacing the exam page", () => {
    const markup = renderToStaticMarkup(<CalculatorLink />);
    expect(markup).toContain(`href="${DESMOS_CALCULATOR_URL}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Calculator");
  });
});
