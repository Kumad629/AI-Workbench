export function validateImages(value){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>3)throw new Error('每次最多添加 3 张图片');
 let total=0;
 return value.map((image,i)=>{
  if(!image||typeof image.dataUrl!=='string'||image.dataUrl.length>2800000)throw new Error('图片过大，每张最多 2 MB');
  const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
  if(!match)throw new Error('仅支持 PNG、JPEG、WebP 图片');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>2*1024*1024||bytes.toString('base64')!==match[2])throw new Error('图片内容无效或超过 2 MB');
  const kind=match[1],valid=kind==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):kind==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)throw new Error('图片格式与内容不一致');
  total+=bytes.length;if(total>6*1024*1024)throw new Error('图片总大小不能超过 6 MB');
  return {name:typeof image.name==='string'?image.name.replace(/[\x00-\x1f\\/]/g,'_').slice(0,120)||'图片':('图片-'+(i+1)),dataUrl:image.dataUrl};
 });
}
