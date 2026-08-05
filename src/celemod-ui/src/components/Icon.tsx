const glyphs: Record<string, string> = {
  home: '⌂', 'chart-area': '▥', search: '⌕', drive: '▣', web: '◎', flag: '⚑',
  image: '▧', download: '⇩', clock: '◷', grid: '▦', file: '▤', edit: '✎',
  save: '⌑', delete: '⌫', warn: '⚠', external: '↗', 'opts-h': '•••',
  'i-down': '⌄', 'i-right': '›', 'i-asterisk': '✱', 'i-cross': '×',
  'i-tick': '✓', fail: '!', replay: '↻',
};

export const Icon = ({ name }: { name: string }) => (
  <span className={`icon icon-${name}`} aria-hidden="true">{glyphs[name] ?? '•'}</span>
);
