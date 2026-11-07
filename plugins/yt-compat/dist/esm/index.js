import { registerPlugin } from "@capacitor/core";

const YtCompat = registerPlugin("YtCompat", {
  web: () => import("./web").then((m) => new m.YtCompatWeb()),
});

export { YtCompat };
