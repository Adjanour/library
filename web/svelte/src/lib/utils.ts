import type { Item } from './api';

export function fileExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

export function typeIcon(type: string): string {
  switch (type) {
    case 'book': return 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z';
    case 'paper': return 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8';
    case 'thesis': return 'M12 6.253v13 M12 6.253c1.168-.775 2.754-1.253 4.5-1.253S19.832 5.478 21 6.253v13c-1.168-.775-2.754-1.253-4.5-1.253s-3.332.478-4.5 1.253 M12 6.253C10.832 5.478 9.246 5 7.5 5S4.168 5.478 3 6.253v13C4.168 18.478 5.754 19 7.5 19s3.332-.478 4.5-1.253';
    case 'ebook': return 'M12 8c-1.5 0-3 .5-4 1v12c1-.5 2.5-1 4-1s3 .5 4 1V9c-1-.5-2.5-1-4-1z M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H8 M4 6a2 2 0 012-2h2';
    default: return 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6';
  }
}

export function purposeColor(purpose: string): string {
  switch (purpose) {
    case 'learning': return 'text-blue-400 bg-blue-500/10';
    case 'reference': return 'text-purple-400 bg-purple-500/10';
    case 'research': return 'text-cyan-400 bg-cyan-500/10';
    case 'interview-prep': return 'text-orange-400 bg-orange-500/10';
    case 'practice': return 'text-green-400 bg-green-500/10';
    case 'self-improvement': return 'text-pink-400 bg-pink-500/10';
    case 'academic': return 'text-amber-400 bg-amber-500/10';
    case 'reading': return 'text-accent bg-accent/10';
    default: return 'text-text-secondary bg-surface-3';
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

export function highlight(text: string, query: string): string {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="bg-accent/30 text-text-primary rounded px-0.5">$1</mark>');
}

export const PURPOSES = [
  'learning', 'reference', 'research', 'interview-prep',
  'practice', 'self-improvement', 'academic', 'reading'
];

export const TYPES = [
  { value: 'book', label: 'Books' },
  { value: 'paper', label: 'Papers' },
  { value: 'thesis', label: 'Theses' },
  { value: 'ebook', label: 'Ebooks' },
];

export const SORTS = [
  { value: '', label: 'Sort: Title' },
  { value: 'year', label: 'Sort: Year' },
  { value: 'added', label: 'Sort: Recent' },
  { value: 'size', label: 'Sort: Size' },
];
