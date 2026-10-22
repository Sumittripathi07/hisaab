"use client";

import { XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";

const DESKTOP = "(min-width: 768px)";
const subscribe = (onChange: () => void) => {
  const query = matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** What has focus when it opens (the drawer would otherwise focus itself). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
};

/** A bottom drawer on phones, a dialog from 768px up, with a scrolling body. */
export function ResponsiveSheet({ open, onOpenChange, title, description, initialFocus, children }: Props) {
  const desktop = useSyncExternalStore(subscribe, () => matchMedia(DESKTOP).matches, () => false);

  return desktop ? (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={initialFocus} className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 p-6 pb-4">
          <DialogTitle className="text-xl font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-6 pt-1">{children}</div>
      </DialogContent>
    </Dialog>
  ) : (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent initialFocus={initialFocus} className="rounded-t-3xl">
        <DrawerHeader className="gap-1 pb-4">
          <DrawerTitle className="text-xl font-semibold">{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        {/* Swiping and the backdrop aren't available to screen readers or switch access; this is. */}
        <DrawerClose
          render={<Button variant="ghost" size="icon" className="absolute top-3 right-3 size-9 rounded-full text-muted-foreground" />}
          aria-label="Close"
        >
          <XIcon className="size-5" aria-hidden />
        </DrawerClose>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-1">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
