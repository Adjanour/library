import { z } from "zod";

export const ItemUpdateSchema = z.object({
  title: z.string().nullable().optional(),
  authors: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  category: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  publisher: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  doi: z.string().nullable().optional(),
  isbn: z.string().nullable().optional(),
  arxiv_id: z.string().nullable().optional(),
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
  cursor: z.string().optional(),
  status: z.string().default(""),
  types: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  purposes: z.array(z.string()).optional(),
});

export const BulkItemUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  updates: ItemUpdateSchema.refine((value) => Object.keys(value).length > 0, {
    message: "updates must contain at least one field",
  }),
});

export const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const SettingsSchema = z.object({
  scan_directories: z.array(z.string().trim().min(1)).min(1).max(20),
  // Optional so a scan-directories-only save keeps the saved page size.
  catalog_page_size: z.number().int().min(12).max(96).optional(),
});

export const CollectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280).optional().default(""),
});

export const CollectionUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280),
});

export const CollectionItemUpdateSchema = z.object({
  item_id: z.coerce.number().int().positive(),
});
export const CollectionReorderSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });

export const ReadingProgressSchema = z.object({
  status: z.enum([
    "unread",
    "queued",
    "reading",
    "finished",
    "dropped",
    "abandoned",
  ]),
  progress_percent: z.number().int().min(0).max(100),
  current_page: z.number().int().min(0),
  total_pages: z.number().int().min(0),
  started_at: z.string().nullable().optional(),
  finished_at: z.string().nullable().optional(),
  last_read_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.total_pages > 0 && value.current_page > value.total_pages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["current_page"],
      message: "current_page cannot exceed total_pages",
    });
  }
});

export const ReadingProgressUpdateSchema = z.object({
  progress_percent: z.number().int().min(0).max(100),
  current_page: z.number().int().min(0),
  total_pages: z.number().int().min(0),
  location: z.string().max(1000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.total_pages > 0 && value.current_page > value.total_pages) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["current_page"],
      message: "current_page cannot exceed total_pages",
    });
  }
});

export const QueueItemSchema = z.object({
  item_id: z.number().int().positive().nullable().optional(),
  focusd_book_number: z.number().int().nonnegative().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  author: z.string().max(500).default(""),
  priority: z.number().int().nonnegative().optional(),
});

export const QueueReorderSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
});

export const BookmarkSchema = z.object({
  location: z.string().trim().min(1).max(1000),
  label: z.string().trim().max(300).default(""),
  percent: z.number().int().min(0).max(100),
});

export const AnnotationSchema = z.object({
  cfi_range: z.string().trim().min(1).max(2000),
  text: z.string().trim().max(2000).default(""),
  note: z.string().trim().max(2000).default(""),
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
