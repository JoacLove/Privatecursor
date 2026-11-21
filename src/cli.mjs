import { havianGet } from "./client.mjs";

function usage() {
  console.log(`Usage:
  npm run get -- --function=project --action=getTimingTrack
  npm run get -- --function=vessel --action=getVesselLocations
  npm run get -- --function=hse --action=get --projects=123,456
`);
}

function parseArgs(argv) {
  const out = { extra: {} };
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (rawKey === "function") out.function = value;
    else if (rawKey === "action") out.action = value;
    else if (rawKey === "format") out.format = value;
    else if (rawKey === "projects") {
      out.extra.projects = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      out.extra[rawKey] = value;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.function || !args.action) {
    usage();
    process.exit(1);
  }

  const result = await havianGet(args);
  console.log(JSON.stringify({ status: result.status, url: result.url, body: result.body }, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
