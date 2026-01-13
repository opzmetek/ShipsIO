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
let myID = null,myVector = new V2(),myPos = new V2();
const ship=new T2.ORectangle(-3,-4,6,8);
const world = r.world;
const andromeda = new T2.Andromeda(r);
const server = new WebSocket("wss://trueshipsioserver.onrender.com");
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
canvas.tabIndex = 0;
canvas.focus();
canvas.addEventListener("keydown",e=>{
  const k = e.key;
  switch(k){
    case "w":
      send({type:"move",vx:1});
      break;
    case "s":
      send({type:"move",vx:-1});
      break;
    case "a":
      send({type:"move",vy:-1});
      break;
    case "d":
      send({type:"move",vy:1});
      break;
  }
});
canvas.addEventListener("keyup",e=>{
  const k = e.key;
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
    threshold:0.1,
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
      accumulator.addScaled(d.vector,d.force);
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
		this.center = new V2(x,y);// In T2 Units
		this.c = this.center.subImm(myPos);// Relative T2 Units to myPos
		this.vector = new V2(0,0);// In 1/30 units(1 frame/30 FPS)
		this.angle = 0;//radians
		this.ship = ship;// ship index
		this.hpUV = 1;
		this.matrix = new M2().identity();//T2 Matrix2
		this.rect = new T2.ORectangle(this.c.x,this.c.y,1,1.5,this.matrix.m);//T2 ORectangle
		this.ll = world.add(this.rect,new V2(0,0),new V2(0.3,0.8));// LowLevel T2 RenderObject
		console.log("ID:",id);//DEBUG
	}

	move(id,x,y,vx,vy,angle){
		this.angle = angle;
		const dx = this.center.x-x, dy = this.center.y-y;
		const l = dx*dx+dy*dy;
		if(l>=1) { //BIG DIFF - NO SMOOTHMOVE
			this.center.x-=dx*0.2;
			this.center.y-=dy*0.2
		}
		this.vector.x = vx;
		this.vector.y = vy;
	}

	frame(ratio/*=30 FPS / actual FPS*/){
		this.center.addScaled(this.vector,ratio);
		this.c.x = this.center.x-myPos.x;//interpolation
		this.c.y = this.center.y-myPos.y;//   -||-
		this.matrix.identity().translate(this.c.x,this.c.y,false).rotate(this.angle,false).scale(1,1.5,false)._update();//LowLevel Update
		this.ll.matrix = this.matrix.m;
	}
}

function start(){
  	send({type:"init",name:"OPZ"});
  	world.add(ship,new V2(0,0),new V2(0.1,0.2));
	world.addCallback(dt=>{
		const ratio = dt*0.003;
		for(const p of playersArray){
			p.frame(ratio);
		}
	});
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
		case "disconnect":
			const id = data.id;
			console.log(players.get(id)?.name,"disconnected!");
			players.delete(id);
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
	const x=arr[off++],y=arr[off++],vx=arr[off++],vy=arr[off++],angle=arr[off++],id=arr[off++];
	if(id===myID){
		myVector.x = vx;
		myVector.y = vy;
		myPos.x = x;
		myPos.y = y;
		return off;
	};
	const p = players.get(id);
	if(!p){
		console.error("Invalid ID:",id);
		return off;
	}
	p.move(id,x,y,vx,vy,angle);
	return off;
}
