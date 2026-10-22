import type { Metadata } from "next";
import { EmptyGroups } from "@/components/empty-groups";
import { GroupGrid } from "@/components/group-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listGroupsForUser } from "@/server/groups";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Groups · Hisaab" };

const count = "rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground group-data-active:bg-primary/10 group-data-active:text-primary";

export default async function GroupsPage({ searchParams }: PageProps<"/groups">) {
  const user = await requireOnboardedUser();
  const [{ active, archived }, { tab }] = await Promise.all([listGroupsForUser(user.id), searchParams]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Groups</h1>
      <Tabs defaultValue={tab === "archived" ? "archived" : "active"} className="gap-4">
        <TabsList className="h-10! w-full sm:w-fit">
          <TabsTrigger value="active" className="group px-4">
            Active <span className={count}>{active.length}</span>
          </TabsTrigger>
          <TabsTrigger value="archived" className="group px-4">
            Archived <span className={count}>{archived.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="active">{active.length ? <GroupGrid groups={active} /> : <EmptyGroups />}</TabsContent>
        <TabsContent value="archived">
          {archived.length ? (
            <GroupGrid groups={archived} />
          ) : (
            <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground">
              Nothing archived. Archive a finished trip from its settings and it waits here, balances intact.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
