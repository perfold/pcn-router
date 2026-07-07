// telegram bot code: collect waypoints, reorder, route, export gpx + share link
// run: BOT_TOKEN=xxx node bot/index.js
import { Bot, session, InlineKeyboard, InputFile } from "grammy";
import { loadGraphFromDisk, snapToNode, findRoute } from "./graph-node.js";
import { geocode } from "./geocode.js";
import { buildGpx } from "./gpx.js";
import { loadOverlay, renderRoutePng } from "./render.js";

const SITE = "https://perfold.github.io/pcn-router";
const MAX_WAYPOINTS = 20;
const SPEED_KMH = 15;

const bot = new Bot(process.env.BOT_TOKEN);

// queue image renders so my rpi doesnt explode
let renderLock = Promise.resolve();
function withRenderLock(fn) {
  const run = renderLock.then(fn, fn);
  renderLock = run.catch(() => {});
  return run;
}

bot.use(
  session({
    getSessionKey: (ctx) => ctx.chat?.id?.toString(), // binds session to the group chat room
    initial: () => ({ waypoints: [], route: null }),
  }),
);

// helper functions

function shortLabel(label, max = 28) {
  const first = label.split(",")[0].trim();
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}

function listText(waypoints) {
  if (waypoints.length === 0)
    return "no stops yet. send an address or a location pin to add one.";
  const lines = waypoints.map((wp, i) => {
    const tag = i === 0 ? "🟢" : i === waypoints.length - 1 ? "🔴" : "⚪";
    return `${tag} ${i + 1}. ${shortLabel(wp.label, 40)}`;
  });
  return "your stops:\n" + lines.join("\n");
}

function listKeyboard(waypoints) {
  const kb = new InlineKeyboard();
  waypoints.forEach((wp, i) => {
    kb.text(`${i + 1} ⬆`, `up:${i}`)
      .text(`${i + 1} ⬇`, `dn:${i}`)
      .text(`${i + 1} ✕`, `rm:${i}`)
      .row();
  });
  if (waypoints.length >= 2)
    kb.text("🔁 flip", "flip").text("🚴 route!", "route").row();
  if (waypoints.length >= 1) kb.text("🗑 clear all", "clear");
  return kb;
}

async function showList(ctx, edit = false) {
  const text = listText(ctx.session.waypoints);
  const kb = listKeyboard(ctx.session.waypoints);
  if (edit) {
    await ctx.editMessageText(text, { reply_markup: kb }).catch(() => {});
  } else {
    await ctx.reply(text, { reply_markup: kb });
  }
}

function buildShareUrl(waypoints) {
  const params = new URLSearchParams();
  for (const wp of waypoints) {
    const [lng, lat] = wp.lngLat;
    const cleanLabel = shortLabel(wp.label, 30);
    params.append("wp", `${lat},${lng},${encodeURIComponent(cleanLabel)}`);
  }
  return `${SITE}/?${params.toString()}`;
}

function addWaypoint(ctx, lat, lng, label) {
  if (ctx.session.waypoints.length >= MAX_WAYPOINTS)
    return { ok: false, err: `max ${MAX_WAYPOINTS} stops, remove one first` };
  const nodeId = snapToNode(lat, lng);
  if (!nodeId)
    return { ok: false, err: "couldn't find a cycleable path near that point" };
  ctx.session.waypoints.push({ nodeId, lngLat: [lng, lat], label });
  ctx.session.route = null;
  return { ok: true };
}

// bot commands

bot.command("start", (ctx) =>
  ctx.reply(
    "🚴 *pcn\\-router bot*\n\n" +
      "plan a cycling route across singapore's park connector network\\.\n\n" +
      '• send an *address* \\(e\\.g\\. "punggol waterway park"\\) or a *location pin* to add a stop\n' +
      "• reorder or remove stops with the buttons\n" +
      "• hit *route\\!* to get the path, distance, gpx file and a shareable link\n\n" +
      "/add \\- add a stop\n/route \\- route the current stops\n/stops \\- show current stops\n/clear \\- start over",
    { parse_mode: "MarkdownV2" },
  ),
);

// add waypoint
bot.command("add", async (ctx) => {
  const query = ctx.match?.trim();

  // handle case where user just typed '/add' without text
  if (!query) {
    return ctx.reply(
      "please provide an address or location. for example:\n/add waterway point",
    );
  }

  await ctx.replyWithChatAction("typing");
  let hit;
  try {
    hit = await geocode(query);
  } catch {
    return ctx.reply("geocoder is unreachable right now, try again in a bit.");
  }
  if (!hit) {
    return ctx.reply(
      `couldn't find "${query}" in singapore. try a landmark or a street name.`,
    );
  }

  const res = addWaypoint(ctx, hit.lat, hit.lng, hit.label);
  if (!res.ok) return ctx.reply(res.err);
  await showList(ctx);
});

bot.command("stops", (ctx) => showList(ctx));

bot.command("route", (ctx) => runRoute(ctx, false));

bot.command("clear", (ctx) => {
  ctx.session.waypoints = [];
  ctx.session.route = null;
  return ctx.reply("cleared. send an address or pin to start a new route.");
});

// adding waypoints

