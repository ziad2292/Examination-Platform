import { Calculator } from "lucide-react";

export const DESMOS_CALCULATOR_URL = "https://www.desmos.com/calculator";

export function CalculatorLink() {
  return <a className="btn-secondary !min-h-10 !px-3 text-sm" href={DESMOS_CALCULATOR_URL} target="_blank" rel="noopener noreferrer" aria-label="Open Desmos calculator in a new tab"><Calculator size={17} />Calculator</a>;
}
