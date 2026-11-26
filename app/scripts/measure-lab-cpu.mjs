// CPU of the Widget Lab in Playwright's WebKit while its mock values change (every 1.5 s): the
// web process's CPU time and the motion scheduler's frames over a window. Compares pages, e.g.
//   node scripts/measure-lab-cpu.mjs 20 "only=widgets" "only=widgets&motion=off"
// Needs the Lab served on :4173 (LAB=1 pnpm exec vite build && pnpm exec vite preview).
// "query|css" also injects a stylesheet (e.g. to hide one kind of element and see its cost).
import { readFileSync, readdirSync } from "node:fs";
import { webkit } from "@playwright/test";

const seconds = Number(process.argv[2] ?? 20);
const pages = process.argv.slice(3);
const TICK = 100; // USER_HZ on Linux

function children() {
  const out = new Map();
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      out.set(Number(pid), { ppid: Number(f[1]), cpu: Number(f[11]) + Number(f[12]) });
    } catch {
      // gone
    }
  }
  return out;
}

function treeCpu(root) {
  const all = children();
  let sum = 0;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    sum += all.get(p)?.cpu ?? 0;
    for (const [pid, v] of all) if (v.ppid === p) stack.push(pid);
  }
  return sum / TICK;
}

const server = await webkit.launchServer();
const pid = server.process().pid;
const browser = await webkit.connect(server.wsEndpoint());
for (const arg of pages) {
  const [query, css] = arg.split("|");
  const page = await browser.newPage({ viewport: { width: 1180, height: 1400 } });
  await page.goto(`http://localhost:4173/lab.html?${query}`);
  if (css) await page.addStyleTag({ content: css });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
  const frames = () => page.evaluate(() => window.__labScheduler?.frames ?? 0);
  const f0 = await frames();
  const c0 = treeCpu(pid);
  await page.waitForTimeout(seconds * 1000);
  const c1 = treeCpu(pid);
  const f1 = await frames();
  const pct = ((c1 - c0) / seconds) * 100;
  console.log(
    `${arg.padEnd(60)} cpu ${pct.toFixed(1)} % of one core, ${((f1 - f0) / seconds).toFixed(1)} frames/s`,
  );
  await page.close();
}
await browser.close();
await server.close();
