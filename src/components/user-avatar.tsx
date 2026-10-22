import { UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

// Eight fixed hues. Each pair keeps the initials above 4.5:1 in its theme.
const HUES = [
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200",
];

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-20 text-2xl",
};

/** "Neha Kapoor Sharma" → "NS": first letters of the first and last words. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words.at(-1)!] : words;
  return picked.map((w) => [...w][0]).join("").toUpperCase();
}

/** The same name always gets the same hue, whatever its capitalisation. */
function hue(name: string): string {
  const hash = [...name.trim().toLowerCase()].reduce((h, ch) => (h * 31 + ch.codePointAt(0)!) >>> 0, 0);
  return HUES[hash % HUES.length];
}

/** The person's photo, or their initials on a colour derived from their name. Decorative: put the name next to it. */
export function UserAvatar({ name, image, size = "md", className }: {
  name: string;
  image?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const letters = initials(name);
  return (
    <Avatar className={cn(SIZES[size], className)} aria-hidden>
      {image && <AvatarImage src={image} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className={cn("font-semibold tracking-wide transition-colors", letters ? hue(name) : "")}>
        {letters || <UserRound className="size-1/2" />}
      </AvatarFallback>
    </Avatar>
  );
}
