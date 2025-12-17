console.log("t2 loading");
import * as T2 from "https://shipsio.pages.dev/t2.module.js";
console.log("t2 loaded");
const img = new Image();
img.src="https://www.reddit.com/r/battlemaps/comments/ls5z3m/transparent_ships/";//debug
img.crossOrigin="anonymous";
const r=new T2.Renderer(document.getElementById("game"),img);
await r.start();
const ship=new T2.ORectangle(-0.5,-1,1,2);
