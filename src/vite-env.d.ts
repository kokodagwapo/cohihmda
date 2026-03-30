/// <reference types="vite/client" />

declare module "*.md?raw" {
  const content: string;
  export default content;
}

/** Optional: Cohi Builder assistant (Gemini) in Capture Analysis */
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
