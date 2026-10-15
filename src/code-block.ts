// Extract the body from the original fenced block, preserving whitespace for copying
// and keeping offsets into the saved message for table excerpts.
export function codeBlockSource(raw:string,fallback:string,language='') {
  const open=raw.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/);
  if(!open)return {content:fallback,offset:0,language};
  const marker=open[1],start=open[0].length;
  let end=raw.length,cursor=start;
  for(const line of raw.slice(start).split('\n')){
    const clean=line.replace(/\r$/,'').trim();
    if(clean.length>=marker.length&&[...clean].every(c=>c===marker[0])){end=cursor;break;}
    cursor+=line.length+1;
  }
  return {content:raw.slice(start,end),offset:start,language:open[2].trim().split(/\s+/)[0]||language};
}
export function markdownCode(language:string,content:string) {
  if(language)return /^(md|markdown|mdown)$/i.test(language);
  // Older web captures discarded the language. Only auto-preview clear Markdown;
  // other unlabelled code can still be previewed explicitly.
  return /^ {0,3}#{1,6} +\S/m.test(content)&&(
    /^ {0,3}#{1,6} +\S[\s\S]*\n {0,3}#{1,6} +\S/m.test(content)||
    /^\s*\|?\s*:?-{3,}:?\s*\|.*$/m.test(content)||
    /^\s*(?:[-*+] |\d+\. |> )\S/m.test(content)
  );
}
