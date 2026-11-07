import { registerPlugin } from "@capacitor/core";

const YtPlayer = registerPlugin("YtPlayer", {
  web: () => import("./web").then((m) => new m.YtPlayerWeb()),
});

export { YtPlayer };
