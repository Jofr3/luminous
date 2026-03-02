import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { healthRoute } from "./routes/health";
import { cardsRoute } from "./routes/cards";
import { setsRoute } from "./routes/sets";

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use("*", cors());

app.route("/health", healthRoute);
app.route("/api/cards", cardsRoute);
app.route("/api/sets", setsRoute);

app.get("/", (c) => {
  return c.json({ message: "Luminouse API" });
});

export default app;
