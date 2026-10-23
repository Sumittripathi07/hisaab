import { Activity, CircleUserRound, House, UsersRound } from "lucide-react";

// Only built sections; a later phase adds Friends.
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", Icon: House },
  { href: "/groups", label: "Groups", Icon: UsersRound },
  { href: "/activity", label: "Activity", Icon: Activity },
  { href: "/account", label: "Account", Icon: CircleUserRound },
];

/** A section stays marked on its sub-pages too: Groups is current on /groups/abc. */
export const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
