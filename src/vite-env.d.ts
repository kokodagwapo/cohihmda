/// <reference types="vite/client" />

/** Optional: Cohi Builder assistant (Gemini) in Capture Analysis */
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_UNIFIED_CHAT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
