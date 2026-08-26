const $=id=>document.getElementById(id);
const status=$("status"), model=$("model"), preserve=$("preserve"), custom=$("custom");

chrome.storage.local.get({model:"gpt-4o-mini",preserveMeaning:true}, s=>{
  model.value=s.model; preserve.checked=s.preserveMeaning;
});

function save(){
  chrome.storage.local.set({model:model.value,preserveMeaning:preserve.checked});
}

function show(text,error=false){
  status.textContent=text;
  status.style.background=error?"#fff0f0":"#f5f5f5";
  status.style.color=error?"#b42318":"#555";
}

chrome.runtime.sendMessage({type:"GET_STATUS"}, r=>{
  if(chrome.runtime.lastError){ show("Extension is running. Select text on a webpage.",false); return; }
  if(!r?.hasKey){ show("Add your OpenAI API key in Settings.",true); return; }
  show(r.hasSelection ? "Selection detected ✓" : "Select text on the page first.");
});

document.querySelectorAll(".action").forEach(btn=>{
  btn.addEventListener("click",()=>run(btn.dataset.action));
});
custom.addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    e.preventDefault();
    const instruction=custom.value.trim();
    if(!instruction){show("Type a custom instruction first.",true);return;}
    run("custom",instruction);
  }
});
model.addEventListener("change",save);
preserve.addEventListener("change",save);

function run(action,customPrompt=""){
  save();
  show("Working…");
  chrome.runtime.sendMessage({type:"POPUP_ACTION",action,customPrompt}, r=>{
    if(chrome.runtime.lastError){
      show("Could not connect. Refresh the webpage and try again.",true);
      return;
    }
    if(!r?.ok){
      show(r?.error||"Select some text first.",true);
      return;
    }
    show("Done ✓");
    setTimeout(()=>window.close(),500);
  });
}
$("settings").addEventListener("click",()=>chrome.runtime.openOptionsPage());
