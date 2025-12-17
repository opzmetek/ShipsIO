console.log("t2 loading");
import * as T2 from "https://shipsio.pages.dev/t2.module.js";
console.log("t2 loaded");
const r=new T2.Renderer(document.getElementById("game"),new OffscreenCanvas(1600,800));
await r.start();
const ship=new T2.ORectangle(-0.5,-1,1,2);
