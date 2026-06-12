export function EmptyState({ icon: Icon, title, desc, action, onAction }: {
  icon: React.ElementType; title: string; desc?: string; action?: string; onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-4">
        <Icon className="w-7 h-7 text-slate-300" />
      </div>
      <p className="text-[15px] font-semibold text-slate-700 mb-1">{title}</p>
      {desc && <p className="text-[13px] text-slate-400 mb-4 max-w-xs">{desc}</p>}
      {action && onAction && (
        <button onClick={onAction} className="text-[12px] text-blue-600 hover:text-blue-700 font-semibold hover:underline">
          {action}
        </button>
      )}
    </div>
  );
}
