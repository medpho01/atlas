import { ReactNode } from 'react';

export function Card({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`bg-surface rounded-xl border border-ink-150 shadow-card ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
  info,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  /** Renders next to the title — typically an <InfoTip />. */
  info?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between px-5 pt-4 pb-3 gap-3 flex-wrap">
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h2 className="font-semibold text-ink-900 text-[15px] leading-tight flex items-center gap-1.5">
            <span>{title}</span>
            {info}
          </h2>
          {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-5 ${className}`}>{children}</div>;
}

export function CardSeparator() {
  return <div className="border-t border-ink-100/80 mx-5" />;
}
