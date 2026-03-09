import express from "express";

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.send("ServHQ backend live");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

export default app;
