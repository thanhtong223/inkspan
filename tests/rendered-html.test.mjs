import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the INKSPAN camera shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>INKSPAN<\/title>/i);
  assert.match(html, /INKSPAN/);
  assert.match(html, /Start recording, choose this tab/);
  assert.match(html, /60 sec maximum/);
  assert.match(html, /local camera/);
  assert.match(html, /Recording timeline/);
  assert.match(html, /Enable camera/);
  assert.match(html, /Thanh Tong/);
  assert.match(html, /tvthanhhh/);
  assert.doesNotMatch(html, /Touch mode|Use touch points/);
  assert.doesNotMatch(html, /class="fingerpoint/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
