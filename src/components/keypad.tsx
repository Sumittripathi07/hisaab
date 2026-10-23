"use client";

import { Delete } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import type { KeypadKey } from "@/lib/keypad";

const KEYS: KeypadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

/** A character on a physical keyboard, as a key; the numpad of some layouts types "," for the point. */
const fromKeyboard = (key: string): KeypadKey | null =>
  /^[0-9]$/.test(key) ? (key as KeypadKey) : key === "." || key === "," ? "." : key === "Backspace" ? "back" : null;

type Props = {
  onKey: (key: KeypadKey) => void;
  /** Enter on the keyboard, unless a button has focus (it would press itself). */
  onEnter?: () => void;
  /** False for a currency without minor units: there is no point to type. */
  decimal: boolean;
};

/** A 3×4 pad of thumb-sized keys. A physical keyboard types into it too for as long as it's on screen. */
export function Keypad({ onKey, onEnter, decimal }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Enter") {
        if (onEnter && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          onEnter();
        }
        return;
      }
      const key = fromKeyboard(e.key);
      if (!key) return;
      e.preventDefault();
      onKey(key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKey, onEnter]);

  return (
    <div role="group" aria-label="Amount keypad" className="grid grid-cols-3 gap-2">
      {KEYS.map((key) =>
        key === "." && !decimal ? (
          <span key={key} aria-hidden />
        ) : (
          <Button
            key={key}
            type="button"
            variant="secondary"
            aria-label={key === "." ? "Decimal point" : key === "back" ? "Delete" : undefined}
            onClick={() => onKey(key)}
            className="h-14 rounded-2xl text-2xl font-medium tabular-nums transition-transform duration-100 active:translate-y-0 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            {key === "back" ? <Delete className="size-6" aria-hidden /> : key}
          </Button>
        ),
      )}
    </div>
  );
}
