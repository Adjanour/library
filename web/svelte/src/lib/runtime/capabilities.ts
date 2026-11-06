import type { BootstrapResponse } from './bootstrap';

export type RuntimeCapabilities = BootstrapResponse['capabilities'];

export function supports(capabilities: RuntimeCapabilities, name: string): boolean {
  return capabilities[name] === true;
}
