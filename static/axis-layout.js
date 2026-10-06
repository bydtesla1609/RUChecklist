"use strict";
// Piecewise-linear paths share every x breakpoint. Keeping their y values ordered
// at those breakpoints guarantees the lines cannot intersect between them.
globalThis.CaptureLayout = {
  interpolate(nodes,x){
    if(x<=nodes[0].x)return nodes[0].y;
    for(let i=1;i<nodes.length;i++)if(x<=nodes[i].x){const a=nodes[i-1],b=nodes[i];return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);}
    return nodes.at(-1).y;
  },
  project(lines,pivot=0,gap=112,anchor=0){
    if(!lines.length)return [];
    // Bound slopes as well as vertical spacing: steep segments must not cut
    // through a neighbouring head or dot even when their y values are ordered.
    const smooth=lines.map((line,i)=>{
      const nodes=line.nodes.map(node=>({...node})),center=i===pivot?Math.max(0,Math.min(anchor,nodes.length-1)):0;
      const clamp=(j,k)=>{const reach=(nodes[j].x-nodes[k].x)*1.2;nodes[j].y=Math.max(nodes[k].y-Math.abs(reach),Math.min(nodes[k].y+Math.abs(reach),nodes[j].y));};
      for(let j=center+1;j<nodes.length;j++)clamp(j,j-1);
      for(let j=center-1;j>=0;j--)clamp(j,j+1);
      return {...line,nodes};
    });
    const xs=[...new Set(smooth.flatMap(line=>line.nodes.map(node=>node.x)))].sort((a,b)=>a-b);
    const paths=lines.map(()=>[]);pivot=Math.max(0,Math.min(pivot,lines.length-1));
    for(const x of xs){
      const ys=smooth.map(line=>this.interpolate(line.nodes,x));
      for(let i=pivot-1;i>=0;i--)ys[i]=Math.min(ys[i],ys[i+1]-gap);
      for(let i=pivot+1;i<ys.length;i++)ys[i]=Math.max(ys[i],ys[i-1]+gap);
      lines.forEach((line,i)=>{if(x>=line.nodes[0].x && x<=line.nodes.at(-1).x)paths[i].push({x,y:ys[i]});});
    }
    return paths;
  }
};
