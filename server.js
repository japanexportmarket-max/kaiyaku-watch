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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = "japanexportmarket-max/kaiyaku-watch";
const DATA_PATH = "data.json";

const users = [];
const items = [];
let dataSha = "";
let saveTimer = null;

function ghHeaders() {
  return {
    Authorization: "Bearer " + GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "User-Agent": "kaiyaku-watch",
    "Content-Type": "application/json"
  };
}

async function loadStore() {
  if (!GITHUB_TOKEN) return;
  const r = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + DATA_PATH, {
    headers: ghHeaders()
  });
  if (r.status === 404) return;
  if (!r.ok) {
    console.log("load failed", r.status);
    return;
  }
  const body = await r.json();
  dataSha = body.sha || "";
  const raw = Buffer.from(body.content || "", "base64").toString("utf8");
  const data = JSON.parse(raw || "{}");
  users.length = 0;
  items.length = 0;
  (data.users || []).forEach((u) => users.push(u));
  (data.items || []).forEach((it) => items.push(it));
  console.log("loaded", users.length, items.length);
}

function scheduleSave() {
  if (!GITHUB_TOKEN) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStore, 800);
}

async function saveStore() {
  if (!GITHUB_TOKEN) return;
  const content = Buffer.from(JSON.stringify({ users, items })).toString("base64");
  const payload = { message: "save data", content };
  if (dataSha) payload.sha = dataSha;
  const r = await fetch("https://api.github.com/repos/" + REPO + "/contents/" + DATA_PATH, {
    method: "PUT",
    headers: ghHeaders(),
    body: JSON.stringify(payload)
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok && body.content && body.content.sha) dataSha = body.content.sha;
  else console.log("save failed", r.status);
}

app.get("/", (_req, res) => {
  res.send("kaiyaku-watch server ok");
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    users: users.length,
    items: items.length,
    token: LINE_TOKEN ? "on" : "off",
    store: GITHUB_TOKEN ? "on" : "off"
  });
});

function rememberUser(userId, family) {
  if (!userId) return;
  let u = users.find((x) => x.id === userId);
  if (!u) {
    u = { id: userId, family: family || "" };
    users.push(u);
    scheduleSave();
  } else if (family && u.family !== family) {
    u.family = family;
    scheduleSave();
  }
}

app.all("/webhook", (req, res) => {
  const events = (req.body && req.body.events) || [];
  events.forEach((ev) => {
    const src = ev.source || {};
    const text = ev.message && ev.message.text ? String(ev.message.text).trim() : "";
    let family = "";
    if (text.indexOf("家族") === 0) family = text.replace(/^家族/, "").trim();
    rememberUser(src.userId, family);
  });
  res.status(200).send("OK");
});

app.post("/register", (req, res) => {
  const b = req.body || {};
  const family = String(b.family || "").trim();
  const item = {
    id: String(Date.now()),
    userId: b.userId || (users[0] && users[0].id) || "",
    family,
    shop: String(b.shop || "").trim(),
    shipDate: b.shipDate,
    daysBefore: Number(b.daysBefore || 10),
    phone: String(b.phone || "").trim()
  };
  items.push(item);
  scheduleSave();
  res.json({ ok: true, item });
});

async function pushText(userId, text) {
  if (!LINE_TOKEN || !userId) return { skipped: true };
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + LINE_TOKEN
    },
    body: JSON.stringify({ to: userId, messages: [{ type: "text", text }] })
  });
  return { status: r.status };
}

app.all("/tick", async (_req, res) => {
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
    const targets = [];
    if (it.family) {
      users.forEach((u) => {
        if (u.family === it.family && targets.indexOf(u.id) === -1) targets.push(u.id);
      });
    }
    if (it.userId && targets.indexOf(it.userId) === -1) targets.push(it.userId);
    for (const id of targets) sent.push(await pushText(id, text));
  }
  res.json({ sent });
});

loadStore().finally(() => {
  app.listen(PORT, () => console.log("listening on " + PORT));
});
