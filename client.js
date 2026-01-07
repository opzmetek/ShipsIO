//file: ShipsIO/client.js
//author: DYNAMYT
//version: beta


//TODO player drawing, mouse & joystick data sending, HP sending & handling, T2 new version, T2 $World.add() returns RenderObject
//CHECK  player connection, player move, delta handling
//FIX 


import * as T2 from "https://shipsio.pages.dev/t2.module.js";
const V2 = T2.Vector2;
const M2 = T2.Matrix2;
T2.setMaxParticles(100_000);
const img = new Image();
img.src="https://shipsio.pages.dev/ships.jpg";
img.crossOrigin="anonymous";
await img.decode();
const canvas = document.getElementById("game");
canvas.onresize=resize;
const r=new T2.Renderer(canvas,img);
const playersArray = [];
const players = new Map();
await r.start();
let myID = null,myVector = new V2();
const ship=new T2.ORectangle(-3,-4,6,8);
const world = r.world;
const andromeda = new T2.Andromeda(r);
const server = new WebSocket("wss://shipsioserver.onrender.com");
await new Promise((r,e)=>{server.onopen=r;server.onerror=e;});
document.getElementById("loader").style.display="none";
server.onmessage = handle;
server.onclose = e=>{
	document.body.textContent = "Connection "+(e.wasClean?"closed by server":"interrupted")+" with error: "+e.code+": "+e.reason+".";
}
server.onerror = e=>{
	document.body.textContent = "Connection interrupted by internal error.";
}
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

class Player{
	constructor(arr){
		const [id,name,x,y,ship] = arr;
		players.set(id,this);
		playersArray.push(this);
		this.id = id;
		this.name = name;
		this.c = new V2(x,y);
		this.vector = new V2(0,0);
		this.angle = 0;
		this.ship = ship;
		this.hpUV = 1;
		this.rect = new T2.ORectangle(this.c.x,this.c.y,1,1.5,new M2().identity().m);
		this.ll = world.add(this.rect);
		console.log("ID:",id);
	}

	move(id,x,y,vx,vy,angle){
		this.angle = angle;
		const v = new V2(vx,vy);
		const p = new V2(x,y);
		const d = p.subImm(this.c);
		const l = d.sq();
		if(l>=1) { //BIG DIFF - NO SMOOTHMOVE
			this.c.add(d.scale(0.2));
		}
		this.vector.copy(vel);
	}

	frame(ratio){
		this.c.addScaledVector(this.vector,ratio);
		this.ll.matrix.identity().translate(this.c.x,this.c.y).rotate(this.angle).scale(1,1.5);
	}
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
	switch(data.type){
		case "init":
			console.log("Your ID is: "+data.id);
			myID = data.id;
			data.setup.forEach(p=>new Player(p));
			break;
		case "connect":
			console.log("Connected new Player: "+data.player[1]);
			new Player(data.player);
			break;
	}
}

async function handlePlayers(d){
	const b = await d.arrayBuffer();
	const arr = new Float32Array(b);
	let o=0;
	while(o+6<arr.length){
		o = handlePlayer(arr,o);
	}
}

function handlePlayer(arr,off){
	const id=arr[off++],x=arr[off++],y=arr[off++],vx=arr[off++],vy=arr[off++],angle=arr[off++];
	if(id===myID){
		myVector.x = vx;
		myVector.y = vy;
	};
	players.get(id).move(id,x,y,vx,vy,angle);
	return off;
}
