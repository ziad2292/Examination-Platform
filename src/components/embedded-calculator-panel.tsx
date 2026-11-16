"use client";
import { useEffect, useRef, useState } from "react";
import { Calculator, X, Maximize2 } from "lucide-react";
type CalculatorInstance = {
  resize: () => void;
  destroy: () => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
  observeEvent: (event: string, callback: () => void) => void;
};
declare global {
  interface Window {
    Desmos?: {
      GraphingCalculator: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => CalculatorInstance;
    };
  }
}
let loading: Promise<void> | undefined;
function loadDesmos(key: string) {
  if (window.Desmos) return Promise.resolve();
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const failed = () => {
        clearTimeout(timeout);
        script.remove();
        loading = undefined;
        reject(new Error("Calculator unavailable"));
      };
      const timeout = setTimeout(failed, 20000);
      script.src = `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(key)}`;
      script.onload = () => {
        clearTimeout(timeout);
        if (window.Desmos) resolve();
        else failed();
      };
      script.onerror = failed;
      document.head.appendChild(script);
    });
  return loading;
}
export function EmbeddedCalculatorPanel({
  sectionAttemptId,
}: {
  sectionAttemptId: string;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const instance = useRef<CalculatorInstance | null>(null);
  const panel = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const key = process.env.NEXT_PUBLIC_DESMOS_API_KEY;
  const storage = `assessly-calculator-${sectionAttemptId}`;
  useEffect(() => {
    if (!open || !key || instance.current) return;
    let disposed = false;
    void loadDesmos(key)
      .then(() => {
        if (disposed || !mount.current || !window.Desmos) return;
        const calculator = window.Desmos.GraphingCalculator(mount.current, {
          expressions: true,
          settingsMenu: true,
        });
        instance.current = calculator;
        try {
          const saved = sessionStorage.getItem(storage);
          if (saved) calculator.setState(JSON.parse(saved));
        } catch {
          /* Invalid calculator state is isolated from exam answers. */
        }
        calculator.observeEvent("change", () => {
          try {
            sessionStorage.setItem(
              storage,
              JSON.stringify(calculator.getState()),
            );
          } catch {
            /* Storage failure does not affect the assessment. */
          }
        });
      })
      .catch(() =>
        setError("Calculator could not load. Check your connection and retry."),
      );
    return () => {
      disposed = true;
    };
  }, [open, key, retry, storage]);
  useEffect(
    () => () => {
      instance.current?.destroy();
      instance.current = null;
    },
    [sectionAttemptId],
  );
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        instance.current?.resize();
        panel.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, expanded]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <div data-calculator>
      <button
        ref={button}
        className="btn-secondary !min-h-10 !px-3 text-sm"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Calculator size={17} />
        Calculator
      </button>
      <section
        ref={panel}
        hidden={!open}
        tabIndex={-1}
        role="region"
        aria-label="Desmos calculator"
        data-calculator
        className={`calculator-panel ${expanded ? "expanded" : ""}`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <header className="flex items-center justify-between border-b border-black/10 p-3">
          <b className="text-sm">Desmos calculator</b>
          <div className="flex gap-2">
            <button
              className="icon-button"
              type="button"
              aria-label="Expand calculator"
              onClick={() => setExpanded(!expanded)}
            >
              <Maximize2 size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="Close calculator"
              onClick={close}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        {!key ? (
          <p role="status" className="p-5 text-sm">
            The embedded calculator is not configured. Ask your administrator to
            configure the licensed Desmos API key.
          </p>
        ) : error ? (
          <div role="alert" className="p-5 text-sm">
            {error}
            <button
              className="btn-secondary mt-3"
              type="button"
              onClick={() => {
                loading = undefined;
                setError("");
                setRetry(retry + 1);
              }}
            >
              Retry calculator
            </button>
          </div>
        ) : <p role="status" className="sr-only">Loading calculator…</p>}
        <div ref={mount} className="h-[calc(100%-60px)] min-h-80" />
      </section>
    </div>
  );
}
