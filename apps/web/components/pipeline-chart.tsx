'use client';

type StatusCount = { status: string; _count: { _all: number } };

const stages = [
  { status: 'NEW', label: 'New', color: '#2563eb', tint: '#eff6ff' },
  { status: 'CONTACTED', label: 'Contacted', color: '#4f46e5', tint: '#eef2ff' },
  { status: 'QUALIFIED', label: 'Qualified', color: '#7c3aed', tint: '#f5f3ff' },
  { status: 'PROPOSAL', label: 'Proposal', color: '#d97706', tint: '#fffbeb' },
  { status: 'WON', label: 'Won', color: '#059669', tint: '#ecfdf5' },
  { status: 'LOST', label: 'Lost', color: '#64748b', tint: '#f1f5f9' },
];

export function PipelineChart({ data }: { data: StatusCount[] }) {
  const counts = new Map(data.map((item) => [item.status, item._count._all]));
  const values = stages.map((stage) => ({ ...stage, count: counts.get(stage.status) ?? 0 }));
  const total = values.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <div className="mt-5">
      <div
        aria-label={`Lead pipeline distribution across ${total} leads`}
        className="flex h-12 gap-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1"
        role="img"
      >
        {total > 0 ? values.filter((stage) => stage.count > 0).map((stage) => (
          <div
            key={stage.status}
            className="flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 text-white sm:px-3"
            style={{ backgroundColor: stage.color, flex: `${stage.count} 1 0%` }}
            title={`${stage.label}: ${stage.count} (${Math.round(stage.count / total * 100)}%)`}
          >
            <span className="truncate text-[10px] font-bold uppercase tracking-wide sm:text-xs">{stage.label}</span>
            <span className="shrink-0 font-mono text-[10px] font-bold sm:text-xs">{stage.count}</span>
          </div>
        )) : <div className="flex w-full items-center justify-center rounded-lg text-xs font-medium text-slate-500">No leads in the pipeline yet</div>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-6">
        {values.map((stage) => {
          const percentage = total ? Math.round(stage.count / total * 100) : 0;
          return (
            <div key={stage.status} className="rounded-xl border border-slate-200/80 p-3" style={{ backgroundColor: stage.tint }}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="truncate text-[11px] font-semibold text-slate-600">{stage.label}</span>
              </div>
              <p className="mt-1 font-mono text-lg font-bold text-slate-900">
                {stage.count} <span className="font-sans text-xs font-medium" style={{ color: stage.color }}>({percentage}%)</span>
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full" style={{ width: `${percentage}%`, backgroundColor: stage.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
