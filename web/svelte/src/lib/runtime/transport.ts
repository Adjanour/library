export interface Transport {
  request(path: string, init?: RequestInit): Promise<Response>;
}

/** Browser preview and desktop both use the same HTTP boundary. */
export const httpTransport: Transport = {
  request: (path, init) => fetch(path, init)
};
