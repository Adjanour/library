import { z } from "zod";

export const BootstrapSchema = z.object({
  protocol_version: z.string(),
  app_version: z.string(),
  runtime_mode: z.enum(["browser", "desktop"]),
  platform: z.string(),
  capabilities: z.record(z.boolean()),
  schema_version: z.number(),
  lifecycle_state: z.string(),
});

export type BootstrapResponse = z.infer<typeof BootstrapSchema>;
