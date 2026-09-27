import { z } from "zod";

export const ItemUpdateSchema = z.object({
  title: z.string().nullable().optional(),
  authors: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  category: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().default(""),
  type: z.string().default(""),
  category: z.string().default(""),
  tag: z.string().default(""),
  purpose: z.string().default(""),
  year: z.coerce.number().int().default(0),
  sort: z.string().default(""),
  order: z.string().default(""),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const SettingsSchema = z.object({
  scan_directories: z.array(z.string().trim().min(1)).min(1).max(20),
});

export const ReaderPreferencesSchema = z.object({
  fontSize: z.number().refine((value) =>
    [80, 90, 100, 110, 125, 150, 175, 200].includes(value)
  ),
  fontFamily: z.enum(["default", "serif", "sans", "mono"]),
  lineHeight: z.number().refine((value) =>
    [1.35, 1.5, 1.65, 1.8, 2].includes(value)
  ),
  contentWidth: z.number().refine((value) =>
    [560, 640, 720, 840, 960].includes(value)
  ),
  theme: z.enum(["light", "sepia", "dark", "black"]),
  spread: z.enum(["none", "both"]),
  flow: z.enum(["paginated", "scrolled"]),
  pdfZoom: z.number().refine((value) =>
    [80, 100, 110, 120, 135, 150, 175, 200].includes(value)
  ),
});
