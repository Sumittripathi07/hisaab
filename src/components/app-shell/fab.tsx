import { Plus } from "lucide-react";
import { CreateGroupButton } from "@/components/create-group-sheet";

/** Phones only: floats above the bottom nav. Phase 2 turns it into "Add expense". */
export function Fab() {
  return (
    <CreateGroupButton
      aria-label="Create a group"
      className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 size-14 rounded-full shadow-lg shadow-primary/30 transition-transform duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 md:hidden"
    >
      <Plus className="size-6" strokeWidth={2.5} aria-hidden />
    </CreateGroupButton>
  );
}
