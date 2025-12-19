import * as T2 from "https://shipsio.pages.dev/t2.module.js";
const V2 = T2.Vector2;
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
const server = new WebSocket("wss://shipsioserver.onrender.com");
await new Promise((r,e)=>{server.onopen=r;server.onerror=e;});
function start(){
  send({type:"init",name:"OPZ"});
  world.add(ship,new V2(0,0),new V2(1,1));
}
function send(o){
  server.send(JSON.stringify(o));
}
