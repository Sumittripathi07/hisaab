import { AddExpenseFab } from "@/components/add-expense-fab";
import { BottomNav } from "@/components/app-shell/bottom-nav";
import { Sidebar } from "@/components/app-shell/sidebar";
import { CreateGroupProvider } from "@/components/create-group-sheet";
import { currencyOptions } from "@/lib/currency";
import { listGroupsForUser } from "@/server/groups";
import { requireOnboardedUser } from "@/server/session";

/** Sidebar from 768px up; below that, a bottom nav with a "+" button floating above it (add an expense, or start a group). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const { active } = await listGroupsForUser(user.id);
  return (
    <CreateGroupProvider currencies={currencyOptions(user.defaultCurrency)} defaultCurrency={user.defaultCurrency}>
      <div className="flex min-h-dvh">
        <Sidebar user={{ name: user.name, email: user.email, image: user.image }} />
        {/* On phones, room at the bottom for the nav and the button, so neither ever covers the last card. */}
        <main className="min-w-0 flex-1 px-4 pt-6 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:px-6 md:px-10 md:py-10">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
      <BottomNav />
      <AddExpenseFab groups={active.map(({ id, name, emoji }) => ({ id, name, emoji }))} />
    </CreateGroupProvider>
  );
}
