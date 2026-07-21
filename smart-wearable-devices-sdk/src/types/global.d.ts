declare global {
  interface Uni {
    $uv: any;
  }

  interface ImportMeta {
    env: Record<string, string | boolean | undefined>;
  }
}

export {};
