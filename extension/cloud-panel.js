"use strict";
const params=new URL(location.href).searchParams,board=params.get("board");
const button=document.getElementById("enable"),consent=document.getElementById("consent"),result=document.getElementById("result");
let ready=false;
function failure(message){result.textContent=message;result.className="error";}
async function check(){
  ready=false;button.disabled=true;
  if(window.parent===window || location.ancestorOrigins.length!==1 || location.ancestorOrigins[0]!==board){failure("请从看板第 4 步打开。");return;}
  try{
    const state=await chrome.runtime.sendMessage({type:"cloud-panel-status"});
    if(!state?.ok)throw new Error(state?.error || "连接暂不可用，请重新打开第 4 步。");
    ready=true;button.disabled=false;button.textContent=state.enabled?"更新云端同步":"开启云端同步";result.textContent="";result.className="";
  }catch(error){failure(error.message);}
}
button.onclick=async()=>{
  if(!ready)return;
  if(!consent.checked){failure("请先勾选上方说明。");return;}
  button.disabled=true;result.className="";result.textContent="正在连接…";
  try{
    // Called directly by a click inside the extension frame, retaining the browser gesture.
    const allowed=await chrome.permissions.request({permissions:["cookies"],origins:["https://openapiv5.ketangpai.com/*","http://*.chaoxing.com/*","https://*.chaoxing.com/*","https://ketangpai.com/*","https://www.zhifz.com/*","https://k.ruc.edu.cn/*","https://ruc.thusaac.com/*"]});
    if(!allowed)throw new Error("未开启。需要时可再次点击。");
    const response=await chrome.runtime.sendMessage({type:"cloud-authorize"});
    if(!response?.ok)throw new Error(response?.error || "暂时无法连接，请重试。");
    result.textContent=response.warning || "已开启，正在查看同步结果。";
    window.parent.postMessage({kind:"rucapture-cloud-enabled"},board);
  }catch(error){failure(error.message);}finally{button.disabled=!ready;}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==="local" && ["boardURL","account","token"].some(key=>key in changes)){consent.checked=false;check();}});
if(board && location.ancestorOrigins[0]===board)new ResizeObserver(()=>window.parent.postMessage({kind:"rucapture-cloud-size",height:Math.ceil(document.body.getBoundingClientRect().height)+16},board)).observe(document.body);
check();
