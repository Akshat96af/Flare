const sharp=require('sharp');
const exif=require('exif-reader');
const fs=require('node:fs/promises');
async function photoMetadata(file){
  const meta=await sharp(Buffer.isBuffer(file)?file:await fs.readFile(file),{limitInputPixels:50000000}).metadata();let taken=null;
  try{const parsed=meta.exif?exif(meta.exif):null;const date=parsed?.Photo?.DateTimeOriginal;if(date instanceof Date&&!Number.isNaN(date.valueOf()))taken=date.valueOf();}catch{}
  return {width:meta.width,height:meta.height,taken};
}
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function photoQuery(input){
  const m=input.trim().match(/^(?:find |search )?photos (?:from |on |taken )?(?:(\d{4})-(\d{2})-(\d{2})|([a-z]+) (\d{4}))$/i);if(!m)return null;
  let start,end;
  if(m[1]){const year=Number(m[1]),month=Number(m[2])-1,day=Number(m[3]);start=Date.UTC(year,month,day);const d=new Date(start);if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month||d.getUTCDate()!==day)return null;end=start+86400000;}
  else{const month=months.indexOf(m[4].toLowerCase());if(month<0)return null;start=Date.UTC(Number(m[5]),month,1);end=Date.UTC(Number(m[5]),month+1,1);}
  return {start,end};
}
module.exports={photoMetadata,photoQuery};
