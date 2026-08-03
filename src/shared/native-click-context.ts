import type { ModifierState } from './messages.ts';

export interface NativeClickContext {
  timestamp: number;
  button: 0 | 1 | 2;
  modifiers: ModifierState;
  trusted: boolean;
  href: string | null;
  targetBlank: boolean;
}

export interface ClickCorrelationContext extends NativeClickContext {
  sourceTabId: number;
}

function hasModifierNewTabIntent(modifiers: ModifierState): boolean {
  return modifiers.ctrl || modifiers.meta || modifiers.shift;
}

export function clickContextIsExplicitNewTab(context: NativeClickContext): boolean {
  return (
    context.trusted &&
    context.href !== null &&
    (context.button === 1 || hasModifierNewTabIntent(context.modifiers))
  );
}

export function clickContextApprovesNavigation(context: NativeClickContext): boolean {
  if (!context.trusted || context.href === null) {
    return false;
  }

  if (context.button === 1 || hasModifierNewTabIntent(context.modifiers)) {
    return true;
  }

  return context.button === 0 && context.targetBlank;
}

export function resolveLinkOpensNewContext(
  link: Element,
  doc: Document | null = typeof document === 'undefined' ? null : document,
): boolean {
  const attributedTarget = link.getAttribute('target');
  if (attributedTarget !== null) {
    return attributedTarget.trim().toLowerCase() === '_blank';
  }

  if (doc === null) {
    return false;
  }

  const base = doc.querySelector('base[target]');
  const baseTarget = base?.getAttribute('target');
  return baseTarget !== null && baseTarget !== undefined
    ? baseTarget.trim().toLowerCase() === '_blank'
    : false;
}

export function extractAnchorClickContext(
  event: Pick<
    MouseEvent,
    'button' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isTrusted' | 'target'
  >,
  timestamp: number,
): NativeClickContext | null {
  if (!(event.target instanceof Element)) {
    return null;
  }

  const link = event.target.closest('a[href], area[href]');
  if (!(link instanceof HTMLAnchorElement) && !(link instanceof HTMLAreaElement)) {
    return null;
  }

  if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
    return null;
  }

  return {
    timestamp,
    button: event.button,
    modifiers: {
      alt: event.altKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
    },
    trusted: event.isTrusted,
    href: link.href.length > 0 ? link.href : null,
    targetBlank: resolveLinkOpensNewContext(link),
  };
}
