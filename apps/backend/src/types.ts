export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
  ALLOWED_ORIGINS?: string;
};

export type AppEnv = { Bindings: Bindings };
