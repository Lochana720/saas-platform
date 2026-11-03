import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { STATUS_LABEL } from '../lib/format';
import type { InvoiceStatus } from '../lib/types';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary', loading, icon, children, className = '', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button className={`btn btn-${variant} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : icon}
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className = '', flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  const key = overdue ? 'OVERDUE' : status;
  return <span className={`badge badge-${key.toLowerCase()}`}>{STATUS_LABEL[key]}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'ok' }) {
  return <span className={`badge badge-tone-${tone}`}>{children}</span>;
}

export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={`field ${error ? 'field-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-msg">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Alert({ children, tone = 'danger' }: { children: ReactNode; tone?: 'danger' | 'info' | 'ok' }) {
  return <div className={`alert alert-${tone}`} role="alert">{children}</div>;
}

export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="pagination">
      <span className="muted">{total} result{total === 1 ? '' : 's'}</span>
      <div className="pagination-btns">
        <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
        <span className="mono">{page} / {totalPages}</span>
        <button className="icon-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="loading"><Loader2 className="spin" size={22} /></div>;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 45% 88%)`, color: `hsl(${hue} 45% 28%)` }}>
      {name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
    </span>
  );
}
