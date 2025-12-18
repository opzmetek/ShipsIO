import * as T2 from "https://shipsio.pages.dev/t2.module.js";
T2.setMaxParticles(100_000);
const img = new Image();
img.src="https://shipsio.pages.dev/ships.jpg";
img.crossOrigin="anonymous";
await img.decode();
const r=new T2.Renderer(document.getElementById("game"),img);
await r.start();
const ship=new T2.ORectangle(-0.5,-1,1,2);
const world = r.world;
const andromeda = new T2.Andromeda(r);
const server = new WebSocket("wss://shipsioserver.onrender.com:8080");
function start(){
  
}
