const express = require("express");
const app = express();
app.use(express.json());
app.use(function (_req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

const PORT = process.env.PORT || 3000;
const LINE_TOKEN = process.env.LINE_TOKEN || "";
const users = [];
const items = [];

app.get("/", (_req, res) => {
  res.send("kaiyaku-watch server ok");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, users: users.length, items: items.length });
});

app.post("/webhook", (req, res) => {
  const events = (req.body && req.body.events) || [];
  events.forEach((ev) => {
    const userId = ev.source && ev.source.userId;
    if (!userId) return;
    if (!users.includes(userId)) users.push(userId);
  });
  res.status(200).send("OK");
});

app.post("/register", (req, res) => {
  const b = req.body || {};
  const item = {
    id: String(Date.now()),
    userId: b.userId || users[0] || "",
    shop: String(b.shop || "").trim(),
    shipDate: b.shipDate,
    daysBefore: Number(b.daysBefore || 10),
    phone: String(b.phone || "").trim()
  };
  items.push(item);
  res.json({ ok: true, item });
});

app.get("/due", (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = items.filter((it) => {
    const d = new Date(it.shipDate + "T00:00:00");
    d.setDate(d.getDate() - Number(it.daysBefore || 0));
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    return diff === 1 || diff === 0;
  });
  res.json({ due });
});

async function pushText(userId, text) {
  if (!LINE_TOKEN || !userId) return { skipped: true };
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + LINE_TOKEN
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text }]
    })
  });
  return { status: r.status };
}

app.post("/tick", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sent = [];
  for (const it of items) {
    const d = new Date(it.shipDate + "T00:00:00");
    d.setDate(d.getDate() - Number(it.daysBefore || 0));
    d.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff !== 1 && diff !== 0) continue;
    const text =
      (it.shop || "店") +
      "\n" +
      d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日までにこの番号へ。\n" +
      (it.phone || "");
    sent.push(await pushText(it.userId, text));
  }
  res.json({ sent });
});

app.listen(PORT, () => {
  console.log("listening on " + PORT);
});
