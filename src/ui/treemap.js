/* Shared, deterministic squarified layout; no filesystem access. */
(function(root){
  function layout(items,width,height){
    if(!(width>0&&height>0))return [];
    const sorted=items.filter(x=>Number.isFinite(x.size)&&x.size>0).slice().sort((a,b)=>b.size-a.size);
    const total=sorted.reduce((s,x)=>s+x.size,0);if(!total)return [];
    const pending=sorted.map(item=>({item,area:item.size/total*width*height}));
    const output=[];let x=0,y=0,w=width,h=height,row=[];
    const worst=(r,side)=>{if(!r.length||side<=0)return Infinity;const sum=r.reduce((s,a)=>s+a.area,0),min=r[r.length-1].area,max=r[0].area;return Math.max(side*side*max/(sum*sum),sum*sum/(side*side*min));};
    function place(){const sum=row.reduce((s,a)=>s+a.area,0);if(w>=h){const rw=sum/h;let ry=y;for(const a of row){const rh=a.area/rw;output.push({item:a.item,x,y:ry,width:rw,height:rh});ry+=rh;}x+=rw;w=Math.max(0,w-rw);}else{const rh=sum/w;let rx=x;for(const a of row){const rw=a.area/rh;output.push({item:a.item,x:rx,y,width:rw,height:rh});rx+=rw;}y+=rh;h=Math.max(0,h-rh);}row=[];}
    for(const a of pending){if(row.length&&worst([...row,a],Math.min(w,h))>worst(row,Math.min(w,h)))place();row.push(a);}if(row.length)place();return output;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={layout};else root.System69Treemap={layout};
})(typeof globalThis!=='undefined'?globalThis:this);
