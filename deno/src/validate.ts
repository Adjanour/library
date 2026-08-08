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
