import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { AppEnv } from "./types";
import { healthRoute } from "./routes/health";
import { cardsRoute } from "./routes/cards";
import { setsRoute } from "./routes/sets";
import { imagesRoute } from "./routes/images";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("*", cors());

app.route("/health", healthRoute);
app.route("/api/cards", cardsRoute);
app.route("/api/sets", setsRoute);
app.route("/images", imagesRoute);

app.get("/", (c) => {
  return c.json({ message: "Luminous API" });
});

export default app;
