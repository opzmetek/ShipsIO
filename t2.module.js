let MAX_MODEL_MATRICES = 100,GRID_SIZE = 15,MAX_PARTICLES = 100000;
  class GPU{
    constructor(id){
      this.ready = this.init(id);
    }
    async init(canvas){
      if(!navigator.gpu){alert("WebGPU not supported\n\n\t-update your browser\n\t-enable webgpu in flags\n\t-install chrome 113+");return;}
      this.adapter = await navigator.gpu.requestAdapter();
      this.device = await this.adapter.requestDevice();
      if(!this.adapter||!this.device){alert("Enable WebGPU in browser flags");return;}
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.canvas = canvas;
      this.ctx = canvas.getContext("webgpu");
      this.ctx.configure({device:this.device,format:this.format});
    }
  }
  class Renderer{
    constructor(canvas,img){
      this.gpu = new GPU(canvas);
      this.ready = this.initialize(img,canvas.width,canvas.height);
      this.canvas = canvas;
      Keyboard.init();
      canvas.addEventListener("resize",e=>this.resize());
    }
    async initialize(img,width,height) {
      await this.gpu.ready;
      const dev = this.gpu.device;
      this.bindGroupLayout = dev.createBindGroupLayout({
        entries: [
          {binding: 0,visibility: GPUShaderStage.VERTEX,buffer: {type: "uniform"}},
          {binding: 1,visibility: GPUShaderStage.FRAGMENT,texture: {sampleType: "float"}},
          {binding: 2,visibility: GPUShaderStage.FRAGMENT,sampler: {type: "non-filtering"}}
        ]
      });
      this.pipelineLayout = dev.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout]
      });
      this.vertexBufferLayout = {
        arrayStride: 4 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0,  format: "float32x2" },
          { shaderLocation: 1, offset: 8,  format: "float32x2" },
        ]
      };
      this.instanceBufferLayout = {
        arrayStride: 4 * 4 * 4 + 4 * 4, 
        stepMode: "instance",
        attributes: [
          { shaderLocation: 2, offset: 0 , format: "float32x4" },
          { shaderLocation: 3, offset: 16, format: "float32x4" },
          { shaderLocation: 4, offset: 32, format: "float32x4" },
          { shaderLocation: 5, offset: 48, format: "float32x4" },
          { shaderLocation: 6, offset: 64, format: "float32x4" }
        ]
      };
      this.worldMatrix = new Matrix2D().identity().m;
      this.scaleY = 0.1;

      this.worldBuffer = dev.createBuffer({
        size: 16 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      });
      this.resize();
      const basicShaderModule = dev.createShaderModule({code:Shaders.createBasicShader()});
      this.pipeline = dev.createRenderPipeline({
        layout:this.pipelineLayout,
        vertex:{
          module:basicShaderModule,
          entryPoint:"vs_main",
          buffers:[this.vertexBufferLayout,this.instanceBufferLayout]
        },
        fragment:{
          module:basicShaderModule,
          entryPoint:"fs_main",
          targets:[{format:this.gpu.format}]
        },
        primitive:{
          topology:"triangle-strip"
        }
      });
      
      this.computePipeline = dev.createComputePipeline({
        layout:"auto",
        compute:{
          module:dev.createShaderModule({code:Shaders.createParticleCompute()}),
          entryPoint:"main"
        }
      });
      
      this.particles = new Float32Array(MAX_PARTICLES*8);
      this.particlesBuffer = dev.createBuffer({
        size:this.particles.byteLength,
        usage: GPUBufferUsage.VERTEX|GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST
      });
      this.particleCount=0;
      
      this.computeGroup = dev.createBindGroup({
        layout:this.computePipeline.getBindGroupLayout(0),
        entries:[{
          binding:0,
          resource:{buffer:this.particlesBuffer}
        }]
      });
      
      this.renderParticlePipeline = dev.createRenderPipeline({
        layout:"auto",
        vertex:{
          module:dev.createShaderModule({code:Shaders.createParticleVertex()}),
          buffers:[]
        },
        fragment:{
          module:dev.createShaderModule({code:Shaders.createParticleFragment()}),
          targets:[{format:this.gpu.format}]
        },
        primitive:{
          topology:"triangle-strip"
        }
      });
      
      this.renderParticleBindGroup = dev.createBindGroup({
        layout:this.renderParticlePipeline.getBindGroupLayout(0),
        entries:[{
          binding:0,
          resource:{buffer:this.particlesBuffer}
        }]
      });
      
      this.bitmap = await createImageBitmap(img);
      
      this.atlas = dev.createTexture({
        size: [this.bitmap.width, this.bitmap.height, 1],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
          mipLevelCount:1
      });

      dev.queue.copyExternalImageToTexture(
        { source: this.bitmap },
        { texture: this.atlas },
        [this.bitmap.width, this.bitmap.height]
      );
      
      this.sampler = dev.createSampler({
        magFilter: "nearest",
        minFilter: "nearest",
        addressModeU:"repeat",
        addressModeV:"repeat",
        mipmapFilter:"nearest"
      });
      
      this.bindGroup = dev.createBindGroup({
        layout:this.bindGroupLayout,
        entries:[{
          binding:0,
          resource:{buffer:this.worldBuffer}
        },{
          binding:1,
          resource:this.atlas.createView()
        },{
          binding:2,
          resource:this.sampler
        }]
      });
      
      const staticVertexData = new Float32Array([
        -1,-1,0,0,-1,1,0,1,1,-1,1,0,1,1,1,1
      ]);
      
      this.vertexBuffer = dev.createBuffer({
        size: staticVertexData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
      });
      new Float32Array(this.vertexBuffer.getMappedRange()).set(staticVertexData);
      this.vertexBuffer.unmap();
      this.instanceBuffer = dev.createBuffer({
        size: MAX_MODEL_MATRICES*80,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.world = new World();
      this.otherRenders = Array.from({length:3},()=>[]);
      this.timeBuffer = new Float32Array(1);
    }
    
    addShaderedWorld(world,shader,order){
      const dev = this.gpu.device;
      const target = {world};
      const module = dev.createShaderModule({code:shader});
      target.pipeline = dev.createRenderPipeline({
        layout:this.pipelineLayout,
        vertex:{
          module,
          buffers:[this.vertexBufferLayout,this.instanceBufferLayout],
          entryPoint:"vs_main"
        },
        fragment:{
          module,
          targets:[{format:this.gpu.format}],
          entryPoint:"fs_main"
        },
        primitive:{
          topology:"triangle-strip"
        }
      });
      target.buffer = dev.createBuffer({
        size: MAX_MODEL_MATRICES*80,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
      this.otherRenders[order].push(target);
    }
    
    render(){
      this.timeBuffer[0] = performance.now();
      this.gpu.device.queue.writeBuffer(this.worldBuffer,60,this.timeBuffer);
      const encoder = this.gpu.device.createCommandEncoder();
      const view = this.gpu.ctx.getCurrentTexture().createView();
      const first = this.otherRenders[Shaders.PRE_WORLD_RENDER].length===0;
      for(const o of this.otherRenders[Shaders.PRE_WORLD_RENDER])this.renderOther(o,encoder,view,true);
      const rpass = encoder.beginRenderPass({
        colorAttachments:[{
            view,
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            loadOp: /*first?"clear":*/"load",
            storeOp: "store"
        }]
      });
      rpass.setPipeline(this.pipeline);
      rpass.setVertexBuffer(0,this.vertexBuffer);
      this.gpu.device.queue.writeBuffer(this.instanceBuffer,0,this.world.prepareInstances());
      rpass.setVertexBuffer(1,this.instanceBuffer);
      rpass.setBindGroup(0,this.bindGroup);
      rpass.draw(4,this.world.length);
      rpass.end();
      for(const o of this.otherRenders[Shaders.POST_WORLD_RENDER])this.renderOther(o,encoder,view,false);
      if(this.particleCount>0){
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(this.computePipeline);
        cpass.setBindGroup(0,this.computeGroup);
        cpass.dispatchWorkgroups(Math.ceil(this.particleCount/64));
        cpass.end();
        const ppass = encoder.beginRenderPass({colorAttachments:[{view,clearValue:{r:0,g:0,b:0,a:0},loadOp:"load",storeOp:"store"}]});
        ppass.setPipeline(this.renderParticlePipeline);
        ppass.setBindGroup(0,this.renderParticleBindGroup);
        ppass.draw(4,this.particleCount);
        ppass.end();
      }
      for(const o of this.otherRenders[Shaders.POST_PARTICLE_RENDER])this.renderOther(o,encoder,view,false);
      this.gpu.device.queue.submit([encoder.finish()]);
    }
    
    renderOther(target,encoder,view,first){
      const rpass = encoder.beginRenderPass({
        colorAttachments:[{
            view,
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
            loadOp: /*first?*/"clear"/*:"load"*/,
            storeOp: "store"
        }]
      });
      rpass.setPipeline(target.pipeline);
      rpass.setVertexBuffer(0,this.vertexBuffer);
      this.gpu.device.queue.writeBuffer(target.buffer,0,target.world.prepareInstances());
      rpass.setVertexBuffer(1,target.buffer);
      rpass.setBindGroup(0,this.bindGroup);
      rpass.draw(4,target.world.length);
      rpass.end();
    }
    
    loop(){
      this.render();
      requestAnimationFrame(()=>this.loop());
    }
    
    recomputeMatrix(){
      this.scaleX = this.aspect*this.scaleY;
      this.worldMatrix = new Matrix2D().setScale(this.scaleX,-this.scaleY).m;
      this.gpu.device.queue.writeBuffer(this.worldBuffer,0,this.worldMatrix);
    }
    
    resize(){
      this.aspect = this.canvas.height/this.canvas.width;
      this.recomputeMatrix();
    }
    
    async start(){
      await this.ready;
      this.loop();
    }
  }
  
  class WorldBase{
    constructor(){
      this.length=0;
    }
  }
  
  class World extends WorldBase{
    constructor(){
      super();
      this.objects = [];
      this.targets = [];
      this.callbacks = [];
      this.grid = new Map();
      this.camera = new Vector2();
      this.arr=new Float32Array();
    }
    prepareInstances(){
      this.callbacks.forEach(c=>c());
      let offset = 0;
      const cam = this.camera.clone().floor();
      const targets = this.getFromMap(cam);
      if(!this.arr||this.arr.length!==targets.length*20)this.arr=new Float32Array(targets.length*20);
      for(const idx of targets){
        const t = this.targets[idx];
        if(t.isRenderObject){
          if(this.objects[idx].needUpdate){
            t.from(this.objects[idx]);
            this.objects[idx].update();
            this.objects[idx].needUpdate = false;
          }
          offset=t.writeInstance(this.arr,offset);
        }
        else console.error("Invalid render object is not render object: "+t);
      }
      this.length = targets.length;
      return this.arr;
    }
    add(obj,uvMin,uvMax){
      if(!obj.isOObject){
        console.error("Invalid oobject is not oobject!");
        return null;
      }
      const idx = this.targets.length;
      this.objects.push(obj);
	  const ro = new RenderObject(obj,uvMin,uvMax);
      this.targets.push(ro);
      const vs = [obj.corner(-1,-1),obj.corner(-1,1),obj.corner(1,1),obj.corner(1,-1)];
      const keys = vs.map(v=>`${Math.floor(v.x/GRID_SIZE)}-${Math.floor(v.y/GRID_SIZE)}`);
      keys.forEach(k=>{
        if(!this.grid.has(k))this.grid.set(k,[]);
        this.grid.get(k).push(idx);
      });
	  return ro;
    }
    addTextured(objects,uvMin,uvMax){
      if(!Array.isArray(objects))console.error("Invalid array is not array!");
      objects.forEach(o=>this.add(o,uvMin,uvMax));
    }
    addCallback(call){
      this.callbacks.push(call);
    }
    remove(obj){
      const idx = this.objects.findIndex(o=>obj===o);
      this.objects.splice(idx,1);
      this.targets.splice(idx,1);
    }
    getFromMap(v2){
      const x=v2.x,y=v2.y,s=1;
      return [[x,y],[x+s,y],[x-s,y],[x-s,y-s],[x-s,y+s],[x,y+s],[x,y-s],[x+s,y+s],[x+s,y-s]].map(t=>this.grid.get(`${t[0]}-${t[1]}`)??[]).flat();
    }
  }
  
  class FullscreenQuadWorld extends WorldBase{
    constructor(minUV,maxUV){
      super();
      this.quad = new ORectangle(-20,-20,40,40);
      this.target = new RenderObject(this.quad,minUV,maxUV);
      this.arr=new Float32Array(20);
    }
    prepareInstances(){
      if(this.target.isRenderObject)this.target.writeInstance(this.arr,0);
      else console.error("Invalid render object is not a render object: "+this.target);
      this.length=1;
      return this.arr;
    }
  }
  
  class Keyboard{
    static isDown(key){
      return Keyboard.keys[key];
    }
    
    static init(){
      Keyboard.keys = {};
      document.addEventListener("keydown",e=>{
        Keyboard.keys[e.key.toLowerCase()] = true;
      });
      document.addEventListener("keyup",e=>{
        delete Keyboard.keys[e.key.toLowerCase()];
      });
    }
    
    static getWSADVector(){
      const move = new Vector2();
      if(Keyboard.isDown("w"))move.y-=1;
      if(Keyboard.isDown("s"))move.y+=1;
      if(Keyboard.isDown("a"))move.x-=1;
      if(Keyboard.isDown("d"))move.x+=1;
      return move;
    }
    
    static getArrowVector(){
      const move = new Vector2();
      if(Keyboard.isDown("arrowup"))move.y-=1;
      if(Keyboard.isDown("arrowdown"))move.y+=1;
      if(Keyboard.isDown("arrowleft"))move.x-=1;
      if(Keyboard.isDown("arrowright"))move.x+=1;
      return move;
    }
  }
  
  Keyboard.init();
  
  class Vector2{
		constructor(x=0,y=0){this.x=x;this.y=y;}
		set(x,y){this.x=x;this.y=y;return this;}
		copy(v){this.x=v.x;this.y=v.y;return this;}
		add(v){this.x+=v.x;this.y+=v.y;return this;}
		sub(v){this.x-=v.x;this.y-=v.y;return this;}
		mul(v){this.x*=v.x,this.y*=v.y;return this;}
		scale(s){this.x*=s;this.y*=s;return this;}
		dot(v){return this.x*v.x+this.y*v.y;}
		len(){return Math.hypot(this.x,this.y);}
		norm(){let l=this.len();if(l>0){this.x/=l;this.y/=l;}return this;}
		clone(){return new Vector2(this.x,this.y);}
		mod(v){if(v.x===0||v.y===0)return this;this.x%=v.x;this.y%=v.y;return this;}
		floor(){this.x=Math.floor(this.x);this.y=Math.floor(this.y);return this;}
		neg(){this.x=-this.x;this.y=-this.y;return this;}
		reset(){this.x=0;this.y=0;return this;}
		rotate(s,c){const x=this.x*c-this.y*s,y=this.x*s+this.y*c;this.x=x;this.y=y;return this;}
		addScaled(v,s){this.x+=v.x*s;this.y+=v.y*s;return this;}
		static one(n){return new Vector2(n,n);}
	}
	
	class Matrix2D{
		constructor(){
		  this.m=new Float32Array(16);
		  this.identity();
		}
		identity(){let m=this.m;
			m[0]=1;m[1]=0;m[2]=0;m[3]=0;
			m[4]=0;m[5]=1;m[6]=0;m[7]=0;
			m[8]=0;m[9]=0;m[10]=1;m[11]=0;
			m[12]=0;m[13]=0;m[14]=0;m[15]=1;
			return this;}
		copy(a){this.m.set(a.m);return this;}
		mul(a){let b=this.m,c=a.m,r=new Float32Array(16);
			for(let i=0;i<4;i++)for(let j=0;j<4;j++)
				r[i*4+j]=b[j]*c[i*4]+b[4+j]*c[i*4+1]+b[8+j]*c[i*4+2]+b[12+j]*c[i*4+3];
			this.m=r;return this;}
		translate(x,y){
			return this.mul((new Matrix2D()).setTranslate(x,y));
		}
		rotate(rad){
			return this.mul((new Matrix2D()).setRotate(rad));
		}
	  shearX(k){
		  return this.mul((new Matrix2D()).setShearX(k));
	  }
	  shearY(k){
		  return this.mul((new Matrix2D()).setShearY(k));
	  }
		scale(x,y){
			return this.mul((new Matrix2D()).setScale(x,y));
		}
		setTranslate(x,y){this.identity();
			this.m[12]=x;this.m[13]=y;return this;}
		setRotate(r){
			this.identity();
			let c=Math.cos(r),s=Math.sin(r);
			this.m[0]=c;this.m[4]=-s;
			this.m[1]=s;this.m[5]=c;
			return this;}
		setScale(x,y){this.identity();
			this.m[0]=x;this.m[5]=y;return this;}
		setShearX(k){
	    this.identity();
	    this.m[4] = k;
	    return this;
    }
    setShearY(k){
	    this.identity();
	    this.m[1] = k;
	    return this;
    }
    invert(){
		  let m=this.m;
		  let a=m[0],b=m[1],c=m[4],d=m[5];
		  let tx=m[12],ty=m[13];
		  let det=a*d-b*c;
		  if(det===0)return this;
		  det=1/det;
		  let r0=a, r1=b, r2=c, r3=d;
		  m[0]= d*det;
		  m[1]=-b*det;
		  m[4]=-c*det;
		  m[5]= a*det;
		  m[12]=-(m[0]*tx + m[4]*ty);
		  m[13]=-(m[1]*tx + m[5]*ty);
		  return this;
	  }
	  transformVector(v){
      return new Vector2(
        v.x * this.m[0] + v.y * this.m[4] + this.m[12],
        v.x * this.m[1] + v.y * this.m[5] + this.m[13]
      );
    }
		clone(){let a=new Matrix2D();a.m.set(this.m);return a;}
	}

	class Matrix2{
		constructor(){
			this.m = new Matrix2D().identity();
			this.angle = 0;
			this.translate = new Vector2(0,0);
			this.shear = new Vector2(0,0);
			this.scale = new Vector2(1,1);
		}

		mul(m){
			this.m.mul(m);
		}

		setRotate(a){
			this.angle=a;
			this._update();
		}

		setTranslate(v){
			this.translate.copy(v);
			this._update();
		}

		setScale(s){
			this.scale.copy(s);
			this._update();
		}

		setShear(s){
			this.shear.copy(s);
			this._update();
		}

		_update(){
			this.m.setTranslate(this.translate.x,this.translate.y).rotate(this.angle).shearX(this.shear.x).shearY(this.shear.y).scale(this.scale.x,this.scale.y);
		}
	}
	
	class OObject{
	  constructor(x,y,sx,sy,matrix=new Matrix2D().identity(),group=-1){
	    this.isOObject = true;
	    this.center = new Vector2(x,y);
	    this.half = new Vector2(sx/2,sy/2);
	    this.matrix = matrix;
	    this.needUpdate = true;
	    this.velocity = new Vector2();
	    this.acc = new Vector2();
	    this.group = group;
	    this.onCollide = e=>{};
	  }
	  corner(dx, dy) {
      return new Vector2(
        this.center.x + dx * this.half.x,
        this.center.y + dy * this.half.y
      );
    }
    move(vel,x = undefined){
      if(x)vel = new Vector2(vel,x);
      this.center.add(vel);
      this.needUpdate = true;
    }
    applyForce(f){
      this.acc.add(f);
    }
    tick(dt){
      this.velocity.add(this.acc);
      this.center.add(this.velocity);
      this.needUpdate = true;
      this.acc.reset();
    }
	}
	
  class ORectangle extends OObject{
    constructor(x,y,sx,sy,matrix = new Matrix2D().identity(),group = -1){
      super(x,y,sx,sy,matrix,group);
      this.isORectangle = true;
      this.update();
    }
    clone(){
      return new ORectangle(this.center.x,this.center.y,this.half.x*2,this.half.y*2,this.matrix);
    }
    update(){
      const cx=this.center.x,cy=this.center.y,hw=this.half.x,hh=this.half.y,m=this.matrix.m;
		  this.c = this.matrix.transformVector(this.center);
		  this.axisX = new Vector2(m[0],m[1]).norm();
		  this.axisY = new Vector2(m[4],m[5]).norm();
		  this.h = new Vector2(
        this.half.x * Math.hypot(m[0], m[1]),
        this.half.y * Math.hypot(m[4], m[5])
      );
    }
    project(axis){
      const c = this.c;
      const ax = this.axisX.norm();
      const ay = this.axisY.norm();

      const centerProj = c.x * axis.x + c.y * axis.y;

      const extent =
        this.h.x * Math.abs(ax.dot(axis))*2 +
        this.h.y * Math.abs(ay.dot(axis))*2;

      return {
        min: centerProj - extent,
        max: centerProj + extent
      };
    }
    overlap(other,axis){
      const pa = this.project(axis);
      const pb = other.project(axis);
      return{pa,pb};
    }
    testOR(other){
		  const axes = [this.axisX,this.axisY,other.axisX,other.axisY];
		  for(const axis of axes){
		    const {pa,pb} = this.overlap(other,axis);
		    if(pa.min>=pb.max||pb.min>=pa.max)return false;
		  }
		  this.onCollide(other);
		  other.onCollide(this);
		  return true;
		}
		testORAll(others){
		  return others.some(o=>this.testOR(o));
		}
		testORSlide(other,velocity){
		  const clone = this.clone();
		  clone.center.add(velocity);
		  clone.update();
		  let smallest = null,depth = Infinity;
		  const axes = [clone.axisX,clone.axisY,other.axisX,other.axisY];
		  for(const axis of axes){
		    const {pa,pb} = clone.overlap(other,axis);
		    const p0 = pa.max-pb.min,p1 = pb.max-pa.min;
		    if(p0<=0||p1<=0)return velocity;
		    const overlap = Math.min(p0,p1);
		    if(overlap<depth){
		      smallest = axis;
		      depth = overlap;
		    }
		  }
		  
		  this.onCollide(other);
		  other.onCollide(this);
		  
		  const dir = other.c.clone().sub(clone.c);
      if (dir.dot(smallest) < 0) {
        smallest = smallest.clone().scale(-1);
      }
      
      let output = new Vector2();
      const t = new Vector2(-smallest.y,smallest.x);
      output.add(t.scale(velocity.dot(t)));
      output.sub(smallest.scale(depth-0.05));
      return output;
		}
		moveAndSlide(other,vel){
		  if(Array.isArray(other))other.forEach(o=>{vel = this.testORSlide(o,vel)});
		  else vel = this.testORSlide(other,vel);
		  super.move(vel);
		}
		testCircle(circle){
      const inv = this.matrix.clone().invert();
      const localCircle = inv.transformVector(circle.center.clone().sub(this.center));
      const closestX = Math.max(-this.half.x, Math.min(localCircle.x, this.half.x));
      const closestY = Math.max(-this.half.y, Math.min(localCircle.y, this.half.y));
      const dx = localCircle.x - closestX;
      const dy = localCircle.y - closestY;
      const scaleX = Math.hypot(circle.matrix.m[0], circle.matrix.m[1]);
      const scaleY = Math.hypot(circle.matrix.m[4], circle.matrix.m[5]);
      const r = circle.radius * Math.max(scaleX, scaleY);

      return dx*dx + dy*dy <= r*r;
    }
    static instanced(arr,{group=-1,matrix=new Matrix2D().identity()} = {}){
      if(!Array.isArray(arr))console.error("Ivalid array is not array!");
      
      return arr.map(([x,y,sx,sy,_matrix = matrix,_group = group])=>new ORectangle(x,y,sx,sy,_matrix,_group));
    }
  }
  
  class OCircle extends OObject{
    constructor(x,y,rad,matrix=new Matrix2D().identity()){
      super(x,y,rad,rad,matrix);
      this.radius = rad;
      this.isOCircle = true;
    }
    testOR(or){
      return or.testCircle(this);
    }
    testCircle(other) {
      const c1 = new Vector2(
        this.matrix.m[12],
        this.matrix.m[13]
      );
      const c2 = new Vector2(
        other.matrix.m[12],
        other.matrix.m[13]
      );

      const r1 = this.radius * Math.hypot(this.matrix.m[0], this.matrix.m[1]);
      const r2 = other.radius * Math.hypot(other.matrix.m[0], other.matrix.m[1]);

      const dx = c1.x - c2.x;
      const dy = c1.y - c2.y;
      const distSq = dx*dx + dy*dy;

      return distSq <= (r1 + r2)*(r1 + r2);
    };

  }
  
  class RenderObject{
    constructor(obj,uvMin,uvMax){
      this.matrix = obj.matrix.clone();
      this.from(obj);
      this.uvMin = uvMin;
      this.uvMax = uvMax;
      this.isRenderObject = true;
    }
    writeInstance(arr,off){
      const write = (val)=>{
        arr[off]=val;
        off++;
      }
      this.matrix.m.forEach(write);
      write(this.uvMin.x);
      write(this.uvMin.y);
      write(this.uvMax.x);
      write(this.uvMax.y);
      return off;
    }
    
    from(obj){
      this.matrix.copy(obj.matrix);
      const hw = obj.half?.x??obj.radius;
      const hh = obj.half?.y??obj.radius;
      this.matrix.translate(obj.center.x,obj.center.y);
      this.matrix.scale(hw*2,hh*2);
      this.c = obj.center;
      this.hw=hw;
      this.hh=hh;
    }
  }
  
  class Andromeda{
    constructor(renderer){
      this.r = renderer;
    }
    addParticles(x,y,rx,ry,time,color,count,sc,to,opts){
      const dir = new Vector2(rx,ry);
      const len=dir.len();
      if(len>0){
        dir.scale(1/len);
        dir.scale(len/time);
      }
      const rad0 = (Math.PI*2)/(count/sc);
      const rad1 = (Math.PI*2)/sc;
      const l = this.r.particleCount;
      let current = 0;
      const s0 = Math.sin(rad0),c0=Math.cos(rad0),s1=Math.sin(rad1),c1=Math.cos(rad1);
      const self=this;
      function batch(){
        const remainings = Math.min(count-current,sc);
        if(remainings<=0)return;
        const b = new Float32Array(remainings*8);
        for(let i=0;i<remainings;i++){
          const idx = i*8;
          b[idx] = x;
          b[idx+1] = y;
          b[idx+2] = dir.x;
          b[idx+3] = dir.y;
          b[idx+4] = color.r;
          b[idx+5] = color.g;
          b[idx+6] = color.b;
          b[idx+7] = color.a;
          dir.rotate(s1,c1);
          if(opts.colorFrameCallback)color=opts.colorFrameCallback(color);
        }
        self.r.gpu.device.queue.writeBuffer(self.r.particlesBuffer,(l+current)*8*4,b);
        self.r.particleCount+=remainings;
        current+=remainings;
        dir.rotate(s0,c0);
        if(opts.colorCallback)color=opts.colorCallback(color);
        setTimeout(()=>batch(),to||100);
      }
      batch();
    }
  }
  
  class Shaders{
    static createBasicVertex(){
      return `
        ${Shaders.createVertexInput()}
        ${Shaders.createVertexOutput()}
        ${Shaders.createInputsVertex()}
        @vertex
        fn vs_main(in: VertexInput)->VertexOutput{
          var out: VertexOutput;
          let time = world[3][3];
          var rWorld:mat4x4<f32> = world;
          rWorld[3][3] = 1.0;
          let model = mat4x4<f32>(in.model_0,in.model_1,in.model_2,in.model_3);
          out.position = rWorld*model*vec4<f32>(in.position,0.0,1.0);
          out.uv = in.uv;
          out.uvMod = in.uvMod;
          out.time=time;
          return out;
        }
      `;
    }
    
    static createBasicFragment(){
      return `
        ${Shaders.createFragmentInput()}
        ${Shaders.createInputsFragment()}
        @fragment
        fn fs_main(input: FragInput)->@location(0) vec4<f32>{
          var color: vec4<f32>;
          var uv = input.uvMod.xy+input.uv*(input.uvMod.zw-input.uvMod.xy);
          color = textureSampleLevel(tex,texSampler,uv,0.0);
          return color;
        }
      `;
    }
    
    static createBasicShader(){
      return `
        ${Shaders.createBasicVertex()}
        ${Shaders.createBasicFragment()}
      `;
    }
    
    static createFragmentInput(){
      return `
        struct FragInput{
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
          @location(1) uvMod: vec4<f32>,
          @location(2) time:f32
        };
      `;
    }
    
    static createVertexInput(){
      return `
        struct VertexInput{
          @location(0) position: vec2<f32>,
          @location(1) uv: vec2<f32>,
          @location(2) model_0: vec4<f32>,
          @location(3) model_1: vec4<f32>,
          @location(4) model_2: vec4<f32>,
          @location(5) model_3: vec4<f32>,
          @location(6) uvMod: vec4<f32>
        };
      `;
    }
    
    static createVertexOutput(){
      return `
        struct VertexOutput{
          @builtin(position) position: vec4<f32>,
          @location(0) uv: vec2<f32>,
          @location(1) uvMod: vec4<f32>,
          @location(2) time:f32
        };
      `;
    }
    
    static createInputsVertex(){
      return `
        @group(0) @binding(0)
        var<uniform> world: mat4x4<f32>;
      `;
    }
    
    static createInputsFragment(){
      return `
        @group(0) @binding(1)
        var tex: texture_2d<f32>;
        @group(0) @binding(2)
        var texSampler: sampler;
      `;
    }
    
    static createInputsParticleCompute(){
      return `
        @group(0) @binding(0)
        var<storage,read_write> particles: array<Particle>;
      `;
    }
    
    static createInputsParticleVertex(){
      return `
        @group(0) @binding(0)
        var<storage,read> particles: array<Particle>;
      `;
    }
    
    static createParticleStruct(){
      return `
        struct Particle{
          position:vec2<f32>,
          delta:vec2<f32>,
          color:vec4<f32>
        };
      `;
    }
    
    static createParticleVertex(){
      return `
        ${Shaders.createInputsParticleVertex()}
        ${Shaders.createParticleStruct()}
        ${Shaders.createRenderParticleStruct()}
        @vertex
        fn vs_main(@builtin(vertex_index)vid:u32,@builtin(instance_index)iid:u32)->RenderParticle{
          let p = particles[iid];
          let size=0.001;
          let quad = array<vec2<f32>, 4>(
            vec2<f32>(-size, -size),
            vec2<f32>(size, -size),
            vec2<f32>(-size,  size),
            vec2<f32>( size,  size)
          );
          var out : RenderParticle;
          let worldPos = quad[vid] + p.position.xy;
          out.position = vec4<f32>(worldPos, 0.0, 1.0);
          out.color = p.color;
          return out;
        }
      `;
    }
    
    static createRenderParticleStruct(){
      return `
        struct RenderParticle{
          @builtin(position)position:vec4<f32>,
          @location(0)color:vec4<f32>
        };
      `;
    }
    
    static createParticleFragment(){
      return `
        ${Shaders.createRenderParticleStruct()}
        @fragment
        fn fs_main(p:RenderParticle)->@location(0)vec4<f32>{
          return p.color;
        }
      `;
    }
    
    static createParticleCompute(){
      return `
        ${Shaders.createInputsParticleCompute()}
        ${Shaders.createParticleStruct()}
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id)global:vec3<u32>){
          let i=global.x;
          if(i<arrayLength(&particles)){
            var p=particles[i];
            p.position+=p.delta*0.016;
            particles[i]=p;
          }
        }
      `;
    }
    
    static createCustomShader(vs,fs,helpers=[]){
      console.log("helpers",helpers,"joined",helpers.join("\n\n"));
      return helpers.join("\n\n")+(vs?`
        ${Shaders.createInputsVertex()}
        ${Shaders.createVertexInput()}
        ${Shaders.createVertexOutput()}
        @vertex
        fn vs_main(in:VertexInput) -> VertexOutput{
          ${vs}
        }
      `:Shaders.createBasicVertex())+"\n\n"+
      (fs?`
        ${Shaders.createFragmentInput()}
        ${Shaders.createInputsFragment()}
        @fragment
        fn fs_main(in:FragInput) -> @location(0) vec4<f32>{
          ${fs}
        }
      `:Shaders.createBasicFragment());
    }
    
  }
  
  
  Shaders.PRE_WORLD_RENDER = 0;
  Shaders.POST_WORLD_RENDER = 1;
  Shaders.POST_PARTICLE_RENDER = 2;

function setMaxModelMatrices(n) {
  MAX_MODEL_MATRICES = n;
}

function setMaxParticles(n) {
  MAX_PARTICLES = n;
}
  
  export {Renderer, Matrix2D,ORectangle,GPU,OCircle,Shaders,Vector2,RenderObject,Keyboard,Andromeda,setMaxModelMatrices,setMaxParticles,FullscreenQuadWorld,World};
