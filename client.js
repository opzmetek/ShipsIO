import * as T2 from "https://shipsio.pages.dev/t2.module.js";
const V2 = T2.Vector2;
T2.setMaxParticles(100_000);
const img = new Image();
img.src="https://shipsio.pages.dev/ships.jpg";
img.crossOrigin="anonymous";
await img.decode();
const canvas = document.getElementById("game");
canvas.onresize=resize;
const r=new T2.Renderer(canvas,img);
await r.start();
const ship=new T2.ORectangle(-3,-4,6,8);
const world = r.world;
const andromeda = new T2.Andromeda(r);
const server = new WebSocket("wss://shipsioserver.onrender.com");
await new Promise((r,e)=>{server.onopen=r;server.onerror=e;});
document.getElementById("loader").style.display="none";
server.onmessage = handle;
resize();
start();
const accumulator = new V2();
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
if("ontouchstart" in window||navigator.maxTouchPoints>0){
  setInterval(()=>{
   send({type:"move",vx:accumulator.x,vy:accumulator.y});
    accumulator.x=0;
    accumulator.y=0;
  },100);
  const j=nipplejs.create({
    zone:document.body,
    mode:'dynamic',
    color:'red',
    size:100,
    treshold:0.1,
    fadeTime:0.5,
    multitouch:true,
    maxNumberOfNipples:2,
  });

  let rId=null,lId=null;

  j.on('start',(evt,data)=>{
    if(data.position.x<window.innerWidth/2&&!lId){
      lId=data.identifier;
    }else{
		rId=data.identifier;
    }
  });

  j.on('move',(e,d)=>{
    if(d.identifier===lId){
      accumulator.addScaled(data.vector,data.force);
    }
  });

  j.on('end',(e,d)=>{
    if(d.identifier===rId)rId=null;
    else lId=null;
  });
}
function start(){
  send({type:"init",name:"OPZ"});
  world.add(ship,new V2(0,0),new V2(0.1,0.2));
}

function resize(){
	canvas.width =window.innerWidth;
	canvas.height=window.innerHeight;
}

function send(o){
  server.send(JSON.stringify(o));
}

async function handle(e){
  const d = e.data;
  if(typeof d==="string")handleInit(d);
  else if(d instanceof Blob)handlePlayers(d);
}

async function handleInit(d){
	const data = JSON.parse(d.toString());
	console.log(data.x,data.y);
}

async function handlePlayers(d){
  const b = await d.arrayBuffer();
  const a = new Float32Array(b);
  console.log(a);
}
