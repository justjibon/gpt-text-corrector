const DEFAULTS = {
  model: "gpt-4o-mini",
  defaultAction: "correct",
  language: "auto",
  preserveMeaning: true,
  preview: false
};

async function settings() {
  const data = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...data };
}
async function getKey() {
  const data = await chrome.storage.local.get("apiKey");
  return data.apiKey?.trim() || "";
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.contextMenus.removeAll();
  await chrome.contextMenus.create({
    id:"gpt-root", title:"✨ GPT Text Corrector", contexts:["selection"]
  });
  for (const [id,title] of [
    ["correct","✨ Correct"],["professional","💼 Professional"],
    ["casual","😊 Casual"],["shorten","✂️ Shorten"],["improve","🧠 Improve"],
    ["translate","🌍 Translate"]
  ]) {
    await chrome.contextMenus.create({id,parentId:"gpt-root",title,contexts:["selection"]});
  }
});

chrome.contextMenus.onClicked.addListener(async (info,tab)=>{
  if (!tab?.id) return;
  const action = info.menuItemId;
  if (["correct","professional","casual","shorten","improve","translate"].includes(action))
    await ensureAndSend(tab.id,"GPT_DO_ACTION",{action});
});

chrome.commands.onCommand.addListener(async command=>{
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=tabs[0]; if(!tab?.id) return;
  if(command==="correct-selection") await ensureAndSend(tab.id,"GPT_DO_ACTION",{action:"correct"});
  if(command==="open-actions") await ensureAndSend(tab.id,"GPT_OPEN_ACTIONS");
});

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="GET_STATUS"){
    (async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      const tab=tabs[0];
      const key=await getKey();
      let selection=false, available=false;
      if(tab?.id){
        try{
          const r=await ensureAndSend(tab.id,"GPT_GET_SELECTION");
          selection=!!r?.hasSelection; available=true;
        }catch{}
      }
      sendResponse({hasKey:!!key,hasSelection:selection,available});
    })(); return true;
  }

  if(message?.type==="POPUP_ACTION"){
    (async()=>{
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tabs[0]?.id) throw new Error("No active tab.");
      const r=await ensureAndSend(tabs[0].id,"GPT_DO_ACTION",{action:message.action});
      sendResponse(r||{ok:true});
    })().catch(e=>sendResponse({ok:false,error:friendly(e)}));
    return true;
  }

  if(message?.type==="GPT_CORRECT"){
    runGPT(message.text,message.action,message.customPrompt)
      .then(text=>sendResponse({ok:true,text}))
      .catch(e=>sendResponse({ok:false,error:e.message}));
    return true;
  }
});

async function ensureAndSend(tabId,type,payload={}) {
  try { return await chrome.tabs.sendMessage(tabId,{type,...payload}); }
  catch(first) {
    await chrome.scripting.executeScript({target:{tabId,allFrames:true},files:["content.js"]});
    await new Promise(r=>setTimeout(r,60));
    return await chrome.tabs.sendMessage(tabId,{type,...payload});
  }
}
function friendly(e) {
  const s=String(e?.message||e||"");
  return s.includes("Receiving end")||s.includes("Could not establish connection")
    ? "Refresh this page once and try again." : (s||"Could not connect to this page.");
}

const ACTIONS={
  correct:"Correct grammar, spelling, punctuation, and unnatural phrasing.",
  professional:"Rewrite this to sound professional, polished, and natural.",
  casual:"Rewrite this to sound friendly, casual, and natural.",
  shorten:"Make this shorter while preserving the important meaning.",
  improve:"Improve clarity and flow while preserving the meaning and tone.",
  translate:"Translate this text to the user's target language. If no target language is provided, infer the most likely intended language from context."
};

async function runGPT(text,action="correct",customPrompt="") {
  const key=await getKey(); if(!key) throw new Error("Add your OpenAI API key in Settings.");
  const s=await settings();
  let instruction=customPrompt?.trim() || ACTIONS[action] || ACTIONS.correct;
  const lang=s.language==="auto" ? "Automatically detect the source language and preserve it unless the instruction requires translation." : `Write the result in ${s.language}.`;
  const preserve=s.preserveMeaning ? "Preserve the user's intended meaning. Do not invent facts." : "You may make reasonable wording changes.";
  const system=`You are a concise writing assistant. ${instruction} ${lang} ${preserve} Return ONLY the final text. No explanation, no quotes around it.`;

  const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({
      model:s.model,
      messages:[{role:"system",content:system},{role:"user",content:text}],
      max_tokens:1600,
      ...(s.model.startsWith("gpt-5") ? {} : {temperature:0.2})
    })
  });
  const raw=await response.text();
  let data; try{data=JSON.parse(raw)}catch{throw new Error("OpenAI returned an invalid response.")};
  if(!response.ok) throw new Error(data?.error?.message||`OpenAI API error (${response.status})`);
  const out=data?.choices?.[0]?.message?.content?.trim();
  if(!out) throw new Error("OpenAI returned no text.");
  return out;
}