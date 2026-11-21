import { havianGet } from "./client.mjs";

async function main() {
  console.log("Testing Havian API connection…");

  const result = await havianGet({
    function: "project",
    action: "getTimingTrack",
  });

  console.log("Status:", result.status);
  console.log("URL:", result.url);

  if (!result.ok) {
    console.error("Request failed.");
    console.error(
      typeof result.body === "string"
        ? result.body.slice(0, 500)
        : JSON.stringify(result.body, null, 2).slice(0, 500)
    );
    process.exit(1);
  }

  console.log("OK – got response:");
  console.log(
    typeof result.body === "string"
      ? result.body.slice(0, 1000)
      : JSON.stringify(result.body, null, 2).slice(0, 1000)
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
