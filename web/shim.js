// Replaces claude.ai's built-in AI/dictation with your own backend + browser speech, so app.html runs unchanged.
(function(){
const API=window.API_BASE||"";
const tok=()=>{try{return localStorage.getItem("nm_token")||""}catch(e){return""}};
const b64=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(",")[1]);f.readAsDataURL(b)});
async function call(messages,o){
  const images=[];for(const b of (o.images||[]))images.push({media_type:b.type||"image/jpeg",data:await b64(b)});
  const r=await fetch(API+"/api/ai",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+tok()},body:JSON.stringify({messages,images,tier:o.modelTier||"default"})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw {code:r.status==429?"rate_limited":r.status==402?"no_credits":"error",message:j.error||"Request failed"};
  if(o.onText)o.onText({text:j.text,delta:j.text});
  return {text:j.text,truncated:false};
}
const sample=(input,o={})=>call(typeof input==="string"?[{role:"user",content:input}]:input,o);
sample.json=async(i,o)=>{const r=await sample(i,o);return JSON.parse(r.text.replace(/```json|```/g,"").trim())};
sample.limits=async()=>({images:true});
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function dict(){if(!SR)return null;let rec;const fin=[],st=[];return{
  start(){rec=new SR();rec.lang="en-IN";rec.continuous=true;rec.interimResults=false;
    rec.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++)if(e.results[i].isFinal)fin.forEach(f=>f({text:e.results[i][0].transcript}))};
    rec.onstart=()=>st.forEach(f=>f({state:"listening"}));rec.onend=()=>st.forEach(f=>f({state:"idle",reason:"stopped"}));
    rec.start();return Promise.resolve()},
  async stop(){rec&&rec.stop()},onFinal(f){fin.push(f)},onPartial(){},onState(f){st.push(f)}}}
// Native speech recognition for the Capacitor apps (WKWebView and Android
// WebView do not expose the Web Speech API). Same dictation interface as
// dict() above, backed by @capacitor-community/speech-recognition. The
// permission prompt happens on first start(), never at page load.
async function pluginDict(){
  const P=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SpeechRecognition;
  if(!P)return null;
  try{const a=await P.available();if(!a.available)return null}catch(e){return null}
  const fin=[],st=[];let latest="",listening=false,handles=[];
  const emit=text=>{if(text)fin.forEach(f=>f({text}))};
  const setState=on=>{if(on===listening)return;listening=on;st.forEach(f=>f(on?{state:"listening"}:{state:"idle",reason:"stopped"}))};
  return{
    async start(){
      try{await P.requestPermissions()}catch(e){}
      latest="";
      handles.push(await P.addListener("partialResults",d=>{if(d.matches&&d.matches[0])latest=d.matches[0]}));
      handles.push(await P.addListener("listeningState",d=>{
        const on=d.status==="started";setState(on);
        if(!on){const t=latest;latest="";emit(t)}
      }));
      await P.start({language:"en-IN",partialResults:true});
      setState(true);
    },
    async stop(){
      try{await P.stop()}catch(e){}
      const t=latest;latest="";emit(t);setState(false);
      handles.forEach(h=>{try{h.remove()}catch(e){}});handles=[];
    },
    onFinal(f){fin.push(f)},onPartial(){},onState(f){st.push(f)}}}
window.claude={async use(n){return n==="sample"?sample:n==="dictation"?(await pluginDict())||dict():null}};
})();
