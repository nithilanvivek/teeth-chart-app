import { resolve } from "node:path";
import { createStaticServer } from "./static-server.mjs";

const root = resolve(process.cwd());
const portFlagIndex = process.argv.indexOf("--port");
const portFlagValue = process.argv.find((arg) => arg.startsWith("--port="));
const port =
  Number(portFlagValue?.split("=")[1] || process.argv[portFlagIndex + 1] || process.env.PORT) ||
  4174;
const server = createStaticServer(root);

server.listen(port, "127.0.0.1", () => {
  console.log(`nithi.land preview running at http://127.0.0.1:${port}`);
});
