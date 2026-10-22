import { Skeleton } from "@/components/ui/skeleton";

/** The dashboard's shape while its groups load: greeting, then a few cards. */
export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <span className="sr-only" role="status">
        Loading your groups…
      </span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-48" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-28" />
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-4 rounded-2xl border bg-card p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-12 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3.5 w-2/5" />
                  </div>
                </div>
                <div className="flex -space-x-2">
                  {[0, 1, 2].map((j) => (
                    <Skeleton key={j} className="size-8 rounded-full ring-2 ring-card" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
