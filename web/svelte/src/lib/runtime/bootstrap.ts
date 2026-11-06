import { httpTransport } from './transport';

export interface BootstrapResponse {
  protocol_version: string;
  app_version: string;
  runtime_mode: 'browser' | 'desktop';
  platform: string;
  capabilities: Record<string, boolean>;
  schema_version: number;
  lifecycle_state: string;
}

let cached: BootstrapResponse | null = null;

export async function bootstrap(force = false): Promise<BootstrapResponse> {
  if (cached && !force) return cached;
  const response = await httpTransport.request('/api/bootstrap');
  if (!response.ok) throw new Error(`Bootstrap failed (${response.status})`);
  cached = await response.json() as BootstrapResponse;
  return cached;
}

export function resetBootstrap(): void { cached = null; }
