import {config} from './config.mjs';
export function chatPrompt(messages){
  // Explicit ChatML keeps the GGUF's Qwen format and avoids exposing reasoning text.
  const sanitize=text=>String(text).replace(/<\|(?:im_start|im_end|endoftext)\|>/g,'');
  return messages.map(m=>`<|im_start|>${m.role}\n${sanitize(m.content)}<|im_end|>\n`).join('')+'<|im_start|>assistant\n<think>\n\n</think>\n\n';
}
export async function modelHealth(){
  try{const response=await fetch(config.modelUrl+'/v1/models',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Unavailable');const result=await response.json();const model=result.data?.find(m=>m.id===config.model);const parameters=model?.meta?.n_params||0;return {available:!!model&&parameters>=26e9&&parameters<=28e9,name:config.model,parameters,context:model?.meta?.n_ctx||8192};}
  catch{return {available:false,name:config.model};}
}
export async function complete(messages,{schema,maxTokens=600,signal,onToken}={}){
  const prompt=chatPrompt(messages);
  const combined=AbortSignal.any([AbortSignal.timeout(config.modelTimeout),...(signal?[signal]:[])]);
  const response=await fetch(config.modelUrl+'/completion',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:combined,
    body:JSON.stringify({prompt,n_predict:maxTokens,temperature:schema?0.1:0.35,top_p:0.9,repeat_penalty:1.08,
      stop:['<|im_end|>','<|im_start|>','<|endoftext|>'],cache_prompt:true,stream:!!onToken,
      ...(schema?{json_schema:schema}:{})})
  });
  if(!response.ok){const body=await response.text();throw Error(`Qwen request failed (${response.status}): ${body.slice(0,180)}`);}
  if(!onToken){const data=await response.json();if(!data.content?.trim())throw Error('Qwen returned an empty response. No answer was substituted.');return {text:data.content.trim(),timings:data.timings,tokens:data.tokens_predicted,stoppedLimit:data.stopped_limit};}
  let buffer='',text='',last={};const reader=response.body.getReader(),decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;
    while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line.startsWith('data:'))continue;const payload=line.slice(5).trim();if(payload==='[DONE]')continue;
      const data=JSON.parse(payload);if(data.error)throw Error(data.error.message||'Qwen generation failed');
      if(data.content){text+=data.content;onToken(data.content);}if(data.stop)last=data;
    }
  }
  if(!text.trim())throw Error('Qwen returned an empty response. No answer was substituted.');
  return {text:text.trim(),timings:last.timings,tokens:last.tokens_predicted,stoppedLimit:last.stopped_limit};
}
export async function countTokens(prompt){
  const r=await fetch(config.modelUrl+'/tokenize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:prompt,add_special:true}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Could not verify model context budget');return (await r.json()).tokens.length;
}
