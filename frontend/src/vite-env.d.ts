/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCKS: string;
  readonly VITE_API_BASE_URL: string;
  /** Public OAuth client id. Unset = the Google button is not rendered and no Google script loads. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
