import * as T2 from "https://shipsio.pages.dev/t2.module.js";
const V2 = T2.Vector2;
T2.setMaxParticles(100_000);
const img = new Image();
img.src="https://shipsio.pages.dev/ships.jpg";
img.crossOrigin="anonymous";
await img.decode();
const canvas = document.getElementById("game");
const r=new T2.Renderer(canvas,img);
await r.start();
const ship=new T2.ORectangle(-3,-4,6,8);
const world = r.world;
const andromeda = new T2.Andromeda(r);
const server = new WebSocket("wss://shipsioserver.onrender.com");
await new Promise((r,e)=>{server.onopen=r;server.onerror=e;});
server.onmessage = m=>console.log(m);
start();
const keys = {};
canvas.addEventListener("keydown",e=>{
  const k = e.keyCode;
  switch(k){
    case "w":
      send({type:"move",vx:1});
      break;
    case "s":
      send({type:"move",vx:-1});
      break;
    case "a":
      send({type:"move",vy:1});
      break;
    case "d":
      send({type:"move",vy:1});
      break;
  }
});
canvas.addEventListener("keyup",e=>{
  const k = e.keyCode;
  switch(k){
    case "w":
    case "s":
      send({type:"move",vx:0});
      break;
    case "a":
    case "d":
      send({type:"move",vy:0});
      break;
  }
});
function start(){
  send({type:"init",name:"OPZ"});
  world.add(ship,new V2(0,0),new V2(0.1,0.2));
}
function send(o){
  server.send(JSON.stringify(o));
}
