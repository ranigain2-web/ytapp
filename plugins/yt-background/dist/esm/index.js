import { registerPlugin } from "@capacitor/core";

const YtBackground = registerPlugin("YtBackground", {
  web: () => import("./web").then((m) => new m.YtBackgroundWeb()),
});

export { YtBackground };
