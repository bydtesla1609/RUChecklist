"use strict";
// Piecewise-linear paths share every x breakpoint. Keeping their y values ordered
// at those breakpoints guarantees the lines cannot intersect between them.
globalThis.CaptureLayout = {
  interpolate(nodes,x){
    if(x<=nodes[0].x)return nodes[0].y;
    for(let i=1;i<nodes.length;i++)if(x<=nodes[i].x){const a=nodes[i-1],b=nodes[i];return a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);}
    return nodes.at(-1).y;
  },
  project(lines,pivot=0,gap=105){
    if(!lines.length)return [];
    const xs=[...new Set(lines.flatMap(line=>line.nodes.map(node=>node.x)))].sort((a,b)=>a-b);
    const paths=lines.map(()=>[]);pivot=Math.max(0,Math.min(pivot,lines.length-1));
    for(const x of xs){
      const ys=lines.map(line=>this.interpolate(line.nodes,x));
      for(let i=pivot-1;i>=0;i--)ys[i]=Math.min(ys[i],ys[i+1]-gap);
      for(let i=pivot+1;i<ys.length;i++)ys[i]=Math.max(ys[i],ys[i-1]+gap);
      lines.forEach((line,i)=>{if(x>=line.nodes[0].x && x<=line.nodes.at(-1).x)paths[i].push({x,y:ys[i]});});
    }
    return paths;
  }
};
