// Source type badges — makes the architecture visible during demonstration (PRD §93)
type BadgeType = "AI" | "RULE" | "RAG" | "SYNTHETIC" | "HUMAN" | "DEMO" | "LIVE";

const badgeStyles: Record<BadgeType, string> = {
  AI: "bg-purple-100 text-purple-700 border-purple-200",
  RULE: "bg-blue-100 text-blue-700 border-blue-200",
  RAG: "bg-indigo-100 text-indigo-700 border-indigo-200",
  SYNTHETIC: "bg-amber-100 text-amber-700 border-amber-200",
  HUMAN: "bg-green-100 text-green-700 border-green-200",
  DEMO: "bg-gray-100 text-gray-600 border-gray-200",
  LIVE: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const badgeLabels: Record<BadgeType, string> = {
  AI: "AI",
  RULE: "RULE",
  RAG: "RAG",
  SYNTHETIC: "SYNTHETIC",
  HUMAN: "HUMAN",
  DEMO: "DEMO MODE",
  LIVE: "LIVE AI",
};

export function SourceBadge({ type, title }: { type: BadgeType; title?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded border ${badgeStyles[type]}`}
      title={title || badgeLabels[type]}
    >
      {badgeLabels[type]}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {badge}
    </div>
  );
}

export function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}
