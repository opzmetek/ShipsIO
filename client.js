import * as T2 from "https://dyt.neocities.org/t2/t2.module.js";
const r=new T2.Renderer(document.getElementById("game"),new OffscreenCanvas(1600,800));
await r.start();
const ship=new T2.ORectangle(-0.5,-1,1,2);
