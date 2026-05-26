export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-2.5 bg-muted rounded animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
