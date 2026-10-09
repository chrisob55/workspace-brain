import type { KnowledgeEntity, RelationshipType } from '@/lib/types';
import { entityStyle, RELATIONSHIP_STYLE } from '@/lib/palette';
import { cn } from '@/lib/utils';

export function EntityChip({
  entity,
  label,
  className,
  size = 'md',
}: {
  entity: Pick<KnowledgeEntity, 'type' | 'name'>;
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const style = entityStyle(entity.type);
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 items-center gap-2 rounded-lg border bg-card font-medium',
        size === 'sm' && 'px-2 py-1 text-xs',
        size === 'md' && 'px-3 py-1.5 text-sm',
        size === 'lg' && 'px-4 py-3 text-base',
        className,
      )}
      style={{
        borderColor: `color-mix(in oklch, ${style.color} 45%, transparent)`,
      }}
      title={entity.name}
    >
      <Icon
        className={cn('shrink-0', size === 'lg' ? 'size-5' : 'size-4')}
        style={{ color: style.color }}
      />
      <span className="truncate">{label ?? entity.name}</span>
      {size === 'lg' && (
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
          {style.label}
        </span>
      )}
    </span>
  );
}

export function RelationshipPill({
  type,
  className,
  count,
}: {
  type: RelationshipType;
  className?: string;
  count?: number;
}) {
  const color = RELATIONSHIP_STYLE[type].color;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide',
        className,
      )}
      style={{
        color,
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {type}
      {count !== undefined && (
        <span className="tabular-nums opacity-80">{count}</span>
      )}
    </span>
  );
}
