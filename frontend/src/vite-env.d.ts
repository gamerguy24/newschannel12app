/// <reference types="vite/client" />

/**
 * Build-time configuration the bundle is allowed to read. Anything secret
 * stays on the backend - only the API base address is public.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
