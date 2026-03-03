export type Bindings = {
  DB: D1Database;
  IMAGES: R2Bucket;
};

export type AppEnv = { Bindings: Bindings };
