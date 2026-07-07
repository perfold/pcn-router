// loads graph.bin from disk and hands it to the shared frontend graph module
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { loadGraph } from "../src/lib/graph.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function loadGraphFromDisk() {
  const meta = JSON.parse(
    readFileSync(path.join(root, "public/data/graph.meta.json"), "utf8"),
  );
  const buf = readFileSync(path.join(root, "public/data/graph.bin"));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await loadGraph(meta, ab);
}

export { snapToNode, findRoute } from "../src/lib/graph.js";