bot.on("message:text", async (ctx) => {
  const query = ctx.message.text.trim();
  if (query.startsWith("/")) return;

  await ctx.replyWithChatAction("typing");
  let hit;
  try {
    hit = await geocode(query);
  } catch {
    return ctx.reply("geocoder is unreachable right now, try again in a bit.");
  }
  if (!hit)
    return ctx.reply(
      `couldn't find "${query}" in singapore. try a landmark or a street name.`,
    );

  const res = addWaypoint(ctx, hit.lat, hit.lng, hit.label);
  if (!res.ok) return ctx.reply(res.err);
  await showList(ctx);
});

bot.on("message:location", async (ctx) => {
  const isPrivate = ctx.chat.type === "private";
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  if (!isPrivate && !isReplyToBot) return;

  const { latitude: lat, longitude: lng } = ctx.message.location;
  const label = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const res = addWaypoint(ctx, lat, lng, label);
  if (!res.ok) return ctx.reply(res.err);
  await showList(ctx);
});

// reorder/remove buttons

bot.callbackQuery(/^(up|dn|rm):(\d+)$/, async (ctx) => {
  const [, op, iStr] = ctx.match;
  const i = Number(iStr);
  const wps = ctx.session.waypoints;
  if (i >= wps.length) return ctx.answerCallbackQuery();

  if (op === "up" && i > 0) [wps[i - 1], wps[i]] = [wps[i], wps[i - 1]];
  else if (op === "dn" && i < wps.length - 1)
    [wps[i + 1], wps[i]] = [wps[i], wps[i + 1]];
  else if (op === "rm") wps.splice(i, 1);

  ctx.session.route = null;
  await ctx.answerCallbackQuery();
  await showList(ctx, true);
});

bot.callbackQuery("flip", async (ctx) => {
  ctx.session.waypoints.reverse();
  ctx.session.route = null;
  await ctx.answerCallbackQuery("flipped");
  await showList(ctx, true);
});

bot.callbackQuery("clear", async (ctx) => {
  ctx.session.waypoints = [];
  ctx.session.route = null;
  await ctx.answerCallbackQuery("cleared");
  await showList(ctx, true);
});

// routing

async function runRoute(ctx, isCallback) {
  const wps = ctx.session.waypoints;
  if (wps.length < 2) {
    const msg = "need at least 2 stops to route";
    return isCallback ? ctx.answerCallbackQuery(msg) : ctx.reply(msg);
  }
  if (isCallback) await ctx.answerCallbackQuery();
  await ctx.replyWithChatAction("upload_photo");

  const coords = [];
  let distanceM = 0;
  for (let i = 0; i < wps.length - 1; i++) {
    const seg = findRoute(wps[i].nodeId, wps[i + 1].nodeId);
    if (!seg) {
      return ctx.reply(
        `no path found between stop ${i + 1} (${shortLabel(wps[i].label)}) and stop ${i + 2} (${shortLabel(wps[i + 1].label)}). ` +
          "they might be on disconnected parts of the network, try a nearby point.",
      );
    }
    coords.push(...seg.geometry.coordinates);
    distanceM += seg.distanceM;
  }

  ctx.session.route = { coords, distanceM };

  const km = (distanceM / 1000).toFixed(1);
  const mins = Math.round((distanceM / 1000 / SPEED_KMH) * 60);
  const url = buildShareUrl(wps);

  const png = await withRenderLock(() => renderRoutePng(coords, wps));
  const kb = new InlineKeyboard()
    .text("⬇ download .gpx", "gpx")
    .url("🌐 open in pcn-router", url);

  await ctx.replyWithPhoto(new InputFile(png, "route.png"), {
    caption:
      `pcn-router 🚴\n` +
      `${shortLabel(wps[0].label)} → ${shortLabel(wps[wps.length - 1].label)} (${wps.length} stops)\n` +
      `${km} km | ~${mins} min at ${SPEED_KMH} km/h\n\n` +
      `share link:\n${url}`,
    reply_markup: kb,
  });
}

bot.callbackQuery("route", (ctx) => runRoute(ctx, true));

bot.callbackQuery("gpx", async (ctx) => {
  const route = ctx.session.route;
  if (!route) return ctx.answerCallbackQuery("route expired, hit route! again");
  await ctx.answerCallbackQuery();

  const wps = ctx.session.waypoints;
  const name = `${shortLabel(wps[0]?.label ?? "start")} to ${shortLabel(wps[wps.length - 1]?.label ?? "end")}`;
  const gpx = buildGpx(route.coords, name);
  const fname =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + ".gpx";

  await ctx.replyWithDocument(new InputFile(Buffer.from(gpx), fname), {
    caption: "ride safe 🥳",
  });
});

// startup

try {
  console.log("loading graph...");
  await loadGraphFromDisk();
  loadOverlay();
} catch (err) {
  console.error(
    "startup failed while loading route data:",
    err?.message ?? err,
  );
  console.error(
    "check that public/data/graph.bin, graph.meta.json and pcn-overlay.geojson exist and are intact.",
  );
  process.exit(1);
}

console.log("starting bot...");
bot.catch((err) => console.error("bot error:", err.error));
bot.start();
